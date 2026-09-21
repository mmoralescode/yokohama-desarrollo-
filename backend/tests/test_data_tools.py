from datetime import date, datetime, timezone
import sqlite3
import pytest
from app.backup import verified_copy
from app.odometer import OdometerConflict, validate_reading
from app.time_utils import date_timestamp


def test_verified_backup_restore_preserves_wal_and_refuses_overwrite(tmp_path):
    original, backup, restored = (tmp_path / name for name in ("original.db", "backup.bak", "restored.db"))
    with sqlite3.connect(original) as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("CREATE TABLE sample(id INTEGER PRIMARY KEY, value TEXT)")
        conn.execute("INSERT INTO sample VALUES(1, 'conserved')")
        conn.commit()
        assert verified_copy(original, backup)["verified"]
        with pytest.raises(FileExistsError):
            verified_copy(original, backup)
    assert verified_copy(backup, restored)["verified"]
    with sqlite3.connect(restored) as conn:
        assert conn.execute("SELECT * FROM sample").fetchall() == [(1, "conserved")]
    with pytest.raises(ValueError):
        verified_copy(original, original)


def test_mexico_legacy_dates_use_historical_rules():
    assert date_timestamp(date(2021, 7, 1)).hour == 5
    assert date_timestamp(date(2026, 7, 1)).hour == 6


@pytest.mark.parametrize("km,error", [(1200, False), (999, True), (2501, True)])
def test_pure_reading_validation(km, error):
    values = dict(when=date(2026, 1, 2), km=km, in_service_date=date(2021, 1, 1),
                  today=date(2026, 1, 2), current_km=1000, max_daily_km=1200,
                  points=[{"date": date(2026, 1, 1), "km": 1000}])
    if error:
        with pytest.raises(OdometerConflict):
            validate_reading(**values)
    else:
        validate_reading(**values)


def test_intraday_cannot_decrease_from_date_only_reference():
    day = date(2026, 1, 2)
    with pytest.raises(OdometerConflict):
        validate_reading(when=day, km=900, in_service_date=date(2021, 1, 1), today=day,
                         current_km=1000, max_daily_km=1200, recorded_at=datetime(2026, 1, 2, 18, tzinfo=timezone.utc),
                         points=[{"date": day, "km": 1000, "recorded_at": date_timestamp(day),
                                  "time_precision": "date", "is_reading": True}])
