# Contrato interno MVP v1

Base de trabajo: raíz del repositorio independiente mmoralescode/yokohama-desarrollo-. No modificar EXCOBA, catálogo histórico, Vercel ni credenciales. La estructura relativa backend/, frontend/, catalogos/ y config/ se conserva desde el MVP original.

## Backend / motor

Python FastAPI + SQLAlchemy 2 + SQLite. Paquete app en backend/app.
Motor puro app/engine.py:
build_plan(vehicle: dict, readings: list[dict], history: list[dict], faults: list[dict], catalog: dict, config: dict, today: datetime.date | None = None) -> dict.
Motor debe exportar también estimate_usage(...) y group_visits(...) para pruebas, firmas a documentar.

Input Vehicle: id (int), vin (str17), plate, model_year (int), variant_id (ID exacto del catálogo variantes), version, body_style (sedan/hatchback), engine (G25/G25T/G20MHEV), transmission (MT6/AT6), drive (FWD/AWD), current_km (float), in_service_date (ISO), usage_regime (normal/severe), is_synthetic (bool).
Input Reading: id, vehicle_id, date (ISO), odometer_km (float).
Input ServiceHistory: id, vehicle_id, service_id (catálogo), performed_on (ISO), odometer_km, notes.
Input Fault: id, vehicle_id, reported_on (ISO), description, dtc (nullable), severity (critico/importante/menor), status (open/resolved), safe_to_defer (bool, solo si evaluado), deadline (ISO nullable), resolution_notes. Critical never deferrable. Desconocido=requiere evaluación, no seguro.

El diferimiento requiere assessment_notes (mínimo 12 caracteres, evaluación y responsable). Las respuestas de falla muestran severity/safe_to_defer/deadline efectivos calculados por el motor; reported_severity/reported_safe_to_defer/reported_deadline conservan lo declarado por el operador y assessment_message explica el criterio. Los reportes originales permanecen en la base para auditoría.

Plan:
{
 vehicle_id, generated_on (ISO), catalog_version, mode ("demo"/"operational"),
 usage: {km_per_day, low_km_per_day, high_km_per_day, confidence, valid_intervals, rejected_readings, explanation},
 services: [{service_id,name,action,status ("upcoming"/"due"/"overdue"/"pending_validation"),due_date (ISO|null),latest_entry_date (ISO|null),due_odometer (float|null),km_remaining (float|null),severity,confidence,window_start (ISO|null),window_end (ISO|null),prediction:{optimistic,probable,pessimistic},explanation,requires_validation (bool),source_urls:list[str],duration_hours (float|null)}],
 visits: [{id (str stable),planned_date (ISO),service_ids:list[str],total_duration_hours (float|null),status,explanation,provisional (bool)}],
 alerts: [{key (str stable),vehicle_id,service_id (str|null),fault_id (int|null),severity,message,deadline (ISO|null),days_remaining (int|null),threshold_days (int|null),status ("open"),kind ("maintenance"/"fault"/"data")}],
 traffic_light ("red"/"amber"/"green"/"gray"),
 warnings:list[str]
}
All dates ISO local date, no probability false precision. Confidence alta/media/baja.

Visit incluye también fault_ids:list[int] para distinguir visitas de diagnóstico de servicios programados. status de visita: proposed/overdue/immediate. Los alertas de falla incorporan safe_to_defer efectivo y safety_evaluation.
Use explicit safeguards of Phase1: catalog all disabled for production. Demonstration allows numeric reference projections flagged provisional, not fake activation. Null tolerances mean no extension. Unknown history not assumed serviced at zero unless in_service anchor is defensible and known; history required per component. Uncertainty late/early bounds; safe conservative deadline against fastest-use bound and time criterion. Window advance configurable, no unsupported late extension. Critico immediate and not grouped with deferred visits. Future approved policy may supply per-service tolerance/advance/duration + explicit validation metadata. Retain source snapshots.

## HTTP interface (backend port8000)

GET /health public
GET /api/vehicles -> list[VehicleSummary]
VehicleSummary = Vehicle plus traffic_light,next_visit_date (ISO|null),open_alerts(int),usage_km_per_day(float|null)
POST /api/vehicles -> Vehicle (input vin,plate,model_year,variant_id,transmission,current_km,in_service_date,usage_regime,is_synthetic optional; derive engine/version/body/drive from matrix)
GET /api/vehicles/{id} -> {vehicle,readings,history,faults}
POST /api/vehicles/{id}/readings input {date,odometer_km}
POST /api/vehicles/{id}/services input {service_id,performed_on,odometer_km,notes?}
POST /api/vehicles/{id}/faults input {description,dtc?,severity,safe_to_defer?:false,deadline?}
PATCH /api/faults/{id}/resolve input {resolution_notes}
GET /api/vehicles/{id}/plan -> Plan
GET /api/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD -> list[Visit plus vehicle_id,plate,version]
GET /api/alerts -> list[Alert with id,plate]
GET /api/catalog -> full original catalog + separate runtime mode/policy metadata if desired; never silently change source values.
GET /api/variants -> entire variantes-mx JSON (root variantes)
POST /api/recalculate -> {vehicles_processed:int,alerts_open:int}
GET /api/notifications -> simulated delivery outbox list (no real sending)
GETs may refresh computed snapshots idempotently, no duplicate active alerts/visits/outbox. Store rules version, input/evaluation snapshots. Resolve/archive stale generated entities when source changes; NEVER discard actual fault history.
Structured errors: HTTP status and detail in Spanish. Validate chronology, finite km, duplicate plate/VIN/date, variant/year, future dates, impossible decreases and max daily mileage. No delete/reset exposed.
Auth: API requires X-API-Key from env YOKOHAMA_API_KEY (do NOT hardcode real token). create_app(database_url=None, api_key=None, policy_path=None) for isolated tests. Fail closed if no key configured except health. SQLite path default inside backend/data (ignored). Bind localhost. No production auth claim.

## Frontend

Independent Next.js+TypeScript package at frontend/, own dependencies lockfile. Spanish panel, no new UI lib; CSS design tokens, accessible SVG icons; red/charcoal/cream Yokohama editorial/fleet style, clearly demo.
Use /api/backend/[...path] server-side proxy -> backend /api/[...path]; env YOKOHAMA_API_URL=http://127.0.0.1:8000, YOKOHAMA_API_KEY server-only.
Local MVP no public deployment. Proxy only loopback host/origin unless explicit production authentication added. Validate same-origin for mutations, fixed upstream routes and bounded body, no arbitrary forwarding/credentials leak.
Routes / (flotilla), /vehiculos/[id], /calendario, /alertas. Optional /catalogo.
Dashboard table search/traffic light, next visit, odometer, usage, summary. Vehicle details plans/source/confidence/uncertainty, readings, service and fault registration forms, confirmed resolution; empty/loading/error/success states, refresh after mutations.
Calendar proposed visits grouped per day; show services and provisional/duration unknown. Alerts actions and fault distinction; notifications explicitly simulated.
Root agent will install dependencies/run integration/browser tests. Frontend agent responsible TS+build ready, backend agent API/tests/seed ready, engine agent math/tests/config ready.
