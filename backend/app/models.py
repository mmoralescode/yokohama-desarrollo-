"""Persistencia portable: tipos SQLAlchemy compatibles con SQLite/PostgreSQL."""
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint, CheckConstraint, Index
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from .time_utils import date_timestamp, utc_now


def reading_timestamp(context) -> datetime:
    """Legacy date-only callers keep working without inventing a precise time."""
    return date_timestamp(context.get_current_parameters()["date"])


class Base(DeclarativeBase):
    pass


class SchemaMigration(Base):
    __tablename__ = "schema_migrations"
    version: Mapped[int] = mapped_column(primary_key=True)
    applied_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class Vehicle(Base):
    __tablename__ = "vehicles"
    __table_args__ = (CheckConstraint("current_km >= 0"), CheckConstraint("model_year BETWEEN 1886 AND 2100"),
                      CheckConstraint("severity_multiplier BETWEEN 0.1 AND 1"))
    id: Mapped[int] = mapped_column(primary_key=True)
    vin: Mapped[str] = mapped_column(String(17), unique=True)
    plate: Mapped[str] = mapped_column(String(16), unique=True)
    model_year: Mapped[int] = mapped_column(Integer)
    # Catalog-specific variant. Manual entries for other makes intentionally
    # leave this empty rather than inventing a Mazda identifier.
    variant_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    version: Mapped[str] = mapped_column(String(80))
    body_style: Mapped[str] = mapped_column(String(20))
    engine: Mapped[str] = mapped_column(String(20))
    transmission: Mapped[str] = mapped_column(String(10))
    drive: Mapped[str] = mapped_column(String(10))
    current_km: Mapped[float] = mapped_column(Float)
    in_service_date: Mapped[date] = mapped_column(Date)
    usage_regime: Mapped[str] = mapped_column(String(10), default="normal")
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)
    severity_multiplier: Mapped[float] = mapped_column(Float, default=1.0, server_default="1")
    make: Mapped[str | None] = mapped_column(String(80), nullable=True)
    model: Mapped[str | None] = mapped_column(String(80), nullable=True)
    fuel_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    color: Mapped[str | None] = mapped_column(String(40), nullable=True)
    maintenance_catalog: Mapped[str | None] = mapped_column(String(80), nullable=True)
    # Administrative assignments: a shared unit may have several drivers.
    # Existing units gain an empty list, never invented personal data.
    drivers: Mapped[list[str]] = mapped_column(JSON, default=list, server_default="[]")


class OdometerReading(Base):
    __tablename__ = "odometer_readings"
    __table_args__ = (UniqueConstraint("vehicle_id", "recorded_at"), CheckConstraint("odometer_km >= 0"),
                      CheckConstraint("source IN ('manual', 'gps', 'obd')"),
                      CheckConstraint("time_precision IN ('date', 'timestamp')"))
    id: Mapped[int] = mapped_column(primary_key=True)
    vehicle_id: Mapped[int] = mapped_column(ForeignKey("vehicles.id"), index=True)
    date: Mapped[date] = mapped_column(Date)
    odometer_km: Mapped[float] = mapped_column(Float)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=reading_timestamp)
    source: Mapped[str] = mapped_column(String(10), default="manual", server_default="manual")
    time_precision: Mapped[str] = mapped_column(String(12), default="date", server_default="date")


class ServiceCatalog(Base):
    __tablename__ = "service_catalog"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    catalog_version: Mapped[str] = mapped_column(String(40))
    source_snapshot: Mapped[dict] = mapped_column(JSON)


class ServiceHistory(Base):
    __tablename__ = "service_history"
    __table_args__ = (UniqueConstraint("vehicle_id", "service_id", "performed_on"), CheckConstraint("odometer_km >= 0"),
                      CheckConstraint("cost IS NULL OR (cost >= 0 AND cost < 1e308)"),
                      CheckConstraint("maintenance_type IN ('preventive', 'corrective', 'unknown')"))
    id: Mapped[int] = mapped_column(primary_key=True)
    vehicle_id: Mapped[int] = mapped_column(ForeignKey("vehicles.id"), index=True)
    service_id: Mapped[str] = mapped_column(ForeignKey("service_catalog.id"))
    performed_on: Mapped[date] = mapped_column(Date)
    odometer_km: Mapped[float | None] = mapped_column(Float, nullable=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    catalog_snapshot: Mapped[dict] = mapped_column(JSON)
    cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    maintenance_type: Mapped[str] = mapped_column(String(16), default="unknown", server_default="unknown")
    fault_id: Mapped[int | None] = mapped_column(ForeignKey("fault_reports.id"), nullable=True)
    predicted_due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    prediction_error_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    prediction_evaluation_id: Mapped[int | None] = mapped_column(ForeignKey("plan_evaluations.id"), nullable=True)
    # Old rows have no trustworthy capture timestamp. New facts retain both
    # the actual service date and the later administrative capture timestamp.
    captured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, default=utc_now)
    appointment_id: Mapped[str | None] = mapped_column(ForeignKey("calendar_appointments.id"), nullable=True)


class CalendarAppointment(Base):
    __tablename__ = "calendar_appointments"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    vehicle_id: Mapped[int] = mapped_column(ForeignKey("vehicles.id"), index=True)
    scheduled_date: Mapped[date] = mapped_column(Date, index=True)
    service_ids: Mapped[list] = mapped_column(JSON)
    completed_service_ids: Mapped[list] = mapped_column(JSON, default=list)
    cycle_anchors: Mapped[dict] = mapped_column(JSON)
    original_visit_id: Mapped[str | None] = mapped_column(String(220), nullable=True)
    original_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default="scheduled")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class AppointmentChange(Base):
    __tablename__ = "appointment_changes"
    id: Mapped[int] = mapped_column(primary_key=True)
    appointment_id: Mapped[str] = mapped_column(ForeignKey("calendar_appointments.id"), index=True)
    previous_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    scheduled_date: Mapped[date] = mapped_column(Date)
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    notes: Mapped[str] = mapped_column(Text, default="")


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
    service_id: Mapped[str | None] = mapped_column(ForeignKey("service_catalog.id"), nullable=True)
    was_predicted: Mapped[bool | None] = mapped_column(Boolean, nullable=True)


class Downtime(Base):
    __tablename__ = "downtime_periods"
    __table_args__ = (CheckConstraint("ended_at IS NULL OR ended_at > started_at"),
                      Index("ix_downtime_periods_vehicle_started", "vehicle_id", "started_at"))
    id: Mapped[int] = mapped_column(primary_key=True)
    vehicle_id: Mapped[int] = mapped_column(ForeignKey("vehicles.id"), index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    notes: Mapped[str] = mapped_column(Text, default="", server_default="")


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
