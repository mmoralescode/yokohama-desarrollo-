"use client";
import {useState} from "react";
import {dateLabel, numberLabel, useResource} from "@/lib/api";
import type {FleetMetrics} from "@/lib/types";
import {ErrorBox, Loading, Stat} from "./ui";

export default function FleetMetricsPanel({demoOnly = false}: {demoOnly?: boolean}) {
  const [cohort, setCohort] = useState(demoOnly ? "true" : "false");
  const resource = useResource<FleetMetrics>(`metrics?synthetic=${cohort}`);
  const data = resource.data;
  return <details className="panel"><summary className="panel-header"><h2>Resultados del mantenimiento</h2><span className="muted small">Ver métricas</span></summary><div className="panel-body">
    <label>Unidades incluidas<select value={cohort} onChange={event => setCohort(event.target.value)}><option value="false">Solo unidades reales</option><option value="true">Solo demostración sintética</option><option value="null">Todas (mezcla reales y demostración)</option></select></label>
    {cohort !== "false" && <p className="muted small">{cohort === "true" ? "Resultados de datos sintéticos; no representan desempeño real." : "Incluye datos sintéticos. No usar este agregado como desempeño real."}</p>}
    {resource.error && <ErrorBox message={resource.error} retry={resource.refresh}/>}
    {resource.loading && !data && <Loading label="Consultando resultados…"/>}
    {data && <><div className="stats-grid">
      <Stat label="SERVICIOS ANTES DE FALLA" value={data.services_before_failure_percent == null ? "—" : `${numberLabel(data.services_before_failure_percent, 1)} %`} note={`${data.preventive_services} preventivos de ${data.classified_services} servicios clasificados`}/>
      <Stat label="ERROR ABSOLUTO DE FECHA" value={data.mean_absolute_error_days == null ? "—" : `${numberLabel(data.mean_absolute_error_days, 1)} días`} note={`${data.prediction_samples} servicios con predicción previa comparable`}/>
      <Stat label="FALLAS NO PREVISTAS" value={data.unpredicted_failures} note={`${data.classified_failures} de ${data.total_failures} fallas clasificadas`} accent="amber"/>
      <Stat label="FUERA DE SERVICIO" value={`${numberLabel(data.downtime_days, 1)} días`} note={`${data.open_downtimes} periodos abiertos; acumulado registrado`}/>
    </div><p className="muted small">Los registros sin clasificación no se cuentan como preventivos ni como fallas previstas. Servicios sin clasificar: {data.total_services - data.classified_services}. Fallas sin clasificar: {data.total_failures - data.classified_failures}. Sin muestras comparables, el error se muestra como «—».</p><p className="muted small">Error firmado: {data.mean_signed_error_days == null ? "sin muestras" : `${numberLabel(data.mean_signed_error_days, 1)} días`} (positivo: servicio posterior a lo previsto; negativo: anticipado). Corte: {dateLabel(data.as_of)} · Ciudad de México.</p><button className="button secondary small-button" disabled={resource.loading} onClick={resource.refresh}>Actualizar métricas</button></>}
  </div></details>;
}
