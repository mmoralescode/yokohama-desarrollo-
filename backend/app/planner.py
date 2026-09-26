"""Adaptador de persistencia del motor puro: auditoría e idempotencia."""
from datetime import date, datetime, timedelta
import hashlib
import json
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from .engine import build_plan, estimate_usage
from .fleet import MAZDA3_CATALOG_KEY
from .time_utils import local_today, as_utc
from .models import Alert, FaultReport, Notification, OdometerReading, PlanEvaluation, ServiceHistory, Vehicle, VisitPlan
from .notifications import SimulatedChannel

ENGINE_SHA256 = hashlib.sha256(Path(__file__).with_name("engine.py").read_bytes()).hexdigest()


def current_date() -> date:
    """Replaceable clock for persistence tests; engine still receives explicit date."""
    return local_today()


def serialize(row) -> dict:
    return {column.name: (as_utc(value).isoformat() if isinstance(value, datetime) else value.isoformat() if isinstance(value, date) else value)
            for column in row.__table__.columns if (value := getattr(row, column.name)) is not ...}


def stable_hash(value: dict) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def vehicle_inputs(session: Session, vehicle: Vehicle) -> dict:
    return {
        "vehicle": serialize(vehicle),
        "readings": [serialize(row) for row in session.scalars(select(OdometerReading).where(OdometerReading.vehicle_id == vehicle.id).order_by(OdometerReading.date, OdometerReading.id))],
        "history": [serialize(row) for row in session.scalars(select(ServiceHistory).where(ServiceHistory.vehicle_id == vehicle.id).order_by(ServiceHistory.performed_on, ServiceHistory.id))],
        "faults": [serialize(row) for row in session.scalars(select(FaultReport).where(FaultReport.vehicle_id == vehicle.id).order_by(FaultReport.id))],
    }


def fleet_usage(session: Session, vehicle: Vehicle, policy: dict, today: date) -> float | None:
    """One aggregate per transaction; never mix demo and actual fleet observations."""
    cache_key = (today, stable_hash(policy["usage"]))
    cached = session.info.get("fleet_usage")
    if cached is None or cached[0] != cache_key:
        cohorts = {row.id: row.is_synthetic for row in session.scalars(select(Vehicle))}
        groups = {vehicle_id: [] for vehicle_id in cohorts}
        cutoff = today - timedelta(days=policy["usage"]["window_days"])
        for row in session.scalars(select(OdometerReading).where(OdometerReading.date >= cutoff, OdometerReading.date <= today)):
            groups[row.vehicle_id].append(serialize(row))
        rates = {}
        for vehicle_id, readings in groups.items():
            usage = estimate_usage(readings, policy, today)
            if usage.get("source") == "observed" and usage["confidence"] != "baja":
                rates[vehicle_id] = (cohorts[vehicle_id], usage["km_per_day"])
        session.info["fleet_usage"] = (cache_key, rates)
    rates = session.info["fleet_usage"][1]
    values = [rate for vehicle_id, (synthetic, rate) in rates.items() if vehicle_id != vehicle.id and synthetic == vehicle.is_synthetic]
    return sum(values) / len(values) if values else None


def catalog_for_vehicle(vehicle: dict, mazda_catalog: dict) -> tuple[dict, bool]:
    """Return only the rules deliberately associated with this unit.

    Brand/model text is descriptive data, not evidence that a vehicle follows a
    particular maintenance manual. This guards against applying Mazda3 rules to
    every newly entered make while leaving usage and fault calculations intact.
    """
    if vehicle.get("maintenance_catalog") == MAZDA3_CATALOG_KEY:
        return mazda_catalog, True
    return {"version_catalogo": "unassigned", "servicios": []}, False


def catalog_warning(vehicle: dict) -> tuple[str, str]:
    key = vehicle.get("maintenance_catalog")
    if key:
        return (
            "maintenance-catalog-unavailable",
            f"El catálogo de mantenimiento '{key}' no está cargado para esta unidad; no se aplicaron reglas de otra marca.",
        )
    return (
        "maintenance-catalog-missing",
        "La unidad no tiene catálogo de mantenimiento asignado; no se aplicaron reglas Mazda ni de otra marca.",
    )


def evaluate(session: Session, vehicle: Vehicle, catalog: dict, policy: dict) -> dict:
    inputs = vehicle_inputs(session, vehicle)
    today = current_date()
    inputs["fleet_usage_km_per_day"] = fleet_usage(session, vehicle, policy, today)
    plan_catalog, catalog_available = catalog_for_vehicle(inputs["vehicle"], catalog)
    fingerprint = stable_hash({"today": today.isoformat(), "inputs": inputs, "catalog": plan_catalog, "policy": policy, "engine_sha256": ENGINE_SHA256})
    # Do not load the large historical input/catalog snapshots for a cache hit.
    cached = session.execute(select(PlanEvaluation.id, PlanEvaluation.result).where(PlanEvaluation.fingerprint == fingerprint)).first()
    if cached:
        evaluation, result = cached, cached.result
        actual_alerts = dict(session.execute(select(Alert.key, Alert.evaluation_id).where(Alert.vehicle_id == vehicle.id, Alert.status == "open")).all())
        actual_visits = dict(session.execute(select(VisitPlan.id, VisitPlan.evaluation_id).where(VisitPlan.vehicle_id == vehicle.id, VisitPlan.status == "proposed")).all())
        expected_alerts = {f"{vehicle.id}:{row['key']}": evaluation.id for row in result["alerts"]}
        expected_visits = {f"{vehicle.id}:{row['id']}": evaluation.id for row in result["visits"]}
        if actual_alerts == expected_alerts and actual_visits == expected_visits:
            return result  # Materialization already committed atomically with this evaluation.
    else:
        result = build_plan(**inputs, catalog=plan_catalog, config=policy, today=today)
        if not catalog_available:
            stage, message = catalog_warning(inputs["vehicle"])
            result["warnings"].append(message)
            result["alerts"].append({
                "key": f"{vehicle.id}:data:{stage}", "vehicle_id": vehicle.id,
                "service_id": None, "fault_id": None, "severity": "menor",
                "message": message, "deadline": None, "days_remaining": None,
                "threshold_days": None, "status": "open", "kind": "data", "stage": stage,
            })
            # A catalog absence is informational (gray), unless a fault already
            # makes the unit actionable or critical (amber/red).
            if result["traffic_light"] in {"green", "gray"}:
                result["traffic_light"] = "gray"
        evaluation = PlanEvaluation(vehicle_id=vehicle.id, fingerprint=fingerprint,
                                    catalog_version=plan_catalog["version_catalogo"], policy_version=policy["policy_version"],
                                    inputs_snapshot={**inputs, "runtime": {"engine_sha256": ENGINE_SHA256}},
                                    catalog_snapshot=plan_catalog, policy_snapshot=policy, result=result)
        session.add(evaluation)
        session.flush()
    # Even a cached evaluation must reconcile materialized projections: restoring
    # a previous policy must archive alerts/visits generated by the newer policy.
    current_alerts = {row.key: row for row in session.scalars(select(Alert).where(Alert.vehicle_id == vehicle.id))}
    notified = set(session.scalars(select(Notification.dedup_key).join(Alert).where(Alert.vehicle_id == vehicle.id)))
    active_keys = set()
    for payload in result["alerts"]:
        key = f"{vehicle.id}:{payload['key']}"
        active_keys.add(key)
        alert = current_alerts.get(key)
        if alert is None:
            alert = Alert(key=key, vehicle_id=vehicle.id, evaluation_id=evaluation.id, generation=1, payload=payload)
            session.add(alert)
            session.flush()  # New notification rows require its database ID.
        elif alert.status != "open":
            alert.generation += 1
        alert.status = "open"
        alert.evaluation_id = evaluation.id
        alert.service_id = payload.get("service_id")
        alert.fault_id = payload.get("fault_id")
        alert.payload = payload
        anchors = [row for row in inputs["history"] if row["service_id"] == alert.service_id]
        cycle = max(((row["performed_on"], row["id"]) for row in anchors), default=(vehicle.in_service_date.isoformat(), 0))
        for channel in ("email", "whatsapp"):
            dedup = stable_hash({"key": key, "generation": alert.generation, "channel": channel,
                                 "cycle": cycle, "threshold": payload.get("threshold_days"),
                                 "severity": payload["severity"], "stage": payload.get("stage")})
            if dedup not in notified:
                session.add(Notification(dedup_key=dedup, alert_id=alert.id, channel=channel,
                                         payload=SimulatedChannel(channel).deliver(payload)))
                notified.add(dedup)
    for key, alert in current_alerts.items():
        if key not in active_keys:
            alert.status = "resolved" if alert.fault_id else "archived"
    current_visits = {row.id: row for row in session.scalars(select(VisitPlan).where(VisitPlan.vehicle_id == vehicle.id))}
    active_visits = set()
    for payload in result["visits"]:
        key = f"{vehicle.id}:{payload['id']}"
        active_visits.add(key)
        visit = current_visits.get(key)
        if visit is None:
            visit = VisitPlan(id=key, vehicle_id=vehicle.id, evaluation_id=evaluation.id,
                              planned_date=date.fromisoformat(payload["planned_date"]), payload=payload)
            session.add(visit)
        visit.status = "proposed"
        visit.evaluation_id = evaluation.id
        visit.planned_date = date.fromisoformat(payload["planned_date"])
        visit.payload = payload
    for key, visit in current_visits.items():
        if key not in active_visits:
            visit.status = "archived"
    session.flush()
    return result
