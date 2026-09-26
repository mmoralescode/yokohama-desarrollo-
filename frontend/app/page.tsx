"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import {useEffect, useMemo, useState} from "react";
import {api, dateLabel, localDate, numberLabel, useResource} from "@/lib/api";
import {SHOW_MAZDA_3D_VIEWER} from "@/lib/feature-flags";
import {proposalMode} from "@/lib/proposal-mode";
import type {Variant, VehicleSummary} from "@/lib/types";
import {Empty, ErrorBox, Icon, Loading, MutationForm, PageHeader, Stat, TrafficBadge} from "@/components/ui";
import FleetMetricsPanel from "@/components/fleet-metrics";
import {compareUrgency} from "@/lib/fleet-order";
import {matchesDriverNames, normalizeSearch, parseDriverNames} from "@/lib/drivers";
import {DriverNames, DriverNamesField} from "@/components/vehicle-drivers";
import VehicleSearchFields from "@/components/vehicle-search-fields";

// The source stays available, but the off flag avoids rendering or fetching
// the 3D component and its local Mazda asset in the current fleet UI.
const MazdaViewer = SHOW_MAZDA_3D_VIEWER
  ? dynamic(() => import("@/components/mazda-viewer"), {ssr: false})
  : null;

type VehicleFields = {
  make: string; model: string; model_year: string; version: string; body_style: string;
  engine: string; transmission: string; drive: string; fuel_type: string; color: string;
};

const emptyVehicleFields: VehicleFields = {make: "", model: "", model_year: "", version: "", body_style: "", engine: "", transmission: "", drive: "", fuel_type: "", color: ""};

function AddVehicle({onDone}: {onDone: () => void}) {
  const variants = useResource<{variantes: Variant[]}>("variants");
  const [template, setTemplate] = useState<"manual" | "mazda3">("manual");
  const [variantId, setVariantId] = useState("");
  const [fields, setFields] = useState<VehicleFields>(emptyVehicleFields);
  const chosen = variants.data?.variantes.find(v => v.id === variantId);
  const usingMazdaTemplate = template === "mazda3";
  const updateField = (name: keyof VehicleFields, value: string) => setFields(current => ({...current, [name]: value}));
  function selectTemplate(value: "manual" | "mazda3") {
    setTemplate(value);
    if (value === "manual") setVariantId("");
  }
  function selectVariant(id: string) {
    setVariantId(id);
    const variant = variants.data?.variantes.find(item => item.id === id);
    if (!variant) return;
    setFields(current => ({...current, make: "Mazda", model: "Mazda3", model_year: String(variant.anio_modelo), version: variant.version, body_style: variant.carroceria, engine: variant.motor, transmission: variant.transmisiones[0] || current.transmission, drive: variant.traccion}));
  }
  return <section className="panel add-vehicle"><MutationForm title="Registrar unidad" description="Captura los datos comprobados de cualquier vehículo. La plantilla Mazda3 conserva su catálogo existente; las demás marcas se registran con sus datos manuales." submitLabel="Agregar a flotilla" onDone={onDone} onSave={async data => {
    const text = (name: string) => String(data.get(name) || "").trim();
    await api("vehicles", {method: "POST", body: {
      vin: text("vin").toUpperCase(), plate: text("plate").toUpperCase(), make: text("make"), model: text("model"), model_year: Number(data.get("model_year")), version: text("version"), body_style: text("body_style"), engine: text("engine"), transmission: text("transmission"), drive: text("drive"), fuel_type: text("fuel_type") || null, color: text("color") || null,
      current_km: Number(data.get("km")), in_service_date: data.get("in_service_date"), usage_regime: data.get("usage_regime"), severity_multiplier: Number(data.get("severity_multiplier") || 1), is_synthetic: data.get("synthetic") === "on", drivers: parseDriverNames(text("drivers")),
      ...(usingMazdaTemplate ? {variant_id: variantId, maintenance_catalog: "mazda3-mx.v0.1.0"} : {})
    }});
    return "Unidad registrada. Agrega sus lecturas y servicios para mejorar la proyección.";
  }}>
    {usingMazdaTemplate && variants.error && <ErrorBox message={variants.error} retry={variants.refresh}/>}
    <div className="form-grid"><label>Número de serie (VIN)<input name="vin" required minLength={17} maxLength={17} pattern="[A-HJ-NPR-Za-hj-npr-z0-9]{17}" autoComplete="off" placeholder="17 caracteres"/></label><label>Placas<input name="plate" required minLength={3} maxLength={16} placeholder="ABC-123-A"/></label>
      <label className="span-2">Configuración inicial<select aria-label="Plantilla de vehículo" value={template} onChange={event => selectTemplate(event.target.value as "manual" | "mazda3")}><option value="manual">Captura manual (cualquier marca)</option><option value="mazda3">Plantilla Mazda3 (catálogo existente)</option></select><span className="field-help">La plantilla es opcional y solo asocia el catálogo documentado de Mazda3.</span></label>
      {usingMazdaTemplate && <label className="span-2">Modelo Mazda3 del catálogo<select required value={variantId} onChange={event => selectVariant(event.target.value)}><option value="">Selecciona año, carrocería y versión</option>{variants.data?.variantes.map(variant => <option key={variant.id} value={variant.id}>{variant.anio_modelo} · {variant.carroceria} · {variant.version} · {variant.motor}</option>)}</select></label>}
      <label>Marca<input name="make" required value={fields.make} onChange={event => updateField("make", event.target.value)} placeholder="Ej. Toyota"/></label><label>Modelo<input name="model" required value={fields.model} onChange={event => updateField("model", event.target.value)} placeholder="Ej. Corolla"/></label>
      <label>Año modelo<input name="model_year" type="number" required min={1886} max={Number(localDate().slice(0, 4)) + 1} value={fields.model_year} onChange={event => updateField("model_year", event.target.value)} placeholder="2024"/></label><label>Versión<input name="version" required value={fields.version} onChange={event => updateField("version", event.target.value)} placeholder="Ej. XLE"/></label>
      <label>Carrocería<input name="body_style" required value={fields.body_style} onChange={event => updateField("body_style", event.target.value)} placeholder="Ej. sedán"/></label><label>Motor<input name="engine" required value={fields.engine} onChange={event => updateField("engine", event.target.value)} placeholder="Ej. 2.0 L"/></label>
      <label>Transmisión<input name="transmission" required list={chosen ? "mazda-transmissions" : undefined} value={fields.transmission} onChange={event => updateField("transmission", event.target.value)} placeholder="Ej. automática"/></label><label>Tracción<input name="drive" required value={fields.drive} onChange={event => updateField("drive", event.target.value)} placeholder="Ej. FWD"/></label>
      {chosen && <datalist id="mazda-transmissions">{chosen.transmisiones.map(transmission => <option key={transmission} value={transmission}/>)}</datalist>}
      <label>Combustible (opcional)<input name="fuel_type" value={fields.fuel_type} onChange={event => updateField("fuel_type", event.target.value)} placeholder="Ej. gasolina"/></label><label>Color (opcional)<input name="color" value={fields.color} onChange={event => updateField("color", event.target.value)} placeholder="Ej. blanco"/></label>
      <label>Odómetro actual (km)<input name="km" type="number" min={0} step="0.1" required/></label><label>Fecha de puesta en servicio<input name="in_service_date" type="date" required max={localDate()}/></label>
      <label>Régimen de uso<select name="usage_regime"><option value="normal">Normal</option><option value="severe">Severo (validar criterio técnico)</option></select></label>
    </div><DriverNamesField/><details className="advanced-settings"><summary>Configuración avanzada</summary><p className="muted small">Para el registro habitual, deja el valor en 1. Ajústalo solo si hay una indicación técnica para adelantar el mantenimiento.</p><label>Factor de intervalo<input name="severity_multiplier" aria-label="Factor de intervalo" type="number" min={0.1} max={1} step={0.01} defaultValue={1} required/><span className="field-help">1 = intervalo normal del catálogo. 0.8 = mantenimiento al 80 % del tiempo o kilometraje previsto. No amplía los límites del fabricante.</span></label></details><label className="check-label"><input type="checkbox" name="synthetic"/>Esta unidad es un dato sintético de demostración</label>
  </MutationForm></section>;
}

export default function FleetPage() {
  const resource = useResource<VehicleSummary[]>("vehicles");
  const [search, setSearch] = useState("");
  const [driverSearch, setDriverSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  useEffect(() => {if (new URLSearchParams(window.location.search).get("alta") === "1") setShowAdd(true);}, []);
  const [recalculating, setRecalculating] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const vehicles = resource.data || [];
  const visible = useMemo(() => vehicles.filter(v => (status === "all" || v.traffic_light === status) && normalizeSearch(`${v.plate} ${v.make} ${v.model} ${v.version} ${v.vin} ${v.model_year}`).includes(normalizeSearch(search)) && matchesDriverNames(v.drivers, driverSearch)).sort(compareUrgency), [vehicles, search, driverSearch, status]);
  const urgent = vehicles.filter(v => v.traffic_light === "red").length;
  const planned = vehicles.filter(v => v.next_visit_date).length;
  const unvalidated = vehicles.filter(v => v.traffic_light === "gray" || v.traffic_light === "amber").length;
  async function recalculate() {
    setRecalculating(true); setMutationError(null); setNotice(null);
    try {const result = await api<{vehicles_processed: number; alerts_open: number}>("recalculate", {method: "POST"}); setNotice(proposalMode ? "Agenda e historial actualizados. En esta propuesta los pronósticos son ejemplos; los cambios administrativos se guardan en este navegador." : `${result.vehicles_processed} unidades recalculadas · ${result.alerts_open} alertas abiertas.`); resource.refresh();}
    catch(e) {setMutationError(e instanceof Error ? e.message : "No se pudo recalcular.");}
    finally {setRecalculating(false);}
  }
  return <>
    <PageHeader eyebrow="VISIÓN GENERAL" title="Más tiempo en ruta." description="Anticipa el mantenimiento y coordina cada ingreso a taller desde un solo lugar." action={<button className="button primary" onClick={() => setShowAdd(value => !value)} aria-expanded={showAdd}><Icon name="plus" size={18}/>{showAdd ? "Cerrar registro" : "Agregar unidad"}</button>}/>
    {showAdd && <AddVehicle onDone={resource.refresh}/>}
    {resource.error && <ErrorBox message={resource.error} retry={resource.refresh}/>}
    {mutationError && <ErrorBox message={mutationError}/>}{notice && <p className="message success" role="status">{notice}</p>}
    {MazdaViewer && <MazdaViewer/>}
    <div className="stats-grid"><Stat label="UNIDADES EN FLOTILLA" value={resource.data ? vehicles.length : "—"} note="Flotilla multimarca"/><Stat label="ATENCIÓN PRIORITARIA" value={resource.data ? urgent : "—"} note="Revisar antes de asignar ruta" accent="red"/><Stat label="VISITAS PROPUESTAS" value={resource.data ? planned : "—"} note="Unidades con fecha provisional"/><Stat label="POR PLANEAR / VALIDAR" value={resource.data ? unvalidated : "—"} note="No equivalen a unidades seguras" accent="amber"/></div>
    <section className="panel fleet-panel"><div className="panel-header"><div><p className="eyebrow">CONTROL DE UNIDADES</p><h2>Tu flotilla, de un vistazo</h2></div><button className="button secondary small-button" onClick={recalculate} disabled={recalculating || resource.loading}><Icon name="refresh" size={16}/>{recalculating ? "Recalculando…" : "Recalcular planes"}</button></div>
      <div className="table-toolbar"><VehicleSearchFields plate={search} driver={driverSearch} onPlateChange={setSearch} onDriverChange={setDriverSearch} platePlaceholder="Placa, marca, modelo o serie"/><label className="status-filter"><span className="sr-only">Filtrar estado</span><select value={status} onChange={e => setStatus(e.target.value)}><option value="all">Todos los estados</option><option value="red">Atención prioritaria</option><option value="amber">Planear / validar</option><option value="gray">Datos insuficientes</option><option value="green">En ventana</option></select></label><span className="muted small result-count">{visible.length} unidades</span></div>
      {resource.loading && !resource.data ? <Loading/> : !visible.length ? <Empty title={search || driverSearch || status !== "all" ? "Sin coincidencias" : "Aún no hay unidades"}>{search || driverSearch || status !== "all" ? "Prueba otra placa, otro nombre o cambia el filtro." : "Registra una unidad o carga los 20 vehículos sintéticos con el generador del backend."}</Empty> : <div className="table-scroll"><table><caption className="sr-only">Estado de mantenimiento de las unidades de la flotilla</caption><thead><tr><th>Unidad / conductores</th><th>Estado</th><th>Odómetro</th><th>Uso estimado</th><th>Próxima visita</th><th>Alertas</th><th><span className="sr-only">Ver detalle</span></th></tr></thead><tbody>{visible.map(vehicle => <tr key={vehicle.id}>
        <td><Link href={`/vehiculos/${vehicle.id}`} className="plate-link">{vehicle.plate}</Link><span className="cell-sub">{[vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Unidad"} {vehicle.model_year} · {vehicle.version}</span><DriverNames drivers={vehicle.drivers}/>{vehicle.is_synthetic && <span className="synthetic-label">DATO SINTÉTICO</span>}</td><td><TrafficBadge value={vehicle.traffic_light}/></td><td className="numeric">{numberLabel(vehicle.current_km)} <span className="muted">km</span></td><td className="numeric">{numberLabel(vehicle.usage_km_per_day, 1)} <span className="muted">km/día</span></td><td>{vehicle.next_visit_date ? dateLabel(vehicle.next_visit_date) : <span className="muted">Sin fecha validada</span>}{vehicle.next_visit_date && <span className="cell-sub">Provisional</span>}</td><td><span className={vehicle.open_alerts ? "alert-count" : "muted"}>{vehicle.open_alerts}</span></td><td><Link className="icon-link" href={`/vehiculos/${vehicle.id}`} aria-label={`Ver unidad ${vehicle.plate}`}><Icon name="arrow"/></Link></td>
      </tr>)}</tbody></table></div>}
    </section>
    {resource.data && <FleetMetricsPanel demoOnly={vehicles.length > 0 && vehicles.every(vehicle => vehicle.is_synthetic)}/>}
    <div className="bottom-note"><Icon name="wrench"/><p><strong>Una visita bien planeada, menos tiempo detenido.</strong><br/>El motor agrupa ventanas compatibles; nunca difiere una falla crítica ni supone tolerancias sin respaldo.</p><Link href="/calendario">Ver calendario <Icon name="arrow" size={16}/></Link></div>
  </>;
}
