"use client";

import Link from "next/link";
import {useEffect, useMemo, useState} from "react";
import {api, dateLabel, dateTimeLabel, localDate, numberLabel} from "@/lib/api";
import {buildDashboard, dashboardRange} from "@/lib/dashboard";
import type {Alert, VehicleSummary, Visit} from "@/lib/types";
import {Empty, ErrorBox, Icon, Loading, PageHeader, SeverityBadge} from "@/components/ui";
import {DriverNames} from "@/components/vehicle-drivers";
import "./dashboard.css";

type Snapshot = {vehicles: VehicleSummary[]; entries: Visit[]; alerts: Alert[]; today: string; fetchedAt: string};
type Cohort = "all" | "real" | "synthetic";
type PendingGroup = "missingDrivers" | "missingCatalog" | "insufficientData";

function monthLabel(month: string) {
  return new Intl.DateTimeFormat("es-MX", {timeZone: "UTC", month: "long", year: "numeric"}).format(new Date(`${month}-01T12:00:00Z`));
}

function agendaLink(visit: Visit, plate: string) {
  return `/calendario?mes=${visit.planned_date.slice(0, 7)}&placa=${encodeURIComponent(plate)}`;
}

function visitWorkLabel(visit: Visit) {
  const labels: string[] = [];
  if (visit.service_ids.length) labels.push(`${visit.service_ids.length} ${visit.service_ids.length === 1 ? "servicio" : "servicios"}`);
  if (visit.fault_ids?.length) labels.push(`${visit.fault_ids.length} ${visit.fault_ids.length === 1 ? "reporte de falla" : "reportes de falla"}`);
  return labels.join(" · ") || "Detalle por confirmar";
}

export default function DashboardPage() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cohort, setCohort] = useState<Cohort>("all");
  const [pendingGroup, setPendingGroup] = useState<PendingGroup>("missingDrivers");
  const [showAllPriority, setShowAllPriority] = useState(false);
  const [showAllAgenda, setShowAllAgenda] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const today = localDate();
    const range = dashboardRange(today);
    setLoading(true); setError(null);
    // Publish an atomic snapshot: a failed source never becomes a false zero
    // or combines a fresh fleet with an older calendar without warning.
    Promise.all([
      api<VehicleSummary[]>("vehicles", {signal: controller.signal}),
      api<Visit[]>(`calendar?start=${range.start}&end=${range.end}`, {signal: controller.signal}),
      api<Alert[]>("alerts", {signal: controller.signal}),
    ]).then(([vehicles, entries, alerts]) => {
      if (!controller.signal.aborted) setSnapshot({vehicles, entries, alerts, today, fetchedAt: new Date().toISOString()});
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "No se pudo consultar el resumen.");
    }).finally(() => {if (!controller.signal.aborted) setLoading(false);});
    return () => controller.abort();
  }, [revision]);

  const vehicles = useMemo(() => (snapshot?.vehicles || []).filter(vehicle => cohort === "all" || (cohort === "synthetic" ? vehicle.is_synthetic : !vehicle.is_synthetic)), [snapshot, cohort]);
  const dashboard = useMemo(() => snapshot ? buildDashboard(vehicles, snapshot.entries, snapshot.alerts, snapshot.today) : null, [snapshot, vehicles]);
  const vehiclesById = new Map(vehicles.map(vehicle => [vehicle.id, vehicle]));
  const syntheticCount = vehicles.filter(vehicle => vehicle.is_synthetic).length;
  const pendingGroups: {key: PendingGroup; label: string; description: string}[] = [
    {key: "missingDrivers", label: "Sin conductor", description: "Asigna uno o varios conductores desde la ficha de cada unidad."},
    {key: "missingCatalog", label: "Sin catálogo", description: "Estas unidades necesitan un programa de mantenimiento compatible. Puedes registrar sus servicios manualmente."},
    {key: "insufficientData", label: "Datos por validar", description: "Revisa las lecturas y el historial de estas unidades para mejorar sus pronósticos."},
  ];
  const currentPending = pendingGroups.find(group => group.key === pendingGroup)!;
  const maxActivity = Math.max(1, ...(dashboard?.monthlyActivity.map(month => month.count) || []));

  return <div className="dashboard">
    <PageHeader eyebrow="RESUMEN ADMINISTRATIVO" title="Dashboard de flotilla" description="Lo que requiere atención, lo que viene y lo que ya se hizo." action={<button className="button secondary" aria-label="Actualizar dashboard" disabled={loading} onClick={() => setRevision(value => value + 1)}><Icon name="refresh" size={17}/>{loading ? "Actualizando…" : "Actualizar"}</button>}/>

    <div className="dashboard-toolbar">
      <div className="dashboard-shortcuts"><Link className="button primary" href="/calendario?registro=1"><Icon name="check" size={17}/>Registrar servicio</Link><Link className="button secondary" href="/?alta=1"><Icon name="plus" size={17}/>Agregar unidad</Link></div>
      <label className="dashboard-cohort">Unidades incluidas<select aria-label="Unidades incluidas en dashboard" value={cohort} onChange={event => {setCohort(event.target.value as Cohort); setShowAllPriority(false); setShowAllAgenda(false);}}><option value="all">Todas las unidades</option><option value="real">Solo unidades reales</option><option value="synthetic">Solo unidades de ejemplo</option></select></label>
    </div>
    <p className="dashboard-capture-hint"><Icon name="calendar" size={17}/><span>¿El servicio ya se hizo? Regístralo con su <strong>fecha real</strong>, aunque lo captures hoy.</span></p>

    {error && <><ErrorBox message={error} retry={() => setRevision(value => value + 1)}/>{snapshot && <p role="status" className="dashboard-stale">No se actualizó el resumen. Se muestran los datos de la última consulta correcta.</p>}</>}
    {loading && !snapshot && <Loading label="Preparando el resumen de tu flotilla…"/>}

    {dashboard && snapshot && <>
      <div className="dashboard-context"><p>Consulta: <time dateTime={snapshot.fetchedAt}>{dateTimeLabel(snapshot.fetchedAt)}</time> · Ciudad de México</p>{syntheticCount > 0 && <p className="dashboard-example-note">Incluye {syntheticCount} {syntheticCount === 1 ? "unidad de ejemplo" : "unidades de ejemplo"}; no representa desempeño real.</p>}</div>
      <div className="dashboard-kpis" aria-label="Indicadores de la flotilla" aria-busy={loading}>
        <Link href="/" className="dashboard-kpi" data-testid="dashboard-fleet-count"><span className="dashboard-kpi-heading"><Icon name="fleet"/><span>Unidades en flotilla</span></span><strong>{numberLabel(dashboard.totalVehicles)}</strong><span>En la selección actual</span><span className="dashboard-kpi-link">Ver flotilla <Icon name="arrow" size={15}/></span></Link>
        <a href="#dashboard-prioridades" className={`dashboard-kpi ${dashboard.criticalUnits ? "dashboard-kpi-urgent" : ""}`} data-testid="dashboard-critical-count"><span className="dashboard-kpi-heading"><Icon name="warning"/><span>Atención prioritaria</span></span><strong>{numberLabel(dashboard.criticalUnits)}</strong><span>Unidades, no número de alertas</span><span className="dashboard-kpi-link">Revisar prioridades <Icon name="arrow" size={15}/></span></a>
        <a href="#dashboard-agenda" className="dashboard-kpi" data-testid="dashboard-upcoming-count"><span className="dashboard-kpi-heading"><Icon name="calendar"/><span>Próximos 7 días</span></span><strong>{numberLabel(dashboard.upcoming.length)}</strong><span>{numberLabel(dashboard.upcomingScheduled)} registradas · {numberLabel(dashboard.upcomingProposed)} propuestas</span><span className="dashboard-kpi-link">Organizar visitas <Icon name="arrow" size={15}/></span></a>
        <a href="#dashboard-actividad" className="dashboard-kpi dashboard-kpi-completed" data-testid="dashboard-completed-count"><span className="dashboard-kpi-heading"><Icon name="check"/><span>Servicios realizados</span></span><strong>{numberLabel(dashboard.completedMonth)}</strong><span className="capitalize">{monthLabel(snapshot.today.slice(0, 7))} · fecha real</span><span className="dashboard-kpi-link">Ver actividad <Icon name="arrow" size={15}/></span></a>
      </div>

      {!vehicles.length && <section className="panel"><Empty title={cohort === "all" ? "Comienza agregando tu primera unidad" : "No hay unidades en esta selección"}>{cohort === "all" ? "Agrega sus datos, asigna conductores y registra su historial. El resumen se construirá con tus capturas." : "Cambia el filtro superior para consultar el resto de la flotilla."}</Empty></section>}

      <div className="dashboard-columns">
        <section id="dashboard-prioridades" className="panel dashboard-panel" aria-labelledby="dashboard-priorities-title">
          <div className="panel-header"><div><p className="eyebrow">QUÉ REVISAR PRIMERO</p><h2 id="dashboard-priorities-title">Primero, lo importante</h2></div><span className="badge neutral">{dashboard.priority.length} unidades</span></div>
          <p className="section-note">Una fila por unidad. Las críticas van primero; cambiar una cita no elimina una alerta.</p>
          {dashboard.priority.length ? <><div className="dashboard-priority-list">{(showAllPriority ? dashboard.priority : dashboard.priority.slice(0, 4)).map(item => <article className={`dashboard-priority-row ${item.severity === "critico" ? "dashboard-priority-critical" : ""}`} key={item.vehicle.id}>
            <div className="dashboard-row-title"><Link href={`/vehiculos/${item.vehicle.id}`} className="plate-link">{item.vehicle.plate}</Link><SeverityBadge value={item.severity}/></div>
            <span className="cell-sub">{item.vehicle.make} {item.vehicle.model}</span><DriverNames drivers={item.vehicle.drivers}/>
            <p className="dashboard-alert-message">{item.topAlert?.message || "Revisa el plan y las condiciones de mantenimiento de esta unidad."}</p>
            <div className="dashboard-row-footer"><span>{item.alerts.length} {item.alerts.length === 1 ? "alerta técnica" : "alertas técnicas"}{item.deadline ? ` · Límite: ${dateLabel(item.deadline)}` : ""}</span><Link href={`/vehiculos/${item.vehicle.id}`}>Revisar unidad <Icon name="arrow" size={14}/></Link></div>
          </article>)}</div>{dashboard.priority.length > 4 && <button className="dashboard-show-more" onClick={() => setShowAllPriority(value => !value)} aria-expanded={showAllPriority}>{showAllPriority ? "Mostrar menos prioridades" : `Ver las ${dashboard.priority.length} unidades por revisar`}</button>}</> : <Empty title="Sin prioridades técnicas registradas">Esto no confirma la condición mecánica de las unidades. Revisa también los datos pendientes.</Empty>}
          <div className="dashboard-panel-footer"><Link href="/alertas">Ver todas las alertas <Icon name="arrow" size={15}/></Link>{dashboard.criticalUnits > 0 && <p>Ante una falla crítica, detener la operación y coordinar asistencia segura.</p>}</div>
        </section>

        <section id="dashboard-agenda" className="panel dashboard-panel" aria-labelledby="dashboard-agenda-title">
          <div className="panel-header"><div><p className="eyebrow">ORGANIZA LOS INGRESOS</p><h2 id="dashboard-agenda-title">Próximos 7 días</h2></div><Icon name="calendar"/></div>
          <p className="section-note">Del {dateLabel(snapshot.today)} al {dateLabel(dashboard.range.weekEnd)}. Una propuesta todavía necesita confirmación.</p>
          {dashboard.pastAppointments.length > 0 && <details className="dashboard-past-dates"><summary>{dashboard.pastAppointments.length} {dashboard.pastAppointments.length === 1 ? "fecha pasada por revisar" : "fechas pasadas por revisar"}</summary><p>Son citas registradas de los últimos 6 meses sin cierre en el sistema. Si el servicio ya se hizo, captura su fecha real; si no, revisa la fecha con el taller.</p><ul>{dashboard.pastAppointments.map(visit => {
            const vehicle = vehiclesById.get(visit.vehicle_id || 0)!;
            return <li key={`${visit.vehicle_id}-${visit.id}`}><Link href={agendaLink(visit, vehicle.plate)}>{vehicle.plate} · {dateLabel(visit.planned_date)} <Icon name="arrow" size={13}/></Link></li>;
          })}</ul></details>}
          {dashboard.upcoming.length ? <><div className="dashboard-agenda-list">{(showAllAgenda ? dashboard.upcoming : dashboard.upcoming.slice(0, 5)).map(visit => {
            const vehicle = vehiclesById.get(visit.vehicle_id || 0)!;
            const registered = visit.status === "scheduled" || !!visit.appointment_id;
            return <article className="dashboard-agenda-row" key={`${visit.vehicle_id}-${visit.id}`}><div className="dashboard-date-tile"><span>{new Intl.DateTimeFormat("es-MX", {timeZone: "UTC", month: "short"}).format(new Date(`${visit.planned_date}T12:00:00Z`))}</span><strong>{visit.planned_date.slice(8, 10)}</strong>{visit.planned_date === snapshot.today && <span>Hoy</span>}</div><div className="dashboard-agenda-content"><div className="dashboard-row-title"><Link className="plate-link" href={`/vehiculos/${vehicle.id}`}>{vehicle.plate}</Link><span className={`badge ${registered ? "status-scheduled" : "neutral"}`}>{registered ? "Fecha registrada" : "Por confirmar"}</span></div><DriverNames drivers={vehicle.drivers}/><p>{visitWorkLabel(visit)}</p><Link className="dashboard-agenda-link" href={agendaLink(visit, vehicle.plate)}>Ver en calendario <Icon name="arrow" size={14}/></Link></div></article>;
          })}</div>{dashboard.upcoming.length > 5 && <button className="dashboard-show-more" onClick={() => setShowAllAgenda(value => !value)} aria-expanded={showAllAgenda}>{showAllAgenda ? "Mostrar menos visitas" : `Ver las ${dashboard.upcoming.length} visitas`}</button>}</> : <Empty title="Sin visitas en los próximos 7 días">Consulta otras fechas o revisa las unidades que aún no tienen una fecha validada.</Empty>}
          <div className="dashboard-panel-footer"><Link href="/calendario">Abrir calendario completo <Icon name="arrow" size={15}/></Link></div>
        </section>
      </div>

      <div className="dashboard-columns dashboard-bottom-columns">
        <section id="dashboard-actividad" className="panel dashboard-panel" aria-labelledby="dashboard-activity-title"><div className="panel-header"><div><p className="eyebrow">ACTIVIDAD REGISTRADA</p><h2 id="dashboard-activity-title">Servicios realizados</h2></div><span className="badge neutral">Últimos 6 meses</span></div><p className="section-note">Se cuenta cada trabajo por su fecha real, no por el día de captura. El mes actual está en curso.</p>
          <figure className="dashboard-activity"><figcaption className="sr-only">Servicios realizados por mes en las unidades seleccionadas</figcaption><ul>{dashboard.monthlyActivity.map(month => <li key={month.month} data-testid={`dashboard-month-${month.month}`}><span className="dashboard-month-label">{month.label}</span><span className="dashboard-bar-track" aria-hidden="true"><span style={{width: `${month.count / maxActivity * 100}%`}}/></span><strong aria-label={`${month.count} servicios`}>{numberLabel(month.count)}</strong></li>)}</ul></figure>
          <div className="dashboard-panel-footer"><p>Sin captura no hay servicio contabilizado. Una visita puede incluir varios trabajos.</p><Link href="/calendario?registro=1">Registrar un servicio realizado <Icon name="arrow" size={15}/></Link></div>
        </section>

        <section id="dashboard-pendientes" className="panel dashboard-panel" aria-labelledby="dashboard-pending-title"><div className="panel-header"><div><p className="eyebrow">ORDEN EN LA CAPTURA</p><h2 id="dashboard-pending-title">Completar registros</h2></div><Icon name="fleet"/></div><p className="section-note">Elige un pendiente y abre la ficha de la unidad. Una unidad puede aparecer en más de un grupo.</p>
          <div className="dashboard-pending-tabs" role="group" aria-label="Tipo de registro pendiente">{pendingGroups.map(group => <button key={group.key} type="button" aria-pressed={pendingGroup === group.key} aria-controls="dashboard-pending-list" onClick={() => setPendingGroup(group.key)}><strong>{dashboard[group.key].length}</strong><span>{group.label}</span></button>)}</div>
          <p className="dashboard-pending-description">{currentPending.description}</p><div id="dashboard-pending-list" className="dashboard-data-list" aria-live="polite">{dashboard[pendingGroup].length ? <ul>{dashboard[pendingGroup].map(vehicle => <li key={vehicle.id}><Link href={`/vehiculos/${vehicle.id}`}><span><strong>{vehicle.plate}</strong><span>{vehicle.make} {vehicle.model}</span></span><span className="dashboard-open-unit">Abrir ficha <Icon name="arrow" size={14}/></span></Link></li>)}</ul> : <div className="dashboard-all-clear"><Icon name="check"/><p>No hay unidades con este pendiente en la selección actual.</p></div>}</div>
        </section>
      </div>
    </>}
  </div>;
}
