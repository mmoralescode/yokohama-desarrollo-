"""API local autenticada. Ejecutar con uvicorn app.main:app --host 127.0.0.1."""
import asyncio
from contextlib import asynccontextmanager, suppress
from datetime import date
import hmac
import hashlib
import json
import logging
import os
from pathlib import Path
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from .database import make_database, migrate
from .engine import matches_service, validate_policy as validate_engine_policy
from .fleet import MAZDA3_CATALOG_KEY
from .models import Alert, AppointmentChange, CalendarAppointment, Downtime, FaultReport, Notification, OdometerReading, PlanEvaluation, ServiceCatalog, ServiceHistory, Vehicle, VisitPlan
from .calendar_admin import appointment_payload, calendar_entries, cycle_anchors, finish_appointments, next_visit_date, remaining_services
from .planner import evaluate, serialize, vehicle_inputs
from .schemas import AppointmentCreate, AppointmentUpdate, DowntimeClose, DowntimeCreate, FaultCreate, FaultResolve, ReadingBatch, ReadingCreate, ServiceBatchCreate, ServiceCreate, VehicleCreate, VehiclePolicyUpdate
from .settings import validate_policy
from .metrics import fleet_metrics
from .odometer import OdometerConflict, validate_reading
from .time_utils import as_utc, date_timestamp, local_today, utc_now

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

    @application.exception_handler(OperationalError)
    async def database_unavailable(_request: Request, exc: OperationalError):
        LOGGER.error("Base temporalmente no disponible (%s)", type(exc.orig).__name__)
        return JSONResponse(status_code=503, headers={"Retry-After": "5"}, content={"detail": "Base temporalmente no disponible. No se confirmó la operación; consulte el historial antes de reintentar."})

    @application.exception_handler(OdometerConflict)
    async def reading_conflict(_request: Request, exc: OdometerConflict):
        return JSONResponse(status_code=409 if exc.duplicate else 422, content={"detail": str(exc)})

    @application.middleware("http")
    async def local_protection(request: Request, call_next):
        if request.method in {"POST", "PATCH", "PUT", "DELETE"}:
            maximum = policy.get("api", {}).get("max_request_bytes", 262_144)
            length = request.headers.get("content-length")
            if length and (not length.isdigit() or int(length) > maximum):
                return JSONResponse(status_code=413, content={"detail": "Solicitud demasiado grande."})
            # Bound streamed/chunked bodies as well; Content-Length is not trusted.
            chunks, size = [], 0
            async for chunk in request.stream():
                size += len(chunk)
                if size > maximum:
                    return JSONResponse(status_code=413, content={"detail": "Solicitud demasiado grande."})
                chunks.append(chunk)
            request._body = b"".join(chunks)
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

    def compact_name(value: str) -> str:
        return "".join(character for character in value.casefold() if character.isalnum())

    def uses_mazda3_catalog(vehicle: Vehicle) -> bool:
        return vehicle.maintenance_catalog == MAZDA3_CATALOG_KEY

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

    def validate_chronology(session: Session, vehicle: Vehicle, when: date, km: float, *, reading: bool, recorded_at=None):
        points = [{"date": row.date, "km": row.odometer_km, "recorded_at": row.recorded_at,
                   "time_precision": row.time_precision, "is_reading": True}
                  for row in session.scalars(select(OdometerReading).where(OdometerReading.vehicle_id == vehicle.id))]
        points += [{"date": row.performed_on, "km": row.odometer_km}
                   for row in session.scalars(select(ServiceHistory).where(ServiceHistory.vehicle_id == vehicle.id, ServiceHistory.odometer_km.is_not(None)))]
        validate_reading(when=when, km=km, points=points, in_service_date=vehicle.in_service_date,
                         today=local_today(), current_km=vehicle.current_km, max_daily_km=policy["usage"]["max_daily_km"],
                         reading=reading, recorded_at=recorded_at)

    @application.get("/health")
    def health():
        return {"status": "ok", "service": "yokohama", "version": "0.1.0", "mode": policy["mode"], "authentication_configured": bool(key)}

    @api.get("/vehicles")
    def list_vehicles(session: Session = Depends(session_dependency, scope="function")):
        result = []
        for vehicle in session.scalars(select(Vehicle).order_by(Vehicle.id)):
            plan = evaluate(session, vehicle, catalog, policy)
            result.append({**serialize(vehicle), "traffic_light": plan["traffic_light"], "next_visit_date": next_visit_date(session, vehicle.id, plan["visits"]),
                           "open_alerts": len(plan["alerts"]), "usage_km_per_day": plan["usage"]["km_per_day"]})
        priority = {"red": 0, "amber": 1, "gray": 2, "green": 3}
        return sorted(result, key=lambda row: (priority[row["traffic_light"]], row["next_visit_date"] or "9999-12-31", row["id"]))

    @api.post("/vehicles", status_code=201)
    def create_vehicle(payload: VehicleCreate, session: Session = Depends(session_dependency, scope="function")):
        values = payload.model_dump()
        if values["severity_multiplier"] is None:
            values["severity_multiplier"] = float(policy["planning"].get("default_severity_multiplier", 1))
        variant = variant_map.get(payload.variant_id or "")
        mazda_catalog_requested = payload.maintenance_catalog == MAZDA3_CATALOG_KEY
        if variant is None:
            if mazda_catalog_requested:
                raise HTTPException(422, "Para usar el catálogo Mazda3 seleccione una variante documentada.")
            required_manual_fields = ("make", "model", "version", "body_style", "engine", "transmission", "drive")
            if any(not values[field] for field in required_manual_fields):
                raise HTTPException(422, "Para dar de alta una unidad manual indique marca, modelo, versión, carrocería, motor, transmisión y tracción.")
            # An optional/unknown catalog is retained as data for a future
            # integration, but it has no rules until that catalog is loaded.
            vehicle = Vehicle(**values)
            session.add(vehicle)
            session.flush()
            session.add(OdometerReading(vehicle_id=vehicle.id, date=local_today(), odometer_km=vehicle.current_km))
            session.flush()
            evaluate(session, vehicle, catalog, policy)
            return serialize(vehicle)
        if payload.maintenance_catalog not in (None, MAZDA3_CATALOG_KEY):
            raise HTTPException(422, "La variante Mazda3 no puede combinarse con otro catálogo de mantenimiento.")
        if payload.make and compact_name(payload.make) != "mazda":
            raise HTTPException(422, "La marca no coincide con la variante Mazda3 seleccionada.")
        if payload.model and compact_name(payload.model) != "mazda3":
            raise HTTPException(422, "El modelo no coincide con la variante Mazda3 seleccionada.")
        if not variant or variant["anio_modelo"] != payload.model_year or payload.transmission not in variant["transmisiones"]:
            raise HTTPException(422, "Año, versión o transmisión fuera de la matriz Mazda3 México documentada.")
        if payload.in_service_date.year < payload.model_year - 1:
            raise HTTPException(422, "La puesta en servicio no es compatible con el año modelo.")
        values = payload.model_dump()
        if values["severity_multiplier"] is None:
            values["severity_multiplier"] = float(policy["planning"].get("default_severity_multiplier", 1))
        vehicle_values = values | {
            "make": "Mazda", "model": "Mazda3", "maintenance_catalog": MAZDA3_CATALOG_KEY,
            "version": variant["version"], "body_style": variant["carroceria"],
            "engine": variant["motor"], "drive": variant["traccion"],
            "fuel_type": payload.fuel_type or "Gasolina",
        }
        vehicle = Vehicle(**vehicle_values)
        session.add(vehicle)
        session.flush()
        session.add(OdometerReading(vehicle_id=vehicle.id, date=local_today(), odometer_km=vehicle.current_km))
        session.flush()
        evaluate(session, vehicle, catalog, policy)
        return serialize(vehicle)

    @api.get("/vehicles/{vehicle_id}")
    def get_vehicle(vehicle_id: int, session: Session = Depends(session_dependency, scope="function")):
        vehicle = find_vehicle(session, vehicle_id)
        plan = evaluate(session, vehicle, catalog, policy)
        payload = vehicle_inputs(session, vehicle)
        payload["faults"] = [effective_fault(fault, plan) for fault in payload["faults"]]
        payload["downtime"] = [serialize(row) for row in session.scalars(select(Downtime).where(Downtime.vehicle_id == vehicle_id).order_by(Downtime.started_at.desc()))]
        return payload

    @api.get("/vehicles/{vehicle_id}/plan")
    def get_plan(vehicle_id: int, session: Session = Depends(session_dependency, scope="function")):
        return evaluate(session, find_vehicle(session, vehicle_id), catalog, policy)

    @api.patch("/vehicles/{vehicle_id}")
    def update_vehicle_policy(vehicle_id: int, payload: VehiclePolicyUpdate, session: Session = Depends(session_dependency, scope="function")):
        vehicle = find_vehicle(session, vehicle_id)
        for field, value in payload.model_dump(exclude_none=True).items():
            setattr(vehicle, field, value)
        session.flush()
        evaluate(session, vehicle, catalog, policy)
        return serialize(vehicle)

    @api.post("/vehicles/{vehicle_id}/readings", status_code=201)
    def create_reading(vehicle_id: int, payload: ReadingCreate, session: Session = Depends(session_dependency, scope="function")):
        vehicle = find_vehicle(session, vehicle_id)
        validate_chronology(session, vehicle, payload.date, payload.odometer_km, reading=True, recorded_at=payload.recorded_at)
        row = OdometerReading(vehicle_id=vehicle_id, **payload.storage_values())
        session.add(row)
        vehicle.current_km = max(vehicle.current_km, payload.odometer_km)
        session.flush()
        evaluate(session, vehicle, catalog, policy)
        return serialize(row)

    def applicable_service(vehicle: Vehicle, service_id: str) -> dict:
        service = service_map.get(service_id)
        if not uses_mazda3_catalog(vehicle) or service is None or not matches_service(serialize(vehicle), service):
            raise HTTPException(422, "El servicio seleccionado no corresponde al catálogo de esta unidad. Describa el trabajo realizado para un registro manual.")
        return service

    def find_appointment(session: Session, vehicle_id: int, appointment_id: str) -> CalendarAppointment:
        appointment = session.get(CalendarAppointment, appointment_id)
        if appointment is None or appointment.vehicle_id != vehicle_id:
            raise HTTPException(404, "Cita no encontrada para esta unidad.")
        if appointment.status != "scheduled":
            raise HTTPException(409, "Esta cita ya se completó. Consulte el historial antes de registrar otro servicio.")
        return appointment

    @api.post("/vehicles/{vehicle_id}/appointments", status_code=201)
    def create_appointment(vehicle_id: int, payload: AppointmentCreate, session: Session = Depends(session_dependency, scope="function")):
        vehicle = find_vehicle(session, vehicle_id)
        if payload.scheduled_date < vehicle.in_service_date:
            raise HTTPException(422, "La fecha no puede ser anterior a la puesta en servicio de la unidad.")
        for service_id in payload.service_ids:
            applicable_service(vehicle, service_id)
        source = session.get(VisitPlan, payload.original_visit_id) if payload.original_visit_id else None
        if payload.original_visit_id and (source is None or source.vehicle_id != vehicle_id or not set(payload.service_ids) <= set(source.payload["service_ids"])):
            raise HTTPException(422, "La visita de origen no corresponde a los servicios de esta unidad. Actualice el calendario.")
        anchors = cycle_anchors(session, vehicle_id, payload.service_ids)
        for existing in session.scalars(select(CalendarAppointment).where(CalendarAppointment.vehicle_id == vehicle_id, CalendarAppointment.status == "scheduled")):
            if any(item in remaining_services(existing) and anchors[item] == existing.cycle_anchors.get(item, 0) for item in payload.service_ids):
                raise HTTPException(409, "Uno de estos servicios ya tiene una fecha registrada. Use Cambiar fecha en esa cita.")
        row = CalendarAppointment(id=str(uuid4()), vehicle_id=vehicle_id, scheduled_date=payload.scheduled_date,
                                  service_ids=payload.service_ids, completed_service_ids=[], cycle_anchors=anchors,
                                  original_visit_id=payload.original_visit_id,
                                  original_date=source.planned_date if source else None, notes=payload.notes)
        session.add(row)
        session.flush()
        session.add(AppointmentChange(appointment_id=row.id, previous_date=row.original_date,
                                     scheduled_date=row.scheduled_date, notes=row.notes))
        session.flush()
        return appointment_payload(session, row, vehicle)

    @api.patch("/vehicles/{vehicle_id}/appointments/{appointment_id}")
    def reschedule_appointment(vehicle_id: int, appointment_id: str, payload: AppointmentUpdate, session: Session = Depends(session_dependency, scope="function")):
        vehicle = find_vehicle(session, vehicle_id)
        row = find_appointment(session, vehicle_id, appointment_id)
        if payload.scheduled_date < vehicle.in_service_date:
            raise HTTPException(422, "La fecha no puede ser anterior a la puesta en servicio de la unidad.")
        if row.scheduled_date != payload.scheduled_date or (payload.notes is not None and payload.notes != row.notes):
            session.add(AppointmentChange(appointment_id=row.id, previous_date=row.scheduled_date,
                                         scheduled_date=payload.scheduled_date, notes=payload.notes or ""))
            row.scheduled_date = payload.scheduled_date
            if payload.notes is not None:
                row.notes = payload.notes
            row.updated_at = utc_now()
            session.flush()
        return appointment_payload(session, row, vehicle)

    @api.post("/vehicles/{vehicle_id}/services/batch", status_code=201)
    def capture_services(vehicle_id: int, payload: ServiceBatchCreate, session: Session = Depends(session_dependency, scope="function")):
        vehicle = find_vehicle(session, vehicle_id)
        if payload.performed_on < vehicle.in_service_date:
            raise HTTPException(422, "La fecha del servicio no puede ser anterior a la puesta en servicio de la unidad.")
        if payload.odometer_km is not None:
            validate_chronology(session, vehicle, payload.performed_on, payload.odometer_km, reading=False)
        appointment = find_appointment(session, vehicle_id, payload.appointment_id) if payload.appointment_id else None
        services = {item: applicable_service(vehicle, item) for item in payload.service_ids}
        if appointment:
            for item in set(payload.service_ids) & set(remaining_services(appointment)):
                anchor_id = appointment.cycle_anchors.get(item, 0)
                anchor = session.get(ServiceHistory, anchor_id) if anchor_id else None
                if anchor and payload.performed_on < anchor.performed_on:
                    raise HTTPException(422, "Ese servicio es anterior al ciclo de la cita. Regístrelo desde Registrar servicio sin vincular esta cita.")
        if payload.manual_description:
            identity = " ".join(payload.manual_description.casefold().split())
            service_id = "manual_" + hashlib.sha256(identity.encode()).hexdigest()[:32]
            service = {"id": service_id, "servicio": payload.manual_description, "manual": True}
            services[service_id] = service
            if session.get(ServiceCatalog, service_id) is None:
                session.add(ServiceCatalog(id=service_id, catalog_version="administrative-v1", source_snapshot=service))
                session.flush()
        duplicate = session.scalar(select(ServiceHistory.id).where(
            ServiceHistory.vehicle_id == vehicle_id, ServiceHistory.performed_on == payload.performed_on,
            ServiceHistory.service_id.in_(services)))
        if duplicate is not None:
            raise HTTPException(409, "Uno de los servicios ya está registrado en esa fecha. Revise el historial; no se guardó ningún servicio del lote.")
        prior = session.scalar(select(PlanEvaluation).where(PlanEvaluation.vehicle_id == vehicle_id,
            PlanEvaluation.evaluated_at < date_timestamp(payload.performed_on)).order_by(PlanEvaluation.evaluated_at.desc(), PlanEvaluation.id.desc()).limit(1))
        captured_at = utc_now()
        records = []
        for service_id, service in services.items():
            prediction = next((item for item in prior.result["services"] if item["service_id"] == service_id), None) if prior else None
            due = date.fromisoformat(prediction["due_date"]) if prediction and prediction.get("due_date") else None
            row = ServiceHistory(vehicle_id=vehicle_id, service_id=service_id,
                performed_on=payload.performed_on, odometer_km=payload.odometer_km,
                notes=payload.notes, maintenance_type=payload.maintenance_type,
                catalog_snapshot=service, captured_at=captured_at, appointment_id=payload.appointment_id,
                predicted_due_date=due, prediction_error_days=(payload.performed_on - due).days if due else None,
                prediction_evaluation_id=prior.id if due else None)
            session.add(row)
            records.append(row)
        if payload.odometer_km is not None:
            vehicle.current_km = max(vehicle.current_km, payload.odometer_km)
        session.flush()
        finish_appointments(session, vehicle_id, records)
        session.flush()
        evaluate(session, vehicle, catalog, policy)
        return {"created": len(records), "records": [serialize(row) for row in records], "appointment_id": payload.appointment_id}

    @api.post("/vehicles/{vehicle_id}/readings/batch")
    def create_reading_batch(vehicle_id: int, payload: ReadingBatch, session: Session = Depends(session_dependency, scope="function")):
        """Bounded, all-or-nothing import. Exact replays skip; conflicts roll back."""
        vehicle = find_vehicle(session, vehicle_id)
        created, skipped = 0, 0
        for item in sorted(payload.readings, key=lambda item: item.storage_values()["recorded_at"]):
            values = item.storage_values()
            existing = session.scalar(select(OdometerReading).where(OdometerReading.vehicle_id == vehicle_id,
                                                                    OdometerReading.recorded_at == values["recorded_at"]))
            if existing is not None:
                if existing.odometer_km == item.odometer_km and existing.source == item.source and existing.time_precision == values["time_precision"]:
                    skipped += 1
                    continue
                raise HTTPException(409, "La carga contiene una lectura que contradice otra existente. No se guardó ningún registro del lote.")
            validate_chronology(session, vehicle, item.date, item.odometer_km, reading=True, recorded_at=item.recorded_at)
            session.add(OdometerReading(vehicle_id=vehicle_id, **values))
            vehicle.current_km = max(vehicle.current_km, item.odometer_km)
            session.flush()
            created += 1
        evaluate(session, vehicle, catalog, policy)
        return {"created": created, "skipped": skipped, "vehicle_id": vehicle_id, "atomic": True}

    @api.post("/vehicles/{vehicle_id}/services", status_code=201)
    def create_service(vehicle_id: int, payload: ServiceCreate, session: Session = Depends(session_dependency, scope="function")):
        vehicle = find_vehicle(session, vehicle_id)
        if not uses_mazda3_catalog(vehicle):
            raise HTTPException(422, "La unidad no tiene un catálogo técnico cargado para registrar este servicio programado.")
        service = service_map.get(payload.service_id)
        if service is None or not matches_service(serialize(vehicle), service):
            raise HTTPException(422, "Servicio desconocido o no aplicable al motor, transmisión o régimen registrado.")
        validate_chronology(session, vehicle, payload.performed_on, payload.odometer_km, reading=False)
        if payload.fault_id is not None:
            fault = session.get(FaultReport, payload.fault_id)
            if fault is None or fault.vehicle_id != vehicle_id or (fault.service_id and fault.service_id != payload.service_id):
                raise HTTPException(422, "La falla vinculada debe pertenecer a esta unidad y al mismo componente.")
            if fault.reported_on > payload.performed_on:
                raise HTTPException(422, "El servicio correctivo no puede ser anterior al reporte de falla.")
        # Avoid hindsight: only a snapshot made BEFORE the service's local day.
        prior = session.scalar(select(PlanEvaluation).where(PlanEvaluation.vehicle_id == vehicle_id,
                              PlanEvaluation.evaluated_at < date_timestamp(payload.performed_on)).order_by(PlanEvaluation.evaluated_at.desc(), PlanEvaluation.id.desc()).limit(1))
        prediction = next((item for item in prior.result["services"] if item["service_id"] == payload.service_id), None) if prior else None
        due = date.fromisoformat(prediction["due_date"]) if prediction and prediction.get("due_date") else None
        row = ServiceHistory(vehicle_id=vehicle_id, **payload.model_dump(), catalog_snapshot=service)
        row.predicted_due_date = due
        row.prediction_error_days = (payload.performed_on - due).days if due else None
        row.prediction_evaluation_id = prior.id if due else None
        session.add(row)
        vehicle.current_km = max(vehicle.current_km, payload.odometer_km)
        session.flush()
        finish_appointments(session, vehicle_id, [row])
        session.flush()
        evaluate(session, vehicle, catalog, policy)
        return serialize(row)

    @api.post("/vehicles/{vehicle_id}/faults", status_code=201)
    def create_fault(vehicle_id: int, payload: FaultCreate, session: Session = Depends(session_dependency, scope="function")):
        vehicle = find_vehicle(session, vehicle_id)
        if payload.service_id and (not uses_mazda3_catalog(vehicle) or payload.service_id not in service_map or not matches_service(serialize(vehicle), service_map[payload.service_id])):
            raise HTTPException(422, "El componente reportado no corresponde a esta unidad.")
        row = FaultReport(vehicle_id=vehicle_id, reported_on=local_today(), **payload.model_dump())
        session.add(row)
        session.flush()
        plan = evaluate(session, vehicle, catalog, policy)
        return effective_fault(serialize(row), plan)

    @api.patch("/faults/{fault_id}/resolve")
    def resolve_fault(fault_id: int, payload: FaultResolve, session: Session = Depends(session_dependency, scope="function")):
        row = session.get(FaultReport, fault_id)
        if row is None:
            raise HTTPException(404, "Reporte de falla no encontrado.")
        if row.status == "resolved":
            raise HTTPException(409, "La falla ya fue resuelta; el historial se conserva sin sobrescribirlo.")
        row.status = "resolved"
        row.resolution_notes = payload.resolution_notes
        row.resolved_on = local_today()
        session.flush()
        evaluate(session, find_vehicle(session, row.vehicle_id), catalog, policy)
        return serialize(row)

    @api.get("/calendar")
    def calendar(start: date = Query(...), end: date = Query(...), session: Session = Depends(session_dependency, scope="function")):
        if end < start or (end - start).days > 366:
            raise HTTPException(422, "Seleccione un rango ordenado de hasta 366 días.")
        for vehicle in session.scalars(select(Vehicle)):
            evaluate(session, vehicle, catalog, policy)
        return calendar_entries(session, start, end)

    @api.get("/alerts")
    def alerts(session: Session = Depends(session_dependency, scope="function")):
        for vehicle in session.scalars(select(Vehicle)):
            evaluate(session, vehicle, catalog, policy)
        rows = session.execute(select(Alert, Vehicle).join(Vehicle).where(Alert.status == "open").order_by(Alert.id))
        return [{**alert.payload, "id": alert.id, "status": alert.status, "plate": vehicle.plate} for alert, vehicle in rows]

    @api.get("/notifications")
    def notifications(session: Session = Depends(session_dependency, scope="function")):
        return [serialize(row) for row in session.scalars(select(Notification).order_by(Notification.id.desc()).limit(500))]

    @api.get("/metrics")
    def metrics(synthetic: Literal["true", "false", "null"] = Query("false"), session: Session = Depends(session_dependency, scope="function")):
        return fleet_metrics(session, {"true": True, "false": False, "null": None}[synthetic])

    def check_downtime(session: Session, vehicle: Vehicle, start, end, exclude_id=None):
        from .time_utils import MEXICO_CITY
        if start.astimezone(MEXICO_CITY).date() < vehicle.in_service_date:
            raise HTTPException(422, "El paro no puede comenzar antes de la puesta en servicio.")
        for other in session.scalars(select(Downtime).where(Downtime.vehicle_id == vehicle.id)):
            if other.id == exclude_id:
                continue
            if (end is None or as_utc(other.started_at) < end) and (other.ended_at is None or start < as_utc(other.ended_at)):
                raise HTTPException(409, "El intervalo se traslapa con otro paro registrado. No se suman horas duplicadas.")

    @api.post("/vehicles/{vehicle_id}/downtime", status_code=201)
    def create_downtime(vehicle_id: int, payload: DowntimeCreate, session: Session = Depends(session_dependency, scope="function")):
        vehicle = find_vehicle(session, vehicle_id)
        check_downtime(session, vehicle, payload.started_at, payload.ended_at)
        row = Downtime(vehicle_id=vehicle_id, **payload.model_dump())
        session.add(row)
        session.flush()
        return serialize(row)

    @api.patch("/vehicles/{vehicle_id}/downtime/{downtime_id}")
    def close_downtime(vehicle_id: int, downtime_id: int, payload: DowntimeClose, session: Session = Depends(session_dependency, scope="function")):
        vehicle = find_vehicle(session, vehicle_id)
        row = session.get(Downtime, downtime_id)
        if row is None or row.vehicle_id != vehicle_id:
            raise HTTPException(404, "Registro fuera de servicio no encontrado.")
        if row.ended_at is not None:
            raise HTTPException(409, "El paro ya está cerrado. El historial no se sobrescribe.")
        if payload.ended_at <= as_utc(row.started_at):
            raise HTTPException(422, "El fin debe ser posterior al inicio.")
        check_downtime(session, vehicle, as_utc(row.started_at), payload.ended_at, exclude_id=row.id)
        row.ended_at = payload.ended_at
        if payload.notes is not None:
            row.notes = payload.notes
        session.flush()
        return serialize(row)

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
