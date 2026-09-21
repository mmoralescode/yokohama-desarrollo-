"""Versioned, transactional migrations. Startup never seeds or erases data."""
from datetime import date, datetime, timezone
from pathlib import Path
import sqlite3
from uuid import uuid4

from sqlalchemy import create_engine, event, inspect, select
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from .models import Base, SchemaMigration
from .time_utils import date_timestamp

SCHEMA_VERSION = 2
V2_COLUMNS = {
    "vehicles": {"severity_multiplier"},
    "odometer_readings": {"recorded_at", "source", "time_precision"},
    "service_history": {"cost", "maintenance_type", "fault_id", "predicted_due_date",
                        "prediction_error_days", "prediction_evaluation_id"},
    "fault_reports": {"service_id", "was_predicted"},
}


def make_database(database_url: str) -> tuple[Engine, sessionmaker]:
    url = make_url(database_url)
    options = {}
    file_sqlite = url.get_backend_name() == "sqlite" and url.database not in (None, "", ":memory:")
    if url.get_backend_name() == "sqlite":
        options["connect_args"] = {"check_same_thread": False, "timeout": 30}
        if not file_sqlite:
            options["poolclass"] = StaticPool
        else:
            Path(url.database).resolve().parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(database_url, **options)
    if url.get_backend_name() == "sqlite":
        @event.listens_for(engine, "connect")
        def set_sqlite_pragmas(connection, _record):
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute("PRAGMA busy_timeout=30000")
            if file_sqlite:
                connection.execute("PRAGMA journal_mode=WAL")
                connection.execute("PRAGMA synchronous=FULL")
    return engine, sessionmaker(engine, expire_on_commit=False)


def _versions(connection) -> set[int]:
    return set(connection.scalars(select(SchemaMigration.version)))


def _validate_schema(connection, version: int) -> None:
    """Fail closed rather than rebuild an unfamiliar table and lose columns."""
    inspector = inspect(connection)
    expected_tables = set(Base.metadata.tables)
    if version == 1:
        expected_tables.remove("downtime_periods")
    if set(inspector.get_table_names()) != expected_tables:
        raise RuntimeError("Esquema incompleto o desconocido; no se reparará automáticamente.")
    for name in expected_tables:
        model_table = Base.metadata.tables[name]
        expected_columns = set(model_table.columns.keys()) - (V2_COLUMNS.get(name, set()) if version == 1 else set())
        reflected = {column["name"]: column for column in inspector.get_columns(name)}
        if set(reflected) != expected_columns:
            raise RuntimeError(f"Esquema desconocido en {name}; se requiere una migración revisada.")
        for column in expected_columns:
            actual = str(reflected[column]["type"]).upper()
            expected = str(model_table.columns[column].type.compile(dialect=connection.dialect)).upper()
            if actual != expected:
                raise RuntimeError(f"Tipo de columna desconocido en {name}.{column}.")
            if reflected[column]["nullable"] != model_table.columns[column].nullable:
                raise RuntimeError(f"Nulabilidad desconocida en {name}.{column}.")
        if tuple(inspector.get_pk_constraint(name)["constrained_columns"]) != tuple(model_table.primary_key.columns.keys()):
            raise RuntimeError(f"Clave primaria desconocida en {name}.")
        expected_unique = {
            tuple(constraint.columns.keys()) for constraint in model_table.constraints
            if constraint.__class__.__name__ == "UniqueConstraint"
        }
        if name == "odometer_readings" and version == 1:
            expected_unique = {("vehicle_id", "date")}
        actual_unique = {tuple(constraint["column_names"]) for constraint in inspector.get_unique_constraints(name)}
        if actual_unique != expected_unique:
            raise RuntimeError(f"Restricciones de unicidad desconocidas en {name}.")
        expected_foreign = {
            (tuple(constraint.column_keys), tuple(element.column.table.name for element in constraint.elements),
             tuple(element.column.name for element in constraint.elements))
            for constraint in model_table.foreign_key_constraints
            if set(constraint.column_keys) <= expected_columns
        }
        actual_foreign = {
            (tuple(constraint["constrained_columns"]), (constraint["referred_table"],) * len(constraint["referred_columns"]),
             tuple(constraint["referred_columns"]))
            for constraint in inspector.get_foreign_keys(name)
        }
        if actual_foreign != expected_foreign:
            raise RuntimeError(f"Claves foráneas desconocidas en {name}.")
    if connection.dialect.name == "sqlite":
        if connection.exec_driver_sql("SELECT name FROM sqlite_master WHERE type='trigger'").first() is not None:
            raise RuntimeError("La base tiene triggers no reconocidos; requiere revisión antes de migrar.")
        if connection.exec_driver_sql("PRAGMA foreign_key_check").first() is not None:
            raise RuntimeError("La base tiene referencias inválidas; no se migrará automáticamente.")


def _backup_sqlite(engine: Engine) -> Path | None:
    """Online backup API includes committed WAL pages, unlike copying the .db."""
    database = engine.url.database
    if not database or database == ":memory:":
        return None
    source = Path(database).resolve()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    target = source.with_name(f"{source.name}.pre-v2-{stamp}-{uuid4().hex[:8]}.bak")
    # A failed backup aborts before mutation. Preserve a partial backup for diagnosis.
    with sqlite3.connect(source) as original, sqlite3.connect(target) as backup:
        original.backup(backup)
        if backup.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise RuntimeError("No se pudo verificar el respaldo previo a la migración.")
    return target


def _upgrade_v1_to_v2(connection) -> None:
    """Explicit SQLite upgrade. Caller owns BEGIN IMMEDIATE and the rollback."""
    connection.exec_driver_sql(
        "ALTER TABLE vehicles ADD COLUMN severity_multiplier FLOAT NOT NULL DEFAULT 1 "
        "CHECK (severity_multiplier BETWEEN 0.1 AND 1)"
    )
    additions = {
        "service_history": [
            "cost FLOAT CHECK (cost IS NULL OR (cost >= 0 AND cost < 1e308))",
            "maintenance_type VARCHAR(16) NOT NULL DEFAULT 'unknown' "
            "CHECK (maintenance_type IN ('preventive', 'corrective', 'unknown'))",
            "fault_id INTEGER REFERENCES fault_reports(id)",
            "predicted_due_date DATE",
            "prediction_error_days INTEGER",
            "prediction_evaluation_id INTEGER REFERENCES plan_evaluations(id)",
        ],
        "fault_reports": ["service_id VARCHAR(80) REFERENCES service_catalog(id)", "was_predicted BOOLEAN"],
    }
    for table, columns in additions.items():
        for definition in columns:
            connection.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {definition}")
    # No table references odometer_readings. Foreign keys remain ON throughout.
    connection.exec_driver_sql("""
        CREATE TABLE odometer_readings_v2 (
            id INTEGER NOT NULL PRIMARY KEY,
            vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
            date DATE NOT NULL,
            odometer_km FLOAT NOT NULL CHECK (odometer_km >= 0),
            recorded_at DATETIME NOT NULL,
            source VARCHAR(10) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','gps','obd')),
            time_precision VARCHAR(12) NOT NULL DEFAULT 'date' CHECK (time_precision IN ('date','timestamp')),
            UNIQUE (vehicle_id, recorded_at)
        )
    """)
    previous_count = connection.exec_driver_sql("SELECT COUNT(*) FROM odometer_readings").scalar_one()
    rows = connection.exec_driver_sql("SELECT id, vehicle_id, date, odometer_km FROM odometer_readings ORDER BY id")
    while chunk := rows.fetchmany(1000):
        migrated = []
        for row in chunk:
            # Historical dates never gain fictitious time precision.
            recorded = date_timestamp(date.fromisoformat(row[2])).replace(tzinfo=None)
            migrated.append((*row, recorded.strftime("%Y-%m-%d %H:%M:%S.%f"), "manual", "date"))
        connection.exec_driver_sql("INSERT INTO odometer_readings_v2 VALUES (?, ?, ?, ?, ?, ?, ?)", migrated)
    if connection.exec_driver_sql("SELECT COUNT(*) FROM odometer_readings_v2").scalar_one() != previous_count:
        raise RuntimeError("El conteo de lecturas no coincide; se canceló la migración.")
    connection.exec_driver_sql("DROP TABLE odometer_readings")
    connection.exec_driver_sql("ALTER TABLE odometer_readings_v2 RENAME TO odometer_readings")
    connection.exec_driver_sql("CREATE INDEX ix_odometer_readings_vehicle_id ON odometer_readings(vehicle_id)")
    Base.metadata.tables["downtime_periods"].create(connection)
    connection.execute(SchemaMigration.__table__.insert().values(version=2))


def migrate(engine: Engine) -> None:
    """Create current schema or atomically upgrade the recognized v1 schema.

    Unknown versions, altered columns/uniqueness, or broken foreign keys fail
    closed. Existing values are preserved; nullable new fields remain unknown.
    """
    with engine.connect() as connection:
        if engine.dialect.name == "sqlite":
            # Legacy sqlite3 mode otherwise runs each introspection SELECT in a
            # separate snapshot, racing another process's startup migration.
            connection.exec_driver_sql("BEGIN")
        tables = set(inspect(connection).get_table_names())
        if tables and "schema_migrations" not in tables:
            raise RuntimeError("Base existente sin versión: use una base nueva o una migración revisada.")
        versions = _versions(connection) if tables else set()
        if tables and versions not in ({1}, {1, 2}):
            raise RuntimeError("Versión de base no compatible; se requiere migración explícita.")
        if tables:
            _validate_schema(connection, max(versions))
        connection.rollback()
        if versions == {1, 2}:
            return
        if versions == {1}:
            if engine.dialect.name != "sqlite":
                raise RuntimeError("La migración v1→v2 requiere SQLite; revise el upgrade del otro motor.")
        # Explicit BEGIN prevents sqlite3 legacy mode from committing DDL early.
        if engine.dialect.name == "sqlite":
            connection.exec_driver_sql("BEGIN IMMEDIATE")
        else:
            connection.begin()
        try:
            # Another process may have completed startup while we waited.
            current_tables = set(inspect(connection).get_table_names())
            if not current_tables:
                Base.metadata.create_all(connection)
                connection.execute(SchemaMigration.__table__.insert(), [{"version": 1}, {"version": 2}])
            elif "schema_migrations" not in current_tables:
                raise RuntimeError("Base existente sin versión; se canceló la migración.")
            else:
                current_versions = _versions(connection)
                if current_versions == {1}:
                    _validate_schema(connection, 1)
                    # We hold the write reservation but have changed no data.
                    # A separate reader backs up this committed v1 snapshot;
                    # another startup/writer cannot race the verified backup.
                    _backup_sqlite(engine)
                    _upgrade_v1_to_v2(connection)
                elif current_versions != {1, 2}:
                    raise RuntimeError("La versión cambió durante la migración.")
            _validate_schema(connection, SCHEMA_VERSION)
            if engine.dialect.name == "sqlite" and connection.exec_driver_sql("PRAGMA quick_check").scalar_one() != "ok":
                raise RuntimeError("La verificación de integridad falló; se canceló la migración.")
            connection.commit()
        except BaseException:
            connection.rollback()
            raise
