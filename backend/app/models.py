"""Persistencia portable: tipos SQLAlchemy compatibles con SQLite/PostgreSQL."""
from datetime import date, datetime, timezone

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint, CheckConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class SchemaMigration(Base):
    __tablename__ = "schema_migrations"
    version: Mapped[int] = mapped_column(primary_key=True)
    applied_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class Vehicle(Base):
    __tablename__ = "vehicles"
    __table_args__ = (CheckConstraint("current_km >= 0"), CheckConstraint("model_year BETWEEN 2021 AND 2026"))
    id: Mapped[int] = mapped_column(primary_key=True)
    vin: Mapped[str] = mapped_column(String(17), unique=True)
    plate: Mapped[str] = mapped_column(String(16), unique=True)
    model_year: Mapped[int] = mapped_column(Integer)
    variant_id: Mapped[str] = mapped_column(String(80))
    version: Mapped[str] = mapped_column(String(80))
    body_style: Mapped[str] = mapped_column(String(20))
    engine: Mapped[str] = mapped_column(String(20))
    transmission: Mapped[str] = mapped_column(String(10))
    drive: Mapped[str] = mapped_column(String(10))
    current_km: Mapped[float] = mapped_column(Float)
    in_service_date: Mapped[date] = mapped_column(Date)
    usage_regime: Mapped[str] = mapped_column(String(10), default="normal")
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)


class OdometerReading(Base):
    __tablename__ = "odometer_readings"
    __table_args__ = (UniqueConstraint("vehicle_id", "date"), CheckConstraint("odometer_km >= 0"))
    id: Mapped[int] = mapped_column(primary_key=True)
    vehicle_id: Mapped[int] = mapped_column(ForeignKey("vehicles.id"), index=True)
    date: Mapped[date] = mapped_column(Date)
    odometer_km: Mapped[float] = mapped_column(Float)


class ServiceCatalog(Base):
    __tablename__ = "service_catalog"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    catalog_version: Mapped[str] = mapped_column(String(40))
    source_snapshot: Mapped[dict] = mapped_column(JSON)


class ServiceHistory(Base):
    __tablename__ = "service_history"
    __table_args__ = (UniqueConstraint("vehicle_id", "service_id", "performed_on"), CheckConstraint("odometer_km >= 0"))
    id: Mapped[int] = mapped_column(primary_key=True)
    vehicle_id: Mapped[int] = mapped_column(ForeignKey("vehicles.id"), index=True)
    service_id: Mapped[str] = mapped_column(ForeignKey("service_catalog.id"))
    performed_on: Mapped[date] = mapped_column(Date)
    odometer_km: Mapped[float] = mapped_column(Float)
    notes: Mapped[str] = mapped_column(Text, default="")
    catalog_snapshot: Mapped[dict] = mapped_column(JSON)


class FaultReport(Base):
    __tablename__ = "fault_reports"
    id: Mapped[int] = mapped_column(primary_key=True)
    vehicle_id: Mapped[int] = mapped_column(ForeignKey("vehicles.id"), index=True)
    reported_on: Mapped[date] = mapped_column(Date)
    description: Mapped[str] = mapped_column(Text)
    dtc: Mapped[str | None] = mapped_column(String(12), nullable=True)
    severity: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), default="open")
    safe_to_defer: Mapped[bool] = mapped_column(Boolean, default=False)
    deadline: Mapped[date | None] = mapped_column(Date, nullable=True)
    assessment_notes: Mapped[str] = mapped_column(Text, default="")
    resolution_notes: Mapped[str] = mapped_column(Text, default="")
    resolved_on: Mapped[date | None] = mapped_column(Date, nullable=True)


class PlanEvaluation(Base):
    __tablename__ = "plan_evaluations"
    id: Mapped[int] = mapped_column(primary_key=True)
    vehicle_id: Mapped[int] = mapped_column(ForeignKey("vehicles.id"), index=True)
    fingerprint: Mapped[str] = mapped_column(String(64), unique=True)
    evaluated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    catalog_version: Mapped[str] = mapped_column(String(40))
    policy_version: Mapped[str] = mapped_column(String(40))
    inputs_snapshot: Mapped[dict] = mapped_column(JSON)
    policy_snapshot: Mapped[dict] = mapped_column(JSON)
    catalog_snapshot: Mapped[dict] = mapped_column(JSON)
    result: Mapped[dict] = mapped_column(JSON)


class Alert(Base):
    __tablename__ = "alerts"
    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(220), unique=True)
    vehicle_id: Mapped[int] = mapped_column(ForeignKey("vehicles.id"), index=True)
    evaluation_id: Mapped[int] = mapped_column(ForeignKey("plan_evaluations.id"))
    service_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    fault_id: Mapped[int | None] = mapped_column(ForeignKey("fault_reports.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="open")
    generation: Mapped[int] = mapped_column(Integer, default=1)
    payload: Mapped[dict] = mapped_column(JSON)


class VisitPlan(Base):
    __tablename__ = "visit_plans"
    id: Mapped[str] = mapped_column(String(220), primary_key=True)
    vehicle_id: Mapped[int] = mapped_column(ForeignKey("vehicles.id"), index=True)
    evaluation_id: Mapped[int] = mapped_column(ForeignKey("plan_evaluations.id"))
    planned_date: Mapped[date] = mapped_column(Date, index=True)
    status: Mapped[str] = mapped_column(String(16), default="proposed")
    payload: Mapped[dict] = mapped_column(JSON)


class Notification(Base):
    __tablename__ = "notification_outbox"
    id: Mapped[int] = mapped_column(primary_key=True)
    dedup_key: Mapped[str] = mapped_column(String(64), unique=True)
    alert_id: Mapped[int] = mapped_column(ForeignKey("alerts.id"))
    channel: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), default="simulated")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    payload: Mapped[dict] = mapped_column(JSON)
