"use client";
import Link from "next/link";
import {useEffect, useState} from "react";
import {dateLabel, dateTimeLabel, localDate, numberLabel, useResource} from "@/lib/api";
import type {VehicleSummary, Visit} from "@/lib/types";
import {Empty, ErrorBox, Icon, Loading, PageHeader, StatusBadge} from "@/components/ui";
import CalendarEntryForm, {type CalendarAction} from "@/components/calendar-entry-form";
import {matchesDriverNames, normalizeSearch} from "@/lib/drivers";
import {DriverNames} from "@/components/vehicle-drivers";
import VehicleSearchFields from "@/components/vehicle-search-fields";

export default function CalendarPage() {
  const [month, setMonth] = useState(() => localDate().slice(0, 7));
  const [action, setAction] = useState<CalendarAction | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [driverSearch, setDriverSearch] = useState("");
  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    const requestedMonth = parameters.get("mes");
    if (requestedMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth)) setMonth(requestedMonth);
    const plate = parameters.get("placa");
    if (plate) setSearch(plate);
    const unit = parameters.get("unidad");
    if (unit && /^[1-9]\d*$/.test(unit)) setAction({mode: "complete", vehicleId: Number(unit)});
    else if (parameters.get("registro") === "1") setAction({mode: "complete"});
  }, []);
  const safeMonth = /^\d{4}-\d{2}$/.test(month) ? month : localDate().slice(0, 7);
  const [year, monthNumber] = safeMonth.split("-").map(Number);
  const start = `${safeMonth}-01`;
  const end = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
  const resource = useResource<Visit[]>(`calendar?start=${start}&end=${end}`);
  const fleet = useResource<VehicleSummary[]>("vehicles");
  const catalog = useResource<{servicios: {id: string; servicio: string}[]}>("catalog");
  const names = Object.fromEntries((catalog.data?.servicios || []).map(service => [service.id, service.servicio]));
  const allVisits = resource.data || [];
  const driversByVehicle = new Map((fleet.data || []).map(vehicle => [vehicle.id, vehicle.drivers || []]));
  const visitDrivers = (visit: Visit) => driversByVehicle.get(visit.vehicle_id || 0) ?? visit.drivers ?? [];
  const visits = allVisits.filter(visit => (filter === "all" || (filter === "completed" ? visit.status === "completed" : visit.status !== "completed")) && normalizeSearch(`${visit.plate || ""} ${visit.version || ""}`).includes(normalizeSearch(search)) && matchesDriverNames(visitDrivers(visit), driverSearch));
  const groups = visits.reduce<Record<string, Visit[]>>((result, visit) => { (result[visit.performed_on || visit.planned_date] ||= []).push(visit); return result; }, {});
  const completed = allVisits.filter(visit => visit.status === "completed").length;
  const monthLabel = new Intl.DateTimeFormat("es-MX", {timeZone: "UTC", month: "long", year: "numeric"}).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
  const firstWeekday = (new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay() + 6) % 7;
  const totalDays = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const today = localDate();
  function moveMonth(delta: number) {setMonth(new Date(Date.UTC(year, monthNumber - 1 + delta, 1)).toISOString().slice(0, 7));}
  function begin(next: CalendarAction) {setNotice(null); setAction(next);}
  function saved(date: string, message: string) {setAction(null); setNotice(message); setMonth(date.slice(0, 7)); setFilter("all"); setSearch(""); setDriverSearch(""); resource.refresh(); fleet.refresh();}
  return <>
    <PageHeader eyebrow="COORDINACIÓN DE TALLER" title="Una agenda, menos paradas." description="Organiza próximas visitas, cambia sus fechas y registra servicios que ya se hicieron, aunque los captures días después." action={<div className="inline gap wrap calendar-heading-actions"><button className="button primary" onClick={() => begin({mode: "complete"})} disabled={!!action}><Icon name="check" size={17}/>Registrar servicio realizado</button><button className="button secondary" onClick={() => {resource.refresh(); fleet.refresh();}} disabled={resource.loading || !!action}><Icon name="refresh" size={17}/>Actualizar</button></div>}/>
    {notice && <div className="message success" role="status"><Icon name="check"/><div><strong>Guardado</strong><p>{notice}</p></div></div>}
    {resource.error && <ErrorBox message={resource.error} retry={resource.refresh}/>}
    {fleet.error && <ErrorBox message={fleet.error} retry={fleet.refresh}/>}
    {action && (fleet.loading && !fleet.data ? <Loading label="Cargando unidades…"/> : <CalendarEntryForm key={`${action.mode}-${action.visit?.id || "new"}`} action={action} vehicles={fleet.data || []} onClose={() => setAction(null)} onSaved={saved}/>)}
    <div className="calendar-layout"><section className="panel calendar-panel"><div className="panel-header"><h2 className="capitalize">{monthLabel}</h2><div className="calendar-controls"><button className="icon-link" onClick={() => moveMonth(-1)} aria-label="Mes anterior">←</button><label><span className="sr-only">Mes de visitas</span><input type="month" value={month} onChange={e => setMonth(e.target.value)}/></label><button className="icon-link" onClick={() => moveMonth(1)} aria-label="Mes siguiente">→</button></div></div>
      <div className="calendar-grid" aria-label={`Agenda de ${monthLabel}`}>{["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map(day => <div key={day} className="calendar-weekday">{day}</div>)}{Array.from({length: firstWeekday}, (_, index) => <div key={`blank-${index}`} className="calendar-day blank"/>)}{Array.from({length: totalDays}, (_, index) => {
        const date = `${safeMonth}-${String(index + 1).padStart(2, "0")}`;
        const dayVisits = groups[date] || [];
        return <div key={date} className={`calendar-day ${today === date ? "today" : ""} ${dayVisits.length ? "has-visits" : ""}`}><span className="day-number">{index + 1}{date === today && <span className="sr-only">, hoy</span>}</span>{dayVisits.length > 0 && <a href={`#dia-${date}`} className={`day-visits ${dayVisits.every(visit => visit.status === "completed") ? "day-completed" : ""}`} aria-label={`${dateLabel(date)}: ${dayVisits.length} registros`}><span className="desktop-label">{dayVisits.length} {dayVisits.length === 1 ? "registro" : "registros"}</span><span className="mobile-label">{dayVisits.length}</span></a>}</div>;
      })}</div><p className="section-note">Las propuestas son sugerencias; las fechas programadas reflejan cambios de la empresa. Los servicios realizados aparecen en el día real del trabajo.</p></section>
      <aside className="calendar-summary"><p className="eyebrow">ESTE MES</p><strong>{resource.data ? allVisits.length - completed : "—"}</strong><h2>visitas por atender</h2><p>{completed} {completed === 1 ? "servicio realizado" : "registros realizados"} · {new Set(allVisits.map(visit => visit.vehicle_id)).size} unidades.</p><div className="summary-divider"/><Icon name="wrench" size={26}/><h3>Captura a tu ritmo</h3><p>Si el trabajo ya se hizo, indica su fecha real. Puedes guardar sin kilometraje y añadir una referencia del comprobante.</p><p className="small">Las fallas críticas requieren atención inmediata, aunque cambies una fecha.</p><Link href="/alertas" className="button secondary">Revisar alertas<Icon name="arrow" size={17}/></Link></aside>
    </div>
    <section className="panel"><div className="panel-header"><div><p className="eyebrow">DETALLE DE LA AGENDA</p><h2>Visitas y servicios realizados</h2></div><span className="badge neutral">{visits.length} registros</span></div>
      <div className="table-toolbar"><VehicleSearchFields plate={search} driver={driverSearch} onPlateChange={setSearch} onDriverChange={setDriverSearch}/><label><span className="sr-only">Filtrar agenda</span><select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">Todos los registros</option><option value="pending">Por atender</option><option value="completed">Realizados</option></select></label></div>
      {resource.loading && !resource.data ? <Loading/> : !visits.length ? <Empty title="Sin registros en este periodo">Consulta otro mes o registra un servicio realizado. Los pendientes sin fecha se pueden consultar en la flotilla.</Empty> : <div className="panel-body">{Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)).map(([date, entries]) => <div id={`dia-${date}`} key={date} className="agenda-day"><h3>{dateLabel(date)}</h3>{entries.map(visit => {
        const done = visit.status === "completed";
        const rescheduled = !done && !!visit.original_date && visit.original_date !== visit.planned_date;
        return <article key={`${visit.vehicle_id}-${visit.id}`} className={`agenda-entry ${done ? "agenda-completed" : ""}`}><div><Link className="plate-link" href={`/vehiculos/${visit.vehicle_id}`}>{visit.plate}</Link><span className="cell-sub">{visit.version}</span><DriverNames drivers={visitDrivers(visit)}/></div><div><strong>{done ? "Servicio realizado" : visit.fault_ids?.length ? `Atención de ${visit.fault_ids.length} ${visit.fault_ids.length === 1 ? "falla" : "fallas"}${visit.service_ids.length ? ` y ${visit.service_ids.length} servicios` : ""}` : `${visit.service_ids.length} ${visit.service_ids.length === 1 ? "servicio" : "servicios agrupados"}`}</strong><ul className="compact-list">{visit.service_ids.map((service, index) => <li key={service}>{visit.service_names?.[index] || names[service] || service}</li>)}{visit.fault_ids?.map(fault => <li key={`fault-${fault}`}>Reporte de falla #{fault}</li>)}</ul><p className="muted small">{visit.explanation}</p>{visit.notes && <p className="small">{visit.notes}</p>}
          {done && <p className="cell-sub">Realizado: {dateLabel(visit.performed_on || visit.planned_date)}{visit.captured_at && <> · Capturado: {dateTimeLabel(visit.captured_at)}</>}</p>}
          {rescheduled && <p className="cell-sub">Fecha inicial: {dateLabel(visit.original_date)} · Nueva fecha: {dateLabel(visit.planned_date)}</p>}
          {!!visit.changes?.length && <details className="calendar-date-history"><summary>Ver cambios de fecha ({visit.changes.length})</summary><ul>{visit.changes.map((change, index) => <li key={`${change.changed_at}-${index}`}>{dateLabel(change.previous_date)} → {dateLabel(change.scheduled_date)}{change.notes ? ` · ${change.notes}` : ""}</li>)}</ul></details>}
          {visit.status === "immediate" && <p className="critical-text">Atender de inmediato; ante falla crítica, detener operación y coordinar traslado seguro.</p>}
        </div><div className="agenda-entry-actions"><StatusBadge status={rescheduled ? "rescheduled" : visit.status}/>{!done && <><span className="cell-sub">{visit.provisional ? "Propuesta por confirmar" : visit.appointment_id ? "Fecha registrada" : "Por confirmar"}</span><span className="cell-sub">{visit.total_duration_hours == null ? "Duración por validar" : `${numberLabel(visit.total_duration_hours, 1)} h estimadas`}</span>{visit.service_ids.length > 0 ? <><button type="button" className="button secondary small-button" onClick={() => begin({mode: "reschedule", visit})} disabled={!!action}><Icon name="calendar" size={15}/>Cambiar fecha</button><button type="button" className="button primary small-button" onClick={() => begin({mode: "complete", visit})} disabled={!!action}><Icon name="check" size={15}/>Registrar realizado</button></> : <Link className="button secondary small-button" href={`/vehiculos/${visit.vehicle_id}`}>Atender falla<Icon name="arrow" size={15}/></Link>}</>}</div></article>;
      })}</div>)}</div>}</section>
  </>;
}
