"""Contratos de entrada; fechas locales, km finitos y triage explícito."""
from datetime import date, datetime
from datetime import date as CalendarDate
import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from .time_utils import MEXICO_CITY, local_today, to_utc, utc_now, date_timestamp

Km = Annotated[float, Field(ge=0, le=2_000_000, allow_inf_nan=False, strict=True)]


class InputModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class VehicleCreate(InputModel):
    vin: str = Field(min_length=17, max_length=17)
    plate: str = Field(min_length=3, max_length=16)
    model_year: int = Field(ge=2021, le=2026)
    variant_id: str = Field(min_length=1, max_length=80)
    transmission: Literal["AT6", "MT6"]
    current_km: Km
    in_service_date: date
    usage_regime: Literal["normal", "severe"] = "normal"
    is_synthetic: bool = False
    severity_multiplier: float | None = Field(default=None, ge=0.1, le=1, allow_inf_nan=False)

    @field_validator("vin")
    @classmethod
    def valid_vin(cls, value: str) -> str:
        value = value.upper()
        if not re.fullmatch(r"[A-HJ-NPR-Z0-9]{17}", value):
            raise ValueError("VIN: 17 caracteres, sin I, O ni Q; confirmar autenticidad con agencia")
        return value

    @field_validator("plate")
    @classmethod
    def valid_plate(cls, value: str) -> str:
        value = value.upper().replace(" ", "")
        if not re.fullmatch(r"[A-Z0-9-]{3,16}", value):
            raise ValueError("Placas: use letras, números y guiones")
        return value

    @field_validator("in_service_date")
    @classmethod
    def no_future(cls, value: date) -> date:
        if value > local_today():
            raise ValueError("La puesta en servicio no puede ser futura")
        return value


class ReadingCreate(InputModel):
    date: CalendarDate | None = None
    recorded_at: datetime | None = None
    source: Literal["manual", "gps", "obd"] = "manual"
    odometer_km: Km

    @model_validator(mode="after")
    def timestamp(self):
        if self.recorded_at is None and self.date is None:
            raise ValueError("Indique recorded_at (fecha/hora con zona) o una fecha histórica.")
        if self.recorded_at is not None:
            self.recorded_at = to_utc(self.recorded_at)
            day = self.recorded_at.astimezone(MEXICO_CITY).date()
            if self.date is not None and self.date != day:
                raise ValueError("La fecha no corresponde a la hora de Ciudad de México.")
            if self.recorded_at > utc_now():
                raise ValueError("No se aceptan lecturas futuras.")
            self.date = day
        elif self.date > local_today():
            raise ValueError("No se aceptan lecturas futuras.")
        return self

    def storage_values(self) -> dict:
        return {"date": self.date, "recorded_at": self.recorded_at or date_timestamp(self.date),
                "time_precision": "timestamp" if self.recorded_at else "date",
                "source": self.source, "odometer_km": self.odometer_km}


class VehiclePolicyUpdate(InputModel):
    severity_multiplier: float | None = Field(default=None, ge=0.1, le=1, allow_inf_nan=False)
    usage_regime: Literal["normal", "severe"] | None = None

    @model_validator(mode="after")
    def nonempty(self):
        if self.severity_multiplier is None and self.usage_regime is None:
            raise ValueError("Indique factor de severidad o régimen de uso.")
        return self


class ServiceCreate(InputModel):
    service_id: str = Field(min_length=1, max_length=80)
    performed_on: date
    odometer_km: Km
    notes: str = Field(default="", max_length=2000)
    cost: float | None = Field(default=None, ge=0, le=100_000_000, allow_inf_nan=False, strict=True)
    maintenance_type: Literal["preventive", "corrective", "unknown"] = "unknown"
    fault_id: int | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def consistent_kind(self):
        if self.fault_id is not None and self.maintenance_type != "corrective":
            raise ValueError("Un servicio vinculado a una falla debe clasificarse como correctivo.")
        return self


class ReadingBatch(InputModel):
    readings: list[ReadingCreate] = Field(min_length=1, max_length=500)


class FaultCreate(InputModel):
    description: str = Field(min_length=8, max_length=3000)
    dtc: str | None = Field(default=None, max_length=12)
    severity: Literal["critico", "importante", "menor"]
    safe_to_defer: bool = False
    deadline: date | None = None
    assessment_notes: str = Field(default="", max_length=2000)
    service_id: str | None = Field(default=None, min_length=1, max_length=80)
    was_predicted: bool | None = None

    @field_validator("dtc")
    @classmethod
    def valid_dtc(cls, value: str | None) -> str | None:
        if not value:
            return None
        value = value.upper()
        if not re.fullmatch(r"[PCBU][0-3][0-9A-F]{3}(?::[0-9A-F]{2})?", value):
            raise ValueError("Código DTC no válido; ejemplo P0126 o P0126:00")
        return value

    @model_validator(mode="after")
    def triage(self):
        today = local_today()
        if self.severity == "critico" and (self.safe_to_defer or (self.deadline and self.deadline > today)):
            raise ValueError("Una falla crítica no puede diferirse; requiere atención inmediata")
        if self.safe_to_defer:
            if self.deadline is None or self.deadline < today or len(self.assessment_notes) < 12:
                raise ValueError("Para diferir indique fecha límite vigente y evaluación técnica (mínimo 12 caracteres)")
        elif self.deadline and self.deadline > today:
            raise ValueError("Sin evaluación de diferimiento no se admite una fecha límite futura")
        return self


class FaultResolve(InputModel):
    resolution_notes: str = Field(min_length=8, max_length=2000)


class DowntimeCreate(InputModel):
    started_at: datetime
    ended_at: datetime | None = None
    notes: str = Field(default="", max_length=2000)

    @field_validator("started_at", "ended_at")
    @classmethod
    def valid_instant(cls, value):
        if value is not None:
            value = to_utc(value)
            if value > utc_now():
                raise ValueError("El tiempo fuera de servicio registra hechos, no fechas futuras.")
        return value

    @model_validator(mode="after")
    def ordered(self):
        if self.ended_at is not None and self.ended_at <= self.started_at:
            raise ValueError("El fin debe ser posterior al inicio.")
        return self


class DowntimeClose(InputModel):
    ended_at: datetime
    notes: str | None = Field(default=None, max_length=2000)

    @field_validator("ended_at")
    @classmethod
    def valid_end(cls, value):
        return DowntimeCreate.valid_instant(value)
