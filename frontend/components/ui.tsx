"use client";
import {FormEvent, ReactNode, useState} from "react";
import {dateLabel, numberLabel} from "@/lib/api";
import type {Severity, TrafficLight, Visit} from "@/lib/types";

export type IconName = "fleet" | "calendar" | "bell" | "arrow" | "refresh" | "plus" | "search" | "check" | "warning" | "wrench" | "dashboard";
export function Icon({name, size = 20}: {name: IconName; size?: number}) {
  const paths: Record<IconName, ReactNode> = {
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="11" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="18" width="7" height="3" rx="1"/></>,
    fleet: <><path d="m4 14 2-7h12l2 7M4 14h16v5H4zM7 19v2m10-2v2M7 16h1m8 0h1M8 7V4h8v3"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18M7 15h2m3 0h2m3 0h1M7 18h2"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM9 21h6"/></>,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>,
    refresh: <><path d="M20 10a8 8 0 0 0-14-5L3 8m0-5v5h5M4 14a8 8 0 0 0 14 5l3-3m0 5v-5h-5"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    search: <><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    warning: <><path d="m12 3 10 18H2L12 3ZM12 9v5m0 3h.01"/></>,
    wrench: <path d="M14 4a5 5 0 0 0-6 6L3 16a3 3 0 0 0 5 5l6-6a5 5 0 0 0 6-6l-4 3-4-4 2-4Z"/>
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
export function TrafficBadge({value}: {value: TrafficLight}) {
  const labels = {red: "Atención prioritaria", amber: "Planear / validar", green: "En ventana", gray: "Datos insuficientes"};
  return <span className={`badge traffic ${value}`}><span className="dot"/>{labels[value] || labels.gray}</span>;
}
export function SeverityBadge({value}: {value: Severity}) {
  return <span className={`badge severity-${value}`}>{({critico: "Crítico", importante: "Importante", menor: "Menor"})[value] || "Por evaluar"}</span>;
}
export function StatusBadge({status}: {status: string}) {
  const labels: Record<string, string> = {upcoming: "Próximo", due: "Vence hoy", overdue: "Vencido", immediate: "Atención inmediata", pending_validation: "Por validar", open: "Abierta", resolved: "Resuelta", proposed: "Propuesta", scheduled: "Programada", rescheduled: "Reprogramada", completed: "Realizado"};
  return <span className={`badge status-${status}`}>{labels[status] || status}</span>;
}
export function PageHeader({eyebrow, title, description, action}: {eyebrow: string; title: string; description: string; action?: ReactNode}) {
  return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="page-description">{description}</p></div>{action && <div className="heading-actions">{action}</div>}</div>;
}
export function ErrorBox({message, retry}: {message: string; retry?: () => void}) {
  return <div className="message error" role="alert"><Icon name="warning"/><div><strong>No pudimos completar la operación</strong><p>{message}</p>{retry && <button className="text-button" onClick={retry}>Volver a intentar</button>}</div></div>;
}
export function Loading({label = "Consultando datos de la flotilla…"}: {label?: string}) {
  return <div className="loading" role="status"><span className="loader"/>{label}</div>;
}
export function Empty({title, children}: {title: string; children?: ReactNode}) {
  return <div className="empty"><div className="empty-icon"><Icon name="fleet" size={28}/></div><h3>{title}</h3>{children && <p>{children}</p>}</div>;
}
export function Stat({label, value, note, accent}: {label: string; value: string | number; note: string; accent?: string}) {
  return <article className={`stat ${accent || ""}`}><p>{label}</p><strong>{value}</strong><span>{note}</span></article>;
}
export function MutationForm({title, description, children, submitLabel = "Guardar registro", onSave, onDone}: {
  title: string; description?: string; children: ReactNode; submitLabel?: string;
  onSave: (data: FormData) => Promise<string>; onDone?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(null); setSuccess(null);
    try {setSuccess(await onSave(new FormData(event.currentTarget))); onDone?.();}
    catch (e) {setError(e instanceof Error ? e.message : "No se pudo guardar el registro.");}
    finally {setBusy(false);}
  }
  return <form onSubmit={submit} className="mutation-form"><h3>{title}</h3>{description && <p className="muted form-intro">{description}</p>}
    <fieldset disabled={busy}>{children}<button type="submit" className="button primary">{busy ? "Guardando…" : submitLabel}<Icon name="arrow" size={17}/></button></fieldset>
    {error && <ErrorBox message={error}/>}{success && <p role="status" className="message success"><Icon name="check"/>{success}</p>}
  </form>;
}
export function VisitCard({visit, names}: {visit: Visit; names?: Record<string, string>}) {
  return <article className="visit-card"><div className="visit-date"><Icon name="calendar"/><strong>{dateLabel(visit.planned_date)}</strong></div>
    <div><div className="inline gap wrap"><strong>{visit.fault_ids?.length ? `Atención de ${visit.fault_ids.length} ${visit.fault_ids.length === 1 ? "falla" : "fallas"}${visit.service_ids.length ? ` y ${visit.service_ids.length} servicios` : ""}` : `${visit.service_ids.length} servicios en una visita`}</strong><StatusBadge status={visit.status}/>{visit.provisional && <span className="badge neutral">Propuesta provisional</span>}</div>
      <ul className="compact-list">{visit.service_ids.map(id => <li key={id}>{names?.[id] || id}</li>)}{visit.fault_ids?.map(id => <li key={`fault-${id}`}>Reporte de falla #{id}</li>)}</ul>
      {visit.status === "immediate" && <p className="critical-text">No esperar a una ventana agrupada. Si la falla es crítica, detener operación y coordinar traslado seguro.</p>}
      <p className="muted small">{visit.explanation}</p><p className="small">Taller: {visit.total_duration_hours == null ? "duración pendiente de validar" : `${numberLabel(visit.total_duration_hours, 1)} h estimadas`}</p>
    </div></article>;
}
