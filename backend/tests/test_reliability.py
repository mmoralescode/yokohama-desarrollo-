"""API robustness regressions, isolated temporary databases; never the demo DB."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, time, timedelta
import json

import pytest
from sqlalchemy import func, select

from app.models import Alert, Notification, OdometerReading, PlanEvaluation
from app.time_utils import MEXICO_CITY, date_timestamp, local_today
from test_api import client, vehicle, vehicle_data  # Reuse isolated DB fixtures.


def day(days_ago=0):
    return local_today() - timedelta(days=days_ago)


def instant(days_ago=1, hour=12):
    return datetime.combine(day(days_ago), time(hour), MEXICO_CITY).isoformat()


def endpoint(vehicle, resource):
    return f"/api/vehicles/{vehicle['id']}/{resource}"


def detail(client, vehicle):
    response = client.get(f"/api/vehicles/{vehicle['id']}")
    assert response.status_code == 200, response.text
    return response.json()


def another_vehicle(client, vehicle_data, identity=2, synthetic=True):
    response = client.post("/api/vehicles", json=vehicle_data | {
        "vin": f"DEM{identity:014d}", "plate": f"RELIAB-{identity}", "is_synthetic": synthetic,
    })
    assert response.status_code == 201, response.text
    return response.json()


def service_payload(service_id="aceite_normal", **changes):
    return {"service_id": service_id, "performed_on": day().isoformat(), "odometer_km": 10000, **changes}


def add_service(client, vehicle, service_id="aceite_normal", **changes):
    response = client.post(endpoint(vehicle, "services"), json=service_payload(service_id, **changes))
    assert response.status_code == 201, response.text
    return response.json()


def add_fault(client, vehicle, **changes):
    response = client.post(endpoint(vehicle, "faults"), json={
        "description": "Ruido de componente por revisar", "severity": "menor", **changes,
    })
    assert response.status_code == 201, response.text
    return response.json()


def insert_rate(client, vehicle, rate):
    response = client.post(endpoint(vehicle, "readings/batch"), json={"readings": [
        {"date": day(offset).isoformat(), "odometer_km": 10000 - rate * offset}
        for offset in (3, 2, 1)
    ]})
    assert response.status_code == 200, response.text
    return response.json()


def test_two_timestamped_readings_same_day_keep_sources_and_utc(client, vehicle):
    url = endpoint(vehicle, "readings")
    first = client.post(url, json={"recorded_at": instant(1, 8), "odometer_km": 9800, "source": "gps"})
    second = client.post(url, json={"recorded_at": instant(1, 14), "odometer_km": 9850, "source": "obd"})
    assert first.status_code == second.status_code == 201
    assert first.json()["source"] == "gps" and second.json()["source"] == "obd"
    assert first.json()["time_precision"] == "timestamp"
    assert second.json()["date"] == day(1).isoformat()
    assert datetime.fromisoformat(second.json()["recorded_at"]).utcoffset() == timedelta(0)
    assert len(detail(client, vehicle)["readings"]) == 3


@pytest.mark.parametrize("changes", [
    {"recorded_at": "2026-01-01T12:00:00"}, {"source": "satellite"},
    {"date": "2020-01-01"}, {"odometer_km": True}, {"odometer_km": "NaN"},
])
def test_reading_invalid_input_is_atomic(client, vehicle, changes):
    response = client.post(endpoint(vehicle, "readings"), json={
        "recorded_at": instant(), "odometer_km": 9900, "source": "manual", **changes,
    })
    assert response.status_code == 422, response.text
    assert len(detail(client, vehicle)["readings"]) == 1


def test_precise_backwards_and_anomaly_are_rejected(client, vehicle):
    url = endpoint(vehicle, "readings")
    assert client.post(url, json={"recorded_at": instant(1, 8), "odometer_km": 9900}).status_code == 201
    backwards = client.post(url, json={"recorded_at": instant(1, 9), "odometer_km": 9890})
    anomaly = client.post(url, json={"recorded_at": instant(1, 7), "odometer_km": 7000})
    assert backwards.status_code == anomaly.status_code == 422
    assert len(detail(client, vehicle)["readings"]) == 2


def test_anomaly_threshold_is_configurable(client, vehicle):
    client.app.state.policy["usage"]["max_daily_km"] = 100
    response = client.post(endpoint(vehicle, "readings"), json={"date": day(1).isoformat(), "odometer_km": 9800})
    assert response.status_code == 422
    client.app.state.policy["usage"]["max_daily_km"] = 250
    assert client.post(endpoint(vehicle, "readings"), json={"date": day(1).isoformat(), "odometer_km": 9800}).status_code == 201


def test_batch_replays_skip_exact_records_without_new_evaluations(client, vehicle):
    payload = {"readings": [
        {"recorded_at": instant(1, 14), "odometer_km": 9900, "source": "gps"},
        {"recorded_at": instant(1, 8), "odometer_km": 9800, "source": "obd"},
    ]}
    first = client.post(endpoint(vehicle, "readings/batch"), json=payload)
    assert first.status_code == 200 and first.json()["created"] == 2
    with client.app.state.sessions() as session:
        count = session.scalar(select(func.count(PlanEvaluation.id)))
    replay = client.post(endpoint(vehicle, "readings/batch"), json=payload)
    assert replay.json() == {"created": 0, "skipped": 2, "vehicle_id": vehicle["id"], "atomic": True}
    with client.app.state.sessions() as session:
        assert session.scalar(select(func.count(PlanEvaluation.id))) == count
    assert len(detail(client, vehicle)["readings"]) == 3


def test_batch_conflict_rolls_back_prior_items(client, vehicle):
    existing = {"date": day(1).isoformat(), "odometer_km": 9900}
    assert client.post(endpoint(vehicle, "readings"), json=existing).status_code == 201
    response = client.post(endpoint(vehicle, "readings/batch"), json={"readings": [
        {"date": day(2).isoformat(), "odometer_km": 9800}, {**existing, "source": "gps"},
    ]})
    assert response.status_code == 409
    snapshot = detail(client, vehicle)
    assert len(snapshot["readings"]) == 2
    assert snapshot["vehicle"]["current_km"] == 10000


def test_batch_backwards_rolls_back_prior_items(client, vehicle):
    response = client.post(endpoint(vehicle, "readings/batch"), json={"readings": [
        {"date": day(3).isoformat(), "odometer_km": 9800},
        {"date": day(2).isoformat(), "odometer_km": 9700},
    ]})
    assert response.status_code == 422
    assert len(detail(client, vehicle)["readings"]) == 1


def test_batch_allows_500_but_rejects_501_before_writes(client, vehicle):
    item = {"date": day(1).isoformat(), "odometer_km": 9900}
    too_many = client.post(endpoint(vehicle, "readings/batch"), json={"readings": [item] * 501})
    assert too_many.status_code == 422
    assert len(detail(client, vehicle)["readings"]) == 1
    allowed = client.post(endpoint(vehicle, "readings/batch"), json={"readings": [item] * 500})
    assert allowed.status_code == 200
    assert allowed.json()["created"] == 1 and allowed.json()["skipped"] == 499


def test_chunked_body_limit_cannot_be_bypassed_without_content_length(client, vehicle):
    client.app.state.policy["api"]["max_request_bytes"] = 1024
    def chunks():
        yield b'{"readings":['
        yield b" " * 1100
        yield b"]}"
    response = client.post(endpoint(vehicle, "readings/batch"), content=chunks(), headers={"Content-Type": "application/json"})
    assert response.status_code == 413
    assert len(detail(client, vehicle)["readings"]) == 1


@pytest.mark.parametrize("cost", [None, 0, 1299.50])
def test_cost_nullable_and_nonnegative(client, vehicle, cost):
    result = add_service(client, vehicle, cost=cost)
    assert result["cost"] == cost


@pytest.mark.parametrize("cost", [-1, True, "NaN", "Infinity", 100_000_001])
def test_invalid_cost_does_not_persist_service(client, vehicle, cost):
    response = client.post(endpoint(vehicle, "services"), json=service_payload(cost=cost))
    assert response.status_code == 422
    assert detail(client, vehicle)["history"] == []


def test_json_nan_cost_is_sanitized_to_validation_response(client, vehicle):
    raw = json.dumps(service_payload(cost=float("nan")), allow_nan=True)
    response = client.post(endpoint(vehicle, "services"), content=raw, headers={"Content-Type": "application/json"})
    assert response.status_code == 422
    assert "NaN" not in response.text


def test_fault_link_must_match_vehicle_component_and_kind(client, vehicle, vehicle_data):
    other = another_vehicle(client, vehicle_data)
    foreign = add_fault(client, other, service_id="aceite_normal")
    own = add_fault(client, vehicle, service_id="filtro_motor")
    for changes in [
        {"fault_id": foreign["id"], "maintenance_type": "corrective"},
        {"fault_id": own["id"], "maintenance_type": "corrective"},
        {"fault_id": own["id"], "maintenance_type": "preventive"},
        {"fault_id": 999999, "maintenance_type": "corrective"},
    ]:
        response = client.post(endpoint(vehicle, "services"), json=service_payload(**changes))
        assert response.status_code == 422, response.text
    assert detail(client, vehicle)["history"] == []
    result = add_service(client, vehicle, "filtro_motor", fault_id=own["id"], maintenance_type="corrective")
    assert result["fault_id"] == own["id"]


def test_fault_unpredicted_is_explicit_not_inferred_from_unknown(client, vehicle):
    add_fault(client, vehicle)
    add_fault(client, vehicle, was_predicted=False)
    add_fault(client, vehicle, was_predicted=True)
    result = client.get("/api/metrics?synthetic=true").json()
    assert result["total_failures"] == 3
    assert result["classified_failures"] == 2
    assert result["unpredicted_failures"] == 1


def test_downtime_overlap_open_close_and_no_overwrite(client, vehicle):
    url = endpoint(vehicle, "downtime")
    first = client.post(url, json={"started_at": instant(3, 8), "ended_at": instant(3, 12)})
    assert first.status_code == 201
    assert client.post(url, json={"started_at": instant(3, 10), "ended_at": instant(3, 14)}).status_code == 409
    opened = client.post(url, json={"started_at": instant(2, 8)})
    assert opened.status_code == 201
    assert client.post(url, json={"started_at": instant(1, 8)}).status_code == 409
    close_url = f"{url}/{opened.json()['id']}"
    assert client.patch(close_url, json={"ended_at": instant(3, 8)}).status_code == 422
    assert client.patch(close_url, json={"ended_at": instant(2, 12)}).status_code == 200
    assert client.patch(close_url, json={"ended_at": instant(1, 12)}).status_code == 409
    metrics = client.get("/api/metrics?synthetic=true").json()
    assert metrics["downtime_days"] == pytest.approx(8 / 24, abs=.0001)
    assert metrics["open_downtimes"] == 0


@pytest.mark.parametrize("changes", [
    {"ended_at": "2020-01-01T12:00:00-06:00"},
    {"started_at": "2020-01-01T12:00:00-06:00"},
    {"started_at": "2026-01-01T12:00:00"},
    {"ended_at": "2099-01-01T12:00:00-06:00"},
])
def test_downtime_invalid_dates_do_not_persist(client, vehicle, changes):
    response = client.post(endpoint(vehicle, "downtime"), json={"started_at": instant(2), "ended_at": instant(1), **changes})
    assert response.status_code == 422
    assert detail(client, vehicle)["downtime"] == []


def test_downtime_cannot_close_other_vehicle_record(client, vehicle, vehicle_data):
    other = another_vehicle(client, vehicle_data)
    row = client.post(endpoint(other, "downtime"), json={"started_at": instant(2)}).json()
    assert client.patch(f"{endpoint(vehicle, 'downtime')}/{row['id']}", json={"ended_at": instant(1)}).status_code == 404


def test_real_metrics_exclude_demo_and_unknown_is_not_success(client, vehicle, vehicle_data):
    real = another_vehicle(client, vehicle_data, synthetic=False)
    add_service(client, vehicle, maintenance_type="preventive")
    add_service(client, real, maintenance_type="preventive")
    add_service(client, real, "filtro_motor", maintenance_type="corrective")
    add_service(client, real, "filtro_cabina")
    live = client.get("/api/metrics").json()
    assert live["total_services"] == 3 and live["classified_services"] == 2
    assert live["services_before_failure_percent"] == 50
    assert live["prediction_samples"] == 0 and live["mean_absolute_error_days"] is None
    assert live["synthetic"] is False and live["timezone"] == "America/Mexico_City"
    demo = client.get("/api/metrics?synthetic=true").json()
    assert demo["total_services"] == 1 and demo["services_before_failure_percent"] == 100


def add_audit_snapshot(client, vehicle, before_days, due_date, identity):
    """A historical immutable fixture, not fabricated by the service endpoint."""
    with client.app.state.sessions.begin() as session:
        result = {"services": [{"service_id": "aceite_normal", "due_date": due_date.isoformat()}]}
        snapshot = PlanEvaluation(vehicle_id=vehicle["id"], fingerprint=identity * 64,
            evaluated_at=date_timestamp(day(before_days)) + timedelta(hours=1),
            catalog_version="test", policy_version="test", inputs_snapshot={"fixture": True},
            policy_snapshot={}, catalog_snapshot={}, result=result)
        session.add(snapshot)
        session.flush()
        return snapshot.id


def test_service_feedback_uses_prior_snapshot_not_same_day_or_recomputed(client, vehicle):
    prior_id = add_audit_snapshot(client, vehicle, 2, day() - timedelta(days=3), "a")
    add_audit_snapshot(client, vehicle, 0, day() + timedelta(days=30), "b")
    result = add_service(client, vehicle, cost=1200, maintenance_type="preventive")
    assert result["prediction_evaluation_id"] == prior_id
    assert result["prediction_error_days"] == 3
    assert result["predicted_due_date"] == day(3).isoformat()
    metrics = client.get("/api/metrics?synthetic=true").json()
    assert metrics["prediction_samples"] == 1
    assert metrics["mean_absolute_error_days"] == metrics["mean_signed_error_days"] == 3
    with client.app.state.sessions() as session:
        assert session.get(PlanEvaluation, prior_id).result["services"][0]["due_date"] == day(3).isoformat()


def test_same_day_only_prediction_does_not_create_false_accuracy(client, vehicle):
    add_audit_snapshot(client, vehicle, 0, day(), "c")
    result = add_service(client, vehicle)
    assert result["prediction_evaluation_id"] is None
    assert result["prediction_error_days"] is None


def test_fleet_fallback_separates_real_demo_and_invalidates_target_cache(client, vehicle, vehicle_data):
    real = another_vehicle(client, vehicle_data, identity=2, synthetic=False)
    insert_rate(client, real, 300)
    first = client.get(endpoint(vehicle, "plan")).json()
    assert first["usage"]["source"] == "default"
    assert first["usage"]["km_per_day"] == 80
    peer = another_vehicle(client, vehicle_data, identity=3)
    insert_rate(client, peer, 65)
    second = client.get(endpoint(vehicle, "plan")).json()
    assert second["usage"]["source"] == "fleet" and second["usage"]["km_per_day"] == 65
    assert client.post(endpoint(peer, "readings"), json={"date": day(4).isoformat(), "odometer_km": 9700}).status_code == 201
    third = client.get(endpoint(vehicle, "plan")).json()
    assert third["usage"]["source"] == "fleet" and third["usage"]["km_per_day"] > 65
    assert third["usage"]["km_per_day"] < 100  # Real 300 km/day cannot enter demo cohort.
    with client.app.state.sessions() as session:
        snapshots = list(session.scalars(select(PlanEvaluation).where(PlanEvaluation.vehicle_id == vehicle["id"])))
        assert len(snapshots) >= 3
        assert all(row.inputs_snapshot["fleet_usage_km_per_day"] != 300 for row in snapshots)


def test_concurrent_duplicate_readings_only_commit_once(client, vehicle):
    payload = {"recorded_at": instant(1, 10), "odometer_km": 9900, "source": "gps"}
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: client.post(endpoint(vehicle, "readings"), json=payload).status_code, range(4)))
    assert sorted(results) == [201, 409, 409, 409]
    assert len(detail(client, vehicle)["readings"]) == 2


def test_concurrent_batch_replay_and_plan_do_not_duplicate(client, vehicle):
    payload = {"readings": [{"date": day(1).isoformat(), "odometer_km": 9900}]}
    def request(index):
        return client.post(endpoint(vehicle, "readings/batch"), json=payload) if index % 2 else client.get(endpoint(vehicle, "plan"))
    with ThreadPoolExecutor(max_workers=4) as pool:
        responses = list(pool.map(request, range(8)))
    assert all(response.status_code == 200 for response in responses)
    assert sum(response.json().get("created", 0) for response in responses) == 1
    with client.app.state.sessions() as session:
        assert session.scalar(select(func.count(OdometerReading.id)).where(OdometerReading.vehicle_id == vehicle["id"])) == 2
        assert session.scalar(select(func.count(Alert.id))) == session.scalar(select(func.count(func.distinct(Alert.key))))
        assert session.scalar(select(func.count(Notification.id))) == session.scalar(select(func.count(func.distinct(Notification.dedup_key))))


def test_actual_body_limit_ignores_understated_content_length(client, vehicle):
    client.app.state.policy["api"]["max_request_bytes"] = 1024
    response = client.post(endpoint(vehicle, "readings/batch"), content=b" " * 1200,
                           headers={"Content-Type": "application/json", "Content-Length": "1"})
    assert response.status_code == 413
    assert len(detail(client, vehicle)["readings"]) == 1


def test_multiple_observed_peers_use_average_not_fallback_rates(client, vehicle, vehicle_data):
    sparse = another_vehicle(client, vehicle_data, identity=2)
    observed_a = another_vehicle(client, vehicle_data, identity=3)
    observed_b = another_vehicle(client, vehicle_data, identity=4)
    # A sparse peer has a default estimate but must not be averaged as observed.
    assert client.get(endpoint(sparse, "plan")).json()["usage"]["source"] == "default"
    insert_rate(client, observed_a, 55)
    insert_rate(client, observed_b, 75)
    usage = client.get(endpoint(vehicle, "plan")).json()["usage"]
    assert usage["source"] == "fleet"
    assert usage["km_per_day"] == 65


def test_overdue_transition_notifies_once_without_duplicating_alert(client, vehicle, monkeypatch):
    client.app.state.policy["service_overrides"]["aceite_normal"] = {
        "validated": True, "validated_by": "Prueba técnica", "validated_on": day(1).isoformat(),
        "evidence_url": "https://example.test/validated", "resolved_conflicts": ["C01"],
        "interval_km": None, "interval_months": None, "interval_days": 60,
    }
    add_service(client, vehicle, performed_on=day(53).isoformat(), odometer_km=9000)
    first = client.get(endpoint(vehicle, "plan")).json()
    alert = next(item for item in first["alerts"] if item.get("service_id") == "aceite_normal")
    assert alert["stage"] == "7d"
    with client.app.state.sessions() as session:
        persistent = session.scalar(select(Alert).where(Alert.service_id == "aceite_normal"))
        alert_id = persistent.id
        before = session.scalar(select(func.count(Notification.id)).where(Notification.alert_id == alert_id))
    future = day() + timedelta(days=8)
    monkeypatch.setattr("app.planner.current_date", lambda: future)
    overdue = client.get(endpoint(vehicle, "plan")).json()
    past = next(item for item in overdue["alerts"] if item.get("service_id") == "aceite_normal")
    assert past["stage"] == "overdue" and past["key"] == alert["key"]
    for _ in range(2):
        assert client.get(endpoint(vehicle, "plan")).status_code == 200
    with client.app.state.sessions() as session:
        assert session.scalar(select(func.count(Alert.id)).where(Alert.service_id == "aceite_normal")) == 1
        assert session.scalar(select(func.count(Notification.id)).where(Notification.alert_id == alert_id)) == before + 2


def test_commit_failure_is_reported_before_success_and_rolls_back(client, vehicle):
    from sqlalchemy import event
    from sqlalchemy.exc import OperationalError
    session_class = client.app.state.sessions.class_

    def unavailable(_session):
        raise OperationalError("test commit", {}, Exception("locked"))

    event.listen(session_class, "before_commit", unavailable)
    try:
        response = client.post(endpoint(vehicle, "readings"), json={"date": day(1).isoformat(), "odometer_km": 9900})
        assert response.status_code == 503
        assert response.headers["retry-after"] == "5"
    finally:
        event.remove(session_class, "before_commit", unavailable)
    assert len(detail(client, vehicle)["readings"]) == 1


def test_vehicle_severity_update_is_validated_and_preserves_unit(client, vehicle):
    route = f"/api/vehicles/{vehicle['id']}"
    assert client.patch(route, json={"severity_multiplier": 1.1}).status_code == 422
    assert client.patch(route, json={"current_km": 0}).status_code == 422
    result = client.patch(route, json={"severity_multiplier": 0.8, "usage_regime": "severe"})
    assert result.status_code == 200
    assert result.json()["severity_multiplier"] == 0.8
    assert result.json()["current_km"] == vehicle["current_km"]
    assert client.get(endpoint(vehicle, "plan")).status_code == 200
