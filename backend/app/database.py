"""Migración inicial no destructiva; nunca se ejecuta seed automáticamente."""
from pathlib import Path

from sqlalchemy import create_engine, event, inspect, select
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from .models import Base, SchemaMigration

SCHEMA_VERSION = 1


def make_database(database_url: str) -> tuple[Engine, sessionmaker]:
    url = make_url(database_url)
    options = {}
    if url.get_backend_name() == "sqlite":
        options["connect_args"] = {"check_same_thread": False, "timeout": 30}
        if url.database in (None, "", ":memory:"):
            options["poolclass"] = StaticPool
        else:
            Path(url.database).resolve().parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(database_url, **options)
    if url.get_backend_name() == "sqlite":
        @event.listens_for(engine, "connect")
        def set_sqlite_pragmas(connection, _record):
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute("PRAGMA busy_timeout=30000")
    return engine, sessionmaker(engine, expire_on_commit=False)


def migrate(engine: Engine) -> None:
    """001: create schema once; refuse unknown/non-versioned databases.

    Future versions must add an explicit upgrade function. create_all is NOT
    used to pretend existing columns have been migrated. No downgrade/delete.
    """
    tables = set(inspect(engine).get_table_names())
    if tables and "schema_migrations" not in tables:
        raise RuntimeError("Base existente sin versión: use una base nueva o una migración revisada.")
    if "schema_migrations" in tables:
        with engine.connect() as connection:
            versions = set(connection.scalars(select(SchemaMigration.version)))
        if versions != {SCHEMA_VERSION}:
            raise RuntimeError("Versión de base no compatible; se requiere migración explícita.")
        missing = set(Base.metadata.tables) - tables
        if missing:
            raise RuntimeError("Esquema incompleto; no se reparará automáticamente.")
        return
    with engine.begin() as connection:
        Base.metadata.create_all(connection)
        connection.execute(SchemaMigration.__table__.insert().values(version=SCHEMA_VERSION))
