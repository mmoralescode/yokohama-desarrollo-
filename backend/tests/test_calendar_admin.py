from datetime import timedelta

from sqlalchemy import select

from app.models import CalendarAppointment, ServiceHistory
from app.time_utils import local_today
from test_api import client, vehicle, vehicle_data


def endpoints(vehicle):
    return f"/api/vehicles/{vehicle['id']}"


def dates():
    today = local_today()
    return today, (today - timedelta(days=7)).isoformat(), (today + timedelta(days=12)).isoformat()


def test_reschedule_survives_recalculation_and_preserves_changes(client, vehicle):
    url = endpoints(vehicle)
    today, past, future = dates()
    recorded = client.post(url + "/services/batch", json={
        "service_ids": ["aceite_normal"], "performed_on": past, "odometer_km": 9300,
    })
    assert recorded.status_code == 201, recorded.text
    plan_before = client.get(url + "/plan").json()
    response = client.post(url + "/appointments", json={"service_ids": ["aceite_normal"], "scheduled_date": future})
    assert response.status_code == 201, response.text
    appointment_id = response.json()["appointment_id"]
    changed = (today + timedelta(days=18)).isoformat()
    assert client.patch(url + f"/appointments/{appointment_id}", json={"scheduled_date": changed, "notes": "Taller confirmó otra fecha"}).status_code == 200
    assert client.get(url + "/plan").json() == plan_before
    entries = client.get(f"/api/calendar?start={today}&end={today + timedelta(days=40)}").json()
    appointment = next(row for row in entries if row.get("appointment_id") == appointment_id)
    assert appointment["planned_date"] == changed
    assert len(appointment["changes"]) == 2
    assert appointment["changes"][-1]["previous_date"] == future
    assert appointment["notes"] == "Taller confirmó otra fecha"
    assert client.get("/api/vehicles").json()[0]["next_visit_date"] == changed
    duplicate = client.post(url + "/appointments", json={"service_ids": ["aceite_normal"], "scheduled_date": future})
    assert duplicate.status_code == 409


def test_late_partial_completion_actual_date_nullable_km_and_no_odometer_rollback(client, vehicle):
    url = endpoints(vehicle)
    today, past, future = dates()
    scheduled = client.post(url + "/appointments", json={"service_ids": ["aceite_normal", "filtro_motor"], "scheduled_date": future})
    assert scheduled.status_code == 201, scheduled.text
    appointment_id = scheduled.json()["appointment_id"]
    payload = {"service_ids": ["aceite_normal"], "performed_on": past, "odometer_km": None,
               "appointment_id": appointment_id, "notes": "Factura recibida una semana después"}
    captured = client.post(url + "/services/batch", json=payload)
    assert captured.status_code == 201, captured.text
    row = captured.json()["records"][0]
    assert row["performed_on"] == past and row["odometer_km"] is None
    assert row["captured_at"][:10] >= today.isoformat()
    assert client.get(url).json()["vehicle"]["current_km"] == 10000
    entries = client.get(f"/api/calendar?start={past}&end={future}").json()
    pending = next(row for row in entries if row["status"] == "scheduled")
    assert pending["service_ids"] == ["filtro_motor"]
    completed = next(row for row in entries if row["status"] == "completed")
    assert completed["planned_date"] == past and completed["captured_at"]
    assert completed["service_ids"] == ["aceite_normal"]
    # Unknown service mileage is not fabricated, nor does older mileage reset
    # this component's cycle. Future odometer ingestion remains possible.
    oil = next(item for item in client.get(url + "/plan").json()["services"] if item["service_id"] == "aceite_normal")
    assert oil["status"] == "pending_validation" and oil["due_date"] is None
    assert "kilometraje" in oil["explanation"]
    assert client.post(url + "/readings", json={"date": (today - timedelta(days=1)).isoformat(), "odometer_km": 9900}).status_code == 201


def test_duplicate_batch_is_atomic_and_older_backfill_keeps_current_schedule(client, vehicle):
    url = endpoints(vehicle)
    today, past, future = dates()
    first = client.post(url + "/services/batch", json={"service_ids": ["aceite_normal"], "performed_on": past, "odometer_km": 9300})
    assert first.status_code == 201, first.text
    scheduled = client.post(url + "/appointments", json={"service_ids": ["aceite_normal"], "scheduled_date": future}).json()
    replay = client.post(url + "/services/batch", json={"service_ids": ["aceite_normal", "filtro_motor"], "performed_on": past, "odometer_km": 9300})
    assert replay.status_code == 409
    assert len(client.get(url).json()["history"]) == 1
    old_date = (today - timedelta(days=14)).isoformat()
    backfill = client.post(url + "/services/batch", json={"service_ids": ["aceite_normal"], "performed_on": old_date, "odometer_km": 8600})
    assert backfill.status_code == 201, backfill.text
    with client.app.state.sessions() as session:
        assert session.get(CalendarAppointment, scheduled["appointment_id"]).status == "scheduled"
        assert len(list(session.scalars(select(ServiceHistory)))) == 2
    plan = client.get(url + "/plan").json()
    assert next(row for row in plan["services"] if row["service_id"] == "aceite_normal")["due_odometer"] == 19300


def test_manual_multibrand_capture_without_catalog_does_not_apply_mazda_rules(client):
    create = client.post("/api/vehicles", json={
        "vin": "ABC00000000000888", "plate": "YKH-888-B", "model_year": 2020,
        "make": "Toyota", "model": "Corolla", "version": "Base", "body_style": "sedan",
        "engine": "1.8", "transmission": "CVT", "drive": "FWD", "current_km": 30000,
        "in_service_date": "2020-03-01",
    })
    assert create.status_code == 201, create.text
    url = endpoints(create.json())
    payload = {"service_ids": [], "manual_description": "Cambio de aceite y revisión general",
               "performed_on": (local_today() - timedelta(days=4)).isoformat(), "odometer_km": None}
    result = client.post(url + "/services/batch", json=payload)
    assert result.status_code == 201, result.text
    assert result.json()["records"][0]["catalog_snapshot"]["manual"]
    assert client.get(url + "/plan").json()["services"] == []
    assert client.post(url + "/services/batch", json=payload).status_code == 409


def test_reject_future_completion_and_foreign_appointment(client, vehicle):
    url = endpoints(vehicle)
    today, _, future = dates()
    assert client.post(url + "/services/batch", json={"service_ids": ["aceite_normal"], "performed_on": future}).status_code == 422
    assert client.post(url + "/services/batch", json={"service_ids": ["aceite_normal"], "performed_on": today.isoformat(), "appointment_id": "missing"}).status_code == 404


def test_appointment_allows_extra_or_manual_work_without_closing_unperformed_items(client, vehicle):
    url = endpoints(vehicle)
    today, past, future = dates()
    scheduled = client.post(url + "/appointments", json={"service_ids": ["aceite_normal"], "scheduled_date": future}).json()
    appointment_id = scheduled["appointment_id"]
    manual = client.post(url + "/services/batch", json={"manual_description": "Revisión de luces", "performed_on": past,
                                                        "appointment_id": appointment_id})
    assert manual.status_code == 201, manual.text
    with client.app.state.sessions() as session:
        assert session.get(CalendarAppointment, appointment_id).status == "scheduled"
    more = client.post(url + "/services/batch", json={"service_ids": ["aceite_normal", "filtro_motor"],
        "performed_on": past, "appointment_id": appointment_id})
    assert more.status_code == 201, more.text
    with client.app.state.sessions() as session:
        assert session.get(CalendarAppointment, appointment_id).status == "completed"
    entries = client.get(f"/api/calendar?start={past}&end={future}").json()
    completed = [row for row in entries if row["status"] == "completed"]
    assert len(completed) == 1  # Multiple delayed captures, one real service day.
    assert len(completed[0]["service_ids"]) == 3
    assert "Revisión de luces" in completed[0]["service_names"]
