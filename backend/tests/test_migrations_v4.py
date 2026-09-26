import sqlite3

import pytest
from sqlalchemy import inspect

import app.database as database
from app.database import migrate
from test_migrations_v2 import original_rows, v1, versions


@pytest.fixture
def v3(v1):
    engine, sessions, path = v1
    with engine.connect() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
        connection.commit()
        connection.exec_driver_sql("BEGIN IMMEDIATE")
        database._upgrade_v1_to_v2(connection)
        database._upgrade_v2_to_v3(connection)
        connection.commit()
        connection.exec_driver_sql("PRAGMA foreign_keys=ON")
    assert versions(engine) == {1, 2, 3}
    return engine, sessions, path


def test_v3_backup_and_unknown_capture_time_preserve_every_existing_value(v3):
    engine, _, path = v3
    before = original_rows(engine)
    migrate(engine)
    assert versions(engine) == {1, 2, 3, 4, 5}
    with engine.connect() as connection:
        for table, (columns, rows) in before.items():
            if table == "schema_migrations":
                continue
            projection = ", ".join(f'"{column}"' for column in columns)
            assert list(connection.exec_driver_sql(f'SELECT {projection} FROM "{table}" ORDER BY 1')) == rows
        assert connection.exec_driver_sql("SELECT captured_at, appointment_id FROM service_history").one() == (None, None)
        assert connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall() == []
        assert connection.exec_driver_sql("PRAGMA quick_check").scalar_one() == "ok"
    backups = list(path.parent.glob("company.db.pre-v4-*.bak"))
    assert len(backups) == 1
    with sqlite3.connect(backups[0]) as backup:
        assert backup.execute("SELECT version FROM schema_migrations").fetchall() == [(1,), (2,), (3,)]
        assert backup.execute("SELECT notes FROM service_history").fetchone()[0] == "Nota original con ñ"
    migrate(engine)
    assert len(list(path.parent.glob("company.db.pre-v4-*.bak"))) == 1


def test_v4_only_renames_exact_seeded_plate_and_preserves_forecasts(v3):
    engine, _, _ = v3
    with engine.begin() as connection:
        connection.exec_driver_sql("UPDATE vehicles SET vin='DEM00000000000001', plate='DEMO-001', is_synthetic=1 WHERE id=41")
        prior = connection.exec_driver_sql("SELECT result FROM plan_evaluations").scalar_one()
    migrate(engine)
    with engine.connect() as connection:
        assert connection.exec_driver_sql("SELECT plate FROM vehicles WHERE id=41").scalar_one() == "YKH-101-A"
        assert connection.exec_driver_sql("SELECT result FROM plan_evaluations").scalar_one() == prior


@pytest.mark.parametrize("vin,plate,synthetic", [
    ("DEM00000000000001", "DEMO-001", 0),
    ("DEM00000000000001", "COMPANY-1", 1),
    ("DEM00000000000888", "DEMO-001", 1),
])
def test_v4_never_changes_operator_plates(v3, vin, plate, synthetic):
    engine, _, _ = v3
    with engine.begin() as connection:
        connection.exec_driver_sql("UPDATE vehicles SET vin=?, plate=?, is_synthetic=? WHERE id=41", (vin, plate, synthetic))
    migrate(engine)
    with engine.connect() as connection:
        assert connection.exec_driver_sql("SELECT plate FROM vehicles WHERE id=41").scalar_one() == plate


def test_v4_failure_rolls_back_ddl_and_all_data(v3, monkeypatch):
    engine, _, _ = v3
    before = original_rows(engine)
    original_validation = database._validate_schema

    def fail(connection, version):
        original_validation(connection, version)
        if version == 4:
            raise RuntimeError("failure after v4")

    monkeypatch.setattr(database, "_validate_schema", fail)
    with pytest.raises(RuntimeError, match="failure after v4"):
        migrate(engine)
    assert original_rows(engine) == before
    assert "calendar_appointments" not in inspect(engine).get_table_names()
