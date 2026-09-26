/** Preserve names as entered while keeping comparisons insensitive to accents/case. */
export function normalizeSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-MX").replace(/\s+/g, " ").trim();
}

export function parseDriverNames(value: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const line of value.split(/\r?\n/)) {
    const name = line.replace(/\s+/g, " ").trim();
    if (!name) continue;
    if (name.length > 100) throw new Error("Cada nombre puede tener hasta 100 caracteres.");
    const key = name.toLocaleLowerCase("es-MX");
    if (!seen.has(key)) {seen.add(key); names.push(name);}
  }
  if (names.length > 20) throw new Error("Puedes asignar hasta 20 conductores a una unidad.");
  return names;
}

export function matchesDriverNames(drivers: string[] | undefined, query: string): boolean {
  const words = normalizeSearch(query).split(" ").filter(Boolean);
  return !words.length || (drivers || []).some(driver => words.every(word => normalizeSearch(driver).includes(word)));
}
