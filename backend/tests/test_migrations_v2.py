"""Frozen v1 schema: these tests do not build the old database from new models."""
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
import sqlite3

import pytest
from sqlalchemy import inspect, select
from sqlalchemy.exc import IntegrityError

import app.database as database
from app.database import make_database, migrate
from app.models import Downtime, OdometerReading, SchemaMigration, ServiceHistory, Vehicle


V1_DDL = (
    """CREATE TABLE schema_migrations (version INTEGER NOT NULL PRIMARY KEY, applied_at DATETIME NOT NULL)""",
    """CREATE TABLE vehicles (
      id INTEGER NOT NULL PRIMARY KEY, vin VARCHAR(17) NOT NULL, plate VARCHAR(16) NOT NULL,
      model_year INTEGER NOT NULL CHECK (model_year BETWEEN 2021 AND 2026), variant_id VARCHAR(80) NOT NULL,
      version VARCHAR(80) NOT NULL, body_style VARCHAR(20) NOT NULL, engine VARCHAR(20) NOT NULL,
      transmission VARCHAR(10) NOT NULL, drive VARCHAR(10) NOT NULL, current_km FLOAT NOT NULL CHECK (current_km >= 0),
      in_service_date DATE NOT NULL, usage_regime VARCHAR(10) NOT NULL, is_synthetic BOOLEAN NOT NULL,
      UNIQUE (vin), UNIQUE (plate))""",
    """CREATE TABLE odometer_readings (
      id INTEGER NOT NULL PRIMARY KEY, vehicle_id INTEGER NOT NULL REFERENCES vehicles(id), date DATE NOT NULL,
      odometer_km FLOAT NOT NULL CHECK (odometer_km >= 0), UNIQUE (vehicle_id, date))""",
    "CREATE INDEX ix_odometer_readings_vehicle_id ON odometer_readings(vehicle_id)",
    """CREATE TABLE service_catalog (
      id VARCHAR(80) NOT NULL PRIMARY KEY, catalog_version VARCHAR(40) NOT NULL, source_snapshot JSON NOT NULL)""",
    """CREATE TABLE service_history (
      id INTEGER NOT NULL PRIMARY KEY, vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
      service_id VARCHAR(80) NOT NULL REFERENCES service_catalog(id), performed_on DATE NOT NULL,
      odometer_km FLOAT NOT NULL CHECK (odometer_km >= 0), notes TEXT NOT NULL, catalog_snapshot JSON NOT NULL,
      UNIQUE (vehicle_id, service_id, performed_on))""",
    """CREATE TABLE fault_reports (
      id INTEGER NOT NULL PRIMARY KEY, vehicle_id INTEGER NOT NULL REFERENCES vehicles(id), reported_on DATE NOT NULL,
      description TEXT NOT NULL, dtc VARCHAR(12), severity VARCHAR(16) NOT NULL, status VARCHAR(16) NOT NULL,
      safe_to_defer BOOLEAN NOT NULL, deadline DATE, assessment_notes TEXT NOT NULL, resolution_notes TEXT NOT NULL,
      resolved_on DATE)""",
    """CREATE TABLE plan_evaluations (
      id INTEGER NOT NULL PRIMARY KEY, vehicle_id INTEGER NOT NULL REFERENCES vehicles(id), fingerprint VARCHAR(64) NOT NULL,
      evaluated_at DATETIME NOT NULL, catalog_version VARCHAR(40) NOT NULL, policy_version VARCHAR(40) NOT NULL,
      inputs_snapshot JSON NOT NULL, policy_snapshot JSON NOT NULL, catalog_snapshot JSON NOT NULL, result JSON NOT NULL,
      UNIQUE (fingerprint))""",
    """CREATE TABLE alerts (
      id INTEGER NOT NULL PRIMARY KEY, key VARCHAR(220) NOT NULL, vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
      evaluation_id INTEGER NOT NULL REFERENCES plan_evaluations(id), service_id VARCHAR(80),
      fault_id INTEGER REFERENCES fault_reports(id), status VARCHAR(16) NOT NULL, generation INTEGER NOT NULL, payload JSON NOT NULL,
      UNIQUE (key))""",
    """CREATE TABLE visit_plans (
      id VARCHAR(220) NOT NULL PRIMARY KEY, vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
      evaluation_id INTEGER NOT NULL REFERENCES plan_evaluations(id), planned_date DATE NOT NULL,
      status VARCHAR(16) NOT NULL, payload JSON NOT NULL)""",
    """CREATE TABLE notification_outbox (
      id INTEGER NOT NULL PRIMARY KEY, dedup_key VARCHAR(64) NOT NULL, alert_id INTEGER NOT NULL REFERENCES alerts(id),
      channel VARCHAR(16) NOT NULL, status VARCHAR(16) NOT NULL, created_at DATETIME NOT NULL, payload JSON NOT NULL,
      UNIQUE (dedup_key))""",
)


@pytest.fixture
def v1(tmp_path):
    path = tmp_path / "company.db"
    engine, sessions = make_database(f"sqlite:///{path.as_posix()}")
    with engine.begin() as conn:
        for ddl in V1_DDL:
            conn.exec_driver_sql(ddl)
        conn.exec_driver_sql("INSERT INTO schema_migrations VALUES (1, '2026-01-01 00:00:00.000000')")
        conn.exec_driver_sql("""INSERT INTO vehicles VALUES
            (41, 'DEM00000000000041', 'COMPANY-41', 2021, 'V21S-i', 'i', 'sedan', 'G25', 'AT6', 'FWD',
             40000.5, '2021-01-01', 'normal', 0)""")
        conn.exec_driver_sql("INSERT INTO odometer_readings VALUES (71, 41, '2021-07-01', 1000.25)")
        conn.exec_driver_sql("INSERT INTO odometer_readings VALUES (72, 41, '2026-01-01', 40000.5)")
        conn.exec_driver_sql("INSERT INTO service_catalog VALUES ('aceite_normal', '0.1.0', '{\"original\":true}')")
        conn.exec_driver_sql("""INSERT INTO service_history VALUES
            (81, 41, 'aceite_normal', '2025-12-01', 39000, 'Nota original con ñ', '{"evidence":"original"}')""")
        conn.exec_driver_sql("""INSERT INTO fault_reports VALUES
            (91, 41, '2025-12-02', 'Falla original', NULL, 'menor', 'open', 0, NULL, '', '', NULL)""")
        conn.exec_driver_sql("""INSERT INTO plan_evaluations VALUES
            (101, 41, 'immutable-fingerprint', '2025-12-02 12:00:00.000000', '0.1.0', '0.1.0',
            '{"v":1}', '{"p":1}', '{"c":1}', '{"plan":"original"}')""")
        conn.exec_driver_sql("INSERT INTO alerts VALUES (111, 'immutable-key', 41, 101, NULL, 91, 'open', 2, '{\"alert\":1}')")
        conn.exec_driver_sql("INSERT INTO visit_plans VALUES ('visit-original', 41, 101, '2026-01-10', 'proposed', '{\"visit\":1}')")
        conn.exec_driver_sql("""INSERT INTO notification_outbox VALUES
            (121, 'immutable-dedup', 111, 'email', 'simulated', '2025-12-02 12:00:00.000000', '{"message":1}')""")
    yield engine, sessions, path
    engine.dispose()


def versions(engine):
    with engine.connect() as connection:
        return set(connection.scalars(select(SchemaMigration.version)))


def original_rows(engine):
    with engine.connect() as connection:
        return {
            name: (tuple(column["name"] for column in inspect(connection).get_columns(name)),
                   list(connection.exec_driver_sql(f'SELECT * FROM "{name}" ORDER BY 1')))
            for name in inspect(connection).get_table_names()
        }


def assert_original_rows_preserved(engine, before):
    with engine.connect() as connection:
        for table, (columns, rows) in before.items():
            projection = ", ".join(f'"{column}"' for column in columns)
            result = list(connection.exec_driver_sql(f'SELECT {projection} FROM "{table}" ORDER BY 1'))
            assert (result[:1] if table == "schema_migrations" else result) == rows


def test_upgrade_preserves_all_records_ids_and_snapshots_and_backups_wal(v1):
    engine, sessions, path = v1
    before = original_rows(engine)
    migrate(engine)
    assert versions(engine) == {1, 2, 3, 4, 5}
    assert_original_rows_preserved(engine, before)
    backups = list(path.parent.glob("company.db.pre-v2-*.bak"))
    assert len(backups) == 1
    with sqlite3.connect(backups[0]) as backup:
        assert backup.execute("PRAGMA quick_check").fetchone()[0] == "ok"
        assert backup.execute("SELECT version FROM schema_migrations").fetchall() == [(1,)]
        assert backup.execute("SELECT notes FROM service_history").fetchone()[0] == "Nota original con ñ"
        assert backup.execute("SELECT COUNT(*) FROM notification_outbox").fetchone()[0] == 1
    with sessions() as session:
        vehicle = session.get(Vehicle, 41)
        assert vehicle.severity_multiplier == 1
        assert (vehicle.make, vehicle.model, vehicle.maintenance_catalog) == ("Mazda", "Mazda3", "mazda3-mx.v0.1.0")
        history = session.get(ServiceHistory, 81)
        assert history.cost is None and history.maintenance_type == "unknown"
        assert history.prediction_error_days is None and history.prediction_evaluation_id is None
        # Mexico City used DST in July 2021; UTC normalization must honor it.
        assert session.get(OdometerReading, 71).recorded_at == datetime(2021, 7, 1, 5)
        recent = session.get(OdometerReading, 72)
        assert recent.recorded_at == datetime(2026, 1, 1, 6)
        assert recent.source == "manual" and recent.time_precision == "date"
    migrate(engine)
    assert_original_rows_preserved(engine, before)
    assert len(list(path.parent.glob("company.db.pre-v2-*.bak"))) == 1


def test_upgrade_allows_multiple_times_same_day_but_not_duplicate_timestamp(v1):
    engine, sessions, _ = v1
    migrate(engine)
    with sessions.begin() as session:
        session.add(OdometerReading(vehicle_id=41, date=date(2026, 1, 1), odometer_km=40001,
                                    recorded_at=datetime(2026, 1, 1, 12, tzinfo=timezone.utc),
                                    source="gps", time_precision="timestamp"))
    with pytest.raises(IntegrityError), sessions.begin() as session:
        session.add(OdometerReading(vehicle_id=41, date=date(2026, 1, 1), odometer_km=40001,
                                    recorded_at=datetime(2026, 1, 1, 12, tzinfo=timezone.utc),
                                    source="obd", time_precision="timestamp"))


def test_migration_rolls_back_ddl_and_data_if_any_final_validation_fails(v1, monkeypatch):
    engine, _, _ = v1
    before = original_rows(engine)
    validate = database._validate_schema

    def fail_after_upgrade(connection, version):
        validate(connection, version)
        if version == 2:
            raise RuntimeError("simulated integrity failure")

    monkeypatch.setattr(database, "_validate_schema", fail_after_upgrade)
    with pytest.raises(RuntimeError, match="simulated"):
        migrate(engine)
    assert versions(engine) == {1}
    assert original_rows(engine) == before
    assert "downtime_periods" not in inspect(engine).get_table_names()
    assert "odometer_readings_v2" not in inspect(engine).get_table_names()


def test_malformed_legacy_date_rolls_back_before_removing_old_readings(v1):
    engine, _, _ = v1
    with engine.begin() as connection:
        connection.exec_driver_sql("UPDATE odometer_readings SET date='invalid-date' WHERE id=71")
    before = original_rows(engine)
    with pytest.raises(ValueError):
        migrate(engine)
    assert original_rows(engine) == before
    assert versions(engine) == {1}


def test_backup_failure_prevents_schema_changes(v1, monkeypatch):
    engine, _, _ = v1
    before = original_rows(engine)

    def failure(_engine):
        raise OSError("disk unavailable")

    monkeypatch.setattr(database, "_backup_sqlite", failure)
    with pytest.raises(OSError, match="disk unavailable"):
        migrate(engine)
    assert original_rows(engine) == before


@pytest.mark.parametrize("change", [
    "INSERT INTO schema_migrations VALUES (99, '2026-01-01')",
    "ALTER TABLE vehicles ADD COLUMN unrecognized_secret TEXT",
    "DROP TABLE notification_outbox",
])
def test_unknown_version_or_schema_fails_closed_without_backup(v1, change):
    engine, _, path = v1
    with engine.begin() as connection:
        connection.exec_driver_sql(change)
    before = original_rows(engine)
    with pytest.raises(RuntimeError):
        migrate(engine)
    assert original_rows(engine) == before
    assert list(path.parent.glob("*.bak")) == []


def test_existing_orphan_is_rejected_without_migration(v1):
    engine, _, path = v1
    with sqlite3.connect(path) as direct:
        direct.execute("INSERT INTO odometer_readings VALUES (999, 999, '2026-01-02', 1)")
    with pytest.raises(RuntimeError, match="referencias inválidas"):
        migrate(engine)
    assert versions(engine) == {1}


def test_concurrent_startup_upgrades_only_once(v1):
    engine, _, path = v1
    other, _ = make_database(f"sqlite:///{path.as_posix()}")
    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(migrate, (engine, other)))
        assert results == [None, None]
        assert versions(engine) == {1, 2, 3, 4, 5}
        with engine.connect() as connection:
            assert connection.exec_driver_sql("SELECT COUNT(*) FROM odometer_readings").scalar_one() == 2
    finally:
        other.dispose()


def test_fresh_database_orm_defaults_and_constraints(tmp_path):
    engine, sessions = make_database(f"sqlite:///{(tmp_path / 'fresh.db').as_posix()}")
    migrate(engine)
    migrate(engine)
    assert versions(engine) == {1, 2, 3, 4, 5}
    with sessions.begin() as session:
        vehicle = Vehicle(vin="DEM00000000000123", plate="DEFAULT-123", model_year=2021, variant_id="V21S-i",
                          version="i", body_style="sedan", engine="G25", transmission="AT6", drive="FWD",
                          current_km=1000, in_service_date=date(2021, 1, 1))
        session.add(vehicle)
        session.flush()
        vehicle_id = vehicle.id
        reading = OdometerReading(vehicle_id=vehicle_id, date=date(2026, 1, 2), odometer_km=1000)
        session.add(reading)
        session.flush()
        assert reading.recorded_at == datetime(2026, 1, 2, 6, tzinfo=timezone.utc)
        assert reading.source == "manual" and reading.time_precision == "date"
    with pytest.raises(IntegrityError), sessions.begin() as session:
        session.add(Downtime(vehicle_id=vehicle_id, started_at=datetime(2026, 1, 2), ended_at=datetime(2026, 1, 1)))
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.exec_driver_sql("UPDATE vehicles SET severity_multiplier=1.5")
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.exec_driver_sql("UPDATE odometer_readings SET source='unknown'")
    engine.dispose()


def test_v2_to_v3_preserves_references_and_accepts_manual_vehicle_years(v1):
    """The multibrand upgrade starts from a real v2 shape, not current ORM DDL."""
    engine, sessions, path = v1
    with engine.connect() as connection:
        connection.exec_driver_sql("BEGIN IMMEDIATE")
        database._upgrade_v1_to_v2(connection)
        connection.commit()
    assert versions(engine) == {1, 2}
    with engine.connect() as connection:
        before = {
            table: list(connection.exec_driver_sql(f'SELECT * FROM "{table}" ORDER BY 1'))
            for table in ("vehicles", "odometer_readings", "service_history", "fault_reports", "plan_evaluations", "alerts", "visit_plans", "notification_outbox")
        }
    migrate(engine)
    assert versions(engine) == {1, 2, 3, 4, 5}
    assert len(list(path.parent.glob("company.db.pre-v3-*.bak"))) == 1
    with engine.connect() as connection:
        assert connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall() == []
        for table, rows in before.items():
            columns = [column["name"] for column in inspect(connection).get_columns(table) if column["name"] not in {"make", "model", "fuel_type", "color", "maintenance_catalog", "captured_at", "appointment_id", "drivers"}]
            projection = ", ".join(f'"{column}"' for column in columns)
            assert list(connection.exec_driver_sql(f'SELECT {projection} FROM "{table}" ORDER BY 1')) == rows
    with sessions.begin() as session:
        legacy = session.get(Vehicle, 41)
        assert (legacy.id, legacy.make, legacy.model, legacy.maintenance_catalog) == (41, "Mazda", "Mazda3", "mazda3-mx.v0.1.0")
        for index, year in enumerate((1886, 2100), start=1):
            session.add(Vehicle(vin=f"DEM00000000000{700 + index}", plate=f"YEAR-{year}", model_year=year,
                                variant_id=None, version="Manual", body_style="sedan", engine="electrico",
                                transmission="CVT", drive="FWD", current_km=0, in_service_date=date(2026, 1, 1),
                                make="Prueba", model="Multimarca"))
    with pytest.raises(IntegrityError), sessions.begin() as session:
        session.add(Vehicle(vin="DEM00000000000709", plate="YEAR-1885", model_year=1885, variant_id=None,
                            version="Manual", body_style="sedan", engine="electrico", transmission="CVT", drive="FWD",
                            current_km=0, in_service_date=date(2026, 1, 1), make="Prueba", model="Multimarca"))
