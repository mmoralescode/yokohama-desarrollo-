"""API local autenticada. Ejecutar con uvicorn app.main:app --host 127.0.0.1."""
import asyncio
from contextlib import asynccontextmanager, suppress
from datetime import date
import hmac
import json
import logging
import os
from pathlib import Path

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .database import make_database, migrate
from .engine import matches_service, validate_policy as validate_engine_policy
from .models import Alert, FaultReport, Notification, OdometerReading, ServiceCatalog, ServiceHistory, Vehicle, VisitPlan
from .planner import evaluate, serialize, vehicle_inputs
from .schemas import FaultCreate, FaultResolve, ReadingCreate, ServiceCreate, VehicleCreate
from .settings import validate_policy

ROOT = Path(__file__).resolve().parents[2]
LOGGER = logging.getLogger("yokohama")


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def create_app(database_url: str | None = None, api_key: str | None = None, policy_path: str | Path | None = None) -> FastAPI:
    """Factory para pruebas aisladas. La ausencia de clave siempre cierra la API."""
    key = api_key if api_key is not None else os.getenv("YOKOHAMA_API_KEY", "")
    db_url = database_url or os.getenv("YOKOHAMA_DATABASE_URL") or f"sqlite:///{(ROOT / 'backend/data/yokohama.db').as_posix()}"
    catalog = read_json(ROOT / "catalogos/mazda3-mx.v0.1.0.json")
    variants = read_json(ROOT / "catalogos/variantes-mx.v0.1.0.json")
    policy = read_json(Path(policy_path or os.getenv("YOKOHAMA_POLICY_PATH") or ROOT / "config/policy.json"))
    service_map = {service["id"]: service for service in catalog["servicios"]}
    validate_policy(policy, set(service_map))
    validate_engine_policy(policy)
    variant_map = {variant["id"]: variant for variant in variants["variantes"]}
    engine, sessions = make_database(db_url)
    lock = asyncio.Lock()

    def refresh_all_sync() -> dict:
        with sessions.begin() as session:
            vehicles = list(session.scalars(select(Vehicle).order_by(Vehicle.id)))
            for vehicle in vehicles:
                evaluate(session, vehicle, catalog, policy)
            count = session.scalar(select(func.count(Alert.id)).where(Alert.status == "open"))
            return {"vehicles_processed": len(vehicles), "alerts_open": count}

    async def refresh_all() -> dict:
        async with lock:
            return await asyncio.to_thread(refresh_all_sync)

    @asynccontextmanager
    async def lifespan(_app):
        migrate(engine)
        with sessions.begin() as session:
            for service_id, service in service_map.items():
                existing = session.get(ServiceCatalog, service_id)
                if existing is None:
                    session.add(ServiceCatalog(id=service_id, catalog_version=catalog["version_catalogo"], source_snapshot=service))
                elif existing.catalog_version != catalog["version_catalogo"] or existing.source_snapshot != service:
                    # History/evaluation snapshots preserve their original evidence.
                    existing.catalog_version = catalog["version_catalogo"]
                    existing.source_snapshot = service

        async def periodic_refresh():
            interval = policy.get("api", {}).get("refresh_seconds", 300)
            if not isinstance(interval, (int, float)) or interval < 1:
                return
            while True:
                try:
                    await refresh_all()
                except Exception:
                    LOGGER.exception("Falló el recálculo periódico local; revisar disponibilidad de la base")
                await asyncio.sleep(interval)

        task = asyncio.create_task(periodic_refresh())
        yield
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
        engine.dispose()

    application = FastAPI(title="Yokohama · Planificación de flotilla", version="0.1.0", lifespan=lifespan,
                          docs_url=None, redoc_url=None, openapi_url=None)
    application.state.engine = engine
    application.state.sessions = sessions
    application.state.catalog = catalog
    application.state.variants = variants
    application.state.policy = policy
    application.state.refresh_all = refresh_all

    @application.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, exc: RequestValidationError):
        errors = [{"campo": ".".join(str(value) for value in error["loc"]), "mensaje": error["msg"]} for error in exc.errors()]
        return JSONResponse(status_code=422, content={"detail": "Datos no válidos; revise los campos indicados.", "errors": errors})

    @application.exception_handler(IntegrityError)
    async def integrity_error(_request: Request, _exc: IntegrityError):
        return JSONResponse(status_code=409, content={"detail": "El registro ya existe o entra en conflicto con otro dato. No se guardaron cambios."})

    @application.middleware("http")
    async def local_protection(request: Request, call_next):
        if request.method in {"POST", "PATCH", "PUT", "DELETE"}:
            length = request.headers.get("content-length")
            if length and (not length.isdigit() or int(length) > 16_384):
                return JSONResponse(status_code=413, content={"detail": "Solicitud demasiado grande."})
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    def authenticate(x_api_key: str | None = Header(default=None)):
        if not key:
            raise HTTPException(503, "API deshabilitada: configure YOKOHAMA_API_KEY localmente.")
        if not x_api_key or not hmac.compare_digest(x_api_key.encode(), key.encode()):
            raise HTTPException(401, "Se requiere una clave API válida.")

    async def session_dependency():
        # Do not hold a thread-owned RLock across a FastAPI yield dependency:
        # entry/endpoint/exit may run on different workers. Async locking also
        # allows safe cancellation and never exhausts the endpoint thread pool.
        async with lock:
            with sessions.begin() as session:
                yield session

    api = APIRouter(prefix="/api", dependencies=[Depends(authenticate)])

    def find_vehicle(session: Session, vehicle_id: int) -> Vehicle:
        vehicle = session.get(Vehicle, vehicle_id)
        if vehicle is None:
            raise HTTPException(404, "Unidad no encontrada.")
        return vehicle

    def effective_fault(payload: dict, plan: dict) -> dict:
        """API displays the current conservative decision, retains operator claims.

        Original inputs remain unchanged in fault_reports and evaluation audit
        snapshots. A later policy escalation must not leave the UI saying safe.
        """
        alert = next((row for row in plan["alerts"] if row.get("fault_id") == payload["id"]), None)
        if alert is None:
            return payload
        return {**payload, "reported_severity": payload["severity"], "reported_safe_to_defer": payload["safe_to_defer"],
                "reported_deadline": payload["deadline"], "severity": alert["severity"],
                "safe_to_defer": alert.get("safe_to_defer", False), "deadline": alert["deadline"],
                "safety_evaluation": alert.get("safety_evaluation", "needs_assessment"), "assessment_message": alert["message"]}

    def validate_chronology(session: Session, vehicle: Vehicle, when: date, km: float, *, reading: bool):
        if when > date.today() or when < vehicle.in_service_date:
            raise HTTPException(422, "La fecha debe estar entre la puesta en servicio y hoy.")
        points = [(row.date, row.odometer_km) for row in session.scalars(select(OdometerReading).where(OdometerReading.vehicle_id == vehicle.id))]
        points += [(row.performed_on, row.odometer_km) for row in session.scalars(select(ServiceHistory).where(ServiceHistory.vehicle_id == vehicle.id))]
        if reading and session.scalar(select(OdometerReading.id).where(OdometerReading.vehicle_id == vehicle.id, OdometerReading.date == when)) is not None:
            raise HTTPException(409, "Ya existe una lectura de odómetro para esa fecha.")
        max_daily = policy["usage"]["max_daily_km"]
        for point_date, point_km in points:
            delta = (when - point_date).days
            if delta == 0 and km != point_km:
                raise HTTPException(422, "Los registros del mismo día deben compartir odómetro; no se sobrescriben lecturas históricas.")
            if (delta > 0 and km < point_km) or (delta < 0 and km > point_km):
                raise HTTPException(422, "El kilometraje disminuye o contradice el historial de la unidad.")
            if delta != 0 and abs(km - point_km) / abs(delta) > max_daily:
                raise HTTPException(422, "Lectura atípica: supera el máximo diario configurado; confirme el odómetro.")
        if km > vehicle.current_km and when < date.today():
            raise HTTPException(422, "El kilometraje histórico supera el kilometraje actual registrado.")

    @application.get("/health")
    def health():
        return {"status": "ok", "service": "yokohama", "version": "0.1.0", "mode": policy["mode"], "authentication_configured": bool(key)}

    @api.get("/vehicles")
    def list_vehicles(session: Session = Depends(session_dependency)):
        result = []
        for vehicle in session.scalars(select(Vehicle).order_by(Vehicle.id)):
            plan = evaluate(session, vehicle, catalog, policy)
            visits = [visit["planned_date"] for visit in plan["visits"]]
            result.append({**serialize(vehicle), "traffic_light": plan["traffic_light"], "next_visit_date": min(visits) if visits else None,
                           "open_alerts": len(plan["alerts"]), "usage_km_per_day": plan["usage"]["km_per_day"]})
        return result

    @api.post("/vehicles", status_code=201)
    def create_vehicle(payload: VehicleCreate, session: Session = Depends(session_dependency)):
        variant = variant_map.get(payload.variant_id)
        if not variant or variant["anio_modelo"] != payload.model_year or payload.transmission not in variant["transmisiones"]:
            raise HTTPException(422, "Año, versión o transmisión fuera de la matriz Mazda3 México documentada.")
        if payload.in_service_date.year < payload.model_year - 1:
            raise HTTPException(422, "La puesta en servicio no es compatible con el año modelo.")
        vehicle = Vehicle(**payload.model_dump(), version=variant["version"], body_style=variant["carroceria"],
                          engine=variant["motor"], drive=variant["traccion"])
        session.add(vehicle)
        session.flush()
        session.add(OdometerReading(vehicle_id=vehicle.id, date=date.today(), odometer_km=vehicle.current_km))
        session.flush()
        evaluate(session, vehicle, catalog, policy)
        return serialize(vehicle)

    @api.get("/vehicles/{vehicle_id}")
    def get_vehicle(vehicle_id: int, session: Session = Depends(session_dependency)):
        vehicle = find_vehicle(session, vehicle_id)
        plan = evaluate(session, vehicle, catalog, policy)
        payload = vehicle_inputs(session, vehicle)
        payload["faults"] = [effective_fault(fault, plan) for fault in payload["faults"]]
        return payload

    @api.get("/vehicles/{vehicle_id}/plan")
    def get_plan(vehicle_id: int, session: Session = Depends(session_dependency)):
        return evaluate(session, find_vehicle(session, vehicle_id), catalog, policy)

    @api.post("/vehicles/{vehicle_id}/readings", status_code=201)
    def create_reading(vehicle_id: int, payload: ReadingCreate, session: Session = Depends(session_dependency)):
        vehicle = find_vehicle(session, vehicle_id)
        validate_chronology(session, vehicle, payload.date, payload.odometer_km, reading=True)
        row = OdometerReading(vehicle_id=vehicle_id, **payload.model_dump())
        session.add(row)
        vehicle.current_km = max(vehicle.current_km, payload.odometer_km)
        session.flush()
        evaluate(session, vehicle, catalog, policy)
        return serialize(row)

    @api.post("/vehicles/{vehicle_id}/services", status_code=201)
    def create_service(vehicle_id: int, payload: ServiceCreate, session: Session = Depends(session_dependency)):
        vehicle = find_vehicle(session, vehicle_id)
        service = service_map.get(payload.service_id)
        if service is None or not matches_service(serialize(vehicle), service):
            raise HTTPException(422, "Servicio desconocido o no aplicable al motor, transmisión o régimen registrado.")
        validate_chronology(session, vehicle, payload.performed_on, payload.odometer_km, reading=False)
        row = ServiceHistory(vehicle_id=vehicle_id, **payload.model_dump(), catalog_snapshot=service)
        session.add(row)
        vehicle.current_km = max(vehicle.current_km, payload.odometer_km)
        session.flush()
        evaluate(session, vehicle, catalog, policy)
        return serialize(row)

    @api.post("/vehicles/{vehicle_id}/faults", status_code=201)
    def create_fault(vehicle_id: int, payload: FaultCreate, session: Session = Depends(session_dependency)):
        vehicle = find_vehicle(session, vehicle_id)
        row = FaultReport(vehicle_id=vehicle_id, reported_on=date.today(), **payload.model_dump())
        session.add(row)
        session.flush()
        plan = evaluate(session, vehicle, catalog, policy)
        return effective_fault(serialize(row), plan)

    @api.patch("/faults/{fault_id}/resolve")
    def resolve_fault(fault_id: int, payload: FaultResolve, session: Session = Depends(session_dependency)):
        row = session.get(FaultReport, fault_id)
        if row is None:
            raise HTTPException(404, "Reporte de falla no encontrado.")
        if row.status == "resolved":
            raise HTTPException(409, "La falla ya fue resuelta; el historial se conserva sin sobrescribirlo.")
        row.status = "resolved"
        row.resolution_notes = payload.resolution_notes
        row.resolved_on = date.today()
        session.flush()
        evaluate(session, find_vehicle(session, row.vehicle_id), catalog, policy)
        return serialize(row)

    @api.get("/calendar")
    def calendar(start: date = Query(...), end: date = Query(...), session: Session = Depends(session_dependency)):
        if end < start or (end - start).days > 366:
            raise HTTPException(422, "Seleccione un rango ordenado de hasta 366 días.")
        for vehicle in session.scalars(select(Vehicle)):
            evaluate(session, vehicle, catalog, policy)
        rows = session.execute(select(VisitPlan, Vehicle).join(Vehicle).where(VisitPlan.status == "proposed", VisitPlan.planned_date >= start, VisitPlan.planned_date <= end).order_by(VisitPlan.planned_date, Vehicle.id))
        return [{**visit.payload, "id": visit.id, "vehicle_id": vehicle.id, "plate": vehicle.plate, "version": vehicle.version} for visit, vehicle in rows]

    @api.get("/alerts")
    def alerts(session: Session = Depends(session_dependency)):
        for vehicle in session.scalars(select(Vehicle)):
            evaluate(session, vehicle, catalog, policy)
        rows = session.execute(select(Alert, Vehicle).join(Vehicle).where(Alert.status == "open").order_by(Alert.id))
        return [{**alert.payload, "id": alert.id, "status": alert.status, "plate": vehicle.plate} for alert, vehicle in rows]

    @api.get("/notifications")
    def notifications(session: Session = Depends(session_dependency)):
        return [serialize(row) for row in session.scalars(select(Notification).order_by(Notification.id.desc()).limit(500))]

    @api.get("/catalog")
    def get_catalog():
        return {**catalog, "runtime": {"mode": policy["mode"], "policy_version": policy["policy_version"], "production_rules_enabled": False}}

    @api.get("/variants")
    def get_variants():
        return variants

    @api.post("/recalculate")
    async def recalculate():
        return await refresh_all()

    application.include_router(api)
    return application


app = create_app()
