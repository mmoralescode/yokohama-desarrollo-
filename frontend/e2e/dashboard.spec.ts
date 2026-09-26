import {expect, test, type Page} from "@playwright/test";
import type {Alert, VehicleSummary, Visit} from "../lib/types";

// Every backend request is intercepted. These dashboard tests never mutate the
// running application's database, including when opening the capture forms.
test.use({baseURL: process.env.YOKOHAMA_DASHBOARD_TEST_URL || "http://127.0.0.1:3001", channel: "chromium"});

const units: VehicleSummary[] = [
  {id: 1, plate: "KPA-101-A", traffic_light: "red", is_synthetic: false, drivers: ["Ana López"], maintenance_catalog: "mazda3-mx.v0.1.0", next_visit_date: "2026-09-28"},
  {id: 2, plate: "KPA-102-A", traffic_light: "gray", is_synthetic: false, drivers: [], maintenance_catalog: null, next_visit_date: "2026-09-30"},
  {id: 3, plate: "KPA-103-A", traffic_light: "red", is_synthetic: true, drivers: ["Conductor de ejemplo"], maintenance_catalog: "mazda3-mx.v0.1.0", next_visit_date: "2026-10-01"},
  {id: 4, plate: "KPA-104-A", traffic_light: "green", is_synthetic: false, drivers: ["Luis Torres"], maintenance_catalog: "mazda3-mx.v0.1.0", next_visit_date: null}
].map(unit => ({make: "Mazda", model: "Mazda3", model_year: 2024, variant_id: null, version: "i Sport", body_style: "sedán", engine: "2.0 L", transmission: "AT", drive: "FWD", current_km: 25000, in_service_date: "2024-01-01", usage_regime: "normal", severity_multiplier: 1, usage_km_per_day: 30, open_alerts: unit.traffic_light === "red" ? 2 : 0, vin: `TST0000000000000${unit.id}`, ...unit})) as VehicleSummary[];

function visit(id: string, vehicleId: number, date: string, services: string[], status: string, capturedAt?: string): Visit {
  const unit = units.find(item => item.id === vehicleId)!;
  return {id, vehicle_id: vehicleId, plate: unit.plate, version: unit.version, drivers: unit.drivers, planned_date: date, service_ids: services, service_names: services.map(service => service === "oil" ? "Aceite y filtro" : "Revisión de frenos"), fault_ids: [], total_duration_hours: null, status, explanation: "Registro de prueba del dashboard", provisional: status === "proposed", ...(status === "completed" ? {performed_on: date, captured_at: capturedAt} : {})};
}

const visits = [
  visit("scheduled-real", 1, "2026-09-28", ["oil", "brakes"], "scheduled"),
  visit("proposed-real", 2, "2026-09-30", ["brakes"], "proposed"),
  visit("scheduled-example", 3, "2026-10-01", ["oil"], "scheduled"),
  // Two individual services in one real visit, not two vehicle visits.
  visit("completed-real", 4, "2026-09-05", ["oil", "brakes"], "completed", "2026-09-24T17:00:00Z"),
  visit("completed-example", 3, "2026-09-10", ["oil"], "completed", "2026-09-11T17:00:00Z"),
  // Captured in September, performed in August: must stay in August's totals.
  visit("late-capture", 1, "2026-08-31", ["oil"], "completed", "2026-09-26T17:00:00Z"),
  visit("oldest-month", 1, "2026-04-12", ["oil"], "completed", "2026-04-15T17:00:00Z")
];

const alerts: Alert[] = [
  {key: "critical-1", vehicle_id: 1, severity: "critico", message: "Revisar sistema de frenos", status: "open"},
  {key: "critical-1-again", vehicle_id: 1, severity: "critico", message: "Segundo aviso de la misma unidad", status: "open"},
  {key: "critical-example", vehicle_id: 3, severity: "critico", message: "Alerta de ejemplo", status: "open"},
  {key: "resolved-4", vehicle_id: 4, severity: "critico", message: "Aviso ya resuelto", status: "resolved"},
  {key: "orphan", vehicle_id: 99, severity: "critico", message: "Aviso de una unidad fuera del conjunto", status: "open"}
].map(alert => ({service_id: null, fault_id: null, deadline: "2026-09-26", days_remaining: 0, threshold_days: 7, kind: "fault", ...alert})) as Alert[];

async function fixture(page: Page, failCalendar = false) {
  await page.clock.setFixedTime(new Date("2026-09-26T18:00:00Z"));
  const state = {failCalendar, reads: [] as string[], writes: [] as string[], errors: [] as string[]};
  page.on("pageerror", error => state.errors.push(error.message));
  await page.route("**/api/backend/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/backend/", "");
    if (request.method() !== "GET") {
      state.writes.push(`${request.method()} ${path}`);
      await route.fulfill({status: 405, json: {detail: "La prueba del dashboard es de solo lectura."}});
      return;
    }
    state.reads.push(`${path}${url.search}`);
    if (path === "calendar" && state.failCalendar) {
      await route.fulfill({status: 503, json: {detail: "Agenda temporalmente no disponible."}});
      return;
    }
    const payload = path === "vehicles" ? units
      : path === "alerts" ? alerts
      : path === "calendar" ? visits.filter(entry => entry.planned_date >= (url.searchParams.get("start") || "") && entry.planned_date <= (url.searchParams.get("end") || "9999"))
      : path === "variants" ? {variantes: []}
      : path === "catalog" ? {servicios: [{id: "oil", servicio: "Aceite y filtro"}, {id: "brakes", servicio: "Revisión de frenos"}]}
      : /^vehicles\/\d+\/plan$/.test(path) ? {services: []}
      : path === "metrics" ? {total_services: 0, classified_services: 0, preventive_services: 0, services_before_failure_percent: null, prediction_samples: 0, mean_absolute_error_days: null, mean_signed_error_days: null, unpredicted_failures: 0, classified_failures: 0, total_failures: 0, downtime_days: 0, open_downtimes: 0, as_of: "2026-09-26", timezone: "America/Mexico_City"}
      : undefined;
    await route.fulfill({status: payload === undefined ? 404 : 200, json: payload ?? {detail: `Ruta no simulada: ${path}`}});
  });
  return state;
}

async function counts(page: Page, expected: [number, number, number, number]) {
  for (const [index, key] of ["fleet", "critical", "upcoming", "completed"].entries()) {
    await expect(page.getByTestId(`dashboard-${key}-count`).locator("strong")).toHaveText(String(expected[index]));
  }
}

test("resume unidades, próximas visitas y servicios según fecha real, sin duplicar alertas", async ({page}) => {
  const state = await fixture(page);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", {level: 1, name: "Dashboard de flotilla"})).toBeVisible();
  await counts(page, [4, 2, 3, 3]);
  await expect(page.getByRole("navigation", {name: "Navegación principal"}).getByRole("link")).toHaveText(["Mi flotilla", "Calendario", "Alertas", "Dashboard"]);
  await expect(page.getByTestId("dashboard-month-2026-04").locator("strong")).toHaveText("1");
  await expect(page.getByTestId("dashboard-month-2026-08").locator("strong")).toHaveText("1");
  await expect(page.getByTestId("dashboard-month-2026-09").locator("strong")).toHaveText("3");
  await expect(page.locator('[data-testid^="dashboard-month-"]')).toHaveCount(6);
  expect(state.reads).toContain("calendar?start=2026-04-01&end=2026-10-02");
  const priorities = page.locator("#dashboard-prioridades");
  await expect(priorities.getByRole("link", {name: /KPA-101-A/})).toHaveCount(1);
  await expect(priorities).not.toContainText("Aviso ya resuelto");
  await expect(priorities).not.toContainText("Aviso de una unidad fuera del conjunto");
  const agenda = page.locator("#dashboard-agenda");
  const octoberVisit = agenda.locator('a[href*="mes=2026-10"]').first();
  await expect(octoberVisit).toHaveAttribute("href", /placa=KPA-103-A/);
  await octoberVisit.click();
  await expect(page.getByLabel("Mes de visitas")).toHaveValue("2026-10");
  await expect(page.locator(".agenda-entry")).toHaveCount(1);
  await expect(page.locator(".agenda-entry")).toContainText("KPA-103-A");
  await expect(page.locator("#calendar-entry-form")).toHaveCount(0);
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("filtrar reales o ejemplos actualiza todos los paneles y permite completar datos", async ({page}) => {
  const state = await fixture(page);
  await page.goto("/dashboard");
  await counts(page, [4, 2, 3, 3]);
  const cohort = page.getByLabel("Unidades incluidas en dashboard");
  await cohort.selectOption("real");
  await counts(page, [3, 1, 2, 2]);
  await expect(page.locator("#dashboard-prioridades")).not.toContainText("KPA-103-A");
  await expect(page.locator("#dashboard-agenda")).not.toContainText("KPA-103-A");
  await expect(page.getByTestId("dashboard-month-2026-09").locator("strong")).toHaveText("2");
  const pending = page.locator("#dashboard-pendientes");
  for (const category of ["Sin conductor", "Datos por validar", "Sin catálogo"]) {
    await pending.getByRole("button", {name: new RegExp(category)}).click();
    await expect(pending.locator(".dashboard-data-list")).toContainText("KPA-102-A");
    await expect(pending.locator(".dashboard-data-list").getByRole("link")).toHaveCount(1);
  }
  await cohort.selectOption("synthetic");
  await counts(page, [1, 1, 1, 1]);
  await expect(page.locator("#dashboard-prioridades")).toContainText("KPA-103-A");
  await expect(page.locator("#dashboard-prioridades")).not.toContainText("KPA-101-A");
  await expect(page.locator("#dashboard-agenda")).not.toContainText("KPA-102-A");
  await expect(page.getByTestId("dashboard-month-2026-04").locator("strong")).toHaveText("0");
  await expect(page.getByTestId("dashboard-month-2026-08").locator("strong")).toHaveText("0");
  await expect(page.getByTestId("dashboard-month-2026-09").locator("strong")).toHaveText("1");
  await expect(pending.locator(".dashboard-data-list")).not.toContainText("KPA-102-A");
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("una falla de consulta no presenta ceros como resultados y permite reintentar", async ({page}) => {
  const state = await fixture(page, true);
  await page.goto("/dashboard");
  await expect(page.locator(".dashboard").getByRole("alert")).toContainText("Agenda temporalmente no disponible");
  await expect(page.locator('[data-testid="dashboard-fleet-count"] strong').filter({hasText: /^0$/})).toHaveCount(0);
  await expect(page.locator('[data-testid="dashboard-completed-count"] strong').filter({hasText: /^0$/})).toHaveCount(0);
  await expect(page.locator('[data-testid^="dashboard-month-"]')).toHaveCount(0);
  state.failCalendar = false;
  await page.getByRole("button", {name: "Volver a intentar", exact: true}).click();
  await counts(page, [4, 2, 3, 3]);
  await expect(page.locator(".dashboard").getByRole("alert")).toHaveCount(0);
  const priorReads = state.reads.filter(path => path.startsWith("calendar?")).length;
  await page.getByRole("button", {name: "Actualizar dashboard", exact: true}).click();
  await expect.poll(() => state.reads.filter(path => path.startsWith("calendar?")).length).toBeGreaterThan(priorReads);
  await counts(page, [4, 2, 3, 3]);
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("en móvil caben las cuatro secciones y los accesos rápidos abren los formularios", async ({page}, info) => {
  const state = await fixture(page);
  await page.setViewportSize({width: 390, height: 844});
  await page.goto("/dashboard");
  await counts(page, [4, 2, 3, 3]);
  const nav = page.getByRole("navigation", {name: "Navegación principal"});
  for (const name of ["Mi flotilla", "Calendario", "Alertas", "Dashboard"]) {
    const link = nav.getByRole("link", {name, exact: true});
    await expect(link).toBeVisible();
    const bounds = await link.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(-1);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await page.screenshot({path: info.outputPath("dashboard-mobile.png"), fullPage: true});
  await page.getByRole("link", {name: "Registrar servicio", exact: true}).click();
  await expect(page).toHaveURL(/\/calendario\?registro=1$/);
  await expect(page.getByRole("heading", {name: "Registrar servicio realizado", exact: true})).toBeVisible();
  await page.getByLabel("Unidad del servicio").selectOption("2");
  await expect(page.getByLabel("Fecha real del servicio")).toHaveValue("2026-09-26");
  await expect(page.getByLabel(/^Trabajo realizado/)).toBeVisible();
  await nav.getByRole("link", {name: "Dashboard", exact: true}).click();
  await page.getByRole("link", {name: "Agregar unidad", exact: true}).click();
  await expect(page).toHaveURL(/\/\?alta=1$/);
  await expect(page.getByRole("heading", {name: "Registrar unidad", exact: true})).toBeVisible();
  await expect(page.getByLabel("Número de serie (VIN)", {exact: true})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});
