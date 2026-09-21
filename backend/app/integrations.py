"""Extension contracts only. No GPS/OBD connection or ML is enabled."""
from typing import Iterable, Protocol
from .schemas import ReadingCreate, FaultCreate


class TelemetryAdapter(Protocol):
    def readings(self, vehicle_external_id: str) -> Iterable[ReadingCreate]: ...
    def diagnostic_reports(self, vehicle_external_id: str) -> Iterable[FaultCreate]: ...


class FailurePredictor(Protocol):
    """Future calibrated model; must supply version/evidence, never override triage."""
    model_version: str
    def predict(self, vehicle: dict, observations: list[dict]) -> list[dict]: ...
