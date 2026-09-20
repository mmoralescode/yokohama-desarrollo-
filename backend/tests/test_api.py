from copy import deepcopy
from datetime import date, timedelta
import json

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import func, select

from app.main import ROOT, create_app, read_json
from app.models import Alert, Notification, PlanEvaluation, Vehicle, VisitPlan
from app.seed import seed_database


@pytest.fixture
def client(tmp_path):
    policy = read_json(ROOT / "config/policy.json")
    policy["api"] = {"refresh_seconds": 0}
    config_path = tmp_path / "policy.json"
    config_path.write_text(json.dumps(policy), encoding="utf-8")
    app = create_app(database_url=f"sqlite:///{(tmp_path / 'test.db').as_posix()}", api_key="local-test-key", policy_path=config_path)
    with TestClient(app) as client:
        client.headers.update({"X-API-Key": "local-test-key"})
        yield client


@pytest.fixture
def vehicle_data():
    return {"vin": "DEM00000000000999", "plate": "TEST-999", "model_year": 2021, "variant_id": "V21S-i",
            "transmission": "AT6", "current_km": 10_000, "in_service_date": "2021-06-01", "usage_regime": "normal", "is_synthetic": True}


@pytest.fixture
def vehicle(client, vehicle_data):
    response = client.post("/api/vehicles", json=vehicle_data)
    assert response.status_code == 201, response.text
    return response.json()


def test_authentication_and_fail_closed(client, tmp_path):
    assert client.get("/health").status_code == 200
    assert client.get("/api/vehicles", headers={"X-API-Key": "wrong"}).status_code == 401
    with TestClient(create_app(database_url="sqlite:///:memory:", api_key="")) as locked:
        assert locked.get("/health").json()["authentication_configured"] is False
        assert locked.get("/api/vehicles").status_code == 503
        assert locked.get("/docs").status_code == 404


def test_vehicle_derive_variant_and_initial_reading(client, vehicle):
    assert vehicle["engine"] == "G25"
    assert vehicle["body_style"] == "sedan"
    detail = client.get(f"/api/vehicles/{vehicle['id']}").json()
    assert detail["readings"][0]["date"] == date.today().isoformat()
    assert detail["readings"][0]["odometer_km"] == 10000
    assert client.get("/api/vehicles").json()[0]["traffic_light"] in {"red", "amber", "green", "gray"}


@pytest.mark.parametrize("updates", [{"model_year": 2020}, {"variant_id": "V26S-i"}, {"transmission": "CVT"},
                                    {"vin": "BADVIN"}, {"vin": "III00000000000000"}, {"current_km": -1},
                                    {"current_km": "NaN"}, {"in_service_date": "2099-01-01"}, {"unexpected": True}])
def test_vehicle_invalid(client, vehicle_data, updates):
    assert client.post("/api/vehicles", json=vehicle_data | updates).status_code == 422


def test_duplicate_vehicle_atomic(client, vehicle, vehicle_data):
    assert client.post("/api/vehicles", json=vehicle_data).status_code == 409
    assert len(client.get("/api/vehicles").json()) == 1


def test_reading_validation_and_history(client, vehicle):
    url = f"/api/vehicles/{vehicle['id']}/readings"
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    assert client.post(url, json={"date": yesterday, "odometer_km": 9900}).status_code == 201
    assert client.post(url, json={"date": yesterday, "odometer_km": 9900}).status_code == 409
    for value in (10100, 100, -2, "Infinity"):
        assert client.post(url, json={"date": (date.today() - timedelta(days=2)).isoformat(), "odometer_km": value}).status_code == 422
    assert client.post(url, json={"date": (date.today() + timedelta(days=1)).isoformat(), "odometer_km": 10100}).status_code == 422
    assert client.post(url, json={"date": "2020-01-01", "odometer_km": 1}).status_code == 422


def test_service_validation_and_snapshot(client, vehicle):
    url = f"/api/vehicles/{vehicle['id']}/services"
    payload = {"service_id": "aceite_normal", "performed_on": date.today().isoformat(), "odometer_km": 10000}
    for odometer in (9900, 10100):
        assert client.post(url, json=payload | {"odometer_km": odometer}).status_code == 422
    response = client.post(url, json=payload)
    assert response.status_code == 201, response.text
    assert response.json()["catalog_snapshot"]["habilitado_produccion"] is False
    assert client.post(url, json=payload).status_code == 409
    assert client.post(url, json=payload | {"service_id": "nonexistent"}).status_code == 422
    assert client.post(url, json=payload | {"service_id": "transmision_mt"}).status_code == 422
    assert client.post(url, json=payload | {"service_id": "aceite_severo"}).status_code == 422


def test_fault_immediate_alert_and_resolution(client, vehicle):
    url = f"/api/vehicles/{vehicle['id']}/faults"
    response = client.post(url, json={"description": "Pérdida de frenado, unidad detenida", "severity": "critico"})
    assert response.status_code == 201
    fault_id = response.json()["id"]
    matching = [item for item in client.get("/api/alerts").json() if item.get("fault_id") == fault_id]
    assert len(matching) == 1
    assert matching[0]["severity"] == "critico"
    plan = client.get(f"/api/vehicles/{vehicle['id']}/plan").json()
    assert plan["traffic_light"] == "red"
    day = date.today().isoformat()
    visits = client.get(f"/api/calendar?start={day}&end={day}").json()
    assert any(fault_id in visit.get("fault_ids", []) for visit in visits)
    result = client.patch(f"/api/faults/{fault_id}/resolve", json={"resolution_notes": "Sistema reparado y revisado por taller"})
    assert result.status_code == 200
    assert result.json()["resolved_on"] == day
    assert not [item for item in client.get("/api/alerts").json() if item.get("fault_id") == fault_id]
    assert client.get(f"/api/vehicles/{vehicle['id']}").json()["faults"][0]["status"] == "resolved"
    assert client.patch(f"/api/faults/{fault_id}/resolve", json={"resolution_notes": "Intento de sobrescribir"}).status_code == 409


def test_deferral_requires_assessment_and_deadline(client, vehicle):
    url = f"/api/vehicles/{vehicle['id']}/faults"
    future = (date.today() + timedelta(days=7)).isoformat()
    base = {"description": "Bisagra con ruido, cierre funciona", "severity": "menor", "safe_to_defer": True}
    assert client.post(url, json=base).status_code == 422
    assert client.post(url, json=base | {"deadline": future}).status_code == 422
    good = base | {"deadline": future, "assessment_notes": "Inspección confirmó cierre y seguridad normal"}
    assert client.post(url, json=good).status_code == 201
    assert client.post(url, json=good | {"severity": "critico"}).status_code == 422
    assert client.post(url, json=good | {"safe_to_defer": False}).status_code == 422


def test_dtc_not_automatic_diagnosis(client, vehicle):
    url = f"/api/vehicles/{vehicle['id']}/faults"
    payload = {"description": "Lectura DTC sin diagnóstico confirmado", "severity": "importante", "dtc": "P0126"}
    response = client.post(url, json=payload)
    assert response.status_code == 201
    assert response.json()["safe_to_defer"] is False
    assert response.json()["deadline"] == date.today().isoformat()
    assert response.json()["reported_deadline"] is None
    assert client.post(url, json=payload | {"dtc": "BAD"}).status_code == 422


def test_idempotent_evaluations_alerts_visits_and_outbox(client, vehicle):
    client.post(f"/api/vehicles/{vehicle['id']}/faults", json={"description": "Pérdida de presión de aceite reportada", "severity": "critico"})
    def counts():
        with client.app.state.sessions() as session:
            return tuple(session.scalar(select(func.count()).select_from(model)) for model in (Alert, VisitPlan, Notification, PlanEvaluation))
    before = counts()
    for _ in range(3):
        assert client.post("/api/recalculate").status_code == 200
        assert client.get(f"/api/vehicles/{vehicle['id']}/plan").status_code == 200
    assert counts() == before
    notifications = client.get("/api/notifications").json()
    assert notifications
    assert all(item["status"] == "simulated" and item["payload"]["sent"] is False for item in notifications)
    assert {item["channel"] for item in notifications} == {"email", "whatsapp"}


def test_public_sources_not_silently_activated(client):
    catalog = client.get("/api/catalog").json()
    assert len(catalog["servicios"]) == 40
    assert all(row["habilitado_produccion"] is False for row in catalog["servicios"])
    assert catalog["runtime"]["mode"] == "demo"
    assert len(client.get("/api/variants").json()["variantes"]) == 48


def test_calendar_range_and_unknown_entity(client):
    assert client.get("/api/calendar?start=2026-02-01&end=2026-01-01").status_code == 422
    assert client.get("/api/calendar?start=2026-01-01&end=2028-01-01").status_code == 422
    assert client.get("/api/vehicles/9999").status_code == 404
    assert client.patch("/api/faults/9999/resolve", json={"resolution_notes": "Informe suficiente"}).status_code == 404


def test_seed_twenty_deterministic_idempotent(tmp_path):
    database_url = f"sqlite:///{(tmp_path / 'demo.db').as_posix()}"
    assert seed_database(database_url)["created"] == 20
    assert seed_database(database_url) == {"created": 0, "skipped": 20, "synthetic": True, "seed": 2026}
    with TestClient(create_app(database_url=database_url, api_key="test")) as client:
        client.headers.update({"X-API-Key": "test"})
        vehicles = client.get("/api/vehicles").json()
        assert len(vehicles) == 20
        assert all(vehicle["is_synthetic"] for vehicle in vehicles)
        assert {vehicle["model_year"] for vehicle in vehicles} == set(range(2021, 2027))
        assert {vehicle["engine"] for vehicle in vehicles} == {"G25", "G25T", "G20MHEV"}
        assert any(vehicle["traffic_light"] == "red" for vehicle in vehicles)


def test_invalid_policy_fails_startup(tmp_path):
    policy = deepcopy(read_json(ROOT / "config/policy.json"))
    policy["usage"]["default_km_per_day"] = -20
    target = tmp_path / "bad.json"
    target.write_text(json.dumps(policy), encoding="utf-8")
    with pytest.raises(ValueError, match="default_km_per_day"):
        create_app(database_url="sqlite:///:memory:", api_key="test", policy_path=target)


def test_effective_fault_response_cannot_understate_risk(client, vehicle):
    url = f"/api/vehicles/{vehicle['id']}/faults"
    submitted = {"description": "Unidad reporta sobrecalentamiento severo", "severity": "menor", "safe_to_defer": True,
                 "deadline": (date.today() + timedelta(days=7)).isoformat(), "assessment_notes": "Operador marcó diferible; motor debe bloquear"}
    response = client.post(url, json=submitted)
    assert response.status_code == 201
    assert response.json()["severity"] == "critico"
    assert response.json()["reported_severity"] == "menor"
    assert response.json()["safe_to_defer"] is False
    detail = client.get(f"/api/vehicles/{vehicle['id']}").json()["faults"][0]
    assert detail["severity"] == "critico"
    assert detail["deadline"] == date.today().isoformat()
    assert detail["safety_evaluation"] == "critical"
    dtc = client.post(url, json=submitted | {"description": "DTC sin síntomas críticos presentes", "dtc": "P0126"})
    assert dtc.json()["safe_to_defer"] is False
    assert dtc.json()["reported_safe_to_defer"] is True


def test_maintenance_cycle_archives_old_and_notifies_new(client, vehicle, monkeypatch):
    from app import planner
    today = date.today()
    service_url = f"/api/vehicles/{vehicle['id']}/services"
    response = client.post(service_url, json={"service_id": "aceite_normal", "performed_on": (today - timedelta(days=175)).isoformat(), "odometer_km": 9000})
    assert response.status_code == 201
    alerts = [item for item in client.get("/api/alerts").json() if item.get("service_id") == "aceite_normal"]
    assert alerts
    old_key = alerts[0]["key"]
    assert client.post(service_url, json={"service_id": "aceite_normal", "performed_on": today.isoformat(), "odometer_km": 10000}).status_code == 201
    assert not [item for item in client.get("/api/alerts").json() if item.get("service_id") == "aceite_normal"]
    with client.app.state.sessions() as session:
        old_alert = session.scalar(select(Alert).where(Alert.service_id == "aceite_normal"))
        assert old_alert.status == "archived"
    monkeypatch.setattr(planner, "current_date", lambda: today + timedelta(days=180))
    alerts = [item for item in client.get("/api/alerts").json() if item.get("service_id") == "aceite_normal"]
    assert alerts and alerts[0]["key"] != old_key
    with client.app.state.sessions() as session:
        new_alert = session.get(Alert, alerts[0]["id"])
        assert len(list(session.scalars(select(Notification).where(Notification.alert_id == new_alert.id)))) == 2


def test_migration_rejects_unversioned_database(tmp_path):
    from app.database import make_database, migrate
    from sqlalchemy import text
    engine, _ = make_database(f"sqlite:///{(tmp_path / 'foreign.db').as_posix()}")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE existing_data (id INTEGER PRIMARY KEY)"))
    with pytest.raises(RuntimeError, match="sin versión"):
        migrate(engine)
    with engine.connect() as connection:
        assert connection.execute(text("SELECT COUNT(*) FROM existing_data")).scalar() == 0
    engine.dispose()


def test_restored_policy_reconciles_cached_projection(client, vehicle):
    service_url = f"/api/vehicles/{vehicle['id']}/services"
    assert client.post(service_url, json={"service_id": "aceite_normal", "performed_on": date.today().isoformat(), "odometer_km": 10000}).status_code == 201
    original = client.get(f"/api/vehicles/{vehicle['id']}/plan").json()
    assert not [row for row in original["alerts"] if row.get("service_id") == "aceite_normal"]
    client.app.state.policy["usage"]["default_km_per_day"] = 400
    faster = client.get("/api/alerts").json()
    assert any(row.get("service_id") == "aceite_normal" for row in faster)
    client.app.state.policy["usage"]["default_km_per_day"] = 80
    restored = client.get(f"/api/vehicles/{vehicle['id']}/plan").json()
    assert restored == original
    assert not [row for row in client.get("/api/alerts").json() if row.get("service_id") == "aceite_normal"]
    with client.app.state.sessions() as session:
        visit_dates = {row.planned_date.isoformat() for row in session.scalars(select(VisitPlan).where(VisitPlan.status == "proposed"))}
    assert visit_dates == {row["planned_date"] for row in original["visits"]}


def test_concurrent_refresh_and_reads_do_not_duplicate_or_deadlock(client, vehicle):
    from concurrent.futures import ThreadPoolExecutor
    def request(index):
        if index % 2:
            return client.post("/api/recalculate").status_code
        return client.get(f"/api/vehicles/{vehicle['id']}/plan").status_code
    with ThreadPoolExecutor(max_workers=8) as workers:
        results = [future.result(timeout=20) for future in [workers.submit(request, index) for index in range(16)]]
    assert results == [200] * 16
    with client.app.state.sessions() as session:
        assert session.scalar(select(func.count(PlanEvaluation.id))) == 1
