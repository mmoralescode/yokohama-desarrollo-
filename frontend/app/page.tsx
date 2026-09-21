"use client";
import Link from "next/link";
import {useMemo, useState} from "react";
import {api, dateLabel, localDate, numberLabel, useResource} from "@/lib/api";
import type {Variant, VehicleSummary} from "@/lib/types";
import {Empty, ErrorBox, Icon, Loading, MutationForm, PageHeader, Stat, TrafficBadge} from "@/components/ui";
import MazdaViewer from "@/components/mazda-viewer";
import FleetMetricsPanel from "@/components/fleet-metrics";
import {compareUrgency} from "@/lib/fleet-order";

function AddVehicle({onDone}: {onDone: () => void}) {
  const variants = useResource<{variantes: Variant[]}>("variants");
  const [variantId, setVariantId] = useState("");
  const chosen = variants.data?.variantes.find(v => v.id === variantId);
  return <section className="panel add-vehicle"><MutationForm title="Registrar unidad" description="Usa el VIN y la variante comprobados en la unidad. El registro no acredita mantenimiento previo." submitLabel="Agregar a flotilla" onDone={onDone} onSave={async data => {
    await api("vehicles", {method: "POST", body: {vin: String(data.get("vin")).trim().toUpperCase(), plate: String(data.get("plate")).trim().toUpperCase(), variant_id: variantId, model_year: chosen?.anio_modelo, transmission: data.get("transmission"), current_km: Number(data.get("km")), in_service_date: data.get("in_service_date"), usage_regime: data.get("usage_regime"), severity_multiplier: Number(data.get("severity_multiplier")), is_synthetic: data.get("synthetic") === "on"}});
    return "Unidad registrada. Agrega sus lecturas y servicios para mejorar la proyección.";
  }}>
    {variants.error && <ErrorBox message={variants.error} retry={variants.refresh}/>}
    <div className="form-grid"><label>VIN<input name="vin" required minLength={17} maxLength={17} pattern="[A-HJ-NPR-Za-hj-npr-z0-9]{17}" autoComplete="off" placeholder="17 caracteres"/></label><label>Placas<input name="plate" required minLength={3} maxLength={16} placeholder="ABC-123-A"/></label>
      <label className="span-2">Variante documentada<select required value={variantId} onChange={e => setVariantId(e.target.value)}><option value="">Selecciona año, carrocería y versión</option>{variants.data?.variantes.map(v => <option key={v.id} value={v.id}>{v.anio_modelo} · {v.carroceria} · {v.version} · {v.motor}</option>)}</select></label>
      <label>Transmisión<select name="transmission" key={variantId} required defaultValue=""><option value="">Selecciona</option>{chosen?.transmisiones.map(t => <option key={t}>{t}</option>)}</select></label><label>Odómetro actual (km)<input name="km" type="number" min={0} step="0.1" required/></label>
      <label>Fecha de puesta en servicio<input name="in_service_date" type="date" required max={localDate()}/></label><label>Régimen de uso<select name="usage_regime"><option value="normal">Normal</option><option value="severe">Severo (validar criterio Mazda)</option></select></label>
      <label className="span-2">Factor de intervalo<input name="severity_multiplier" type="number" min={0.1} max={1} step={0.01} defaultValue={1} required/><span className="field-help">1 conserva los intervalos. Un valor menor los acorta (0.8 = 80 %); nunca amplía límites de mantenimiento.</span></label>
    </div><label className="check-label"><input type="checkbox" name="synthetic"/>Esta unidad es un dato sintético de demostración</label>
  </MutationForm></section>;
}

export default function FleetPage() {
  const resource = useResource<VehicleSummary[]>("vehicles");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const vehicles = resource.data || [];
  const visible = useMemo(() => vehicles.filter(v => (status === "all" || v.traffic_light === status) && `${v.plate} ${v.version} ${v.vin} ${v.model_year}`.toLowerCase().includes(search.toLowerCase())).sort(compareUrgency), [vehicles, search, status]);
  const urgent = vehicles.filter(v => v.traffic_light === "red").length;
  const planned = vehicles.filter(v => v.next_visit_date).length;
  const unvalidated = vehicles.filter(v => v.traffic_light === "gray" || v.traffic_light === "amber").length;
  async function recalculate() {
    setRecalculating(true); setMutationError(null); setNotice(null);
    try {const result = await api<{vehicles_processed: number; alerts_open: number}>("recalculate", {method: "POST"}); setNotice(`${result.vehicles_processed} unidades recalculadas · ${result.alerts_open} alertas abiertas.`); resource.refresh();}
    catch(e) {setMutationError(e instanceof Error ? e.message : "No se pudo recalcular.");}
    finally {setRecalculating(false);}
  }
  return <>
    <PageHeader eyebrow="VISIÓN GENERAL" title="Más tiempo en ruta." description="Anticipa el mantenimiento y coordina cada ingreso a taller desde un solo lugar." action={<button className="button primary" onClick={() => setShowAdd(value => !value)} aria-expanded={showAdd}><Icon name="plus" size={18}/>{showAdd ? "Cerrar registro" : "Agregar unidad"}</button>}/>
    {showAdd && <AddVehicle onDone={resource.refresh}/>}
    {resource.error && <ErrorBox message={resource.error} retry={resource.refresh}/>}
    {mutationError && <ErrorBox message={mutationError}/>}{notice && <p className="message success" role="status">{notice}</p>}
    <MazdaViewer/>
    <div className="stats-grid"><Stat label="UNIDADES EN FLOTILLA" value={resource.data ? vehicles.length : "—"} note="Mazda3 · México"/><Stat label="ATENCIÓN PRIORITARIA" value={resource.data ? urgent : "—"} note="Revisar antes de asignar ruta" accent="red"/><Stat label="VISITAS PROPUESTAS" value={resource.data ? planned : "—"} note="Unidades con fecha provisional"/><Stat label="POR PLANEAR / VALIDAR" value={resource.data ? unvalidated : "—"} note="No equivalen a unidades seguras" accent="amber"/></div>
    <section className="panel fleet-panel"><div className="panel-header"><div><p className="eyebrow">CONTROL DE UNIDADES</p><h2>Tu flotilla, de un vistazo</h2></div><button className="button secondary small-button" onClick={recalculate} disabled={recalculating || resource.loading}><Icon name="refresh" size={16}/>{recalculating ? "Recalculando…" : "Recalcular planes"}</button></div>
      <div className="table-toolbar"><label className="search-field"><span className="sr-only">Buscar unidad</span><Icon name="search" size={18}/><input type="search" placeholder="Buscar placa, versión o VIN…" value={search} onChange={e => setSearch(e.target.value)}/></label><label className="status-filter"><span className="sr-only">Filtrar estado</span><select value={status} onChange={e => setStatus(e.target.value)}><option value="all">Todos los estados</option><option value="red">Atención prioritaria</option><option value="amber">Planear / validar</option><option value="gray">Datos insuficientes</option><option value="green">En ventana</option></select></label><span className="muted small result-count">{visible.length} unidades</span></div>
      {resource.loading && !resource.data ? <Loading/> : !visible.length ? <Empty title={search || status !== "all" ? "Sin coincidencias" : "Aún no hay unidades"}>{search || status !== "all" ? "Prueba otra placa o cambia el filtro." : "Registra una unidad o carga los 20 vehículos sintéticos con el generador del backend."}</Empty> : <div className="table-scroll"><table><caption className="sr-only">Estado de mantenimiento de las unidades de la flotilla</caption><thead><tr><th>Unidad</th><th>Estado</th><th>Odómetro</th><th>Uso estimado</th><th>Próxima visita</th><th>Alertas</th><th><span className="sr-only">Ver detalle</span></th></tr></thead><tbody>{visible.map(vehicle => <tr key={vehicle.id}>
        <td><Link href={`/vehiculos/${vehicle.id}`} className="plate-link">{vehicle.plate}</Link><span className="cell-sub">Mazda3 {vehicle.model_year} · {vehicle.version}</span>{vehicle.is_synthetic && <span className="synthetic-label">DATO SINTÉTICO</span>}</td><td><TrafficBadge value={vehicle.traffic_light}/></td><td className="numeric">{numberLabel(vehicle.current_km)} <span className="muted">km</span></td><td className="numeric">{numberLabel(vehicle.usage_km_per_day, 1)} <span className="muted">km/día</span></td><td>{vehicle.next_visit_date ? dateLabel(vehicle.next_visit_date) : <span className="muted">Sin fecha validada</span>}{vehicle.next_visit_date && <span className="cell-sub">Provisional</span>}</td><td><span className={vehicle.open_alerts ? "alert-count" : "muted"}>{vehicle.open_alerts}</span></td><td><Link className="icon-link" href={`/vehiculos/${vehicle.id}`} aria-label={`Ver unidad ${vehicle.plate}`}><Icon name="arrow"/></Link></td>
      </tr>)}</tbody></table></div>}
    </section>
    {resource.data && <FleetMetricsPanel demoOnly={vehicles.length > 0 && vehicles.every(vehicle => vehicle.is_synthetic)}/>}
    <div className="bottom-note"><Icon name="wrench"/><p><strong>Una visita bien planeada, menos tiempo detenido.</strong><br/>El motor agrupa ventanas compatibles; nunca difiere una falla crítica ni supone tolerancias sin respaldo.</p><Link href="/calendario">Ver calendario <Icon name="arrow" size={16}/></Link></div>
  </>;
}
