"""The additive driver migration preserves all preexisting data and history."""
from concurrent.futures import ThreadPoolExecutor
import sqlite3

import pytest
from sqlalchemy import inspect

import app.database as database
from app.database import make_database, migrate
from app.models import Vehicle
from test_migrations_v2 import original_rows, v1, versions
from test_migrations_v4 import v3


@pytest.fixture
def v4(v3):
    engine, sessions, path = v3
    with engine.begin() as connection:
        database._upgrade_v3_to_v4(connection)
        connection.exec_driver_sql("""INSERT INTO calendar_appointments
            VALUES ('original-appointment', 41, '2026-09-20', '["aceite_normal"]', '["aceite_normal"]', '{}',
            'visit-original', '2026-09-10', 'Nota de agenda', 'completed', '2026-09-01', '2026-09-24')""")
        connection.exec_driver_sql("""INSERT INTO appointment_changes
            VALUES (1, 'original-appointment', '2026-09-10', '2026-09-20', '2026-09-02', 'Cambio de fecha')""")
        connection.exec_driver_sql("""UPDATE service_history
            SET captured_at='2026-09-24 12:00:00', appointment_id='original-appointment', odometer_km=NULL""")
    assert versions(engine) == {1, 2, 3, 4}
    return engine, sessions, path


def assert_previous_data(engine, before):
    with engine.connect() as connection:
        for table, (columns, rows) in before.items():
            projection = ", ".join(f'"{column}"' for column in columns)
            actual = list(connection.exec_driver_sql(f'SELECT {projection} FROM "{table}" ORDER BY 1'))
            assert (actual[:len(rows)] if table == "schema_migrations" else actual) == rows


def test_v4_upgrade_backup_idempotency_preserves_every_existing_value(v4):
    engine, sessions, path = v4
    before = original_rows(engine)
    migrate(engine)
    assert versions(engine) == {1, 2, 3, 4, 5}
    assert_previous_data(engine, before)
    with sessions() as session:
        assert session.get(Vehicle, 41).drivers == []
    with engine.connect() as connection:
        assert connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall() == []
        assert connection.exec_driver_sql("PRAGMA quick_check").scalar_one() == "ok"
    backups = list(path.parent.glob("company.db.pre-v5-*.bak"))
    assert len(backups) == 1
    with sqlite3.connect(backups[0]) as backup:
        assert backup.execute("SELECT version FROM schema_migrations ORDER BY version").fetchall() == [(1,), (2,), (3,), (4,)]
        assert "drivers" not in [row[1] for row in backup.execute("PRAGMA table_info(vehicles)")]
        assert backup.execute("SELECT notes FROM calendar_appointments").fetchone()[0] == "Nota de agenda"
        assert backup.execute("PRAGMA quick_check").fetchone()[0] == "ok"
    migrate(engine)
    assert_previous_data(engine, before)
    assert len(list(path.parent.glob("company.db.pre-v5-*.bak"))) == 1


def test_v5_validation_failure_rolls_back_ddl_and_data(v4, monkeypatch):
    engine, _, _ = v4
    before = original_rows(engine)
    original_validation = database._validate_schema

    def fail(connection, version):
        original_validation(connection, version)
        if version == 5:
            raise RuntimeError("failure after v5")

    monkeypatch.setattr(database, "_validate_schema", fail)
    with pytest.raises(RuntimeError, match="failure after v5"):
        migrate(engine)
    assert original_rows(engine) == before
    assert "drivers" not in [column["name"] for column in inspect(engine).get_columns("vehicles")]


def test_v5_backup_failure_aborts_before_mutation(v4, monkeypatch):
    engine, _, _ = v4
    before = original_rows(engine)

    def fail(*_args):
        raise OSError("backup unavailable")

    monkeypatch.setattr(database, "_backup_sqlite_for_version", fail)
    with pytest.raises(OSError, match="backup unavailable"):
        migrate(engine)
    assert original_rows(engine) == before


def test_concurrent_v4_startups_upgrade_once(v4):
    engine, _, path = v4
    other, _ = make_database(f"sqlite:///{path.as_posix()}")
    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            assert list(executor.map(migrate, (engine, other))) == [None, None]
        assert versions(engine) == {1, 2, 3, 4, 5}
        assert len(list(path.parent.glob("company.db.pre-v5-*.bak"))) == 1
    finally:
        other.dispose()
