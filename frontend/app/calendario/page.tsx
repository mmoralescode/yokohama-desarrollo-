"use client";
import Link from "next/link";
import {useState} from "react";
import {dateLabel, localDate, numberLabel, useResource} from "@/lib/api";
import type {Visit} from "@/lib/types";
import {Empty, ErrorBox, Icon, Loading, PageHeader, StatusBadge} from "@/components/ui";

export default function CalendarPage() {
  const [month, setMonth] = useState(() => localDate().slice(0, 7));
  const safeMonth = /^\d{4}-\d{2}$/.test(month) ? month : localDate().slice(0, 7);
  const [year, monthNumber] = safeMonth.split("-").map(Number);
  const start = `${safeMonth}-01`;
  const end = localDate(new Date(year, monthNumber, 0));
  const resource = useResource<Visit[]>(`calendar?start=${start}&end=${end}`);
  const catalog = useResource<{servicios: {id: string; servicio: string}[]}>("catalog");
  const names = Object.fromEntries((catalog.data?.servicios || []).map(service => [service.id, service.servicio]));
  const visits = resource.data || [];
  const groups = visits.reduce<Record<string, Visit[]>>((result, visit) => { (result[visit.planned_date] ||= []).push(visit); return result; }, {});
  const monthLabel = new Intl.DateTimeFormat("es-MX", {month: "long", year: "numeric"}).format(new Date(year, monthNumber - 1, 1));
  const firstWeekday = (new Date(year, monthNumber - 1, 1).getDay() + 6) % 7;
  const totalDays = new Date(year, monthNumber, 0).getDate();
  const today = localDate();
  function moveMonth(delta: number) {setMonth(localDate(new Date(year, monthNumber - 1 + delta, 1)).slice(0, 7));}
  return <>
    <PageHeader eyebrow="COORDINACIÓN DE TALLER" title="Una agenda, menos paradas." description="Visitas agrupadas en la última fecha compatible de cada ventana. Confirma cada propuesta antes de asignar la unidad." action={<button className="button secondary" onClick={resource.refresh} disabled={resource.loading}><Icon name="refresh" size={17}/>Actualizar</button>}/>
    {resource.error && <ErrorBox message={resource.error} retry={resource.refresh}/>}
    <div className="calendar-layout"><section className="panel calendar-panel"><div className="panel-header"><h2 className="capitalize">{monthLabel}</h2><div className="calendar-controls"><button className="icon-link" onClick={() => moveMonth(-1)} aria-label="Mes anterior">←</button><label><span className="sr-only">Mes de visitas</span><input type="month" value={month} onChange={e => setMonth(e.target.value)}/></label><button className="icon-link" onClick={() => moveMonth(1)} aria-label="Mes siguiente">→</button></div></div>
      <div className="calendar-grid" aria-label={`Agenda de ${monthLabel}`}>{["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map(day => <div key={day} className="calendar-weekday">{day}</div>)}{Array.from({length: firstWeekday}, (_, index) => <div key={`blank-${index}`} className="calendar-day blank"/>)}{Array.from({length: totalDays}, (_, index) => {
        const date = `${safeMonth}-${String(index + 1).padStart(2, "0")}`;
        const dayVisits = groups[date] || [];
        return <div key={date} className={`calendar-day ${today === date ? "today" : ""} ${dayVisits.length ? "has-visits" : ""}`}><span className="day-number">{index + 1}{date === today && <span className="sr-only">, hoy</span>}</span>{dayVisits.length > 0 && <a href={`#dia-${date}`} className="day-visits" aria-label={`${dateLabel(date)}: ${dayVisits.length} visitas propuestas`}><span className="desktop-label">{dayVisits.length} {dayVisits.length === 1 ? "visita" : "visitas"}</span><span className="mobile-label">{dayVisits.length}</span></a>}</div>;
      })}</div><p className="section-note">Las fechas no son citas confirmadas. Los pendientes sin fecha no aparecen en el calendario: consúltalos en la flotilla.</p></section>
      <aside className="calendar-summary"><p className="eyebrow">ESTE MES</p><strong>{resource.data ? visits.length : "—"}</strong><h2>visitas propuestas</h2><p>Para {new Set(visits.map(visit => visit.vehicle_id)).size} unidades. Agrupar no implica que todos los servicios se puedan posponer.</p><div className="summary-divider"/><Icon name="wrench" size={26}/><h3>Primero, la seguridad</h3><p>Las fallas críticas se atienden de inmediato, fuera de la espera por una ventana óptima.</p><Link href="/alertas" className="button secondary">Revisar alertas<Icon name="arrow" size={17}/></Link></aside>
    </div>
    <section className="panel"><div className="panel-header"><div><p className="eyebrow">DETALLE DE LA AGENDA</p><h2>Ingresos propuestos</h2></div><span className="badge neutral">No confirmados</span></div>{resource.loading && !resource.data ? <Loading/> : !visits.length ? <Empty title="Sin visitas propuestas en este mes">Consulta otro periodo o completa los historiales de las unidades. Una agenda vacía no garantiza que no haya servicios pendientes.</Empty> : <div className="panel-body">{Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)).map(([date, entries]) => <div id={`dia-${date}`} key={date} className="agenda-day"><h3>{dateLabel(date)}</h3>{entries.map(visit => <article key={`${visit.vehicle_id}-${visit.id}`} className="agenda-entry"><div><Link className="plate-link" href={`/vehiculos/${visit.vehicle_id}`}>{visit.plate}</Link><span className="cell-sub">{visit.version}</span></div><div><strong>{visit.fault_ids?.length ? `Atención de ${visit.fault_ids.length} ${visit.fault_ids.length === 1 ? "falla" : "fallas"}${visit.service_ids.length ? ` y ${visit.service_ids.length} servicios` : ""}` : `${visit.service_ids.length} servicios agrupados`}</strong><ul className="compact-list">{visit.service_ids.map(service => <li key={service}>{names[service] || service}</li>)}{visit.fault_ids?.map(fault => <li key={`fault-${fault}`}>Reporte de falla #{fault}</li>)}</ul><p className="muted small">{visit.explanation}</p>{visit.status === "immediate" && <p className="critical-text">Atender de inmediato; ante falla crítica, detener operación y coordinar traslado seguro.</p>}</div><div><StatusBadge status={visit.status}/><span className="cell-sub">{visit.provisional ? "Provisional" : "Por confirmar"}</span><span className="cell-sub">{visit.total_duration_hours == null ? "Duración por validar" : `${numberLabel(visit.total_duration_hours, 1)} h estimadas`}</span></div></article>)}</div>)}</div>}</section>
  </>;
}
