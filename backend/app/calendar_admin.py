"""Administrative appointments, independent of recalculated technical dates."""
from collections import defaultdict
from datetime import date

from sqlalchemy import select

from .models import AppointmentChange, CalendarAppointment, ServiceCatalog, ServiceHistory, Vehicle, VisitPlan
from .planner import serialize
from .time_utils import utc_now


def equivalent_services(service_id: str) -> set[str]:
    if service_id in {"aceite_normal", "aceite_severo"}:
        return {"aceite_normal", "aceite_severo"}
    if service_id in {"refrigerante_inicial", "refrigerante_sucesivo"}:
        return {"refrigerante_inicial", "refrigerante_sucesivo"}
    return {service_id}


def cycle_anchors(session, vehicle_id: int, service_ids: list[str]) -> dict:
    history = list(session.scalars(select(ServiceHistory).where(ServiceHistory.vehicle_id == vehicle_id)))
    return {service_id: max(
        ((row.performed_on, row.id) for row in history if row.service_id in equivalent_services(service_id)),
        default=(date.min, 0),
    )[1] for service_id in service_ids}


def remaining_services(appointment: CalendarAppointment) -> list[str]:
    return [item for item in appointment.service_ids if item not in appointment.completed_service_ids]


def next_visit_date(session, vehicle_id: int, predicted_visits: list[dict]) -> str | None:
    """Fleet summary follows stored dates, while technical plans stay intact."""
    dates, covered = [], set()
    for appointment in session.scalars(select(CalendarAppointment).where(
            CalendarAppointment.vehicle_id == vehicle_id, CalendarAppointment.status == "scheduled")):
        pending = remaining_services(appointment)
        if not pending:
            continue
        dates.append(appointment.scheduled_date.isoformat())
        current = cycle_anchors(session, vehicle_id, pending)
        covered.update(item for item in pending if current[item] == appointment.cycle_anchors.get(item, 0))
    dates.extend(visit["planned_date"] for visit in predicted_visits
                 if visit.get("fault_ids") or any(item not in covered for item in visit["service_ids"]))
    return min(dates) if dates else None


def finish_appointments(session, vehicle_id: int, records: list[ServiceHistory]) -> None:
    """Complete only work actually recorded for an appointment's current cycle.

    An older invoice entered today cannot close a newer scheduled service.
    Equivalent oil/coolant catalog IDs describe the same component cycle.
    """
    for appointment in session.scalars(select(CalendarAppointment).where(
            CalendarAppointment.vehicle_id == vehicle_id, CalendarAppointment.status == "scheduled")):
        completed = set(appointment.completed_service_ids)
        for service_id in remaining_services(appointment):
            anchor_id = appointment.cycle_anchors.get(service_id, 0)
            anchor = session.get(ServiceHistory, anchor_id) if anchor_id else None
            for record in records:
                if record.service_id not in equivalent_services(service_id):
                    continue
                if anchor and record.performed_on < anchor.performed_on:
                    continue
                completed.add(service_id)
                if record.appointment_id is None:
                    record.appointment_id = appointment.id
        appointment.completed_service_ids = sorted(completed)
        if not remaining_services(appointment):
            appointment.status = "completed"
        appointment.updated_at = utc_now()


def appointment_payload(session, appointment: CalendarAppointment, vehicle: Vehicle) -> dict:
    return {
        "id": f"appointment:{appointment.id}", "appointment_id": appointment.id,
        "vehicle_id": vehicle.id, "plate": vehicle.plate, "version": vehicle.version,
        "planned_date": appointment.scheduled_date.isoformat(), "original_date": appointment.original_date.isoformat() if appointment.original_date else None,
        "service_ids": remaining_services(appointment), "completed_service_ids": appointment.completed_service_ids,
        "fault_ids": [], "status": appointment.status, "notes": appointment.notes,
        "total_duration_hours": None, "provisional": False,
        "explanation": "Fecha registrada por administración. El pronóstico técnico se conserva por separado.",
        "changes": [serialize(row) for row in session.scalars(select(AppointmentChange).where(
            AppointmentChange.appointment_id == appointment.id).order_by(AppointmentChange.id))],
    }


def calendar_entries(session, start: date, end: date) -> list[dict]:
    vehicles = {row.id: row for row in session.scalars(select(Vehicle))}
    names = {row.id: row.source_snapshot.get("servicio", row.id) for row in session.scalars(select(ServiceCatalog))}
    appointments = list(session.scalars(select(CalendarAppointment).where(CalendarAppointment.status == "scheduled")))
    coverage = defaultdict(set)
    result = []
    for appointment in appointments:
        pending = remaining_services(appointment)
        current = cycle_anchors(session, appointment.vehicle_id, pending)
        coverage[appointment.vehicle_id].update(service_id for service_id in pending
            if current[service_id] == appointment.cycle_anchors.get(service_id, 0))
        if start <= appointment.scheduled_date <= end:
            result.append(appointment_payload(session, appointment, vehicles[appointment.vehicle_id]))
    for visit in session.scalars(select(VisitPlan).where(
            VisitPlan.status == "proposed", VisitPlan.planned_date >= start, VisitPlan.planned_date <= end)):
        pending = [item for item in visit.payload["service_ids"] if item not in coverage[visit.vehicle_id]]
        if not pending and not visit.payload.get("fault_ids"):
            continue
        vehicle = vehicles[visit.vehicle_id]
        result.append({**visit.payload, "id": visit.id, "vehicle_id": vehicle.id,
                       "plate": vehicle.plate, "version": vehicle.version, "service_ids": pending})
    completed = defaultdict(list)
    for record in session.scalars(select(ServiceHistory).where(
            ServiceHistory.performed_on >= start, ServiceHistory.performed_on <= end).order_by(ServiceHistory.id)):
        # Calendar shows one completed visit per actual day and appointment,
        # even if a capturista entered its component lines in several batches.
        # Individual capture times remain available in the vehicle history.
        completed[(record.vehicle_id, record.performed_on, record.appointment_id)].append(record)
    for (vehicle_id, performed_on, appointment_id), records in completed.items():
        vehicle = vehicles[vehicle_id]
        appointment = session.get(CalendarAppointment, appointment_id) if appointment_id else None
        result.append({
            "id": "completed:" + ",".join(str(row.id) for row in records), "appointment_id": appointment_id,
            "vehicle_id": vehicle_id, "plate": vehicle.plate, "version": vehicle.version,
            "planned_date": performed_on.isoformat(), "performed_on": performed_on.isoformat(),
            "captured_at": max((serialize(row)["captured_at"] for row in records if row.captured_at), default=None),
            "original_date": appointment.scheduled_date.isoformat() if appointment else None,
            "service_ids": [row.service_id for row in records], "fault_ids": [], "status": "completed",
            "total_duration_hours": None, "provisional": False,
            "notes": "\n".join(dict.fromkeys(row.notes for row in records if row.notes)),
            "odometer_km": next((row.odometer_km for row in records if row.odometer_km is not None), None),
            "explanation": "Servicio realizado. La fecha corresponde al trabajo, aunque se haya capturado después.",
        })
    for entry in result:
        entry["service_names"] = [names.get(item, item) for item in entry["service_ids"]]
    return sorted(result, key=lambda item: (item["planned_date"], item["vehicle_id"], item["id"]))
