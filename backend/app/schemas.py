"""Contratos de entrada; fechas locales, km finitos y triage explícito."""
from datetime import date
import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

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
        if value > date.today():
            raise ValueError("La puesta en servicio no puede ser futura")
        return value


class ReadingCreate(InputModel):
    date: date
    odometer_km: Km


class ServiceCreate(InputModel):
    service_id: str = Field(min_length=1, max_length=80)
    performed_on: date
    odometer_km: Km
    notes: str = Field(default="", max_length=2000)


class FaultCreate(InputModel):
    description: str = Field(min_length=8, max_length=3000)
    dtc: str | None = Field(default=None, max_length=12)
    severity: Literal["critico", "importante", "menor"]
    safe_to_defer: bool = False
    deadline: date | None = None
    assessment_notes: str = Field(default="", max_length=2000)

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
        today = date.today()
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
