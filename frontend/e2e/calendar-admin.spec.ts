import {expect, test, type Page} from "@playwright/test";
import {localDate} from "../lib/dates";

test.use({baseURL: process.env.YOKOHAMA_CALENDAR_TEST_URL || "http://127.0.0.1:3003", channel: "chromium"});

const today = localDate();
const month = today.slice(0, 7);
const year = Number(month.slice(0, 4));
const monthIndex = Number(month.slice(5, 7)) - 1;
const later = new Date(Date.UTC(year, monthIndex + 1, 12)).toISOString().slice(0, 10);
const earlier = new Date(Date.UTC(year, monthIndex - 1, 10)).toISOString().slice(0, 10);
const appointment = "d8f25f49-4b27-4b6f-8e0e-dbc8d4eaf160";
const unit = {id: 1, vin: "TST00000000000001", plate: "NPK-482-A", make: "Mazda", model: "Mazda3", version: "i Sport", current_km: 24000, in_service_date: "2021-01-01", maintenance_catalog: "mazda3-mx.v0.1.0"};
const manualUnit = {...unit, id: 2, plate: "PZL-913-B", make: "Toyota", model: "Corolla", maintenance_catalog: null};
const services = [{service_id: "aceite_normal", name: "Aceite y filtro"}, {service_id: "frenos_revision", name: "Revisión de frenos"}];
const proposal = {id: "source-visit", vehicle_id: 1, plate: unit.plate, version: unit.version, planned_date: `${month}-20`, service_ids: services.map(item => item.service_id), fault_ids: [], total_duration_hours: null, status: "proposed", explanation: "Servicios agrupados por ventana.", provisional: true};

async function fixture(page: Page, failFirst = false) {
  const writes: {method: string; path: string; body: Record<string, unknown>}[] = [];
  const errors: string[] = [];
  let visits: Record<string, unknown>[] = [proposal];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/backend/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/backend/", "");
    if (request.method() !== "GET") {
      const body = request.postDataJSON();
      writes.push({method: request.method(), path, body});
      if (failFirst && writes.length === 1) {await route.fulfill({status: 409, json: {detail: "Ese servicio ya está registrado en esta fecha. Revisa el historial."}}); return;}
      if (path.includes("appointments")) {
        visits = [{...proposal, id: appointment, appointment_id: appointment, planned_date: body.scheduled_date, original_date: proposal.planned_date, notes: body.notes, status: "scheduled", provisional: false, changes: [{previous_date: proposal.planned_date, scheduled_date: body.scheduled_date, changed_at: new Date().toISOString(), notes: body.notes}]}];
      } else {
        const vehicle = path.includes("vehicles/2/") ? manualUnit : unit;
        visits = [{...proposal, id: "completed-1", vehicle_id: vehicle.id, plate: vehicle.plate, planned_date: body.performed_on, performed_on: body.performed_on, captured_at: new Date().toISOString(), service_ids: body.service_ids.length ? body.service_ids : ["manual-work"], service_names: body.service_ids.length ? body.service_ids.map((id: string) => services.find(service => service.service_id === id)?.name) : [body.manual_description], status: "completed", notes: body.notes, provisional: false}];
      }
      await route.fulfill({status: 201, json: {id: appointment, created: 1, records: []}}); return;
    }
    const payload = path === "calendar" ? visits.filter(visit => String(visit.planned_date) >= url.searchParams.get("start")! && String(visit.planned_date) <= url.searchParams.get("end")!)
      : path === "catalog" ? {servicios: services.map(service => ({id: service.service_id, servicio: service.name}))}
      : path === "vehicles" ? [unit, manualUnit]
      : path === "vehicles/1/plan" ? {services}
      : path === "vehicles/2/plan" ? {services: []} : undefined;
    await route.fulfill({status: payload ? 200 : 404, json: payload || {detail: "Ruta no simulada"}});
  });
  return {writes, errors};
}

test("reprogramar lleva al nuevo mes y conserva las fechas anteriores", async ({page}) => {
  const state = await fixture(page);
  await page.goto("/calendario");
  await page.getByRole("button", {name: "Cambiar fecha", exact: true}).click();
  await page.getByLabel("Nueva fecha de la visita").fill(later);
  await page.getByLabel("Motivo del cambio (opcional)").fill("El taller confirmó disponibilidad.");
  await page.getByRole("button", {name: "Guardar nueva fecha"}).click();
  await expect.poll(() => state.writes[0]).toEqual({method: "POST", path: "vehicles/1/appointments", body: {scheduled_date: later, notes: "El taller confirmó disponibilidad.", service_ids: ["aceite_normal", "frenos_revision"], original_visit_id: "source-visit"}});
  await expect(page.getByLabel("Mes de visitas")).toHaveValue(later.slice(0, 7));
  await expect(page.getByText("Reprogramada", {exact: true})).toBeVisible();
  await expect(page.getByText(/Fecha inicial:/)).toBeVisible();
  await page.getByText("Ver cambios de fecha (1)").click();
  await expect(page.getByText(/→/).filter({hasText: "El taller confirmó disponibilidad."})).toBeVisible();
  await page.getByRole("button", {name: "Cambiar fecha", exact: true}).click();
  await page.getByLabel("Nueva fecha de la visita").fill(later.slice(0, 8) + "14");
  await page.getByRole("button", {name: "Guardar nueva fecha"}).click();
  await expect.poll(() => state.writes[1]?.path).toBe(`vehicles/1/appointments/${appointment}`);
  expect(state.writes[1].method).toBe("PATCH");
  expect(state.errors).toEqual([]);
});

test("captura tardía de otra marca acepta fecha pasada y km vacío y se ve en móvil", async ({page}, info) => {
  const state = await fixture(page);
  await page.goto("/calendario");
  await page.getByRole("button", {name: "Registrar servicio realizado", exact: true}).click();
  await page.getByLabel("Unidad del servicio").selectOption("2");
  await page.getByLabel("Fecha real del servicio").fill(earlier);
  await page.getByLabel(/^Trabajo realizado/).fill("Cambio de batería");
  await page.getByLabel("Notas o referencia del comprobante (opcional)").fill("Factura 456; recibido después por administración.");
  await page.setViewportSize({width: 390, height: 844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await page.screenshot({path: info.outputPath("captura-tardia-mobile.png"), fullPage: true});
  await page.getByRole("button", {name: "Guardar servicio realizado"}).click();
  await expect.poll(() => state.writes[0]?.body).toEqual({service_ids: [], performed_on: earlier, odometer_km: null, notes: "Factura 456; recibido después por administración.", manual_description: "Cambio de batería"});
  await expect(page.getByLabel("Mes de visitas")).toHaveValue(earlier.slice(0, 7));
  await expect(page.getByText("Realizado", {exact: true})).toBeVisible();
  await expect(page.getByText("Cambio de batería", {exact: true})).toBeVisible();
  await expect(page.getByText(/Realizado:.*Capturado:/)).toBeVisible();
  expect(state.errors).toEqual([]);
});

test("captura parcial conserva selección ante error y sólo envía el trabajo marcado", async ({page}) => {
  const state = await fixture(page, true);
  await page.goto("/calendario");
  await page.getByRole("button", {name: "Registrar realizado", exact: true}).click();
  await expect(page.getByLabel("Aceite y filtro", {exact: true})).toBeChecked();
  await page.getByLabel("Revisión de frenos", {exact: true}).uncheck();
  await page.getByLabel("Fecha real del servicio").fill(earlier);
  await page.getByLabel("Odómetro en ese servicio (km, opcional)").fill("22400");
  await page.getByRole("button", {name: "Guardar servicio realizado"}).click();
  await expect(page.getByRole("alert").filter({hasText: "No pudimos completar"})).toContainText("Ese servicio ya está registrado en esta fecha");
  await expect(page.getByLabel("Fecha real del servicio")).toHaveValue(earlier);
  await expect(page.getByLabel("Aceite y filtro", {exact: true})).toBeChecked();
  await expect(page.getByLabel("Revisión de frenos", {exact: true})).not.toBeChecked();
  expect(state.writes[0].body).toMatchObject({service_ids: ["aceite_normal"], performed_on: earlier, odometer_km: 22400});
  await page.getByRole("button", {name: "Guardar servicio realizado"}).click();
  await expect(page.getByText("Guardado", {exact: true})).toBeVisible();
  expect(state.writes).toHaveLength(2);
  expect(state.errors).toEqual([]);
});
