"""Generate public fixtures from a NEW synthetic database, never the live fleet."""
from datetime import timedelta
import json
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from fastapi.testclient import TestClient
from app.main import create_app, read_json
from app.seed import seed_database
from app.time_utils import local_today


def main():
    with tempfile.TemporaryDirectory(prefix="yokohama-public-proposal-") as temporary:
        workspace = Path(temporary)
        database_url = f"sqlite:///{(workspace / 'synthetic.db').as_posix()}"
        policy = read_json(ROOT / "config/policy.json")
        policy["api"] = {"refresh_seconds": 0}
        policy_path = workspace / "policy.json"
        policy_path.write_text(json.dumps(policy), encoding="utf-8")
        seed_database(database_url)
        application = create_app(database_url=database_url, api_key="isolated-synthetic-export", policy_path=policy_path)
        with TestClient(application) as client:
            client.headers["X-API-Key"] = "isolated-synthetic-export"

            def get(path):
                response = client.get(f"/api/{path}")
                response.raise_for_status()
                return response.json()

            vehicles = get("vehicles")
            assert len(vehicles) == 20 and all(vehicle["is_synthetic"] for vehicle in vehicles)
            # Fictional driver names are assigned ONLY inside this temporary
            # proposal database. The operational fleet is never opened.
            drivers = ["Andrea Torres", "Luis Hernández", "Mariana López", "Carlos Ramírez",
                       "Sofía Mendoza", "Jorge Castillo", "Valeria Ruiz", "Diego Navarro"]
            for index, vehicle in enumerate(vehicles):
                assigned = [drivers[index % len(drivers)]]
                if index % 3 == 0:
                    assigned.append(drivers[(index + 1) % len(drivers)])
                response = client.patch(f"/api/vehicles/{vehicle['id']}", json={"drivers": assigned})
                response.raise_for_status()
            vehicles = get("vehicles")
            details, plans = {}, {}
            for vehicle in vehicles:
                key = str(vehicle["id"])
                details[key] = get(f"vehicles/{key}")
                for history in details[key]["history"]:
                    history.pop("catalog_snapshot", None)
                plans[key] = get(f"vehicles/{key}/plan")
            today = local_today()
            snapshot = {
                "generated_on": today.isoformat(), "vehicles": vehicles,
                "details": details, "plans": plans,
                "calendar": get(f"calendar?start={(today - timedelta(days=180)).isoformat()}&end={(today + timedelta(days=180)).isoformat()}"),
                "catalog": get("catalog"), "variants": get("variants"),
            }
        target = ROOT / "frontend/public/proposal/fleet.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"Synthetic proposal: {len(vehicles)} vehicles, {target.stat().st_size} bytes. Live database never opened.")


if __name__ == "__main__":
    main()
