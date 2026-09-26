"use client";

import {Icon} from "./ui";

export default function VehicleSearchFields({plate, driver, onPlateChange, onDriverChange, platePlaceholder = "Buscar por placa"}: {plate: string; driver: string; onPlateChange: (value: string) => void; onDriverChange: (value: string) => void; platePlaceholder?: string}) {
  return <div className="vehicle-search-fields"><label className="search-field"><span className="sr-only">Buscar por placa</span><Icon name="search" size={18}/><input type="search" placeholder={platePlaceholder} value={plate} onChange={event => onPlateChange(event.target.value)}/></label><label className="search-field"><span className="sr-only">Buscar por nombre</span><Icon name="search" size={18}/><input type="search" placeholder="Buscar por nombre" value={driver} onChange={event => onDriverChange(event.target.value)}/></label></div>;
}
