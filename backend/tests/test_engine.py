"""Deterministic safety/forecasting tests; fixtures are synthetic, not Mazda data."""

import copy
import json
from datetime import date, timedelta
from pathlib import Path

import pytest

from app.engine import add_months, build_plan, estimate_usage, group_visits, matches_service


TODAY = date(2026, 9, 19)
ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def policy():
    return json.loads((ROOT / "config" / "policy.json").read_text(encoding="utf-8"))


@pytest.fixture
def vehicle():
    return {"id": 1, "current_km": 20000, "model_year": 2024, "body_style": "sedan",
            "engine": "G25", "transmission": "AT6", "drive": "FWD", "usage_regime": "normal",
            "in_service_date": "2024-01-01"}


def readings(rate=100, count=11, end_km=20000, step=5, end=TODAY):
    return [{"date": (end - timedelta(days=step * n)).isoformat(), "odometer_km": end_km - rate * step * n}
            for n in reversed(range(count))]


def rule(**changes):
    value = {"id": "oil", "servicio": "Aceite", "accion": "reemplazo", "intervalo_km": 10000,
             "intervalo_meses": 6, "habilitado_produccion": False, "severidad": "importante",
             "confianza": "alta", "tolerancia_km": None, "tolerancia_dias": None,
             "duracion_estimada_taller_horas": None, "fuente": [{"url": "https://example.test/manual"}]}
    value.update(changes)
    return value


def service_history(km=15000, performed="2026-08-01", service_id="oil"):
    return [{"service_id": service_id, "performed_on": performed, "odometer_km": km}]


def plan(vehicle, policy, services=None, history=None, data=None, faults=None):
    return build_plan(vehicle, readings() if data is None else data,
                      service_history() if history is None else history, faults or [],
                      {"version_catalogo": "test", "servicios": services if services is not None else [rule()]},
                      policy, TODAY)


def window(identity, start, end, **extras):
    item = {"service_id": identity, "window_start": start, "window_end": end,
            "severity": "menor", "status": "upcoming", "duration_hours": 1}
    item.update(extras)
    return item


def fault(**changes):
    value = {"id": 3, "description": "Ruido reportado", "severity": "menor", "status": "open",
             "reported_on": TODAY.isoformat(), "safe_to_defer": False, "deadline": None}
    value.update(changes)
    return value


def test_weighted_daily_rate_and_scenarios(policy):
    usage = estimate_usage(readings(), policy, TODAY)
    assert usage["km_per_day"] == 100
    assert usage["low_km_per_day"] == 80
    assert usage["high_km_per_day"] == 120
    assert usage["confidence"] == "alta"


def test_sparse_data_uses_configured_default_without_high_confidence(policy):
    policy["usage"]["default_km_per_day"] = 65
    usage = estimate_usage(readings(count=2), policy, TODAY)
    assert usage["km_per_day"] == 65
    assert usage["confidence"] == "baja"
    assert usage["high_km_per_day"] >= 100


def test_empty_readings_fallback(policy):
    usage = estimate_usage([], policy, TODAY)
    assert usage["km_per_day"] == 80
    assert usage["valid_intervals"] == 0
    assert usage["confidence"] == "baja"


def test_uneven_gaps_do_not_count_missing_days_as_zero(policy):
    data = [{"date": (TODAY - timedelta(days=d)).isoformat(), "odometer_km": 20000 - 70 * d}
            for d in [70, 60, 22, 11, 3, 0]]
    assert estimate_usage(data, policy, TODAY)["km_per_day"] == 70


def test_isolated_large_spike_rejected(policy):
    data = readings()
    data[4]["odometer_km"] += 1800
    usage = estimate_usage(data, policy, TODAY)
    assert usage["km_per_day"] == 100
    assert usage["rejected_readings"] == 1


def test_bad_latest_spike_not_used_as_projection_odometer(vehicle, policy):
    data = readings()
    data[-1]["odometer_km"] += 1800
    vehicle["current_km"] += 1800
    result = plan(vehicle, policy, data=data)
    assert result["usage"]["rejected_readings"] == 1
    assert result["services"][0]["due_odometer"] == 25000
    assert result["services"][0]["due_date"] == "2026-11-08"
    assert any("difiere" in warning for warning in result["warnings"])


@pytest.mark.parametrize("invalid", [float("nan"), float("inf"), -1, "oops", None, True])
def test_invalid_odometer_rejected(policy, invalid):
    data = readings()
    data.append({"date": (TODAY - timedelta(days=2)).isoformat(), "odometer_km": invalid})
    usage = estimate_usage(data, policy, TODAY)
    assert usage["rejected_readings"] == 1
    assert usage["km_per_day"] == 100


def test_future_and_duplicate_readings_rejected(policy):
    data = readings()
    data += [{"date": (TODAY + timedelta(days=1)).isoformat(), "odometer_km": 20100}, data[-1].copy()]
    usage = estimate_usage(data, policy, TODAY)
    assert usage["rejected_readings"] == 2
    assert usage["km_per_day"] == 100


def test_conflicting_same_day_rejects_both(policy):
    data = readings()
    data.append({"date": data[5]["date"], "odometer_km": data[5]["odometer_km"] + 10})
    usage = estimate_usage(data, policy, TODAY)
    assert usage["rejected_readings"] == 2
    assert usage["km_per_day"] == 100


def test_decreasing_sequence_not_negative_usage(policy):
    data = [{"date": "2026-09-17", "odometer_km": 5000}, {"date": "2026-09-18", "odometer_km": 4900}]
    usage = estimate_usage(data, policy, TODAY)
    assert usage["rejected_readings"] == 1
    assert usage["km_per_day"] >= 0


def test_old_observations_lower_confidence(policy):
    usage = estimate_usage(readings(end=TODAY - timedelta(days=20)), policy, TODAY)
    assert usage["confidence"] == "baja"
    assert usage["high_km_per_day"] == 160


def test_stationary_vehicle_has_zero_measured_usage(policy):
    usage = estimate_usage(readings(rate=0), policy, TODAY)
    assert usage["km_per_day"] == usage["low_km_per_day"] == usage["high_km_per_day"] == 0


def test_calendar_month_end_and_leap_year():
    assert add_months(date(2024, 1, 31), 1) == date(2024, 2, 29)
    assert add_months(date(2024, 2, 29), 12) == date(2025, 2, 28)
    assert add_months(date(2026, 12, 31), 2) == date(2027, 2, 28)


def test_distance_service_date_and_conservative_limit(vehicle, policy):
    result = plan(vehicle, policy)["services"][0]
    assert result["due_date"] == "2026-11-08"  # 5000 / 100 = 50 days.
    assert result["latest_entry_date"] == "2026-10-30"  # floor(5000 / 120).
    assert result["prediction"] == {"optimistic": "2026-11-20", "probable": "2026-11-08", "pessimistic": "2026-10-30"}
    assert result["requires_validation"] is True


def test_calendar_deadline_wins(vehicle, policy):
    result = plan(vehicle, policy, history=service_history(performed="2026-04-01"))["services"][0]
    assert result["due_date"] == result["latest_entry_date"] == "2026-10-01"


def test_overdue_history_not_moved_into_future(vehicle, policy):
    result = plan(vehicle, policy, history=service_history(km=5000, performed="2026-01-01"))
    assert result["services"][0]["status"] == "overdue"
    assert result["services"][0]["latest_entry_date"] < TODAY.isoformat()
    assert result["visits"][0]["planned_date"] == TODAY.isoformat()
    assert result["alerts"][0]["days_remaining"] < 0
    assert result["traffic_light"] == "red"


def test_negative_km_forecast_uncertainty_ordered(vehicle, policy):
    result = plan(vehicle, policy, services=[rule(intervalo_meses=None)], history=service_history(km=5000))["services"][0]
    assert result["prediction"]["pessimistic"] <= result["prediction"]["probable"] <= result["prediction"]["optimistic"]
    assert result["km_remaining"] < 0


def test_no_history_does_not_assume_zero(vehicle, policy):
    result = plan(vehicle, policy, history=[])
    assert result["services"][0]["status"] == "pending_validation"
    assert result["services"][0]["due_date"] is None
    assert result["visits"] == []
    assert result["traffic_light"] == "gray"


def test_general_service_does_not_reset_individual_component(vehicle, policy):
    result = plan(vehicle, policy, history=service_history(service_id="general"))
    assert result["services"][0]["due_date"] is None


def test_maintenance_beyond_current_km_rejected(vehicle, policy):
    result = plan(vehicle, policy, history=service_history(km=30000))
    assert result["services"][0]["status"] == "pending_validation"


def test_no_interval_means_condition_not_infinite_lifetime(vehicle, policy):
    result = plan(vehicle, policy, services=[rule(intervalo_km=None, intervalo_meses=None)])
    assert result["services"][0]["due_date"] is None
    assert "Por condición" in result["services"][0]["explanation"]


def test_stationary_vehicle_still_uses_months(vehicle, policy):
    result = plan(vehicle, policy, data=readings(rate=0))["services"][0]
    assert result["due_date"] == "2027-02-01"


def test_stationary_vehicle_km_only_unknown(vehicle, policy):
    result = plan(vehicle, policy, data=readings(rate=0), services=[rule(intervalo_meses=None)])["services"][0]
    assert result["due_date"] is None
    assert result["status"] == "pending_validation"


def test_operational_mode_blocks_unvalidated_catalog(vehicle, policy):
    policy["mode"] = "operational"
    result = plan(vehicle, policy)
    assert result["services"][0]["status"] == "pending_validation"
    assert result["visits"] == []


def test_positive_tolerances_without_validation_are_ignored(vehicle, policy):
    policy["service_overrides"]["oil"] = {"tolerance_days": 900, "tolerance_km": 900000}
    result = plan(vehicle, policy)["services"][0]
    assert result["latest_entry_date"] == "2026-10-30"


def test_validated_override_enables_rule_without_changing_catalog(vehicle, policy):
    policy["mode"] = "operational"
    policy["service_overrides"]["oil"] = {"validated": True, "validated_by": "Agencia de prueba",
        "validated_on": "2026-09-01", "evidence_url": "https://example.test/evidence", "advance_days": 4,
        "tolerance_km": 1200, "tolerance_days": 4, "duration_hours": 2}
    result = plan(vehicle, policy)["services"][0]
    assert result["status"] == "upcoming"
    assert result["requires_validation"] is False
    assert result["latest_entry_date"] == "2026-11-09"
    assert result["duration_hours"] == 2


def test_future_validation_is_not_accepted(vehicle, policy):
    policy["mode"] = "operational"
    policy["service_overrides"]["oil"] = {"validated": True, "validated_by": "Agencia", "validated_on": "2027-01-01", "evidence_url": "https://example.test"}
    assert plan(vehicle, policy)["services"][0]["status"] == "pending_validation"


def test_zero_advance_operational_without_approval(vehicle, policy):
    policy["mode"] = "operational"
    result = plan(vehicle, policy, services=[rule(habilitado_produccion=True)])["services"][0]
    assert result["window_start"] == result["window_end"]


@pytest.mark.parametrize("days,expected", [(31, None), (30, 30), (15, 30), (14, 14), (8, 14), (7, 7), (3, 7), (0, 7), (-1, 0)])
def test_alert_thresholds_against_limit(vehicle, policy, days, expected):
    # Zero-motion fixture makes the month criterion exact, independent of usage.
    due = TODAY + timedelta(days=days)
    performed = add_months(due, -1).isoformat()
    result = plan(vehicle, policy, data=readings(rate=0),
                  services=[rule(intervalo_km=None, intervalo_meses=1)], history=service_history(performed=performed))
    maintenance = [alert for alert in result["alerts"] if alert["kind"] == "maintenance"]
    if expected is None:
        assert not maintenance
    else:
        assert maintenance[0]["threshold_days"] == expected


def test_latest_common_point_grouping():
    visits = group_visits([window("a", "2026-09-20", "2026-09-28"), window("b", "2026-09-25", "2026-10-02")], TODAY)
    assert len(visits) == 1
    assert visits[0]["planned_date"] == "2026-09-28"
    assert visits[0]["service_ids"] == ["a", "b"]
    assert visits[0]["total_duration_hours"] == 2


def test_pairwise_chain_overlap_does_not_merge_without_global_intersection():
    visits = group_visits([window("a", "2026-09-20", "2026-09-22"), window("b", "2026-09-22", "2026-09-25"), window("c", "2026-09-25", "2026-09-28")], TODAY)
    assert len(visits) == 2
    assert visits[0]["service_ids"] == ["a", "b"]
    assert visits[1]["service_ids"] == ["c"]


def test_unknown_duration_not_silently_zero():
    visits = group_visits([window("a", "2026-09-20", "2026-09-22"), window("b", "2026-09-20", "2026-09-22", duration_hours=None)], TODAY)
    assert visits[0]["total_duration_hours"] is None


def test_grouping_ids_stable_and_input_order_invariant():
    a, b = window("a", "2026-09-20", "2026-09-22"), window("b", "2026-09-20", "2026-09-22")
    assert group_visits([a, b], TODAY, 42) == group_visits([b, a], TODAY, 42)


def test_critical_report_immediate_ignores_deferral(vehicle, policy):
    result = plan(vehicle, policy, faults=[fault(severity="critico", safe_to_defer=True, deadline="2026-10-20")])
    alert = next(a for a in result["alerts"] if a["kind"] == "fault")
    visit = next(v for v in result["visits"] if v["fault_ids"])
    assert alert["deadline"] == TODAY.isoformat()
    assert "No conducir" in alert["message"]
    assert visit["planned_date"] == TODAY.isoformat()
    assert visit["service_ids"] == []
    assert result["traffic_light"] == "red"


def test_minor_without_triage_cannot_wait(vehicle, policy):
    result = plan(vehicle, policy, faults=[fault(deadline="2026-10-20")])
    alert = next(a for a in result["alerts"] if a["kind"] == "fault")
    assert alert["deadline"] == TODAY.isoformat()
    assert "no se declara seguro esperar" in alert["message"]


def test_minor_with_explicit_triage_groups_at_latest_common_day(vehicle, policy):
    result = plan(vehicle, policy, faults=[fault(safe_to_defer=True, deadline="2026-11-01")])
    grouped = next(v for v in result["visits"] if v["fault_ids"])
    assert grouped["service_ids"] == ["oil"]
    assert grouped["planned_date"] == "2026-10-30"
    assert any(a["kind"] == "fault" for a in result["alerts"])  # Alert now, even far ahead.


def test_resolved_fault_absent(vehicle, policy):
    result = plan(vehicle, policy, faults=[fault(status="resolved", severity="critico")])
    assert not any(a["kind"] == "fault" for a in result["alerts"])


def test_critical_with_old_deadline_retains_overdue_alert(vehicle, policy):
    result = plan(vehicle, policy, faults=[fault(severity="critico", reported_on="2026-09-10")])
    alert = next(a for a in result["alerts"] if a["kind"] == "fault")
    assert alert["deadline"] == "2026-09-10"
    assert alert["days_remaining"] == -9


def test_year_engine_transmission_drive_regime_applicability(vehicle):
    assert matches_service(vehicle, rule(transmisiones_permitidas=["AT6"]))
    assert not matches_service(vehicle, rule(transmisiones_permitidas=["MT6"]))
    assert not matches_service(vehicle, rule(tracciones_permitidas=["AWD"]))
    assert not matches_service(vehicle, rule(motores_permitidos=["G25T"]))
    assert not matches_service(vehicle, rule(aplicabilidad={"anios_modelo": [2021]}))
    assert not matches_service(vehicle, rule(regimen="severo"))


def test_severe_oil_uses_previous_normal_oil_record(vehicle, policy):
    vehicle["usage_regime"] = "severe"
    result = plan(vehicle, policy,
                  services=[rule(id="aceite_normal", regimen="normal"), rule(id="aceite_severo", regimen="severo", intervalo_km=5000, intervalo_meses=3)],
                  history=service_history(service_id="aceite_normal"))
    assert len(result["services"]) == 1
    assert result["services"][0]["service_id"] == "aceite_severo"
    assert result["services"][0]["due_odometer"] == 20000


def test_coolant_initial_does_not_repeat_after_documented_change(vehicle, policy):
    services = [rule(id="refrigerante_inicial", intervalo_km=192000, intervalo_meses=120), rule(id="refrigerante_sucesivo", intervalo_km=96000, intervalo_meses=60)]
    result = plan(vehicle, policy, services=services, history=service_history(service_id="refrigerante_inicial"))
    assert [s["service_id"] for s in result["services"]] == ["refrigerante_sucesivo"]
    assert result["services"][0]["due_odometer"] == 111000


def test_catalog_real_fields_match_and_are_not_mutated(vehicle, policy):
    catalog = json.loads((ROOT / "catalogos" / "mazda3-mx.v0.1.0.json").read_text(encoding="utf-8"))
    originals = copy.deepcopy((vehicle, policy, catalog))
    result = build_plan(vehicle, readings(), [], [], catalog, policy, TODAY)
    ids = {s["service_id"] for s in result["services"]}
    assert "bujias_no_turbo" in ids and "bujias_turbo" not in ids
    assert "transmision_at" in ids and "transmision_mt" not in ids
    assert "awd" not in ids and "bateria_mhev" not in ids
    assert (vehicle, policy, catalog) == originals
    json.dumps(result, allow_nan=False)


def test_invalid_mode_rejected(vehicle, policy):
    policy["mode"] = "prod"
    with pytest.raises(ValueError):
        plan(vehicle, policy)


def test_overdue_services_share_one_evaluation_but_critical_stays_separate():
    items = [window("a", "2026-09-01", "2026-09-10"), window("b", "2026-09-02", "2026-09-12"),
             window("c", "2026-09-01", "2026-09-11", severity="critico")]
    visits = group_visits(items, TODAY)
    assert len(visits) == 2
    assert any(v["service_ids"] == ["a", "b"] for v in visits)
    assert any(v["service_ids"] == ["c"] for v in visits)
    assert all(v["planned_date"] == TODAY.isoformat() for v in visits)


def test_operator_inspection_does_not_require_workshop():
    assert not group_visits([window("pressure", "2026-09-19", "2026-09-19", action="inspeccion_operador")], TODAY)


def test_equipment_condition_unknown_not_scheduled(vehicle, policy):
    result = plan(vehicle, policy, services=[rule(condicion_aplicabilidad="Solo si está equipado.")])
    assert result["services"][0]["status"] == "pending_validation"
    assert "Equipamiento" in result["services"][0]["explanation"]


def test_equipment_confirmed_absent_not_applicable(vehicle, policy):
    vehicle["confirmed_equipment"] = {"oil": False}
    result = plan(vehicle, policy, services=[rule(condicion_aplicabilidad="Solo si está equipado.")])
    assert result["services"] == []


def test_equipment_confirmed_present_eligible(vehicle, policy):
    vehicle["confirmed_equipment"] = {"oil": True}
    result = plan(vehicle, policy, services=[rule(condicion_aplicabilidad="Solo si está equipado.")])
    assert result["services"][0]["status"] == "upcoming"


def test_conflict_resolution_requires_explicit_evidence(vehicle, policy):
    policy["mode"] = "operational"
    override = {"validated": True, "validated_by": "Agencia", "validated_on": "2026-09-01", "evidence_url": "https://example.test", "interval_months": 12}
    policy["service_overrides"]["oil"] = override
    result = plan(vehicle, policy, services=[rule(conflictos=["C01"])])
    assert result["services"][0]["status"] == "pending_validation"
    override["resolved_conflicts"] = ["C01"]
    result = plan(vehicle, policy, services=[rule(conflictos=["C01"], intervalo_km=None)])
    assert result["services"][0]["due_date"] == "2027-08-01"


@pytest.mark.parametrize("description", ["Pérdida de frenos al bajar", "Baja presión de aceite", "Fuga de combustible", "Sobrecalentamiento del motor", "La unidad no frena"])
def test_critical_symptoms_override_manual_minor_classification(vehicle, policy, description):
    result = plan(vehicle, policy, faults=[fault(description=description, safe_to_defer=True, deadline="2026-11-01")])
    alert = next(a for a in result["alerts"] if a["kind"] == "fault")
    assert alert["severity"] == "critico"
    assert alert["deadline"] == TODAY.isoformat()


def test_unmapped_dtc_cannot_claim_safe_deferral(vehicle, policy):
    result = plan(vehicle, policy, faults=[fault(dtc="P0126", safe_to_defer=True, deadline="2026-11-01")])
    alert = next(a for a in result["alerts"] if a["kind"] == "fault")
    assert alert["deadline"] == TODAY.isoformat()
    assert "DTC sin regla" in alert["message"]


def test_cycle_alert_key_changes_after_new_service(vehicle, policy):
    service = rule(intervalo_km=5000, intervalo_meses=None)
    first = plan(vehicle, policy, services=[service], history=service_history(km=15000, performed="2026-08-01"))
    second = plan(vehicle, policy, services=[service], history=service_history(km=15000, performed="2026-09-01"))
    a = next(a for a in first["alerts"] if a["kind"] == "maintenance")
    b = next(a for a in second["alerts"] if a["kind"] == "maintenance")
    assert a["key"] != b["key"]


def test_zero_low_usage_has_no_finite_optimistic_km_only_date(vehicle, policy):
    policy["usage"]["relative_uncertainty"] = 1
    result = plan(vehicle, policy, services=[rule(intervalo_meses=None)])["services"][0]
    assert result["prediction"]["optimistic"] is None
    assert result["prediction"]["pessimistic"] is not None


def test_sustained_recent_usage_increase_preserved_in_conservative_bound(policy):
    data = readings()
    data[-3]["odometer_km"] += 300
    data[-2]["odometer_km"] += 600
    data[-1]["odometer_km"] += 900
    usage = estimate_usage(data, policy, TODAY)
    assert usage["rejected_readings"] == 0
    assert usage["high_km_per_day"] >= 160


@pytest.mark.parametrize("section,key,value", [
    ("usage", "half_life_days", 0), ("usage", "relative_uncertainty", 2),
    ("usage", "default_km_per_day", float("nan")), ("planning", "demo_advance_days", -2),
    ("planning", "max_projection_days", 0),
])
def test_invalid_configuration_fails_closed(vehicle, policy, section, key, value):
    policy[section][key] = value
    with pytest.raises(ValueError, match="Política"):
        plan(vehicle, policy)


def test_fault_alert_exposes_effective_deferral_state(vehicle, policy):
    result = plan(vehicle, policy, faults=[fault(description="Baja presión de aceite", safe_to_defer=True, deadline="2026-10-01")])
    alert = next(a for a in result["alerts"] if a["kind"] == "fault")
    assert alert["safe_to_defer"] is False
    assert alert["safety_evaluation"] == "critical"


def test_fresh_service_odometer_resets_projection_origin_after_stale_reading(vehicle, policy):
    vehicle["current_km"] = 10000
    result = plan(vehicle, policy, data=[{"date": "2026-06-01", "odometer_km": 10000}],
                  history=service_history(km=10000, performed=TODAY.isoformat()))["services"][0]
    assert result["status"] == "upcoming"
    assert result["due_date"] == "2027-01-22"
    assert result["latest_entry_date"] == "2026-12-06"
    assert result["km_remaining"] == 10000


def test_fresh_service_measurement_survives_rejected_odometer_spike(vehicle, policy):
    data = readings()
    data[-1]["odometer_km"] += 1800
    vehicle["current_km"] += 1800
    result = plan(vehicle, policy, data=data, services=[rule(intervalo_km=500)],
                  history=service_history(km=21800, performed=TODAY.isoformat()))
    assert result["usage"]["rejected_readings"] == 1
    assert result["services"][0]["km_remaining"] == 500
    assert result["services"][0]["latest_entry_date"] == "2026-09-23"


def test_backwards_projection_never_predates_performed_service(vehicle, policy):
    result = plan(vehicle, policy, services=[rule(intervalo_km=100, intervalo_meses=None)],
                  history=service_history(km=19000, performed="2026-09-18"))["services"][0]
    assert result["status"] == "overdue"
    assert result["due_date"] == "2026-09-18"
    assert result["latest_entry_date"] == "2026-09-18"
    assert all(value >= "2026-09-18" for value in result["prediction"].values() if value)


def test_workshop_buffer_does_not_invent_due_date_before_replacement(vehicle, policy):
    policy["planning"]["workshop_buffer_days"] = 1000
    result = plan(vehicle, policy, history=service_history(km=20000, performed=TODAY.isoformat()))["services"][0]
    assert result["latest_entry_date"] == TODAY.isoformat()


def test_sparse_readings_use_fleet_rate_with_low_confidence(policy):
    result = estimate_usage(readings(count=2), policy, TODAY, fleet_usage_km_per_day=65)
    assert result["km_per_day"] == 65
    assert result["source"] == "fleet"
    assert result["fallback_used"] is True
    assert result["confidence"] == "baja"
    assert result["high_km_per_day"] >= 100  # Sparse high use remains visible.
    assert "flotilla" in result["explanation"]


def test_observed_usage_does_not_get_replaced_by_fleet(policy):
    result = estimate_usage(readings(), policy, TODAY, fleet_usage_km_per_day=65)
    assert result["km_per_day"] == 100
    assert result["source"] == "observed"
    assert result["fallback_used"] is False


def test_stationary_fleet_is_distinct_from_missing_fleet(policy):
    assert estimate_usage([], policy, TODAY, 0)["km_per_day"] == 0
    assert estimate_usage([], policy, TODAY)["source"] == "default"


@pytest.mark.parametrize("rate", [-1, True, float("nan"), float("inf"), 1201])
def test_invalid_fleet_fallback_fails_closed(policy, rate):
    with pytest.raises(ValueError, match="flotilla"):
        estimate_usage([], policy, TODAY, rate)


def test_plan_accepts_fleet_fallback(vehicle, policy):
    result = build_plan(vehicle, [], service_history(), [], {"servicios": [rule()]}, policy, TODAY, 65)
    assert result["usage"]["km_per_day"] == 65
    assert result["usage"]["source"] == "fleet"


def test_latest_precise_reading_per_day_is_not_a_conflict(policy):
    data = []
    for item in readings():
        data.extend([
            {**item, "odometer_km": item["odometer_km"] - 50, "recorded_at": item["date"] + "T08:00:00-06:00", "time_precision": "timestamp"},
            {**item, "recorded_at": item["date"] + "T18:00:00-06:00", "time_precision": "timestamp"},
            {**item, "odometer_km": item["odometer_km"] - 25, "time_precision": "date"},
        ])
    result = estimate_usage(data, policy, TODAY)
    assert result["km_per_day"] == 100
    assert result["rejected_readings"] == 0
    assert result["confidence"] == "alta"


def test_same_instant_conflicting_precise_readings_rejected(policy):
    data = readings()
    data[-1].update(recorded_at=TODAY.isoformat() + "T18:00:00-06:00", time_precision="timestamp")
    data.append({**data[-1], "odometer_km": 20100})
    result = estimate_usage(data, policy, TODAY)
    assert result["rejected_readings"] == 2


@pytest.mark.parametrize("days", [20, 90])
def test_days_and_months_take_first_without_converting_months(vehicle, policy, days):
    result = plan(vehicle, policy, data=readings(rate=0),
                  services=[rule(intervalo_km=None, intervalo_meses=1, intervalo_dias=days)],
                  history=service_history(performed="2026-08-01"))["services"][0]
    assert result["due_date"] == ("2026-08-21" if days == 20 else "2026-09-01")


def test_days_only_rule_is_forecastable(vehicle, policy):
    result = plan(vehicle, policy, services=[rule(intervalo_km=None, intervalo_meses=None, intervalo_dias=60)])["services"][0]
    assert result["due_date"] == "2026-09-30"
    assert result["prediction"] == {"optimistic": "2026-09-30", "probable": "2026-09-30", "pessimistic": "2026-09-30"}


@pytest.mark.parametrize("days", [0, -1, .5, True, float("nan")])
def test_invalid_days_interval_rejected(vehicle, policy, days):
    with pytest.raises(ValueError, match="Intervalo"):
        plan(vehicle, policy, services=[rule(intervalo_dias=days)])


def test_severity_factor_shortens_distance_and_time(vehicle, policy):
    vehicle["severity_multiplier"] = .5
    result = plan(vehicle, policy, services=[rule(intervalo_dias=120)])["services"][0]
    assert result["due_odometer"] == 20000
    assert result["due_date"] == TODAY.isoformat()
    assert result["severity_multiplier"] == .5
    stationary = plan(vehicle, policy, data=readings(rate=0), services=[rule(intervalo_km=None, intervalo_dias=120)])["services"][0]
    assert stationary["due_date"] == "2026-09-30"  # 120 * .5 days since Aug 1.


def test_severity_factor_preserves_actual_calendar_duration(vehicle, policy):
    vehicle["severity_multiplier"] = .5
    result = plan(vehicle, policy, data=readings(rate=0),
                  services=[rule(intervalo_km=None, intervalo_meses=1)],
                  history=service_history(performed="2026-08-01"))["services"][0]
    assert result["due_date"] == "2026-08-16"  # floor(31 * .5), not a converted monthly seed.


@pytest.mark.parametrize("factor", [0, -1, 1.01, True, float("nan"), float("inf")])
def test_severity_factor_cannot_extend_interval(vehicle, policy, factor):
    vehicle["severity_multiplier"] = factor
    with pytest.raises(ValueError, match="severidad"):
        plan(vehicle, policy)


def test_alert_describes_km_usage_and_distinct_overdue_stage(vehicle, policy):
    service = rule(intervalo_km=6000, intervalo_meses=None)
    first = plan(vehicle, policy, services=[service])
    alert = next(alert for alert in first["alerts"] if alert["kind"] == "maintenance")
    assert alert["stage"] == "14d"
    assert alert["km_remaining"] == 1000
    assert alert["usage_km_per_day"] == 100
    assert "1,000 km" in alert["message"] and "100 km/día" in alert["message"]
    overdue = build_plan(vehicle, readings(), service_history(), [], {"servicios": [service]}, policy, TODAY + timedelta(days=9))
    past = next(alert for alert in overdue["alerts"] if alert["kind"] == "maintenance")
    assert past["stage"] == "overdue"
    assert past["threshold_days"] == 0
    assert past["key"] == alert["key"]  # Same alert, new notification stage.


def test_alert_generation_is_deterministic_and_cycle_unique(vehicle, policy):
    first = plan(vehicle, policy, services=[rule(intervalo_km=6000)])
    assert first == plan(vehicle, policy, services=[rule(intervalo_km=6000)])
    assert len({alert["key"] for alert in first["alerts"]}) == len(first["alerts"])


def test_grouping_fifteen_day_horizon_does_not_collect_distant_limits():
    items = [window("a", "2026-09-19", "2026-09-20"),
             window("b", "2026-09-19", "2026-10-05"),
             window("c", "2026-09-19", "2026-10-06")]
    visits = group_visits(items, TODAY, grouping_window_days=15)
    assert len(visits) == 2
    assert visits[0]["service_ids"] == ["a", "b"]
    assert visits[0]["planned_date"] == "2026-09-20"
    assert visits[1]["service_ids"] == ["c"]


def test_fifteen_day_grouping_cannot_expand_nonoverlapping_windows():
    items = [window("a", "2026-09-19", "2026-09-20"),
             window("b", "2026-09-21", "2026-09-25")]
    visits = group_visits(items, TODAY, grouping_window_days=15)
    assert len(visits) == 2
    assert visits[0]["planned_date"] == "2026-09-20"


def test_engine_defaults_to_mexico_city_clock(policy, monkeypatch):
    monkeypatch.setattr("app.engine.local_today", lambda: TODAY)
    assert estimate_usage(readings(), policy) == estimate_usage(readings(), policy, TODAY)


def test_day_override_needs_evidence_before_condition_rule_is_enabled(vehicle, policy):
    service = rule(intervalo_km=None, intervalo_meses=None)
    policy["service_overrides"]["oil"] = {"interval_days": 60}
    assert plan(vehicle, policy, services=[service])["services"][0]["status"] == "pending_validation"
    policy["service_overrides"]["oil"].update(validated=True, validated_by="Agencia de prueba",
        validated_on="2026-09-01", evidence_url="https://example.test/validation")
    assert plan(vehicle, policy, services=[service])["services"][0]["due_date"] == "2026-09-30"


@pytest.mark.parametrize("section,key,value", [
    ("planning", "grouping_window_days", -1),
    ("planning", "grouping_window_days", 1.5),
    ("planning", "default_severity_multiplier", 0),
    ("planning", "default_severity_multiplier", 1.01),
])
def test_new_policy_fields_validated_at_startup_and_evaluation(vehicle, policy, section, key, value):
    from app.settings import validate_policy
    policy[section][key] = value
    with pytest.raises(ValueError, match="Política"):
        validate_policy(policy, {"oil"})
    with pytest.raises(ValueError, match="Política"):
        plan(vehicle, policy)


@pytest.mark.parametrize("value", [0, 1023, 1048577, 2048.5, True, float("nan")])
def test_request_size_policy_rejects_invalid_bounds(policy, value):
    from app.settings import validate_policy
    policy["api"]["max_request_bytes"] = value
    with pytest.raises(ValueError, match="api.max_request_bytes"):
        validate_policy(policy, {"oil"})


@pytest.mark.parametrize("value", [1024, 262144, 1048576])
def test_request_size_policy_accepts_inclusive_bounds(policy, value):
    from app.settings import validate_policy
    policy["api"]["max_request_bytes"] = value
    assert validate_policy(policy, {"oil"}) is policy
