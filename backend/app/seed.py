"""Datos ficticios reproducibles. Uso explícito: python -m app.seed --seed 2026.

Nunca borra unidades ni modifica las ya presentes. El VIN DEM... no identifica
un vehículo real; is_synthetic y las notas conservan esa distinción.
"""
import argparse
from datetime import date, timedelta
import json
import os
from pathlib import Path
import random

from sqlalchemy import select

from .database import make_database, migrate
from .engine import matches_service
from .models import FaultReport, OdometerReading, ServiceCatalog, ServiceHistory, Vehicle
from .planner import evaluate
from .time_utils import local_today

ROOT = Path(__file__).resolve().parents[2]


def seed_database(database_url: str, *, seed: int = 2026, count: int = 20, today: date | None = None) -> dict:
    if not 1 <= count <= 200:
        raise ValueError("La demostración acepta entre 1 y 200 unidades")
    today = today or local_today()
    catalog = json.loads((ROOT / "catalogos/mazda3-mx.v0.1.0.json").read_text(encoding="utf-8"))
    variants = json.loads((ROOT / "catalogos/variantes-mx.v0.1.0.json").read_text(encoding="utf-8"))["variantes"]
    policy = json.loads((ROOT / "config/policy.json").read_text(encoding="utf-8"))
    engine, sessions = make_database(database_url)
    migrate(engine)
    created = skipped = 0
    try:
        with sessions.begin() as session:
            for service in catalog["servicios"]:
                if session.get(ServiceCatalog, service["id"]) is None:
                    session.add(ServiceCatalog(id=service["id"], catalog_version=catalog["version_catalogo"], source_snapshot=service))
            session.flush()
            for index in range(count):
                # Stable across repeated runs and --seed variations: no accidental
                # second fleet merely by changing pseudo-random variability.
                vin = f"DEM{index + 1:014d}"
                plate = f"DEMO-{index + 1:03d}"
                if session.scalar(select(Vehicle.id).where((Vehicle.vin == vin) | (Vehicle.plate == plate))) is not None:
                    skipped += 1
                    continue
                rng = random.Random(seed + index)
                year = 2021 + index % 6
                available = [variant for variant in variants if variant["anio_modelo"] == year]
                variant = available[(index // 6) % len(available)]
                # Ensure engine diversity including the documented MHEV.
                if index == 9:
                    variant = next(variant for variant in variants if variant["motor"] == "G20MHEV")
                    year = variant["anio_modelo"]
                if index == 10:
                    variant = next(variant for variant in available if variant["motor"] == "G25T")
                commissioned = min(date(year, 1, 15), today - timedelta(days=210))
                start = max(commissioned, today - timedelta(days=180))
                rate = 38 + index * 5
                base = max(0, (start - commissioned).days * rate * .65)
                odo_by_date = {start: round(base, 1)}
                stamp = start
                running_km = base
                while stamp < today:
                    stamp += timedelta(days=1)
                    day_factor = .3 if stamp.weekday() == 6 else 1.0
                    running_km += rate * day_factor * rng.uniform(.65, 1.35)
                    odo_by_date[stamp] = round(running_km, 1)
                vehicle = Vehicle(vin=vin, plate=plate, model_year=year, variant_id=variant["id"], version=variant["version"],
                                  body_style=variant["carroceria"], engine=variant["motor"], transmission=variant["transmisiones"][-1],
                                  drive=variant["traccion"], current_km=odo_by_date[today], in_service_date=commissioned,
                                  usage_regime="severe" if index % 5 == 0 else "normal", is_synthetic=True)
                session.add(vehicle)
                session.flush()
                dates = sorted(odo_by_date)
                reading_dates = [stamp for offset, stamp in enumerate(dates) if offset % 7 == 0 and rng.random() > .18]
                reading_dates = sorted(set(reading_dates + [today]))
                if index == 3:
                    reading_dates = [today]  # Deliberate low-information unit.
                for stamp in reading_dates:
                    session.add(OdometerReading(vehicle_id=vehicle.id, date=stamp, odometer_km=odo_by_date[stamp]))
                if index != 3:
                    vehicle_dict = {"model_year": year, "body_style": vehicle.body_style, "engine": vehicle.engine,
                                    "transmission": vehicle.transmission, "drive": vehicle.drive, "usage_regime": vehicle.usage_regime}
                    service_age = [170, 150, 120, 100, 75, 40, 15][index % 7]
                    common_date = max(start, today - timedelta(days=service_age))
                    for service in catalog["servicios"]:
                        if not matches_service(vehicle_dict, service):
                            continue
                        if service["id"] in {"refrigerante_inicial", "refrigerante_sucesivo", "bujias_no_turbo", "bujias_turbo", "filtro_combustible"}:
                            continue  # Never pretend an initial replacement was performed.
                        if service.get("intervalo_km") is None and service.get("intervalo_meses") is None:
                            continue
                        stamp = max(start, today - timedelta(days=20 + index % 15)) if service["id"] == "llantas_presion" else common_date
                        session.add(ServiceHistory(vehicle_id=vehicle.id, service_id=service["id"], performed_on=stamp,
                                                   odometer_km=odo_by_date[stamp], notes="Servicio realizado FICTICIO para demostrar el sistema; no es evidencia mecánica real.",
                                                   catalog_snapshot=service))
                if index == 0:
                    session.add(FaultReport(vehicle_id=vehicle.id, reported_on=today, description="DEMO: pérdida de frenado reportada; operación detenida en lugar seguro.",
                                            severity="critico", safe_to_defer=False, deadline=today))
                if index == 1:
                    session.add(FaultReport(vehicle_id=vehicle.id, reported_on=today, description="DEMO: bisagra de puerta con ruido leve; cierre funciona normalmente.",
                                            severity="menor", safe_to_defer=True, deadline=today + timedelta(days=12),
                                            assessment_notes="Evaluación TÉCNICA FICTICIA: sin afectación al cierre. Diferimiento de prueba, no autorización real."))
                if index == 2:
                    session.add(FaultReport(vehicle_id=vehicle.id, reported_on=today, description="DEMO: DTC reportado, pendiente de diagnóstico; no se presume causa ni plazo seguro.",
                                            dtc="P0126", severity="importante", safe_to_defer=False))
                session.flush()
                evaluate(session, vehicle, catalog, policy)
                created += 1
    finally:
        engine.dispose()
    return {"created": created, "skipped": skipped, "synthetic": True, "seed": seed}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=int, default=2026)
    parser.add_argument("--count", type=int, default=20)
    parser.add_argument("--database-url", default=os.getenv("YOKOHAMA_DATABASE_URL") or f"sqlite:///{(ROOT / 'backend/data/yokohama.db').as_posix()}")
    args = parser.parse_args()
    print(json.dumps(seed_database(args.database_url, seed=args.seed, count=args.count), ensure_ascii=False))


if __name__ == "__main__":
    main()
