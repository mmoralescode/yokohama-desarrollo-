import {test, expect, type Page} from "@playwright/test";

test.use({baseURL: process.env.YOKOHAMA_VISUAL_TEST_URL || "http://127.0.0.1:3002", channel: "chromium", timezoneId: "Asia/Tokyo"});

const unit = {id: 1, vin: "TST00000000000001", plate: "TEST-001", make: "Mazda", model: "Mazda3", model_year: 2021, variant_id: "demo", version: "i Sport", body_style: "sedan", engine: "G25", transmission: "AT6", drive: "FWD", fuel_type: "gasolina", color: "gris", maintenance_catalog: "mazda3-mx.v0.1.0", current_km: 10000, in_service_date: "2021-06-01", usage_regime: "normal", severity_multiplier: 0.8, is_synthetic: true, traffic_light: "red", next_visit_date: "2026-09-25", open_alerts: 1, usage_km_per_day: 65};
const manualUnit = {...unit, make: "Toyota", model: "Corolla", variant_id: "manual", maintenance_catalog: null};
const service = {service_id: "aceite_normal", name: "Aceite y filtro", action: "reemplazo", status: "upcoming", due_date: "2026-09-25", latest_entry_date: "2026-09-24", due_odometer: 10800, km_remaining: 800, severity: "importante", confidence: "media", window_start: "2026-09-20", window_end: "2026-09-24", prediction: {optimistic: "2026-09-25", probable: "2026-09-25", pessimistic: "2026-09-24"}, explanation: "Referencia por validar.", requires_validation: true, source_urls: [], duration_hours: null};
const detail = {vehicle: unit, readings: [{id: 1, vehicle_id: 1, date: "2026-09-20", recorded_at: "2026-09-20T18:00:00Z", source: "gps", odometer_km: 10000}], history: [{id: 1, service_id: "aceite_normal", performed_on: "2026-09-18", odometer_km: 9900, notes: "Muestra sintética", cost: 1250, maintenance_type: "preventive", predicted_due_date: "2026-09-20", prediction_error_days: -2}], faults: [{id: 1, description: "Moldura floja evaluada", dtc: null, reported_on: "2026-09-20", severity: "menor", status: "open", safe_to_defer: false, deadline: null, resolution_notes: null, was_predicted: false}], downtime: [{id: 1, vehicle_id: 1, started_at: "2026-09-20T18:00:00Z", ended_at: null, notes: "Diagnóstico"}]};
const plan = {vehicle_id: 1, generated_on: "2026-09-21", catalog_version: "test", mode: "demo", usage: {km_per_day: 65, low_km_per_day: 50, high_km_per_day: 80, confidence: "media", valid_intervals: 5, rejected_readings: 0, explanation: "Promedio ponderado"}, services: [service], visits: [], alerts: [], traffic_light: "red", warnings: []};
const metrics = {total_services: 5, classified_services: 4, preventive_services: 3, services_before_failure_percent: 75, prediction_samples: 2, mean_absolute_error_days: 2, mean_signed_error_days: -1, unpredicted_failures: 1, classified_failures: 2, total_failures: 3, downtime_days: 1.5, open_downtimes: 1, as_of: "2026-09-21", timezone: "America/Mexico_City"};
const variants = {variantes: [{id: "mazda3-2021", anio_modelo: 2021, carroceria: "sedán", version: "i Sport", motor: "G25", transmisiones: ["AT6"], traccion: "FWD"}]};

async function fixture(page: Page, vehicle: typeof unit | typeof manualUnit = unit) {
  const writes: {path: string; body: Record<string, unknown>}[] = [];
  const reads: string[] = [];
  const errors: string[] = [];
  const planForVehicle = vehicle.maintenance_catalog ? plan : {...plan, services: []};
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/backend/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/backend/", "");
    if (request.method() !== "GET") {
      writes.push({path, body: request.postDataJSON()});
      await route.fulfill({status: request.method() === "POST" ? 201 : 200, json: {id: 99}});
      return;
    }
    reads.push(path + url.search);
    const payload = path === "vehicles" ? [{...vehicle, id: 2, plate: "TEST-002", traffic_light: "green"}, vehicle]
      : path === "variants" ? variants
      : path === "vehicles/1" ? {...detail, vehicle} : path === "vehicles/1/plan" ? planForVehicle : path === "metrics" ? metrics : undefined;
    await route.fulfill({status: payload ? 200 : 404, json: payload || {detail: "Unexpected fixture route"}});
  });
  return {writes, reads, errors};
}

test("alta manual conserva datos multimarca y no asigna un catálogo Mazda", async ({page}) => {
  const state = await fixture(page);
  await page.goto("/");
  await page.getByRole("button", {name: "Agregar unidad", exact: true}).click();
  await expect(page.getByLabel("Plantilla de vehículo")).toHaveValue("manual");
  await page.getByLabel("Número de serie (VIN)", {exact: true}).fill("1HGCM82633A004352");
  await expect(page.getByLabel("Factor de intervalo", {exact: true})).not.toBeVisible();
  await expect(page.getByLabel("Factor de intervalo", {exact: true})).toHaveValue("1");
  await page.getByLabel("Placas", {exact: true}).fill("GEN-2024");
  await page.getByLabel("Marca", {exact: true}).fill("Toyota");
  await page.getByLabel("Modelo", {exact: true}).fill("Corolla");
  await page.getByLabel("Año modelo", {exact: true}).fill("2024");
  await page.getByLabel("Versión", {exact: true}).fill("XLE");
  await page.getByLabel("Carrocería", {exact: true}).fill("sedán");
  await page.getByLabel("Motor", {exact: true}).fill("2.0 L");
  await page.getByLabel("Transmisión", {exact: true}).fill("CVT");
  await page.getByLabel("Tracción", {exact: true}).fill("FWD");
  await page.getByLabel("Combustible (opcional)", {exact: true}).fill("gasolina");
  await page.getByLabel("Color (opcional)", {exact: true}).fill("blanco");
  await page.getByLabel("Odómetro actual (km)").fill("18450.5");
  await page.getByLabel("Fecha de puesta en servicio").fill("2024-02-01");
  await page.getByRole("button", {name: "Agregar a flotilla"}).click();
  await expect.poll(() => state.writes[0]?.body).toEqual({vin: "1HGCM82633A004352", plate: "GEN-2024", make: "Toyota", model: "Corolla", model_year: 2024, version: "XLE", body_style: "sedán", engine: "2.0 L", transmission: "CVT", drive: "FWD", fuel_type: "gasolina", color: "blanco", current_km: 18450.5, in_service_date: "2024-02-01", usage_regime: "normal", severity_multiplier: 1, is_synthetic: false, drivers: []});
  expect(state.writes[0].body).not.toHaveProperty("variant_id");
  expect(state.writes[0].body).not.toHaveProperty("maintenance_catalog");
  await expect(page.getByText("Unidad registrada. Agrega sus lecturas y servicios para mejorar la proyección.")).toBeVisible();
  expect(state.errors).toEqual([]);
});

test("plantilla Mazda3 mantiene el catálogo y precarga sus datos documentados", async ({page}) => {
  const state = await fixture(page);
  await page.goto("/");
  await page.getByRole("button", {name: "Agregar unidad", exact: true}).click();
  await page.getByLabel("Plantilla de vehículo").selectOption("mazda3");
  await page.getByLabel("Modelo Mazda3 del catálogo").selectOption("mazda3-2021");
  await page.getByLabel("Número de serie (VIN)", {exact: true}).fill("3MZBPABM7LM123456");
  await page.getByLabel("Placas", {exact: true}).fill("MZD-2021");
  await page.getByLabel("Odómetro actual (km)").fill("12000");
  await page.getByLabel("Fecha de puesta en servicio").fill("2021-06-01");
  await page.getByRole("button", {name: "Agregar a flotilla"}).click();
  await expect.poll(() => state.writes[0]?.body).toEqual({vin: "3MZBPABM7LM123456", plate: "MZD-2021", make: "Mazda", model: "Mazda3", model_year: 2021, version: "i Sport", body_style: "sedán", engine: "G25", transmission: "AT6", drive: "FWD", fuel_type: null, color: null, current_km: 12000, in_service_date: "2021-06-01", usage_regime: "normal", severity_multiplier: 1, is_synthetic: false, drivers: [], variant_id: "mazda3-2021", maintenance_catalog: "mazda3-mx.v0.1.0"});
  expect(state.errors).toEqual([]);
});

test("unidad sin catálogo conserva odómetro y fallas y enlaza la captura administrativa", async ({page}) => {
  const state = await fixture(page, manualUnit);
  await page.goto("/vehiculos/1");
  await expect(page.getByRole("heading", {name: "TEST-001"})).toBeVisible();
  await expect(page.getByText("Esta unidad no tiene un catálogo de mantenimiento asociado.")).toBeVisible();
  await expect(page.getByRole("button", {name: "Servicio", exact: true})).toHaveCount(0);
  await expect(page.getByRole("button", {name: "Odómetro", exact: true})).toBeVisible();
  await expect(page.getByRole("button", {name: "Falla", exact: true})).toBeVisible();
  await expect(page.getByRole("link", {name: "Registrar un servicio ya realizado en el calendario →"})).toHaveAttribute("href", "/calendario?unidad=1");
  expect(state.errors).toEqual([]);
});

test("urgency order and cohort metrics are clear on desktop and mobile", async ({page}, info) => {
  const state = await fixture(page);
  await page.goto("/");
  await expect(page.locator("tbody tr .plate-link")).toHaveText(["TEST-001", "TEST-002"]);
  await page.locator("summary").filter({hasText: "Resultados del mantenimiento"}).click();
  await expect(page.getByLabel("Unidades incluidas")).toHaveValue("true");
  await expect(page.getByText("75 %", {exact: true})).toBeVisible();
  await page.getByLabel("Unidades incluidas").selectOption("false");
  await expect.poll(() => state.reads).toContain("metrics?synthetic=false");
  await page.setViewportSize({width: 390, height: 844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await page.screenshot({path: info.outputPath("metrics-mobile.png"), fullPage: true});
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("readings, services, feedback and downtime send explicit normalized data", async ({page}, info) => {
  const state = await fixture(page);
  await page.goto("/vehiculos/1");
  await expect(page.getByRole("heading", {name: "TEST-001"})).toBeVisible();
  await expect(page.getByText("2 días antes de lo previsto")).toBeVisible();
  await page.getByLabel("Fecha y hora de lectura (CDMX)").fill("2026-09-20T12:00");
  await page.getByLabel("Odómetro (km)", {exact: true}).fill("10000");
  await page.getByLabel("Fuente de lectura").selectOption("obd");
  await page.getByRole("button", {name: "Guardar registro", exact: true}).click();
  await expect.poll(() => state.writes[0]?.body).toEqual({recorded_at: "2026-09-20T18:00:00.000Z", odometer_km: 10000, source: "obd"});
  await page.getByRole("button", {name: "Servicio", exact: true}).click();
  await page.getByLabel("Servicio del catálogo").selectOption("aceite_normal");
  await page.getByLabel("Odómetro al realizarlo (km)").fill("10000");
  await page.getByLabel("Costo (MXN, opcional)").fill("900.50");
  await page.getByLabel("Tipo de mantenimiento").selectOption("corrective");
  await page.getByLabel("Falla atendida (opcional)").selectOption("1");
  await page.getByRole("button", {name: "Guardar registro", exact: true}).click();
  await expect.poll(() => state.writes[1]?.body.cost).toBe(900.5);
  expect(state.writes[1].body).toMatchObject({maintenance_type: "corrective", fault_id: 1});
  await page.getByRole("button", {name: "Falla", exact: true}).click();
  await page.getByLabel("Descripción del síntoma").fill("Moldura con vibración reportada por operador.");
  await page.getByLabel("Componente relacionado (opcional)").selectOption("aceite_normal");
  await page.getByLabel("¿Se había previsto esta falla?").selectOption("false");
  await page.getByRole("button", {name: "Registrar falla y alertar"}).click();
  await expect.poll(() => state.writes[2]?.body.was_predicted).toBe(false);
  expect(state.writes[2].body.service_id).toBe("aceite_normal");
  await page.getByRole("button", {name: "Registrar regreso a operación"}).click();
  await page.getByLabel("Regreso a operación (CDMX)").fill("2026-09-20T15:00");
  await page.getByRole("button", {name: "Cerrar periodo"}).click();
  await expect.poll(() => state.writes[3]?.path).toBe("vehicles/1/downtime/1");
  expect(state.writes[3].body.ended_at).toBe("2026-09-20T21:00:00.000Z");
  await page.locator("summary").filter({hasText: "Configuración avanzada"}).click();
  await page.getByLabel("Factor de intervalo").fill("0.7");
  await page.getByRole("combobox", {name: "Régimen de uso", exact: true}).selectOption("severe");
  await page.getByRole("button", {name: "Guardar condiciones"}).click();
  await expect.poll(() => state.writes[4]?.body).toEqual({severity_multiplier: 0.7, usage_regime: "severe"});
  await page.getByRole("button", {name: "Registrar periodo", exact: true}).click();
  await page.getByLabel("Inicio (CDMX)", {exact: true}).fill("2026-09-19T08:00");
  await page.getByLabel("Regreso (opcional, CDMX)", {exact: true}).fill("2026-09-19T10:30");
  await page.getByRole("button", {name: "Guardar registro", exact: true}).click();
  await expect.poll(() => state.writes[5]?.body).toEqual({started_at: "2026-09-19T14:00:00.000Z", ended_at: "2026-09-19T16:30:00.000Z", notes: ""});
  await page.setViewportSize({width: 390, height: 844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await page.screenshot({path: info.outputPath("detail-mobile.png"), fullPage: true});
  expect(state.errors).toEqual([]);
});
