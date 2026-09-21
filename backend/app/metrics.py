"""Descriptive, auditable metrics; missing labels are never treated as successes."""
from datetime import datetime
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from .models import Downtime, FaultReport, ServiceHistory, Vehicle
from .time_utils import TIMEZONE, as_utc, utc_now


def fleet_metrics(session: Session, synthetic: bool | None = False, now: datetime | None = None) -> dict:
    now = now or utc_now()
    vehicle_ids = select(Vehicle.id)
    if synthetic is not None:
        vehicle_ids = vehicle_ids.where(Vehicle.is_synthetic == synthetic)

    def count(model, *conditions):
        return session.scalar(select(func.count(model.id)).where(model.vehicle_id.in_(vehicle_ids), *conditions)) or 0

    total = count(ServiceHistory)
    classified = count(ServiceHistory, ServiceHistory.maintenance_type.in_(["preventive", "corrective"]))
    preventive = count(ServiceHistory, ServiceHistory.maintenance_type == "preventive")
    samples, absolute, signed = session.execute(select(
        func.count(ServiceHistory.prediction_error_days),
        func.avg(func.abs(ServiceHistory.prediction_error_days)),
        func.avg(ServiceHistory.prediction_error_days),
    ).where(ServiceHistory.vehicle_id.in_(vehicle_ids))).one()
    downtime_seconds = 0
    open_count = 0
    for row in session.scalars(select(Downtime).where(Downtime.vehicle_id.in_(vehicle_ids))):
        end = min(as_utc(row.ended_at), now) if row.ended_at else now
        downtime_seconds += max(0, (end - as_utc(row.started_at)).total_seconds())
        open_count += row.ended_at is None
    return {
        "total_services": total, "classified_services": classified, "preventive_services": preventive,
        "services_before_failure_percent": round(100 * preventive / classified, 2) if classified else None,
        "prediction_samples": samples, "mean_absolute_error_days": round(absolute, 2) if absolute is not None else None,
        "mean_signed_error_days": round(signed, 2) if signed is not None else None,
        "unpredicted_failures": count(FaultReport, FaultReport.was_predicted.is_(False)),
        "classified_failures": count(FaultReport, FaultReport.was_predicted.is_not(None)),
        "total_failures": count(FaultReport), "downtime_days": round(downtime_seconds / 86400, 4),
        "open_downtimes": open_count, "as_of": now.isoformat(), "timezone": TIMEZONE, "synthetic": synthetic,
        "definitions": {"services_before_failure_percent": "Servicios clasificados preventivos / (preventivos + correctivos). No demuestra que una falla haya sido evitada.",
                        "prediction_error_days": "Fecha real menos fecha pronosticada, usando la última evaluación anterior al día del servicio.",
                        "downtime_days": "Suma de horas reales fuera de servicio / 24; paros abiertos medidos hasta as_of."},
    }
