"""Opt-in local capacity probe; never reads or writes the configured demo DB.

Run: YOKOHAMA_RUN_LOAD_TESTS=1 python -m pytest tests/test_capacity.py -q -s
The printed measurement describes this workload/machine, not a production SLA.
"""
from bisect import bisect_right
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import json
import math
import os
from statistics import median
from time import perf_counter

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import func, select

from app.database import make_database
from app.main import ROOT, create_app, read_json
from app.models import Alert, Notification, OdometerReading, Vehicle
from app.seed import seed_database
from app.time_utils import local_today


@pytest.mark.skipif(os.getenv("YOKOHAMA_RUN_LOAD_TESTS") != "1", reason="Explicit isolated capacity probe only")
def test_isolated_fleet_concurrent_reads_and_recalculation(tmp_path):
    started = perf_counter()
    db_url = f"sqlite:///{(tmp_path / 'capacity-only.db').as_posix()}"
    seeded = seed_database(db_url, count=100, today=local_today())
    assert seeded["created"] == 100
    engine, sessions = make_database(db_url)
    # Fill intermediate days with piecewise interpolation of the synthetic
    # odometers, preserving every original seed reading and its chronology.
    with sessions.begin() as session:
        ids = list(session.scalars(select(Vehicle.id).order_by(Vehicle.id)))
        for vehicle_id in ids:
            original = list(session.scalars(select(OdometerReading).where(
                OdometerReading.vehicle_id == vehicle_id).order_by(OdometerReading.date)))
            if len(original) < 2:
                continue
            dates = [reading.date for reading in original]
            existing = set(dates)
            added = 0
            for offset in range(1, (dates[-1] - dates[0]).days):
                day = dates[0] + timedelta(days=offset)
                if day in existing:
                    continue
                right = bisect_right(dates, day)
                before, after = original[right - 1], original[right]
                fraction = (day - before.date).days / (after.date - before.date).days
                km = round(before.odometer_km + fraction * (after.odometer_km - before.odometer_km), 3)
                session.add(OdometerReading(vehicle_id=vehicle_id, date=day, odometer_km=km))
                added += 1
                if added == 100:
                    break
    with sessions() as session:
        reading_count = session.scalar(select(func.count(OdometerReading.id)))
        original_km_sum = session.scalar(select(func.sum(OdometerReading.odometer_km)))
    assert reading_count >= 12_000
    engine.dispose()

    policy = read_json(ROOT / "config/policy.json")
    policy["api"] = {**policy.get("api", {}), "refresh_seconds": 0}
    policy_path = tmp_path / "capacity-policy.json"
    policy_path.write_text(json.dumps(policy), encoding="utf-8")
    application = create_app(database_url=db_url, api_key="capacity-test-only", policy_path=policy_path)
    with TestClient(application) as client:
        client.headers.update({"X-API-Key": "capacity-test-only"})
        # Warm the updated snapshots before timing the mixed repeated workload.
        warm = client.post("/api/recalculate")
        assert warm.status_code == 200, warm.text[:300]
        assert warm.json()["vehicles_processed"] == 100
        work = [("GET", "/api/vehicles"), ("GET", "/api/alerts"),
                ("GET", f"/api/vehicles/{ids[0]}/plan"), ("POST", "/api/recalculate")] * 4

        def request(item):
            method, path = item
            began = perf_counter()
            response = client.request(method, path)
            elapsed = perf_counter() - began
            assert response.status_code == 200, (method, path, response.status_code, response.text[:300])
            if path == "/api/vehicles":
                assert len(response.json()) == 100
            return {"route": path, "seconds": elapsed}

        concurrent_started = perf_counter()
        with ThreadPoolExecutor(max_workers=16) as executor:
            results = list(executor.map(request, work))
        concurrent_elapsed = perf_counter() - concurrent_started
        with application.state.sessions() as session:
            assert session.scalar(select(func.count(Vehicle.id))) == 100
            assert session.scalar(select(func.count(OdometerReading.id))) == reading_count
            assert session.scalar(select(func.sum(OdometerReading.odometer_km))) == pytest.approx(original_km_sum)
            assert session.scalar(select(func.count(Alert.id))) == session.scalar(select(func.count(func.distinct(Alert.key))))
            assert session.scalar(select(func.count(Notification.id))) == session.scalar(select(func.count(func.distinct(Notification.dedup_key))))
            alert_count = session.scalar(select(func.count(Alert.id)))
            notification_count = session.scalar(select(func.count(Notification.id)))
            assert session.connection().exec_driver_sql("PRAGMA foreign_key_check").all() == []
            assert session.connection().exec_driver_sql("PRAGMA quick_check").scalar_one() == "ok"
    samples = sorted(result["seconds"] for result in results)
    report = {
        "workload": "SQLite isolated synthetic fleet; mixed concurrent HTTP test client",
        "vehicles": 100, "readings": reading_count, "concurrency": 16, "requests": len(samples),
        "failures": 0, "alerts": alert_count, "notifications": notification_count,
        "latency_seconds": {"p50": round(median(samples), 3),
                            "p95": round(samples[math.ceil(len(samples) * .95) - 1], 3),
                            "max": round(max(samples), 3)},
        "concurrent_wall_seconds": round(concurrent_elapsed, 3),
        "total_seconds": round(perf_counter() - started, 3),
    }
    print("\nCAPACITY_RESULT " + json.dumps(report, ensure_ascii=False))
