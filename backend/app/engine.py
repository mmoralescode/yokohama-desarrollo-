"""Pure, deterministic planning rules. No database, network or hidden clock state.

``estimate_usage(readings, config, today=None)`` returns a robust weighted daily
rate and scenario bounds (not calibrated probability/coverage intervals).
``group_visits(services, today=None, vehicle_id=None, provisional=True)`` groups
closed date windows by their GLOBAL intersection, placing visits at its end.
``build_plan(...)`` implements the public contract in docs/contrato-mvp.md.

A future calibrated ML estimator may implement UsagePredictor. Its output still
passes through the same service eligibility, date and safety constraints.
"""

from __future__ import annotations

import calendar
import hashlib
import math
import unicodedata
from collections import defaultdict
from datetime import date, datetime, timedelta
from statistics import median
from typing import Any, Protocol


class UsagePredictor(Protocol):
    def estimate(self, readings: list[dict], config: dict, today: date) -> dict: ...


def _date(value: Any) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def _number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        result = float(value)
        return result if math.isfinite(result) and result >= 0 else None
    except (ValueError, TypeError):
        return None


def _iso(value: date | None) -> str | None:
    return value.isoformat() if value is not None else None


def add_months(value: date, months: int) -> date:
    """Calendar arithmetic, clamping Jan 31 + 1 month to February's last day."""
    year, month0 = divmod(value.year * 12 + value.month - 1 + months, 12)
    month = month0 + 1
    return date(year, month, min(value.day, calendar.monthrange(year, month)[1]))


def _weighted_mean(items: list[tuple[float, float]]) -> float:
    weight = sum(w for _, w in items)
    return sum(v * w for v, w in items) / weight if weight else 0.0


def validate_policy(config: dict) -> None:
    """Reject unsafe/malformed configuration before evaluating a fleet.

    Metadata does not substitute for human technical review; this checks shape
    and numeric bounds, not whether an agency truly approved a document.
    """
    if config.get("mode") not in {"demo", "operational"}:
        raise ValueError("El modo debe ser demo u operational.")
    usage = config.get("usage", {})
    positive = ["window_days", "half_life_days", "max_daily_km", "min_intervals",
                "high_confidence_intervals", "robust_mad_multiplier", "max_interval_weight_days"]
    nonnegative = ["default_km_per_day", "stale_after_days", "min_residual_km"]
    fractions = ["relative_uncertainty", "fallback_relative_uncertainty", "rate_spread_floor_fraction", "conservative_rate_quantile"]
    for key in positive + nonnegative + fractions:
        value = _number(usage.get(key))
        if value is None or (key in positive and value <= 0) or (key in fractions and value > 1):
            raise ValueError(f"Política usage.{key} inválida.")
    if usage["default_km_per_day"] > usage["max_daily_km"]:
        raise ValueError("El uso de respaldo no puede superar el máximo diario.")
    if usage["high_confidence_intervals"] < usage["min_intervals"]:
        raise ValueError("La confianza alta requiere al menos los intervalos mínimos.")
    planning = config.get("planning", {})
    for key in ["default_advance_days", "demo_advance_days", "max_projection_days", "workshop_buffer_days"]:
        value = _number(planning.get(key))
        if value is None or int(value) != value or (key == "max_projection_days" and value == 0):
            raise ValueError(f"Política planning.{key} inválida.")
    alert_days = config.get("alert_days")
    if not isinstance(alert_days, list) or any(_number(value) is None or int(value) != value for value in alert_days):
        raise ValueError("alert_days debe ser una lista de días enteros no negativos.")
    for service_id, override in config.get("service_overrides", {}).items():
        for key in ["tolerance_days", "tolerance_km", "duration_hours", "advance_days", "workshop_buffer_days", "interval_km", "interval_months"]:
            if key not in override or override[key] is None:
                continue
            value = _number(override[key])
            if value is None or (key in {"interval_km", "interval_months"} and value == 0):
                raise ValueError(f"Política {service_id}.{key} inválida.")
            if key in {"advance_days", "workshop_buffer_days", "interval_months"} and int(value) != value:
                raise ValueError(f"Política {service_id}.{key} requiere entero.")


def _clean_readings(readings: list[dict], cfg: dict, today: date) -> tuple[list, int]:
    """Reject malformed/duplicate, robust residual, decreasing/impossible readings.

    Theil-Sen-style median pairwise slopes tolerate isolated odometer spikes.
    The service projection also uses this cleaned sequence, not a rejected spike.
    """
    rejected = 0
    grouped: dict[date, list[float]] = defaultdict(list)
    for reading in readings:
        try:
            stamp = _date(reading.get("date"))
        except (TypeError, ValueError):
            rejected += 1
            continue
        value = _number(reading.get("odometer_km"))
        if value is None or stamp > today:
            rejected += 1
            continue
        grouped[stamp].append(value)
    ordered = []
    for stamp, values in sorted(grouped.items()):
        if len(set(values)) > 1:
            rejected += len(values)  # Conflicting same-day records: choose neither.
        else:
            ordered.append((stamp, values[0]))
            rejected += len(values) - 1
    cutoff = today - timedelta(days=int(cfg["window_days"]))
    recent = [item for item in ordered if item[0] >= cutoff]
    before = [item for item in ordered if item[0] < cutoff]
    if before:
        recent.insert(0, before[-1])  # Retain a bounding observation across gaps.
    if len(recent) >= 4:
        origin = recent[0][0]
        slopes = [
            (b[1] - a[1]) / (b[0] - a[0]).days
            for i, a in enumerate(recent)
            for b in recent[i + 1:]
            if 0 <= (b[1] - a[1]) / (b[0] - a[0]).days <= cfg["max_daily_km"]
        ]
        if slopes:
            slope = median(slopes)
            intercept = median(km - slope * (stamp - origin).days for stamp, km in recent)
            residuals = [km - intercept - slope * (stamp - origin).days for stamp, km in recent]
            centre = median(residuals)
            mad = median(abs(r - centre) for r in residuals)
            bound = max(cfg["min_residual_km"], cfg["robust_mad_multiplier"] * 1.4826 * mad)
            outlying = [abs(residual - centre) > bound for residual in residuals]
            # A sustained new usage regime is not an isolated typo. Retain two
            # or more consecutive, physically plausible points off the old trend.
            keep = [not flag for flag in outlying]
            index = 0
            while index < len(recent):
                if not outlying[index]:
                    index += 1
                    continue
                stop = index + 1
                while stop < len(recent) and outlying[stop]:
                    stop += 1
                group = recent[index:stop]
                if len(group) >= 2 and all(0 <= (b[1] - a[1]) / (b[0] - a[0]).days <= cfg["max_daily_km"] for a, b in zip(group, group[1:])):
                    keep[index:stop] = [True] * len(group)
                index = stop
            kept = [point for point, retain in zip(recent, keep) if retain]
            rejected += len(recent) - len(kept)
            recent = kept
    clean = []
    for stamp, km in recent:
        if clean:
            days = (stamp - clean[-1][0]).days
            speed = (km - clean[-1][1]) / days
            if speed < 0 or speed > cfg["max_daily_km"]:
                rejected += 1
                continue
        clean.append((stamp, km))
    return clean, rejected


def estimate_usage(readings: list[dict], config: dict, today: date | None = None) -> dict:
    validate_policy(config)
    today = today or date.today()
    cfg = config["usage"]
    clean, rejected = _clean_readings(readings, cfg, today)
    intervals = []
    for a, b in zip(clean, clean[1:]):
        days = (b[0] - a[0]).days
        rate = (b[1] - a[1]) / days
        age = (today - b[0]).days
        weight = min(days, cfg["max_interval_weight_days"]) * math.exp(-math.log(2) * age / cfg["half_life_days"])
        intervals.append((rate, weight))
    fallback = len(intervals) < cfg["min_intervals"]
    stale = not clean or (today - clean[-1][0]).days > cfg["stale_after_days"]
    if fallback:
        rate = float(cfg["default_km_per_day"])
        spread = rate * cfg["fallback_relative_uncertainty"]
        # Sparse observed high use must not be hidden by the fallback average.
        high = max([rate + spread] + [r for r, _ in intervals])
        low = max(0.0, min([rate - spread] + [r for r, _ in intervals]))
        explanation = "Pocos datos: tasa de respaldo configurable; escenarios provisionales, confianza baja."
        confidence = "baja"
    else:
        centre = median(r for r, _ in intervals)
        mad = median(abs(r - centre) for r, _ in intervals)
        spread = max(centre * cfg["rate_spread_floor_fraction"], cfg["robust_mad_multiplier"] * 1.4826 * mad)
        clipped = [(min(centre + spread, max(0.0, centre - spread, r)), w) for r, w in intervals]
        rate = _weighted_mean(clipped)
        variation = math.sqrt(_weighted_mean([((r - rate) ** 2, w) for r, w in clipped]))
        uncertainty = cfg["fallback_relative_uncertainty"] if stale else cfg["relative_uncertainty"]
        width = max(rate * uncertainty, variation)
        rates = sorted(r for r, _ in intervals)
        upper_observed = rates[max(0, math.ceil(cfg["conservative_rate_quantile"] * len(rates)) - 1)]
        low, high = max(0.0, rate - width), min(cfg["max_daily_km"], max(rate + width, upper_observed))
        confidence = "alta" if len(intervals) >= cfg["high_confidence_intervals"] and not rejected and not stale else "media"
        if stale:
            confidence = "baja"
        explanation = "Promedio móvil ponderado de incrementos, depuración robusta de atípicos y escenarios de uso; no probabilidad de avería."
    if stale:
        explanation += " Lecturas antiguas o ausentes: actualizar odómetro antes de confirmar una visita."
    if rejected:
        explanation += f" Se descartaron {rejected} lecturas inconsistentes."
    return {
        "km_per_day": round(rate, 3), "low_km_per_day": round(low, 3),
        "high_km_per_day": round(high, 3), "confidence": confidence,
        "valid_intervals": len(intervals), "rejected_readings": rejected,
        "explanation": explanation,
    }


class RulesUsagePredictor:
    def estimate(self, readings: list[dict], config: dict, today: date) -> dict:
        return estimate_usage(readings, config, today)


def matches_service(vehicle: dict, service: dict) -> bool:
    """Structural applicability; history-dependent coolant phase is in build_plan."""
    applicability = service.get("aplicabilidad", {})
    checks = [
        (applicability.get("anios_modelo"), vehicle.get("model_year")),
        (applicability.get("carrocerias"), vehicle.get("body_style")),
        (applicability.get("motores"), vehicle.get("engine")),
        (service.get("motores_permitidos"), vehicle.get("engine")),
        (service.get("transmisiones_permitidas"), vehicle.get("transmission")),
        (service.get("tracciones_permitidas"), vehicle.get("drive")),
    ]
    if any(allowed is not None and value not in allowed for allowed, value in checks):
        return False
    regime = service.get("regimen")
    expected = "severo" if vehicle.get("usage_regime") in {"severe", "severo"} else "normal"
    return regime is None or regime == expected


def _validated(override: dict, today: date) -> bool:
    try:
        stamp = _date(override.get("validated_on"))
    except (ValueError, TypeError):
        return False
    return bool(override.get("validated") is True and override.get("validated_by") and override.get("evidence_url") and stamp <= today)


def _confidence(*values: str) -> str:
    return min(values, key=lambda value: {"baja": 0, "media": 1, "alta": 2}.get(value, 0))


def _project(anchor_date: date, remaining: float, rate: float, max_days: int) -> date | None:
    if remaining == 0:
        return anchor_date
    if rate <= 0:
        return anchor_date if remaining < 0 else None
    days = math.floor(remaining / rate)  # Never round the conservative entry date later.
    if abs(days) > max_days:
        return None
    try:
        return anchor_date + timedelta(days=days)
    except OverflowError:
        return None


def _first(*values: date | None) -> date | None:
    known = [value for value in values if value is not None]
    return min(known) if known else None


def _alert(vehicle_id: Any, kind: str, key: str, severity: str, message: str,
           deadline: date | None, today: date, service_id: str | None = None,
           fault_id: int | None = None, threshold: int | None = None) -> dict:
    return {
        "key": f"{vehicle_id}:{kind}:{key}", "vehicle_id": vehicle_id,
        "service_id": service_id, "fault_id": fault_id, "severity": severity,
        "message": message, "deadline": _iso(deadline),
        "days_remaining": (deadline - today).days if deadline else None,
        "threshold_days": threshold, "status": "open", "kind": kind,
    }


def group_visits(services: list[dict], today: date | None = None, vehicle_id: Any = None,
                 provisional: bool = True) -> list[dict]:
    """Minimum interval-stabbing visits; latest feasible point in common window.

    No transitive-overlap chaining. Overdue work keeps its historic deadline but
    needs evaluation today, isolated from future work. Critical work is isolated.
    Durations remain unknown if any member's duration is unknown. The result is
    a proposal, not a workshop-capacity or parts-availability reservation.
    """
    today = today or date.today()
    available, immediate, overdue_items = [], [], []
    for service in services:
        if service.get("status") == "pending_validation":
            continue
        if service.get("action") == "inspeccion_operador":
            continue  # Pressure check does not by itself immobilize a unit in a workshop.
        if not service.get("window_start") or not service.get("window_end"):
            continue
        start, end = _date(service["window_start"]), _date(service["window_end"])
        if service.get("severity") == "critico":
            immediate.append((service, end < today))
        elif end < today:
            overdue_items.append(service)
        elif start <= end:
            available.append((max(start, today), end, service))
    groups = [(today, [service], "overdue" if overdue else "immediate") for service, overdue in immediate]
    if overdue_items:
        groups.append((today, overdue_items, "overdue"))
    available.sort(key=lambda item: (item[1], item[0], str(item[2].get("service_id"))))
    while available:
        point = available[0][1]
        included = [item for item in available if item[0] <= point <= item[1]]
        groups.append((point, [item[2] for item in included], "proposed"))
        available = [item for item in available if not (item[0] <= point <= item[1])]
    visits = []
    for point, members, status in groups:
        service_ids = sorted(s["service_id"] for s in members if s.get("service_id"))
        fault_ids = sorted(s["fault_id"] for s in members if s.get("fault_id") is not None)
        identity = f"{vehicle_id}:{point.isoformat()}:{','.join(service_ids)}:{fault_ids}"
        durations = [member.get("duration_hours") for member in members]
        total = sum(durations) if all(value is not None for value in durations) else None
        explanation = "Último día de la intersección común de ventanas; confirmar taller, duración y disponibilidad."
        if status == "overdue":
            explanation = "Límites ya vencidos: una evaluación urgente hoy; se conservan vencimientos históricos. No es una ventana válida ni nueva prórroga."
        elif status == "immediate":
            explanation = "Atención inmediata aislada de visitas diferibles; si hay riesgo, detener operación segura y coordinar asistencia."
        visits.append({
            "id": hashlib.sha256(identity.encode()).hexdigest()[:20], "planned_date": point.isoformat(),
            "service_ids": service_ids, "fault_ids": fault_ids,
            "total_duration_hours": total, "status": status,
            "explanation": explanation, "provisional": provisional or any(s.get("requires_validation", False) for s in members),
        })
    return sorted(visits, key=lambda visit: (visit["planned_date"], visit["id"]))


def build_plan(vehicle: dict, readings: list[dict], history: list[dict], faults: list[dict],
               catalog: dict, config: dict, today: date | None = None) -> dict:
    """Evaluate source snapshots without mutating them or fabricating missing data."""
    today = today or date.today()
    mode = config.get("mode", "operational")
    if mode not in {"demo", "operational"}:
        raise ValueError("El modo debe ser demo u operational.")
    demo = mode == "demo"
    usage = RulesUsagePredictor().estimate(readings, config, today)
    clean, _ = _clean_readings(readings, config["usage"], today)
    current_km = _number(vehicle.get("current_km"))
    if current_km is None:
        raise ValueError("El kilometraje actual debe ser finito y no negativo.")
    observed_on, observed_km = clean[-1] if clean else (today, current_km)
    warnings = []
    if demo:
        warnings.append("DEMOSTRACIÓN: catálogo técnico aún pendiente de agencia. Fechas y ventanas son propuestas provisionales, no autorización de operación ni garantía de ausencia de riesgo.")
    valid_history = []
    for entry in history:
        try:
            stamp, km = _date(entry["performed_on"]), _number(entry.get("odometer_km"))
            if stamp <= today and km is not None and km <= current_km:
                valid_history.append((stamp, km, entry))
            else:
                warnings.append("Se omitió un servicio con fecha o kilometraje incoherente; revisar historial.")
        except (ValueError, TypeError, KeyError):
            warnings.append("Se omitió un registro de servicio inválido; revisar historial.")
    # A performed-service record contains a dated, validated odometer reading.
    # It can advance the projection origin without pretending that 30 service
    # lines on one invoice are 30 independent samples of daily usage.
    if valid_history:
        measured_on, measured_km, _ = max(valid_history, key=lambda item: (item[0], item[1]))
        if not clean or measured_on > observed_on or (measured_on == observed_on and measured_km > observed_km):
            observed_on, observed_km = measured_on, measured_km
    if observed_on < today:
        warnings.append("Las fechas dependen de lecturas ausentes o antiguas; el uso posterior es una estimación, no un odómetro registrado.")
    if current_km != observed_km:
        warnings.append("El odómetro actual difiere de la última medición fiable. Se usa la lectura depurada o medición del servicio; verificar datos antes de confirmar el plan.")
    coolant_ids = {"refrigerante_inicial", "refrigerante_sucesivo"}
    coolant_history = [item for item in valid_history if item[2].get("service_id") in coolant_ids]
    services, alerts, fault_windows = [], [], []
    planning = config["planning"]
    for service in catalog.get("servicios", []):
        if not matches_service(vehicle, service):
            continue
        service_id = service["id"]
        if service_id == "refrigerante_inicial" and coolant_history:
            continue
        if service_id == "refrigerante_sucesivo" and not coolant_history:
            continue
        override = config.get("service_overrides", {}).get(service_id, {})
        validated = _validated(override, today)
        if set(service.get("conflictos", [])) - set(override.get("resolved_conflicts", [])):
            validated = False
        enabled = service.get("habilitado_produccion") is True and not service.get("conflictos")
        allowed = demo or validated or enabled
        requires_validation = not (validated or enabled)
        result = {
            "service_id": service_id, "name": service["servicio"], "action": service.get("accion", "inspeccion"),
            "status": "pending_validation", "due_date": None, "latest_entry_date": None,
            "due_odometer": None, "km_remaining": None, "severity": service.get("severidad", "importante"),
            "confidence": "baja", "window_start": None, "window_end": None,
            "prediction": {"optimistic": None, "probable": None, "pessimistic": None},
            "explanation": "", "requires_validation": requires_validation,
            "source_urls": list(dict.fromkeys(source["url"] for source in service.get("fuente", []) if source.get("url"))),
            "duration_hours": override.get("duration_hours") if validated else service.get("duracion_estimada_taller_horas"),
        }
        if service.get("condicion_aplicabilidad"):
            equipment = vehicle.get("confirmed_equipment", {}).get(service_id)
            if equipment is False:
                continue
            if equipment is not True:
                result["explanation"] = "Equipamiento no confirmado por VIN: " + service["condicion_aplicabilidad"]
                result["requires_validation"] = True
                services.append(result)
                continue
        if not allowed:
            result["explanation"] = "Bloqueado para operación: regla o conflicto no validado técnicamente. Aprobación de desarrollo no habilita mantenimiento real."
            services.append(result)
            continue
        interval_km = _number(override.get("interval_km", service.get("intervalo_km"))) if validated else _number(service.get("intervalo_km"))
        months = override.get("interval_months", service.get("intervalo_meses")) if validated else service.get("intervalo_meses")
        if not interval_km and not months:
            result["explanation"] = "Por condición/VIN: requiere inspección o diagnóstico; no existe intervalo documentado que permita predecir una avería por km."
            services.append(result)
            continue
        equivalent_ids = {service_id}
        if service_id in {"aceite_normal", "aceite_severo"}:
            equivalent_ids = {"aceite_normal", "aceite_severo"}
        elif service_id == "refrigerante_sucesivo":
            equivalent_ids = coolant_ids
        candidates = [item for item in valid_history if item[2].get("service_id") in equivalent_ids]
        anchor = max(candidates, key=lambda item: (item[0], item[1])) if candidates else None
        # Only explicit component-original confirmation can justify an initial anchor.
        if anchor is None and planning.get("allow_initial_anchor") and vehicle.get("initial_components_confirmed") is True:
            initial_km = _number(vehicle.get("in_service_odometer_km"))
            try:
                initial_date = _date(vehicle.get("in_service_date"))
                if initial_km is not None and initial_date <= today:
                    anchor = (initial_date, initial_km, {})
            except (ValueError, TypeError):
                pass
        if anchor is None:
            result["explanation"] = "Falta historial de este componente. No se presume mantenimiento a km cero ni se reinicia por un servicio general. Registrar evidencia del último servicio/estado inicial."
            services.append(result)
            continue
        anchor_date, anchor_km, _ = anchor
        due_km = anchor_km + interval_km if interval_km else None
        time_due = add_months(anchor_date, int(months)) if months else None
        remaining = due_km - observed_km if due_km is not None else None
        max_days = int(planning["max_projection_days"])
        distances = [_project(observed_on, remaining, usage[key], max_days) if remaining is not None else None
                     for key in ("low_km_per_day", "km_per_day", "high_km_per_day")]
        # Backwards projections may predate a recent replacement when historical
        # average usage differs from the latest actual use. That prior cycle no
        # longer exists: no new-cycle due date may precede its performed service.
        distances = [max(anchor_date, value) if value is not None else None for value in distances]
        probable = _first(distances[1], time_due)
        if remaining is None or remaining >= 0:
            pessimistic = _first(distances[2], time_due)
            optimistic = _first(distances[0], time_due)
        else:
            pessimistic = _first(distances[0], time_due)
            optimistic = _first(distances[2], time_due)
        if probable is None:
            result["explanation"] = "Fecha no estimable con uso nulo o fuera del horizonte configurado; actualizar odómetro y revisar condición."
            services.append(result)
            continue
        tolerance_days = _number(override.get("tolerance_days")) if validated else None
        tolerance_km = _number(override.get("tolerance_km")) if validated else None
        tolerance_days = tolerance_days or 0
        tolerance_km = tolerance_km or 0
        limit_time = time_due + timedelta(days=tolerance_days) if time_due else None
        distance_limits = [_project(observed_on, remaining + tolerance_km, usage[key], max_days)
                           for key in ("low_km_per_day", "high_km_per_day")] if remaining is not None else []
        deadline = _first(limit_time, *distance_limits)
        if deadline is None:
            deadline = pessimistic
        buffer_days = int(override.get("workshop_buffer_days", planning["workshop_buffer_days"])) if validated else int(planning["workshop_buffer_days"])
        deadline -= timedelta(days=max(0, buffer_days))
        deadline = max(anchor_date, deadline)
        advance = override.get("advance_days", planning["default_advance_days"]) if validated else (planning["demo_advance_days"] if demo else planning["default_advance_days"])
        start = min(pessimistic or deadline, deadline) - timedelta(days=max(0, int(advance)))
        km_remaining = due_km - (observed_km + usage["km_per_day"] * (today - observed_on).days) if due_km is not None else None
        status = "overdue" if deadline < today else "due" if deadline == today else "upcoming"
        explanation = "Vence lo primero: kilómetros o meses calendario. Límite calculado con escenario de uso más exigente; no autoriza prórroga desconocida."
        if requires_validation:
            explanation += " Referencia provisional: confirmar intervalo, ventana de adelanto y límite con Mazda."
        if service.get("conflictos"):
            explanation += " Conflicto documental pendiente: " + ", ".join(service["conflictos"]) + "."
        if not validated or result["duration_hours"] is None:
            explanation += " Confirmar tiempo de diagnóstico, refacciones y terminación antes de reservar ingreso."
        result.update({
            "status": status, "due_date": _iso(probable), "latest_entry_date": _iso(deadline),
            "due_odometer": due_km, "km_remaining": round(km_remaining, 2) if km_remaining is not None else None,
            "confidence": _confidence(service.get("confianza", "baja"), usage["confidence"], "baja" if requires_validation else "alta"),
            "window_start": _iso(start), "window_end": _iso(deadline),
            "prediction": {"optimistic": _iso(optimistic), "probable": _iso(probable), "pessimistic": _iso(pessimistic)},
            "explanation": explanation,
        })
        services.append(result)
        days_remaining = (deadline - today).days
        thresholds = sorted(set(int(days) for days in config["alert_days"] if int(days) >= 0))
        crossed = [days for days in thresholds if days_remaining <= days]
        if crossed or days_remaining <= 0:
            threshold = min(crossed) if crossed else None
            text = f"{service['servicio']}: " + ("límite vencido; gestionar evaluación hoy." if days_remaining < 0 else f"límite de ingreso {deadline.isoformat()} ({days_remaining} días).")
            cycle_key = f"{service_id}:{anchor_date.isoformat()}:{anchor_km:g}"
            alerts.append(_alert(vehicle.get("id"), "maintenance", cycle_key, result["severity"], text,
                                 deadline, today, service_id=service_id, threshold=threshold))
    for fault in faults:
        if fault.get("status", "open") != "open":
            continue
        severity = fault.get("severity", "importante")
        if severity not in {"critico", "importante", "menor"}:
            severity = "importante"
        triage = config.get("triage", {})
        description = str(fault.get("description", ""))
        normalized = "".join(char for char in unicodedata.normalize("NFKD", description.lower()) if not unicodedata.combining(char))
        code = str(fault.get("dtc") or "").strip().upper().split(":")[0]
        symptom_match = any(phrase in normalized for phrase in triage.get("critical_symptom_phrases", []))
        dtc_critical = code and code in triage.get("critical_dtcs", [])
        if symptom_match or dtc_critical:
            severity = "critico"
        unknown_dtc = bool(code and code not in triage.get("deferrable_dtcs", []) and triage.get("unknown_dtc_requires_assessment", True))
        try:
            reported = _date(fault.get("reported_on", today))
            explicit_deadline = _date(fault["deadline"]) if fault.get("deadline") else None
        except (ValueError, TypeError):
            reported, explicit_deadline = today, None
        if reported > today:
            warnings.append("Reporte de falla con fecha futura: requiere corregir datos; no se autoriza diferir.")
            reported, explicit_deadline = today, None
        critical = severity == "critico"
        can_defer = not critical and not unknown_dtc and fault.get("safe_to_defer") is True and explicit_deadline is not None and explicit_deadline >= reported
        deadline = reported if critical or not can_defer else explicit_deadline
        message = "Falla reportada: " + fault.get("description", "Requiere diagnóstico") + ". "
        if critical:
            message += "CRÍTICA: detener operación en un lugar seguro y coordinar asistencia inmediata. No conducir al taller ni esperar a la visita agrupada."
        elif can_defer:
            message += f"Diferimiento evaluado explícitamente; atender como máximo {deadline.isoformat()}. Si cambia el síntoma, reevaluar de inmediato."
        else:
            message += "Requiere evaluación inmediata. Sin plazo técnico validado, no se declara seguro esperar."
            if unknown_dtc:
                message += " DTC sin regla técnica de diferimiento: el código no basta para diagnosticar ni autorizar circulación."
        alerts.append(_alert(vehicle.get("id"), "fault", str(fault.get("id")), severity, message,
                             deadline, today, fault_id=fault.get("id")))
        alerts[-1].update({
            "safe_to_defer": can_defer,
            "safety_evaluation": "critical" if critical else "deferral_evaluated" if can_defer else "needs_assessment",
        })
        fault_windows.append({
            "service_id": None, "fault_id": fault.get("id"), "severity": severity,
            "window_start": _iso(reported), "window_end": _iso(deadline),
            "duration_hours": None, "requires_validation": not can_defer and not critical,
            "status": "overdue" if deadline < today else "due" if deadline == today else "upcoming",
        })
    pending = [service for service in services if service["status"] == "pending_validation"]
    if pending:
        warnings.append(f"{len(pending)} operaciones requieren historial, inspección o validación técnica; no equivalen a unidades sin necesidades de mantenimiento.")
        alerts.append(_alert(vehicle.get("id"), "data", "pending-services", "menor",
                             f"{len(pending)} operaciones sin plan confirmable: completar historial/validación.", None, today))
    if usage["rejected_readings"] or not clean or (today - observed_on).days > config["usage"]["stale_after_days"]:
        alerts.append(_alert(vehicle.get("id"), "data", "odometer-quality", "importante", usage["explanation"], None, today))
    visits = group_visits(services + fault_windows, today, vehicle.get("id"), provisional=demo)
    urgent = any(alert["severity"] == "critico" or (alert["kind"] != "data" and alert["days_remaining"] is not None and alert["days_remaining"] <= 0) for alert in alerts)
    actionable = any(alert["kind"] != "data" for alert in alerts)
    traffic = "red" if urgent else "amber" if actionable else "gray" if pending or usage["confidence"] == "baja" else "green"
    return {
        "vehicle_id": vehicle.get("id"), "generated_on": today.isoformat(),
        "catalog_version": catalog.get("version_catalogo", "unknown"), "mode": mode,
        "usage": usage, "services": services, "visits": visits, "alerts": alerts,
        "traffic_light": traffic, "warnings": list(dict.fromkeys(warnings)),
    }
