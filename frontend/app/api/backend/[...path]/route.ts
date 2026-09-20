import { NextRequest, NextResponse } from "next/server";
import { isLoopback, localRequestOrigin } from "@/lib/local-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 32_768;
const routes: Record<string, RegExp[]> = {
  GET: [/^vehicles$/, /^vehicles\/[1-9]\d*$/, /^vehicles\/[1-9]\d*\/plan$/, /^calendar$/, /^alerts$/, /^catalog$/, /^variants$/, /^notifications$/],
  POST: [/^vehicles$/, /^vehicles\/[1-9]\d*\/(readings|services|faults)$/, /^recalculate$/],
  PATCH: [/^faults\/[1-9]\d*\/resolve$/]
};
function error(detail: string, status: number) { return NextResponse.json({detail}, {status, headers: {"Cache-Control": "no-store"}}); }

// Never log the exception, URL, headers, key or payload. Allowlist transport codes only.
function transportCode(cause: unknown): string {
  const failure = cause as {name?: string; code?: unknown; cause?: {code?: unknown}} | null;
  if (failure?.name === "TimeoutError") return "REQUEST_TIMEOUT";
  if (failure?.name === "AbortError") return "REQUEST_ABORTED";
  const code = failure?.cause?.code ?? failure?.code;
  const allowed = new Set(["ECONNRESET", "ECONNREFUSED", "ECONNABORTED", "EPIPE", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_ABORTED"]);
  return typeof code === "string" && allowed.has(code) ? code : "TRANSPORT_ERROR";
}

async function fetchUpstream(url: URL, options: RequestInit): Promise<Response> {
  const method = options.method || "GET";
  try { return await fetch(url, options); }
  catch (cause) {
    console.warn(`[yokohama-proxy] ${method} ${transportCode(cause)}`);
    // GET alone is safe to repeat after a dropped loopback socket. HTTP errors and
    // parsing failures are outside this catch; mutations must never be replayed.
    if (method !== "GET" || options.signal?.aborted) throw cause;
    try { return await fetch(url, options); }
    catch (retryCause) {
      console.warn(`[yokohama-proxy] ${method} ${transportCode(retryCause)}`);
      throw retryCause;
    }
  }
}

async function forward(request: NextRequest, context: {params: Promise<{path: string[]}>}) {
  const origin = localRequestOrigin(request.headers.get("host"));
  if (!origin || request.headers.get("sec-fetch-site") === "cross-site") return error("Acceso reservado al MVP local.", 403);
  const method = request.method;
  if (method !== "GET" && request.headers.get("origin") !== origin) return error("La operación debe originarse en este panel local.", 403);
  const {path} = await context.params;
  const route = path.join("/");
  if (!(routes[method] || []).some(pattern => pattern.test(route))) return error("Ruta no permitida.", 404);
  const key = process.env.YOKOHAMA_API_KEY;
  if (!key?.trim() || !process.env.YOKOHAMA_API_URL) return error("Configura YOKOHAMA_API_URL y YOKOHAMA_API_KEY en el servidor del panel.", 503);
  let upstream: URL;
  try {
    upstream = new URL(process.env.YOKOHAMA_API_URL);
    if (upstream.protocol !== "http:" || !isLoopback(upstream.hostname) || upstream.username || upstream.password || upstream.pathname !== "/" || upstream.search || upstream.hash) throw new Error("invalid");
  } catch { return error("La API del MVP debe usar una dirección HTTP loopback sin rutas ni credenciales.", 503); }
  upstream.pathname = `/api/${route}`;
  if (route === "calendar") {
    for (const name of ["start", "end"]) {
      const value = request.nextUrl.searchParams.get(name);
      if (value) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return error("Fechas de calendario inválidas.", 400);
        upstream.searchParams.set(name, value);
      }
    }
  }
  let body: string | undefined;
  if (method !== "GET") {
    if (!request.headers.get("content-type")?.startsWith("application/json")) return error("Se requiere contenido JSON.", 415);
    if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) return error("El formulario excede el tamaño permitido.", 413);
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > MAX_BODY_BYTES) { await reader.cancel(); return error("El formulario excede el tamaño permitido.", 413); }
        chunks.push(next.value);
      }
    }
    body = Buffer.concat(chunks).toString("utf8");
    try { JSON.parse(body); } catch { return error("JSON inválido.", 400); }
  }
  try {
    // One timeout budget is shared by the initial GET and its optional retry.
    const response = await fetchUpstream(upstream, {
      method, headers: {"X-API-Key": key, "Content-Type": "application/json", "Accept": "application/json"},
      body, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000)
    });
    if (response.status === 401 || response.status === 403) return error("La clave del panel no coincide con la API local. Revisa la configuración del servidor.", 503);
    if (response.status >= 500) return error("La API no pudo completar la operación. Revisa sus registros locales.", 502);
    const data: unknown = await response.json();
    return NextResponse.json(data, {status: response.status, headers: {"Cache-Control": "no-store"}});
  } catch { return error("No se pudo conectar con la API local. Comprueba que el backend esté encendido.", 502); }
}
export {forward as GET, forward as POST, forward as PATCH};
