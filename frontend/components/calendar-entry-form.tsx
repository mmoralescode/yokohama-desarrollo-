"use client";

import {FormEvent, useEffect, useRef, useState} from "react";
import {api, dateLabel, localDate, useResource} from "@/lib/api";
import type {Plan, VehicleSummary, Visit} from "@/lib/types";
import {ErrorBox, Icon, Loading} from "./ui";

export type CalendarAction = {mode: "reschedule"; visit: Visit} | {mode: "complete"; visit?: Visit; vehicleId?: number};
type Saved = (date: string, message: string) => void;

function ServiceCapture({vehicle, visit, onSaved, onBusy}: {vehicle: VehicleSummary; visit?: Visit; onSaved: Saved; onBusy: (busy: boolean) => void}) {
  const plan = useResource<Plan>(`vehicles/${vehicle.id}/plan`);
  const [selected, setSelected] = useState<string[]>(visit?.service_ids || []);
  const [performedOn, setPerformedOn] = useState(localDate);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const today = localDate();
  const applicable = plan.data?.services || [];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current) return;
    const data = new FormData(event.currentTarget);
    const manualDescription = String(data.get("manual_description") || "").trim();
    const serviceIds = selected.filter(id => applicable.some(service => service.service_id === id));
    if (!serviceIds.length && !manualDescription) {setError("Selecciona al menos un servicio o describe el trabajo realizado."); return;}
    saving.current = true;
    setBusy(true); onBusy(true); setError(null);
    try {
      const rawKm = String(data.get("km") || "").trim();
      await api(`vehicles/${vehicle.id}/services/batch`, {method: "POST", body: {
        service_ids: serviceIds,
        performed_on: performedOn,
        odometer_km: rawKm ? Number(rawKm) : null,
        notes: String(data.get("notes") || "").trim(),
        ...(visit?.appointment_id ? {appointment_id: visit.appointment_id} : {}),
        ...(manualDescription ? {manual_description: manualDescription} : {})
      }});
      onSaved(performedOn, `Servicio de ${vehicle.plate} registrado como realizado el ${dateLabel(performedOn)}. El historial conserva la fecha real del trabajo y la fecha de captura.`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "No se pudo guardar el servicio. Revisa los datos e intenta de nuevo.");
    } finally {saving.current = false; setBusy(false); onBusy(false);}
  }

  return <form onSubmit={submit} className="mutation-form calendar-capture-form">
    <fieldset disabled={busy}>
      <div className="form-grid">
        <label>Fecha real del servicio<input name="performed_on" type="date" value={performedOn} onChange={event => {setPerformedOn(event.target.value); setError(null);}} min={vehicle.in_service_date} max={today} required/>
          <span className="field-help">El día en que trabajaron en la unidad, aunque lo registres después.</span></label>
        <label>Odómetro en ese servicio (km, opcional)<input name="km" type="number" min={0} step="0.1" placeholder="Sin dato, dejar vacío"/>
          <span className="field-help">Usa el kilometraje del comprobante. Puedes guardarlo sin este dato.</span></label>
      </div>
      {performedOn && performedOn < today && <p className="capture-date-note"><Icon name="calendar" size={17}/>Se registrará en el calendario del {dateLabel(performedOn)}, aunque lo estés capturando hoy.</p>}
      {plan.loading && !plan.data ? <Loading label="Consultando servicios de la unidad…"/> : plan.error ? <ErrorBox message={plan.error} retry={plan.refresh}/> : <>
        {applicable.length > 0 && <fieldset className="service-checklist"><legend>¿Qué servicios se realizaron?</legend><p className="field-help">Marca solo los trabajos hechos. Los demás seguirán pendientes.</p><div>{applicable.map(service => <label className="check-label" key={service.service_id}><input type="checkbox" value={service.service_id} checked={selected.includes(service.service_id)} onChange={event => {setSelected(current => event.target.checked ? [...current, service.service_id] : current.filter(id => id !== service.service_id)); setError(null);}}/>{service.name}</label>)}</div></fieldset>}
        <label>{applicable.length ? "Otro trabajo realizado (opcional)" : "Trabajo realizado"}<input name="manual_description" minLength={3} maxLength={200} required={!applicable.length} placeholder="Ej. Cambio de batería o reparación de suspensión"/>
          {!applicable.length && <span className="field-help">Describe el trabajo para conservarlo en el historial de esta unidad.</span>}</label>
      </>}
      <label>Notas o referencia del comprobante (opcional)<textarea name="notes" rows={2} maxLength={2000} placeholder="Taller, folio, factura o algún detalle que ayude a identificar el servicio…"/></label>
      {!!visit?.fault_ids?.length && <p className="field-help">Registrar el trabajo no cierra los reportes de falla. Confirma su resolución en el detalle de la unidad.</p>}
      <button type="submit" className="button primary" disabled={plan.loading || !!plan.error}>{busy ? "Guardando…" : "Guardar servicio realizado"}<Icon name="check" size={17}/></button>
    </fieldset>
    {error && <ErrorBox message={error}/>}
  </form>;
}

function RescheduleForm({visit, vehicle, onSaved, onBusy}: {visit: Visit; vehicle?: VehicleSummary; onSaved: Saved; onBusy: (busy: boolean) => void}) {
  const [date, setDate] = useState(visit.planned_date);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current) return;
    if (date === visit.planned_date) {setError("Selecciona una fecha diferente para mover esta visita."); return;}
    saving.current = true;
    setBusy(true); onBusy(true); setError(null);
    const data = new FormData(event.currentTarget);
    try {
      const body = {scheduled_date: date, notes: String(data.get("notes") || "").trim()};
      await api(`vehicles/${visit.vehicle_id}/appointments${visit.appointment_id ? `/${visit.appointment_id}` : ""}`, {
        method: visit.appointment_id ? "PATCH" : "POST",
        body: visit.appointment_id ? body : {...body, service_ids: visit.service_ids, original_visit_id: visit.id}
      });
      onSaved(date, `La visita de ${visit.plate} cambió del ${dateLabel(visit.planned_date)} al ${dateLabel(date)}. Ya puedes verla en el nuevo día.`);
    } catch (failure) {setError(failure instanceof Error ? failure.message : "No se pudo cambiar la fecha. Intenta de nuevo.");}
    finally {saving.current = false; setBusy(false); onBusy(false);}
  }
  return <form onSubmit={submit} className="mutation-form"><fieldset disabled={busy}>
    <p className="muted small">Fecha actual: <strong>{dateLabel(visit.planned_date)}</strong></p>
    <div className="form-grid"><label>Nueva fecha de la visita<input name="scheduled_date" type="date" value={date} onChange={event => {setDate(event.target.value); setError(null);}} min={vehicle?.in_service_date} required autoFocus/></label></div>
    {date < localDate() && <p className="capture-date-note">Esta fecha ya pasó. Si ya hicieron el trabajo, utiliza «Registrar realizado» para guardarlo en el historial.</p>}
    <label>Motivo del cambio (opcional)<textarea name="notes" rows={2} maxLength={2000} placeholder="Ej. La unidad está en ruta; taller confirmó disponibilidad…" defaultValue={visit.notes || ""}/></label>
    <p className="field-help">Se conserva la fecha anterior. Los avisos de mantenimiento y de seguridad siguen vigentes.</p>
    <button type="submit" className="button primary">{busy ? "Guardando…" : "Guardar nueva fecha"}<Icon name="calendar" size={17}/></button>
  </fieldset>{error && <ErrorBox message={error}/>}</form>;
}

export default function CalendarEntryForm({action, vehicles, onClose, onSaved}: {action: CalendarAction; vehicles: VehicleSummary[]; onClose: () => void; onSaved: Saved}) {
  const [vehicleId, setVehicleId] = useState(action.visit?.vehicle_id ? String(action.visit.vehicle_id) : action.mode === "complete" && action.vehicleId ? String(action.vehicleId) : "");
  const [busy, setBusy] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const vehicle = vehicles.find(item => String(item.id) === vehicleId);
  useEffect(() => {panel.current?.scrollIntoView({behavior: "smooth", block: "start"});}, []);
  return <section ref={panel} id="calendar-entry-form" className="panel calendar-entry-editor" aria-labelledby="calendar-entry-title">
    <div className="panel-header"><div><p className="eyebrow">REGISTRO ADMINISTRATIVO</p><h2 id="calendar-entry-title">{action.mode === "reschedule" ? `Cambiar fecha · ${action.visit.plate}` : "Registrar servicio realizado"}</h2></div><button type="button" className="button secondary small-button" onClick={onClose} disabled={busy}>Cancelar</button></div>
    <div className="panel-body">{action.mode === "complete" ? <>
      <p className="muted form-intro">No importa si lo capturas días después: selecciona la unidad, indica la fecha en que se hizo el trabajo y guarda los servicios realizados.</p>
      <label className="capture-unit-picker">Unidad<select aria-label="Unidad del servicio" value={vehicleId} onChange={event => setVehicleId(event.target.value)} disabled={busy || !!action.visit} autoFocus={!action.visit}><option value="">Selecciona una placa</option>{[...vehicles].sort((a, b) => a.plate.localeCompare(b.plate, "es-MX")).map(item => <option key={item.id} value={item.id}>{item.plate} · {item.make} {item.model}</option>)}</select></label>
      {vehicle ? <ServiceCapture key={vehicle.id} vehicle={vehicle} visit={action.visit} onSaved={onSaved} onBusy={setBusy}/> : <p className="muted small">Selecciona una unidad para registrar su servicio.</p>}
    </> : <RescheduleForm visit={action.visit} vehicle={vehicle} onSaved={onSaved} onBusy={setBusy}/>}</div>
  </section>;
}
