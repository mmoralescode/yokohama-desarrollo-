"use client";

import {useState} from "react";
import {api} from "@/lib/api";
import {parseDriverNames} from "@/lib/drivers";
import {Icon, MutationForm} from "./ui";

export function DriverNamesField({drivers = []}: {drivers?: string[]}) {
  return <label>Conductores asignados (opcional)
    <textarea name="drivers" aria-label="Conductores asignados (opcional)" rows={3} defaultValue={drivers.join("\n")} placeholder={"Ana López\nCarlos Pérez"} onInput={event => {
      try {parseDriverNames(event.currentTarget.value); event.currentTarget.setCustomValidity("");}
      catch (error) {event.currentTarget.setCustomValidity(error instanceof Error ? error.message : "Revisa los nombres.");}
    }}/>
    <span className="field-help">Escribe un nombre por renglón. Puedes asignar varios conductores o dejarlo vacío si aún no conoces sus nombres.</span>
  </label>;
}

export function DriverNames({drivers = []}: {drivers?: string[]}) {
  return <span className="driver-names">{drivers.length ? drivers.join(" · ") : "Sin conductor asignado"}</span>;
}

export default function VehicleDrivers({id, drivers = [], onDone}: {id: string; drivers?: string[]; onDone: () => void}) {
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState(false);
  return <section className="panel vehicle-drivers-panel"><div className="panel-header"><div><p className="eyebrow">PERSONAS ASIGNADAS A LA UNIDAD</p><h2>Conductores asignados</h2></div>{!editing && <button type="button" className="button secondary small-button" onClick={() => {setNotice(false); setEditing(true);}}>Editar conductores</button>}</div><div className="panel-body">
    {editing ? <MutationForm title="Actualizar conductores" description="Agrega o quita nombres. Guardar la lista vacía deja la unidad sin conductor asignado." submitLabel="Guardar conductores" onDone={() => {setEditing(false); setNotice(true); onDone();}} onSave={async data => {
      await api(`vehicles/${id}`, {method: "PATCH", body: {drivers: parseDriverNames(String(data.get("drivers") || ""))}});
      return "Conductores actualizados.";
    }}><DriverNamesField drivers={drivers}/><button type="button" className="button secondary" onClick={() => setEditing(false)}>Cancelar</button></MutationForm> : <><DriverNames drivers={drivers}/>{notice && <p className="message success" role="status"><Icon name="check" size={17}/>Conductores actualizados.</p>}</>}
  </div></section>;
}
