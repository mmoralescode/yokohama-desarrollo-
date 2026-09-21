"use client";
import {useState} from "react";
import {api, dateLabel, dateTimeLabel, localDate, localDateTime, mexicoDateTimeToISO, numberLabel} from "@/lib/api";
import type {Downtime, Fault, MaintenanceType, Reading, ServiceHistory, ServicePlan, Vehicle} from "@/lib/types";
import {Empty, MutationForm} from "./ui";

export const maintenanceLabels: Record<MaintenanceType, string> = {unknown: "Sin clasificar", preventive: "Preventivo (antes de falla)", corrective: "Correctivo (por falla)"};

export function UsageConditions({id, vehicle, onDone}: {id: string; vehicle: Vehicle; onDone: () => void}) {
  return <details className="panel"><summary className="panel-header"><h2>Condiciones de uso</h2><span className="muted small">Ajustar intervalos</span></summary><div className="panel-body"><MutationForm title="Ajuste por unidad" description="Un factor menor acorta el intervalo por km y tiempo. No sustituye la validación técnica ni amplía los límites del fabricante." submitLabel="Guardar condiciones" onDone={onDone} onSave={async data => {
    await api(`vehicles/${id}`, {method: "PATCH", body: {severity_multiplier: Number(data.get("severity_multiplier")), usage_regime: data.get("usage_regime")}});
    return "Condiciones guardadas. Plan recalculado.";
  }}><div className="form-grid"><label>Régimen de uso<select name="usage_regime" defaultValue={vehicle.usage_regime}><option value="normal">Normal</option><option value="severe">Severo (validar criterio Mazda)</option></select></label><label>Factor de intervalo<input name="severity_multiplier" type="number" min={0.1} max={1} step={0.01} defaultValue={vehicle.severity_multiplier ?? 1} required/><span className="field-help">1 = intervalo original; 0.8 = 80 % del intervalo.</span></label></div></MutationForm></div></details>;
}

export function ReadingForm({id, vehicle, onDone}: {id: string; vehicle: Vehicle; onDone: () => void}) {
  return <MutationForm title="Lectura de odómetro" description="Fecha y hora de Ciudad de México. Se rechazan retrocesos, saltos anómalos y lecturas futuras. GPS/OBD identifica el origen; no activa una conexión automática." onDone={onDone} onSave={async data => {
    await api(`vehicles/${id}/readings`, {method: "POST", body: {recorded_at: mexicoDateTimeToISO(String(data.get("recorded_at"))), odometer_km: Number(data.get("km")), source: data.get("source")}});
    return "Lectura guardada. Proyección recalculada.";
  }}><div className="form-grid"><label>Fecha y hora de lectura (CDMX)<input name="recorded_at" type="datetime-local" required min={`${vehicle.in_service_date}T00:00`} max={localDateTime()} defaultValue={localDateTime()}/></label><label>Odómetro (km)<input name="km" type="number" min={0} step="0.1" required placeholder={String(vehicle.current_km)}/></label><label>Fuente de lectura<select name="source" defaultValue="manual"><option value="manual">Manual</option><option value="gps">GPS (captura del dato)</option><option value="obd">OBD (captura del dato)</option></select></label></div></MutationForm>;
}

export function ServiceForm({id, vehicle, services, faults, onDone}: {id: string; vehicle: Vehicle; services: ServicePlan[]; faults: Fault[]; onDone: () => void}) {
  const [kind, setKind] = useState<MaintenanceType>("unknown");
  return <MutationForm title="Servicio realizado" description="Registra trabajo efectivamente realizado. Reinicia solo el componente correspondiente; conserva la predicción anterior para comparar fechas." onDone={onDone} onSave={async data => {
    const rawCost = String(data.get("cost") || "").trim();
    await api(`vehicles/${id}/services`, {method: "POST", body: {service_id: data.get("service_id"), performed_on: data.get("performed_on"), odometer_km: Number(data.get("km")), notes: data.get("notes"), cost: rawCost === "" ? null : Number(rawCost), maintenance_type: kind, fault_id: data.get("fault_id") ? Number(data.get("fault_id")) : null}});
    return "Servicio registrado. Plan y métricas actualizados.";
  }}><label>Servicio del catálogo<select name="service_id" required defaultValue=""><option value="">Selecciona el servicio</option>{services.map(service => <option key={service.service_id} value={service.service_id}>{service.name}</option>)}</select></label><div className="form-grid"><label>Fecha realizada<input name="performed_on" type="date" required max={localDate()} min={vehicle.in_service_date} defaultValue={localDate()}/></label><label>Odómetro al realizarlo (km)<input name="km" type="number" min={0} step="0.1" required/></label><label>Costo (MXN, opcional)<input name="cost" type="number" min={0} step="0.01" placeholder="Sin registrar"/></label><label>Tipo de mantenimiento<select name="maintenance_type" value={kind} onChange={event => setKind(event.target.value as MaintenanceType)}>{Object.entries(maintenanceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
    {kind === "corrective" && <label>Falla atendida (opcional)<select name="fault_id" defaultValue=""><option value="">Sin asociación</option>{faults.map(fault => <option key={fault.id} value={fault.id}>#{fault.id} · {fault.description}</option>)}</select><span className="field-help">Vincular no cierra el reporte: confirma su resolución por separado.</span></label>}
    <label>Notas del trabajo<textarea name="notes" rows={3} maxLength={2000} placeholder="Comprobante, revisión o trabajo efectuado…"/></label></MutationForm>;
}

export function ReadingHistory({readings}: {readings: Reading[]}) {
  return readings.length ? <div className="history-scroll"><table><thead><tr><th>Fecha / hora CDMX</th><th>Odómetro</th><th>Fuente</th></tr></thead><tbody>{[...readings].sort((a, b) => (b.recorded_at || b.date).localeCompare(a.recorded_at || a.date)).map(reading => <tr key={reading.id}><td>{reading.recorded_at ? dateTimeLabel(reading.recorded_at) : dateLabel(reading.date)}</td><td className="numeric">{numberLabel(reading.odometer_km)} km</td><td>{({manual: "Manual", gps: "GPS", obd: "OBD"})[reading.source || "manual"]}</td></tr>)}</tbody></table></div> : <Empty title="Sin lecturas registradas"/>;
}

export function ServiceHistoryTable({history, names}: {history: ServiceHistory[]; names: Record<string, string>}) {
  return history.length ? <div className="history-scroll"><table><thead><tr><th>Servicio</th><th>Fecha / odómetro</th><th>Costo / pronóstico</th></tr></thead><tbody>{[...history].sort((a, b) => b.performed_on.localeCompare(a.performed_on)).map(service => <tr key={service.id}><td><strong>{names[service.service_id] || service.service_id}</strong><span className="cell-sub">{maintenanceLabels[service.maintenance_type || "unknown"]}</span><span className="cell-sub">{service.notes}</span>{service.fault_id && <span className="cell-sub">Falla #{service.fault_id}</span>}</td><td>{dateLabel(service.performed_on)}<span className="cell-sub">{numberLabel(service.odometer_km)} km</span></td><td>{service.cost == null ? "Sin costo registrado" : new Intl.NumberFormat("es-MX", {style: "currency", currency: "MXN"}).format(service.cost)}{service.predicted_due_date && <span className="cell-sub">Previsto: {dateLabel(service.predicted_due_date)}</span>}<span className="cell-sub">{service.prediction_error_days == null ? "Sin predicción previa comparable" : service.prediction_error_days === 0 ? "Realizado en la fecha prevista" : `${numberLabel(Math.abs(service.prediction_error_days))} días ${service.prediction_error_days < 0 ? "antes" : "después"} de lo previsto`}</span></td></tr>)}</tbody></table></div> : <Empty title="Sin historial de servicios">No se presume que los componentes se atendieron al kilometraje cero.</Empty>;
}

function CloseDowntime({id, entry, onDone}: {id: string; entry: Downtime; onDone: () => void}) {
  const [closing, setClosing] = useState(false);
  return <><button className="text-button" onClick={() => setClosing(value => !value)} aria-expanded={closing}>{closing ? "Cancelar" : "Registrar regreso a operación"}</button>{closing && <MutationForm title="Fin del periodo fuera de servicio" submitLabel="Cerrar periodo" onDone={onDone} onSave={async data => {
    await api(`vehicles/${id}/downtime/${entry.id}`, {method: "PATCH", body: {ended_at: mexicoDateTimeToISO(String(data.get("ended_at"))), notes: data.get("notes")}});
    return "Periodo cerrado. No modifica el estado de las fallas: confirma su resolución cuando corresponda.";
  }}><label>Regreso a operación (CDMX)<input name="ended_at" type="datetime-local" required min={localDateTime(new Date(entry.started_at))} max={localDateTime()} defaultValue={localDateTime()}/></label><label>Notas<textarea name="notes" maxLength={2000} rows={2} defaultValue={entry.notes}/></label></MutationForm>}</>;
}

export function DowntimePanel({id, vehicle, entries, onDone}: {id: string; vehicle: Vehicle; entries: Downtime[]; onDone: () => void}) {
  const [adding, setAdding] = useState(false);
  return <section className="panel"><div className="panel-header"><div><p className="eyebrow">DISPONIBILIDAD REAL</p><h2>Periodos fuera de servicio</h2></div><button className="button secondary small-button" onClick={() => setAdding(value => !value)} aria-expanded={adding}>{adding ? "Cerrar registro" : "Registrar periodo"}</button></div><div className="panel-body"><p className="muted small">Registra el tiempo real sin operar, no la duración estimada de una visita. Horas de Ciudad de México. Un periodo abierto acumula tiempo hasta el corte de las métricas.</p>
    {adding && <MutationForm title="Unidad fuera de servicio" onDone={onDone} onSave={async data => {
      await api(`vehicles/${id}/downtime`, {method: "POST", body: {started_at: mexicoDateTimeToISO(String(data.get("started_at"))), ended_at: data.get("ended_at") ? mexicoDateTimeToISO(String(data.get("ended_at"))) : null, notes: data.get("notes")}});
      return "Periodo registrado. Métricas actualizadas.";
    }}><div className="form-grid"><label>Inicio (CDMX)<input type="datetime-local" name="started_at" required min={`${vehicle.in_service_date}T00:00`} max={localDateTime()} defaultValue={localDateTime()}/></label><label>Regreso (opcional, CDMX)<input type="datetime-local" name="ended_at" min={`${vehicle.in_service_date}T00:00`} max={localDateTime()}/></label></div><label>Motivo / notas<textarea name="notes" maxLength={2000} rows={2}/></label></MutationForm>}
    {entries.length ? [...entries].sort((a, b) => b.started_at.localeCompare(a.started_at)).map(entry => <article className="service-row" key={entry.id}><div className="inline gap wrap"><strong>{dateTimeLabel(entry.started_at)}</strong><span>→ {entry.ended_at ? dateTimeLabel(entry.ended_at) : "Sigue fuera de servicio"}</span></div><p className="muted small">{entry.notes || "Sin notas"}</p>{!entry.ended_at && <CloseDowntime id={id} entry={entry} onDone={onDone}/>}</article>) : <Empty title="Sin periodos registrados">Cero días registrados no garantiza que no haya existido indisponibilidad.</Empty>}
  </div></section>;
}
