"""Puertos de notificación; este MVP NO envía correos ni WhatsApp reales."""
from typing import Protocol


class NotificationChannel(Protocol):
    def deliver(self, payload: dict) -> dict: ...


class SimulatedChannel:
    def __init__(self, channel: str):
        self.channel = channel

    def deliver(self, payload: dict) -> dict:
        return {"channel": self.channel, "status": "simulated", "sent": False,
                "message": "Simulación local. No se contactó a ningún destinatario.", "alert": payload}
