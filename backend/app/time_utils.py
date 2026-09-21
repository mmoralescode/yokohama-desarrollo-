"""Business dates in Mexico City; persisted instants and audit clocks in UTC."""
from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

TIMEZONE = "America/Mexico_City"
MEXICO_CITY = ZoneInfo(TIMEZONE)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def local_today() -> date:
    return utc_now().astimezone(MEXICO_CITY).date()


def to_utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("La fecha/hora debe incluir zona horaria u offset.")
    return value.astimezone(timezone.utc)


def as_utc(value: datetime) -> datetime:
    """SQLite returns naive values: our storage convention is strictly UTC."""
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else to_utc(value)


def date_timestamp(value: date) -> datetime:
    """Compatibility only: date-only input has no measured time of day."""
    return datetime.combine(value, time.min, MEXICO_CITY).astimezone(timezone.utc)
