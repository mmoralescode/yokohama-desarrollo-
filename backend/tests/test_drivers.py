"""Driver assignments are administrative data, independent of vehicle make."""
import pytest
from sqlalchemy import select

from app.models import PlanEvaluation, Vehicle
from app.planner import serialize
from test_api import client, vehicle, vehicle_data


def test_create_with_multiple_drivers_normalizes_and_persists(client, vehicle_data):
    response = client.post("/api/vehicles", json=vehicle_data | {
        "drivers": ["  María   Hernández ", "Luis\tPérez", "MARÍA HERNÁNDEZ"],
    })
    assert response.status_code == 201, response.text
    created = response.json()
    expected = ["María Hernández", "Luis Pérez"]
    assert created["drivers"] == expected
    assert client.get("/api/vehicles").json()[0]["drivers"] == expected
    assert client.get(f"/api/vehicles/{created['id']}").json()["vehicle"]["drivers"] == expected
    with client.app.state.sessions() as session:
        assert session.get(Vehicle, created["id"]).drivers == expected


def test_edit_clear_and_omitted_driver_assignments_preserve_existing_forecasts(client, vehicle):
    assert vehicle["drivers"] == []
    url = f"/api/vehicles/{vehicle['id']}"
    with client.app.state.sessions() as session:
        previous = {row.id: serialize(row) for row in session.scalars(select(PlanEvaluation))}
    response = client.patch(url, json={"drivers": ["Ana López", "Diego Ruiz"]})
    assert response.status_code == 200, response.text
    assert response.json()["drivers"] == ["Ana López", "Diego Ruiz"]
    assert client.patch(url, json={"usage_regime": "severe"}).json()["drivers"] == ["Ana López", "Diego Ruiz"]
    assert client.patch(url, json={"drivers": ["  Ana López  "]}).json()["drivers"] == ["Ana López"]
    assert client.patch(url, json={"drivers": []}).json()["drivers"] == []
    assert client.get(url).json()["vehicle"]["drivers"] == []
    with client.app.state.sessions() as session:
        assert session.get(Vehicle, vehicle["id"]).drivers == []
        assert {key: serialize(session.get(PlanEvaluation, key)) for key in previous} == previous


@pytest.mark.parametrize("invalid", [None, "Ana López", {}, [None], [1], [True], [""], [" \t "], ["A" * 101], [f"Conductor {i}" for i in range(21)]])
def test_invalid_drivers_rejected_at_create_and_patch_without_mutation(client, vehicle, vehicle_data, invalid):
    create = vehicle_data | {"vin": "DEM00000000000998", "plate": "TEST-998", "drivers": invalid}
    assert client.post("/api/vehicles", json=create).status_code == 422
    assert client.patch(f"/api/vehicles/{vehicle['id']}", json={"drivers": invalid}).status_code == 422
    assert client.get(f"/api/vehicles/{vehicle['id']}").json()["vehicle"]["drivers"] == []
    assert len(client.get("/api/vehicles").json()) == 1


def test_drivers_allow_manual_make_and_shared_assignments(client):
    payload = {"vin": "DEM00000000000888", "plate": "TOY-888", "make": "Toyota", "model": "Corolla",
               "model_year": 2019, "version": "LE", "body_style": "sedan", "engine": "1.8L",
               "transmission": "CVT", "drive": "FWD", "current_km": 40000,
               "in_service_date": "2019-02-01", "drivers": ["Ana López"]}
    first = client.post("/api/vehicles", json=payload)
    second = client.post("/api/vehicles", json=payload | {"vin": "DEM00000000000887", "plate": "TOY-887"})
    assert first.status_code == second.status_code == 201
    assert first.json()["drivers"] == second.json()["drivers"] == ["Ana López"]


def test_driver_count_and_name_length_boundaries(client, vehicle_data):
    names = ["A" * 100] + [f"Conductor {index}" for index in range(19)]
    response = client.post("/api/vehicles", json=vehicle_data | {"drivers": names})
    assert response.status_code == 201, response.text
    assert response.json()["drivers"] == names
