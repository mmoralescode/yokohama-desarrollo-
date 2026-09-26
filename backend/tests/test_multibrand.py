"""API behavior for manual, non-catalogued fleet units."""
from datetime import date
import json

from fastapi.testclient import TestClient

from app.main import ROOT, create_app, read_json


def test_manual_vehicle_keeps_usage_and_faults_without_mazda_rules(tmp_path):
    policy = read_json(ROOT / "config/policy.json")
    policy["api"] = {"refresh_seconds": 0}
    policy_path = tmp_path / "policy.json"
    policy_path.write_text(json.dumps(policy), encoding="utf-8")
    app = create_app(database_url=f"sqlite:///{(tmp_path / 'fleet.db').as_posix()}", api_key="test-key", policy_path=policy_path)
    payload = {
        "vin": "DEM00000000000888", "plate": "TOY-888", "make": "Toyota", "model": "Corolla",
        "model_year": 2019, "version": "LE", "body_style": "sedan", "engine": "1.8L",
        "transmission": "CVT", "drive": "FWD", "fuel_type": "Gasolina", "color": "Blanco",
        "current_km": 40000, "in_service_date": "2019-02-01", "usage_regime": "normal",
    }
    with TestClient(app) as client:
        client.headers.update({"X-API-Key": "test-key"})
        response = client.post("/api/vehicles", json=payload)
        assert response.status_code == 201, response.text
        vehicle = response.json()
        assert vehicle["make"] == "Toyota"
        assert vehicle["model"] == "Corolla"
        assert vehicle["variant_id"] is None
        assert vehicle["maintenance_catalog"] is None

        plan = client.get(f"/api/vehicles/{vehicle['id']}/plan").json()
        assert plan["traffic_light"] == "gray"
        assert plan["services"] == []
        assert plan["usage"]["km_per_day"] >= 0
        assert any(alert["kind"] == "data" and alert["stage"] == "maintenance-catalog-missing" for alert in plan["alerts"])
        assert client.post(f"/api/vehicles/{vehicle['id']}/services", json={
            "service_id": "aceite_normal", "performed_on": date.today().isoformat(), "odometer_km": 40000,
        }).status_code == 422

        fault = client.post(f"/api/vehicles/{vehicle['id']}/faults", json={
            "description": "Pérdida de frenado; la unidad se detuvo de inmediato", "severity": "critico",
        })
        assert fault.status_code == 201, fault.text
        after_fault = client.get(f"/api/vehicles/{vehicle['id']}/plan").json()
        assert after_fault["traffic_light"] == "red"
        assert any(alert["kind"] == "fault" and alert["severity"] == "critico" for alert in after_fault["alerts"])


def test_legacy_mazda_variant_still_selects_its_catalog(tmp_path):
    app = create_app(database_url=f"sqlite:///{(tmp_path / 'fleet.db').as_posix()}", api_key="test-key")
    with TestClient(app) as client:
        client.headers.update({"X-API-Key": "test-key"})
        response = client.post("/api/vehicles", json={
            "vin": "DEM00000000000889", "plate": "MZD-889", "model_year": 2021,
            "variant_id": "V21S-i", "transmission": "AT6", "current_km": 1000,
            "in_service_date": "2021-06-01",
        })
        assert response.status_code == 201, response.text
        vehicle = response.json()
        assert (vehicle["make"], vehicle["model"], vehicle["maintenance_catalog"]) == ("Mazda", "Mazda3", "mazda3-mx.v0.1.0")
