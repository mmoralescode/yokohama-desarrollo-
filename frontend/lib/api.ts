"use client";
import {useCallback, useEffect, useRef, useState} from "react";
export {localDate, localDateTime, mexicoDateTimeToISO, dateTimeLabel} from "./dates";

function errorMessage(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map(item => {
    const value = item as {msg?: string; loc?: (string | number)[]};
    return `${value.loc?.filter(part => part !== "body").join(" / ") || "Formulario"}: ${value.msg || "valor inválido"}`;
  }).join(". ");
  return "No se pudo completar la solicitud.";
}
export async function api<T>(path: string, options: {method?: "POST" | "PATCH"; body?: unknown; signal?: AbortSignal} = {}): Promise<T> {
  const response = await fetch(`/api/backend/${path}`, {
    method: options.method || "GET", signal: options.signal, cache: "no-store",
    headers: options.method ? {"Content-Type": "application/json"} : undefined,
    body: options.method ? JSON.stringify(options.body ?? {}) : undefined
  });
  const data = await response.json().catch(() => ({detail: "El servidor devolvió una respuesta inesperada."}));
  if (!response.ok) {
    const fields = Array.isArray(data.errors) ? data.errors.map((item: {campo?: string; mensaje?: string}) => `${item.campo || "Formulario"}: ${item.mensaje || "valor inválido"}`).join(". ") : "";
    throw new Error([errorMessage(data.detail), fields].filter(Boolean).join(" "));
  }
  return data as T;
}
export function useResource<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const lastPath = useRef(path);
  useEffect(() => {
    const controller = new AbortController();
    if (lastPath.current !== path) {setData(null); lastPath.current = path;}
    setLoading(true); setError(null);
    api<T>(path, {signal: controller.signal}).then(setData).catch(e => {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Error de conexión.");
    }).finally(() => {if (!controller.signal.aborted) setLoading(false);});
    return () => controller.abort();
  }, [path, revision]);
  return {data, error, loading, refresh};
}
export function dateLabel(value?: string | null): string {
  if (!value) return "Sin fecha validada";
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? "Sin fecha validada" : new Intl.DateTimeFormat("es-MX", {timeZone: "UTC", day: "2-digit", month: "short", year: "numeric"}).format(date);
}
export function numberLabel(value?: number | null, decimals = 0): string {
  return value == null || !Number.isFinite(value) ? "—" : new Intl.NumberFormat("es-MX", {maximumFractionDigits: decimals}).format(value);
}
