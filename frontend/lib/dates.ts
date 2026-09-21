/** Operational wall-clock dates are always Mexico City, never the browser's zone. */
export const OPERATING_TIMEZONE = "America/Mexico_City";
const wallClock = new Intl.DateTimeFormat("en-CA", {timeZone: OPERATING_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"});

export function localDateTime(value = new Date()): string {
  const parts = Object.fromEntries(wallClock.formatToParts(value).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
export function localDate(value = new Date()): string { return localDateTime(value).slice(0, 10); }

/** Resolve a datetime-local field with IANA rules, including historical DST. */
export function mexicoDateTimeToISO(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("Indica una fecha y hora válidas de Ciudad de México.");
  const wall = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 16) !== value) throw new Error("La fecha u hora no existe.");
  let instant = wall;
  for (let pass = 0; pass < 4; pass++) {
    const represented = Date.parse(`${localDateTime(new Date(instant))}:00Z`);
    instant += wall - represented;
  }
  if (localDateTime(new Date(instant)) !== value) throw new Error("Esa hora no existe en Ciudad de México por el cambio horario. Verifica el registro.");
  if ([-3_600_000, 3_600_000].some(delta => localDateTime(new Date(instant + delta)) === value)) throw new Error("Esa hora histórica es ambigua por el cambio horario. Registra el instante con su zona horaria mediante la API.");
  return new Date(instant).toISOString();
}

export function dateTimeLabel(value?: string | null): string {
  if (!value) return "Sin hora registrada";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Sin hora registrada" : new Intl.DateTimeFormat("es-MX", {timeZone: OPERATING_TIMEZONE, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23"}).format(date);
}
