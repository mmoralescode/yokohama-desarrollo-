"""Rechaza políticas mal formadas al arrancar, no durante una predicción."""
import math
from datetime import date

from .time_utils import local_today


def validate_policy(policy: dict, service_ids: set[str]) -> dict:
    if policy.get("mode") not in {"demo", "operational"} or not isinstance(policy.get("policy_version"), str):
        raise ValueError("Política: mode/policy_version no válidos")

    def number(value, name, *, minimum=0, integer=False, maximum=1_000_000):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError(f"Política: {name} debe ser finito y numérico")
        if value < minimum or value > maximum or (integer and int(value) != value):
            raise ValueError(f"Política: {name} fuera del rango permitido")

    alerts = policy.get("alert_days")
    if not isinstance(alerts, list) or not alerts or len(alerts) != len(set(alerts)):
        raise ValueError("Política: alert_days debe contener umbrales únicos")
    for value in alerts:
        number(value, "alert_days", integer=True, maximum=3650)
    usage = policy.get("usage", {})
    for name in ("default_km_per_day", "half_life_days", "max_daily_km", "robust_mad_multiplier", "min_residual_km", "rate_spread_floor_fraction", "max_interval_weight_days"):
        number(usage.get(name), f"usage.{name}", minimum=.000001)
    for name in ("min_intervals", "high_confidence_intervals", "window_days", "stale_after_days"):
        number(usage.get(name), f"usage.{name}", integer=True, minimum=1)
    for name in ("relative_uncertainty", "fallback_relative_uncertainty"):
        number(usage.get(name), f"usage.{name}", maximum=.99)
    if usage["default_km_per_day"] > usage["max_daily_km"]:
        raise ValueError("Política: uso por defecto superior al máximo diario")
    planning = policy.get("planning", {})
    for name in ("default_advance_days", "demo_advance_days", "workshop_buffer_days", "max_projection_days"):
        number(planning.get(name), f"planning.{name}", integer=True, maximum=36500)
    number(planning.get("grouping_window_days", 15), "planning.grouping_window_days", integer=True, maximum=3650)
    number(planning.get("default_severity_multiplier", 1), "planning.default_severity_multiplier", minimum=.1, maximum=1)
    if not isinstance(planning.get("allow_initial_anchor"), bool):
        raise ValueError("Política: allow_initial_anchor debe ser booleano")
    number(policy.get("api", {}).get("refresh_seconds", 300), "api.refresh_seconds", maximum=86400)
    number(policy.get("api", {}).get("max_request_bytes", 262144), "api.max_request_bytes",
           minimum=1024, maximum=1048576, integer=True)
    overrides = policy.get("service_overrides", {})
    if not isinstance(overrides, dict) or set(overrides) - service_ids:
        raise ValueError("Política: override de servicio desconocido")
    for service_id, override in overrides.items():
        for name in ("advance_days", "tolerance_days", "tolerance_km", "duration_hours", "workshop_buffer_days"):
            if override.get(name) is not None:
                number(override[name], f"{service_id}.{name}", integer=name.endswith("days"))
        for name in ("interval_km", "interval_months", "interval_days"):
            if override.get(name) is not None:
                number(override[name], f"{service_id}.{name}", minimum=1,
                       integer=name in {"interval_months", "interval_days"})
        if override.get("validated") is True:
            if not override.get("validated_by") or not str(override.get("evidence_url", "")).startswith("https://"):
                raise ValueError("Política: validación sin responsable o evidencia HTTPS")
            try:
                validated_on = date.fromisoformat(override["validated_on"])
            except (KeyError, ValueError, TypeError) as error:
                raise ValueError("Política: fecha de validación obligatoria") from error
            if validated_on > local_today():
                raise ValueError("Política: fecha de validación futura")
    return policy
