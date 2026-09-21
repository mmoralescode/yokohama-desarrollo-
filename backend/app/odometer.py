"""Pure chronology validation, shared by individual and atomic batch ingestion."""
from datetime import date, datetime
from .time_utils import as_utc


class OdometerConflict(ValueError):
    def __init__(self, message: str, duplicate: bool = False):
        super().__init__(message)
        self.duplicate = duplicate


def validate_reading(*, when: date, km: float, points: list[dict], in_service_date: date,
                     today: date, current_km: float, max_daily_km: float,
                     recorded_at: datetime | None = None, reading: bool = True) -> None:
    if when > today or when < in_service_date:
        raise OdometerConflict("La fecha debe estar entre la puesta en servicio y hoy.")
    for point in points:
        day, value = point["date"], point["km"]
        stamp = point.get("recorded_at")
        precise = recorded_at is not None and stamp is not None
        if reading and point.get("is_reading"):
            if recorded_at is None and day == when:
                raise OdometerConflict("Ya existe una lectura de odómetro para esa fecha; use fecha y hora para otra lectura.", True)
            if recorded_at is not None and stamp is not None and as_utc(stamp) == as_utc(recorded_at):
                raise OdometerConflict("Ya existe una lectura para esa fecha y hora.", True)
        delta = ((as_utc(recorded_at) - as_utc(stamp)).total_seconds() / 86400) if precise else (when - day).days
        # Day-only history has unknown time, not a falsely precise measurement.
        if delta == 0 and km != value and recorded_at is None and point.get("time_precision", "date") == "date":
            raise OdometerConflict("Los registros históricos del mismo día deben compartir odómetro; indique hora para lecturas nuevas.")
        if (delta > 0 and km < value) or (delta < 0 and km > value):
            raise OdometerConflict("El kilometraje disminuye o contradice el historial de la unidad.")
        if abs(km - value) > max_daily_km * max(1, abs(delta)):
            raise OdometerConflict("Lectura atípica: supera el máximo diario configurado; confirme el odómetro.")
    if km > current_km and when < today:
        raise OdometerConflict("El kilometraje histórico supera el kilometraje actual registrado.")
