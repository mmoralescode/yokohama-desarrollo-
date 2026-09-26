/** Browser-only proposal workspace. It never calls the operational API. */
import type {Alert, FleetMetrics, Plan, ServiceHistory, Vehicle, VehicleDetail, VehicleSummary, Variant, Visit} from "./types";
import {localDate} from "./dates";

type History = Omit<ServiceHistory, "odometer_km"> & {odometer_km: number | null; captured_at?: string | null; service_name?: string};
type Detail = Omit<VehicleDetail, "history"> & {history: History[]};
type Appointment = {id: string; vehicle_id: number; service_ids: string[]; scheduled_date: string; original_date: string; notes: string; captured_at: string; changes: {previous_date: string; scheduled_date: string; changed_at: string; notes: string}[]};
type Entry = Visit & {appointment_id?: string; performed_on?: string; captured_at?: string | null; original_date?: string; service_names?: string[]; notes?: string; changes?: Appointment["changes"]};
type Catalog = {servicios: {id: string; servicio: string; [key: string]: unknown}[]; [key: string]: unknown};
type Snapshot = {generated_on: string; vehicles: VehicleSummary[]; details: Record<string, Detail>; plans: Record<string, Plan>; calendar: Entry[]; catalog: Catalog; variants: {variantes: Variant[]}};
type Workspace = Snapshot & {revision: 1; appointments: Appointment[]; completed: Entry[]};
const STORAGE_KEY = "yokohama-propuesta-administrativa-v1";
let workspace: Workspace | undefined;
let loading: Promise<Workspace> | undefined;
type Body = Record<string, unknown>;

function copy<T>(value: T): T {return structuredClone(value);}
function assert(condition: unknown, message: string): asserts condition {if (!condition) throw new Error(message);}
function text(body: Body, key: string): string {return String(body[key] ?? "").trim();}
function driverNames(value: unknown): string[] {
  assert(Array.isArray(value) && value.length <= 20, "Agrega como máximo 20 conductores por unidad.");
  const names: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    assert(typeof item === "string", "Escribe el nombre de cada conductor.");
    const name = item.trim().replace(/\s+/g, " ");
    assert(name.length >= 1 && name.length <= 100, "Cada nombre debe tener entre 1 y 100 caracteres.");
    const key = name.toLocaleLowerCase("es-MX");
    if (!seen.has(key)) {seen.add(key); names.push(name);}
  }
  return names;
}
function withDriverDefaults(state: Workspace): Workspace {
  // Upgrade older browser workspaces in place without discarding their units,
  // service history or changed dates. No invented assignments on saved units.
  for (const row of Object.values(state.details)) row.vehicle.drivers ??= [];
  for (const vehicle of state.vehicles) vehicle.drivers ??= state.details[String(vehicle.id)]?.vehicle.drivers || [];
  return state;
}
function ids(body: Body): string[] {
  const values = body.service_ids;
  assert(Array.isArray(values) && values.every(value => typeof value === "string"), "Selecciona los servicios realizados.");
  return [...new Set(values as string[])];
}
function validDate(value: string, label: string): string {
  const instant = new Date(`${value}T12:00:00Z`);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 10) === value, `Indica ${label} válida.`);
  return value;
}
function number(body: Body, key: string): number | null {
  if (body[key] == null || body[key] === "") return null;
  const value = Number(body[key]);
  assert(Number.isFinite(value) && value >= 0, "El kilometraje y los importes deben ser números positivos o cero.");
  return value;
}
async function load(): Promise<Workspace> {
  if (workspace) return workspace;
  if (loading) return loading;
  loading = (async () => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as Workspace;
        assert(parsed.revision === 1 && Array.isArray(parsed.vehicles) && parsed.details && parsed.plans && Array.isArray(parsed.appointments) && Array.isArray(parsed.completed), "Formato de propuesta desconocido.");
        return workspace = withDriverDefaults(parsed);
      } catch {throw new Error("No se pudo leer la propuesta guardada en este navegador. Tus datos no se sobrescribieron; prueba desde una ventana privada.");}
    }
    const response = await fetch("/proposal/fleet.json", {cache: "no-store"});
    assert(response.ok, "No se pudieron cargar las unidades de ejemplo. Actualiza la página.");
    const snapshot = await response.json() as Snapshot;
    assert(snapshot.vehicles.every(vehicle => vehicle.is_synthetic), "La propuesta sólo admite datos de ejemplo.");
    workspace = withDriverDefaults({...snapshot, revision: 1, appointments: [], completed: []});
    return workspace;
  })();
  try {return await loading;} finally {loading = undefined;}
}
function save(next: Workspace): void {
  try {window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));}
  catch {throw new Error("El navegador no pudo guardar el cambio. Libera espacio o permite el almacenamiento y vuelve a intentarlo.");}
  workspace = next;
}
function detail(state: Workspace, vehicleId: number): Detail {
  const value = state.details[String(vehicleId)];
  assert(value, "No se encontró esa unidad.");
  return value;
}
function serviceNames(state: Workspace): Record<string, string> {
  return Object.fromEntries(state.catalog.servicios.map(service => [service.id, service.servicio]));
}
function appointmentEntry(state: Workspace, appointment: Appointment): Entry {
  const vehicle = detail(state, appointment.vehicle_id).vehicle;
  const names = serviceNames(state);
  return {id: `appointment-${appointment.id}`, appointment_id: appointment.id, vehicle_id: vehicle.id, plate: vehicle.plate, version: `${vehicle.make} ${vehicle.model} · ${vehicle.version}`, planned_date: appointment.scheduled_date, original_date: appointment.original_date, service_ids: [...appointment.service_ids], fault_ids: [], total_duration_hours: null, status: "scheduled", provisional: false, explanation: "Fecha de agenda registrada por administración.", notes: appointment.notes, captured_at: appointment.captured_at, changes: copy(appointment.changes), service_names: appointment.service_ids.map(id => names[id] || id)};
}
function calendar(state: Workspace): Entry[] {
  const rows = state.calendar.map(entry => {
    if (entry.status === "completed") return copy(entry);
    const pending = entry.service_ids.map((service, index) => ({id: service, name: entry.service_names?.[index]})).filter(service => !state.appointments.some(appointment => appointment.vehicle_id === entry.vehicle_id && appointment.service_ids.includes(service.id)));
    return {...copy(entry), service_ids: pending.map(service => service.id), service_names: pending.map(service => service.name || serviceNames(state)[service.id] || service.id)};
  })
    .filter(entry => entry.status === "completed" || entry.service_ids.length || entry.fault_ids?.length);
  return [...rows, ...state.appointments.map(appointment => appointmentEntry(state, appointment)), ...state.completed]
    .sort((a, b) => a.planned_date.localeCompare(b.planned_date));
}
function summary(state: Workspace, original: VehicleSummary): VehicleSummary {
  const vehicle = detail(state, original.id).vehicle;
  const plan = state.plans[String(original.id)];
  const visits = calendar(state).filter(entry => entry.vehicle_id === original.id && entry.status !== "completed");
  return {...original, ...vehicle, next_visit_date: visits[0]?.planned_date || null, open_alerts: plan.alerts.length, traffic_light: plan.traffic_light, usage_km_per_day: plan.usage.km_per_day};
}
function metrics(state: Workspace, cohort: string | null): FleetMetrics {
  const included = state.vehicles.filter(vehicle => cohort === "null" || (cohort === "true" ? vehicle.is_synthetic : !vehicle.is_synthetic));
  const records = included.flatMap(vehicle => detail(state, vehicle.id).history);
  const classified = records.filter(record => record.maintenance_type === "preventive" || record.maintenance_type === "corrective");
  const preventive = classified.filter(record => record.maintenance_type === "preventive");
  const faults = included.flatMap(vehicle => detail(state, vehicle.id).faults);
  const classifiedFaults = faults.filter(fault => typeof fault.was_predicted === "boolean");
  const errors = records.flatMap(record => typeof record.prediction_error_days === "number" ? [record.prediction_error_days] : []);
  const periods = included.flatMap(vehicle => detail(state, vehicle.id).downtime || []);
  return {total_services: records.length, classified_services: classified.length, preventive_services: preventive.length, services_before_failure_percent: classified.length ? preventive.length / classified.length * 100 : null, prediction_samples: errors.length, mean_absolute_error_days: errors.length ? errors.reduce((sum, value) => sum + Math.abs(value), 0) / errors.length : null, mean_signed_error_days: errors.length ? errors.reduce((sum, value) => sum + value, 0) / errors.length : null, unpredicted_failures: classifiedFaults.filter(fault => fault.was_predicted === false).length, classified_failures: classifiedFaults.length, total_failures: faults.length, downtime_days: periods.reduce((sum, row) => sum + Math.max(0, Date.parse(row.ended_at || new Date().toISOString()) - Date.parse(row.started_at)) / 86_400_000, 0), open_downtimes: periods.filter(row => !row.ended_at).length, as_of: localDate(), timezone: "America/Mexico_City"};
}
function nextId(state: Workspace, key: "history" | "readings" | "faults" | "downtime"): number {
  return Math.max(0, ...Object.values(state.details).flatMap(row => (row[key] || []).map(entry => entry.id))) + 1;
}
function verifyKm(row: Detail, when: string, km: number | null): void {
  if (km == null) return;
  const points = [...row.readings.map(reading => ({date: reading.date, km: reading.odometer_km})), ...row.history.filter(history => history.odometer_km != null).map(history => ({date: history.performed_on, km: history.odometer_km as number}))];
  assert(!points.some(point => (point.date < when && point.km > km) || (point.date > when && point.km < km)), "El kilometraje contradice una lectura anterior o posterior. Corrígelo o déjalo pendiente si no lo tienes.");
}
function capture(state: Workspace, vehicleId: number, body: Body): Body {
  const row = detail(state, vehicleId);
  const performed = validDate(text(body, "performed_on"), "una fecha de servicio");
  assert(performed <= localDate() && performed >= row.vehicle.in_service_date, "El servicio debe haberse realizado entre la puesta en servicio y hoy.");
  const selected = ids(body);
  const description = text(body, "manual_description");
  assert(selected.length || description, "Selecciona al menos un servicio o escribe el trabajo realizado.");
  assert(!description || (description.length >= 3 && description.length <= 200), "Describe el trabajo con entre 3 y 200 caracteres.");
  const normalizedDescription = description.toLocaleLowerCase("es-MX").replace(/\s+/g, " ");
  assert(!description || !row.history.some(record => record.performed_on === performed && record.service_name?.trim().toLocaleLowerCase("es-MX").replace(/\s+/g, " ") === normalizedDescription), "Ese trabajo ya está registrado en la misma fecha. Revisa el historial para evitar duplicados.");
  const plan = state.plans[String(vehicleId)];
  assert(selected.every(id => plan.services.some(service => service.service_id === id)), "Selecciona un servicio disponible para esta unidad.");
  const appointment = body.appointment_id ? state.appointments.find(entry => entry.id === String(body.appointment_id) && entry.vehicle_id === vehicleId) : undefined;
  assert(!body.appointment_id || appointment, "La cita cambió. Actualiza el calendario e inténtalo de nuevo.");
  assert(!appointment || !selected.some(id => appointment.service_ids.includes(id) && row.history.some(record => record.service_id === id && record.performed_on > performed)), "Ese servicio es anterior al ciclo de la cita. Regístralo desde Registrar servicio realizado, sin vincular esta cita.");
  const km = number(body, "odometer_km");
  verifyKm(row, performed, km);
  const names = serviceNames(state);
  if (description) {selected.push(`manual-${crypto.randomUUID()}`); names[selected[selected.length - 1]] = description;}
  assert(!selected.some(id => row.history.some(record => record.service_id === id && record.performed_on === performed)), "Ya está registrado uno de estos servicios en esa fecha. Revisa el historial para evitar duplicados.");
  const captured = new Date().toISOString();
  const records: History[] = selected.map((id, index) => ({id: nextId(state, "history") + index, service_id: id, service_name: names[id] || id, performed_on: performed, captured_at: captured, odometer_km: km, notes: text(body, "notes"), cost: number(body, "cost"), maintenance_type: (text(body, "maintenance_type") || "unknown") as History["maintenance_type"], predicted_due_date: null, prediction_error_days: null}));
  row.history.push(...records);
  if (km != null) row.vehicle.current_km = Math.max(row.vehicle.current_km, km);
  const completedIds = selected.filter(id => !row.history.some(record => record.service_id === id && record.performed_on > performed));
  state.calendar = state.calendar.map(entry => entry.vehicle_id === vehicleId && entry.status !== "completed" ? {...entry, service_ids: entry.service_ids.filter(id => !completedIds.includes(id))} : entry);
  for (const entry of state.appointments) if (entry.vehicle_id === vehicleId) entry.service_ids = entry.service_ids.filter(id => !completedIds.includes(id));
  state.appointments = state.appointments.filter(entry => entry.service_ids.length > 0);
  // The public proposal records administrative activity. It does not pretend
  // to run the private Python forecasting engine in the visitor's browser.
  for (const service of plan.services) if (completedIds.includes(service.service_id)) {
    service.status = "pending_validation"; service.due_date = null; service.latest_entry_date = null;
    service.window_start = null; service.window_end = null; service.due_odometer = null; service.km_remaining = null;
    service.prediction = {optimistic: null, probable: null, pessimistic: null}; service.requires_validation = true;
    service.explanation = "Servicio capturado. La propuesta demuestra el registro; el sistema operativo recalcula el siguiente mantenimiento con el historial real.";
  }
  plan.alerts = plan.alerts.filter(alert => alert.kind !== "maintenance" || !completedIds.includes(alert.service_id || ""));
  plan.traffic_light = plan.alerts.some(alert => alert.severity === "critico") ? "red" : plan.alerts.length ? "amber" : "gray";
  state.completed.push({id: `completed-${crypto.randomUUID()}`, vehicle_id: vehicleId, plate: row.vehicle.plate, version: `${row.vehicle.make} ${row.vehicle.model}`, planned_date: performed, performed_on: performed, captured_at: captured, service_ids: selected, service_names: selected.map(id => names[id] || id), fault_ids: [], status: "completed", provisional: false, total_duration_hours: null, explanation: "Servicio realizado; fecha real conservada aunque se capture después.", notes: text(body, "notes"), appointment_id: appointment?.id, original_date: appointment?.original_date, changes: appointment ? copy(appointment.changes) : []});
  return {created: records.length, records, appointment_id: appointment?.id || null};
}

export async function proposalApi<T>(path: string, options: {method?: "POST" | "PATCH"; body?: unknown}): Promise<T> {
  const current = await load();
  const state = options.method ? copy(current) : current;
  const [route, query] = path.split("?");
  const parameters = new URLSearchParams(query);
  const body = (options.body || {}) as Body;
  const method = options.method || "GET";
  let result: unknown;
  const match = /^vehicles\/(\d+)(?:\/(.*))?$/.exec(route);
  if (method === "GET") {
    if (route === "vehicles") result = state.vehicles.map(vehicle => summary(state, vehicle));
    else if (route === "catalog") result = state.catalog;
    else if (route === "variants") result = state.variants;
    else if (route === "calendar") result = calendar(state).filter(entry => entry.planned_date >= (parameters.get("start") || "0000") && entry.planned_date <= (parameters.get("end") || "9999"));
    else if (route === "notifications") result = [];
    else if (route === "metrics") result = metrics(state, parameters.get("synthetic") || "false");
    else if (route === "alerts") result = Object.entries(state.plans).flatMap(([id, plan]) => plan.alerts.map(alert => ({...alert, vehicle_id: Number(id), plate: detail(state, Number(id)).vehicle.plate})));
    else if (match && !match[2]) result = detail(state, Number(match[1]));
    else if (match?.[2] === "plan") {result = {...state.plans[match[1]], visits: calendar(state).filter(entry => entry.vehicle_id === Number(match[1]) && entry.status !== "completed")};}
    else if (match?.[2] === "appointments") result = state.appointments.filter(entry => entry.vehicle_id === Number(match[1]));
    else throw new Error("Esta consulta no está disponible en la propuesta.");
    return copy(result) as T;
  }
  if (route === "recalculate") result = {vehicles_processed: state.vehicles.length, alerts_open: Object.values(state.plans).reduce((sum, plan) => sum + plan.alerts.length, 0)};
  else if (method === "POST" && route === "vehicles") {
    const id = Math.max(0, ...state.vehicles.map(vehicle => vehicle.id)) + 1;
    const vin = text(body, "vin").toUpperCase(), plate = text(body, "plate").toUpperCase();
    assert(/^[A-HJ-NPR-Z0-9]{17}$/.test(vin), "El número de serie (VIN) debe tener 17 caracteres válidos.");
    assert(plate.length >= 3 && plate.length <= 16, "Indica una placa de 3 a 16 caracteres.");
    assert(!state.vehicles.some(vehicle => vehicle.vin === vin || vehicle.plate === plate), "Ya existe una unidad con ese VIN o placa.");
    const variant = state.variants.variantes.find(entry => entry.id === text(body, "variant_id"));
    const make = variant ? "Mazda" : text(body, "make"), model = variant ? "Mazda3" : text(body, "model");
    assert(make && model, "Indica la marca y el modelo.");
    const vehicle: Vehicle = {id, vin, plate, make, model, model_year: Number(body.model_year), variant_id: variant?.id || null, version: variant?.version || text(body, "version"), body_style: variant?.carroceria || text(body, "body_style"), engine: variant?.motor || text(body, "engine"), transmission: text(body, "transmission"), drive: variant?.traccion || text(body, "drive"), current_km: number(body, "current_km") || 0, in_service_date: validDate(text(body, "in_service_date"), "una fecha de puesta en servicio"), usage_regime: text(body, "usage_regime") || "normal", severity_multiplier: Number(body.severity_multiplier) || 1, fuel_type: text(body, "fuel_type") || null, color: text(body, "color") || null, maintenance_catalog: variant ? "mazda3-mx.v0.1.0" : null, is_synthetic: true};
    vehicle.drivers = driverNames(body.drivers === undefined ? [] : body.drivers);
    assert(vehicle.in_service_date <= localDate(), "La puesta en servicio no puede ser futura.");
    const plan: Plan = {vehicle_id: id, generated_on: localDate(), catalog_version: "unassigned", mode: "proposal", usage: {km_per_day: 0, low_km_per_day: 0, high_km_per_day: 0, confidence: "baja", valid_intervals: 0, rejected_readings: 0, explanation: "Agrega lecturas para construir el historial de la unidad."}, services: [], visits: [], alerts: [], traffic_light: "gray", warnings: ["Unidad registrada en la propuesta. Su programa técnico se configura al incorporar su catálogo de mantenimiento."]};
    state.details[String(id)] = {vehicle, readings: [], history: [], faults: [], downtime: []}; state.plans[String(id)] = plan;
    state.vehicles.push({...vehicle, traffic_light: "gray", next_visit_date: null, open_alerts: 0, usage_km_per_day: null}); result = vehicle;
  } else if (match) {
    const vehicleId = Number(match[1]), action = match[2] || "";
    const row = detail(state, vehicleId);
    if (action === "services/batch" && method === "POST") result = capture(state, vehicleId, body);
    else if (action === "services" && method === "POST") result = (capture(state, vehicleId, {...body, service_ids: [body.service_id]}).records as History[])[0];
    else if ((action === "appointments" && method === "POST") || (action.startsWith("appointments/") && method === "PATCH")) {
      const scheduled = validDate(text(body, "scheduled_date"), "una fecha de agenda");
      assert(scheduled >= row.vehicle.in_service_date, "La fecha no puede ser anterior a la puesta en servicio.");
      let appointment = state.appointments.find(entry => entry.id === action.slice("appointments/".length) && entry.vehicle_id === vehicleId);
      if (method === "PATCH") assert(appointment, "No se encontró la cita. Actualiza el calendario.");
      if (!appointment) {
        const selected = ids(body);
        assert(selected.length, "Selecciona al menos un servicio para la agenda.");
        assert(selected.every(id => state.plans[String(vehicleId)].services.some(service => service.service_id === id)), "Uno de los servicios no corresponde a esta unidad.");
        assert(!state.appointments.some(entry => entry.vehicle_id === vehicleId && entry.service_ids.some(id => selected.includes(id))), "Estos servicios ya tienen una fecha de agenda. Modifica esa cita.");
        const original = state.calendar.find(entry => entry.id === text(body, "original_visit_id") && entry.vehicle_id === vehicleId);
        appointment = {id: crypto.randomUUID(), vehicle_id: vehicleId, scheduled_date: scheduled, original_date: original?.planned_date || scheduled, service_ids: selected, notes: text(body, "notes"), captured_at: new Date().toISOString(), changes: [{previous_date: original?.planned_date || scheduled, scheduled_date: scheduled, changed_at: new Date().toISOString(), notes: text(body, "notes")}]};
        state.appointments.push(appointment);
      } else {
        appointment.changes.push({previous_date: appointment.scheduled_date, scheduled_date: scheduled, changed_at: new Date().toISOString(), notes: text(body, "notes")});
        appointment.scheduled_date = scheduled; appointment.notes = text(body, "notes");
      }
      result = {...appointment, ...appointmentEntry(state, appointment), id: appointment.id};
    } else if (action === "readings" && method === "POST") {
      const km = number(body, "odometer_km"); assert(km != null, "Indica el kilometraje.");
      const recordedAt = text(body, "recorded_at") || `${text(body, "date")}T18:00:00Z`;
      assert(Number.isFinite(Date.parse(recordedAt)) && Date.parse(recordedAt) <= Date.now(), "Indica la fecha real de la lectura, sin fechas futuras.");
      const when = localDate(new Date(recordedAt)); verifyKm(row, when, km);
      assert(!row.readings.some(reading => reading.recorded_at === recordedAt), "Esa lectura ya está registrada.");
      const reading = {id: nextId(state, "readings"), vehicle_id: vehicleId, date: when, recorded_at: recordedAt, odometer_km: km, source: (text(body, "source") || "manual") as "manual" | "gps" | "obd"};
      row.readings.push(reading); row.vehicle.current_km = Math.max(row.vehicle.current_km, km); result = reading;
    } else if (action === "faults" && method === "POST") {
      const description = text(body, "description"); assert(description.length >= 5, "Describe la falla reportada.");
      const severity = (text(body, "severity") || "importante") as "critico" | "importante" | "menor";
      const fault = {id: nextId(state, "faults"), description, severity, status: "open", reported_on: localDate(), dtc: text(body, "dtc") || null, safe_to_defer: false, deadline: null, resolution_notes: null};
      row.faults.push(fault);
      const alert: Alert = {key: `proposal-fault-${fault.id}`, vehicle_id: vehicleId, plate: row.vehicle.plate, service_id: null, fault_id: fault.id, severity, message: description, deadline: null, days_remaining: null, threshold_days: null, status: "open", kind: "fault"};
      state.plans[String(vehicleId)].alerts.push(alert); state.plans[String(vehicleId)].traffic_light = severity === "critico" ? "red" : "amber"; result = fault;
    } else if (action === "downtime" && method === "POST") {
      const started = text(body, "started_at"), ended = text(body, "ended_at") || null;
      assert(Number.isFinite(Date.parse(started)) && (!ended || Date.parse(ended) > Date.parse(started)), "Revisa las fechas del periodo fuera de servicio.");
      const entry = {id: nextId(state, "downtime"), vehicle_id: vehicleId, started_at: started, ended_at: ended, notes: text(body, "notes")};
      (row.downtime ||= []).push(entry); result = entry;
    } else if (action.startsWith("downtime/") && method === "PATCH") {
      const entry = row.downtime?.find(period => period.id === Number(action.slice(9))); assert(entry && !entry.ended_at, "No se encontró un periodo abierto.");
      const ended = text(body, "ended_at"); assert(Date.parse(ended) > Date.parse(entry.started_at), "El regreso debe ser posterior al inicio.");
      entry.ended_at = ended; entry.notes = text(body, "notes") || entry.notes; result = entry;
    } else if (!action && method === "PATCH") {
      if (Object.prototype.hasOwnProperty.call(body, "drivers")) row.vehicle.drivers = driverNames(body.drivers);
      if (body.usage_regime != null) row.vehicle.usage_regime = text(body, "usage_regime");
      if (body.severity_multiplier != null) {const factor = Number(body.severity_multiplier); assert(factor >= 0.1 && factor <= 1, "El factor debe estar entre 0.1 y 1."); row.vehicle.severity_multiplier = factor;}
      result = row.vehicle;
    } else throw new Error("Esta operación no está disponible en la propuesta.");
  } else if (/^faults\/\d+\/resolve$/.test(route) && method === "PATCH") {
    const faultId = Number(route.split("/")[1]); const row = Object.values(state.details).find(entry => entry.faults.some(fault => fault.id === faultId));
    const fault = row?.faults.find(entry => entry.id === faultId); assert(row && fault && fault.status !== "resolved", "No se encontró la falla abierta.");
    fault.status = "resolved"; fault.resolution_notes = text(body, "resolution_notes");
    const plan = state.plans[String(row.vehicle.id)]; plan.alerts = plan.alerts.filter(alert => alert.fault_id !== faultId);
    plan.traffic_light = plan.alerts.some(alert => alert.severity === "critico") ? "red" : plan.alerts.length ? "amber" : "gray"; result = fault;
  } else throw new Error("Esta operación no está disponible en la propuesta.");
  save(state);
  return copy(result) as T;
}
