import {expect, test} from "@playwright/test";
import {localDate} from "../lib/dates";

test.use({baseURL: process.env.YOKOHAMA_PROPOSAL_TEST_URL || "http://127.0.0.1:3004", channel: "chromium"});

test("dashboard público muestra ejemplos, filtra y navega en móvil sin API privada", async ({page}, info) => {
  const privateRequests: string[] = [];
  const errors: string[] = [];
  page.on("request", request => {if (new URL(request.url()).pathname.startsWith("/api/")) privateRequests.push(request.url());});
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/dashboard");
  await expect(page.getByText("Prueba la propuesta.", {exact: true})).toBeVisible();
  await expect(page.getByRole("heading", {name: "Dashboard de flotilla", exact: true})).toBeVisible();
  await expect(page.getByTestId("dashboard-fleet-count").locator("strong")).toHaveText("20");
  await expect(page.locator('[data-testid^="dashboard-month-"]')).toHaveCount(6);
  await expect(page.locator(".dashboard [role=alert]")).toHaveCount(0);
  await page.getByLabel("Unidades incluidas en dashboard").selectOption("real");
  for (const key of ["fleet", "critical", "upcoming", "completed"]) await expect(page.getByTestId(`dashboard-${key}-count`).locator("strong")).toHaveText("0");
  await expect(page.getByRole("heading", {name: "No hay unidades en esta selección"})).toBeVisible();
  await page.getByLabel("Unidades incluidas en dashboard").selectOption("synthetic");
  await expect(page.getByTestId("dashboard-fleet-count").locator("strong")).toHaveText("20");
  await page.screenshot({path: info.outputPath("dashboard-public-desktop.png"), fullPage: true});
  await page.setViewportSize({width: 390, height: 844});
  const navigation = page.getByRole("navigation", {name: "Navegación principal"});
  await expect(navigation.getByRole("link")).toHaveText(["Mi flotilla", "Calendario", "Alertas", "Dashboard"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({path: info.outputPath("dashboard-public-mobile.png"), fullPage: true});
  await page.getByRole("link", {name: "Agregar unidad", exact: true}).click();
  await expect(page.getByRole("heading", {name: "Registrar unidad", exact: true})).toBeVisible();
  expect(errors).toEqual([]);
  expect(privateRequests).toEqual([]);
});

test("captura de prueba se refleja en el dashboard y se conserva al recargar", async ({page}) => {
  await page.goto("/dashboard");
  // Refuse to mutate unless this is explicitly the browser-only proposal.
  await expect(page.getByText("Prueba la propuesta.", {exact: true})).toBeVisible();
  const completed = page.getByTestId("dashboard-completed-count").locator("strong");
  await expect(completed).toBeVisible();
  const before = Number((await completed.innerText()).replace(/\D/g, ""));
  await page.getByRole("link", {name: "Registrar servicio", exact: true}).click();
  await expect(page.getByRole("heading", {name: "Registrar servicio realizado", exact: true})).toBeVisible();
  await page.getByLabel("Unidad del servicio").selectOption("1");
  await page.getByLabel("Fecha real del servicio").fill(localDate());
  await page.locator('input[name="manual_description"]').fill("Inspección administrativa ficticia del dashboard");
  await page.getByRole("button", {name: "Guardar servicio realizado", exact: true}).click();
  await expect(page.getByText("Guardado", {exact: true})).toBeVisible();
  await page.getByRole("navigation", {name: "Navegación principal"}).getByRole("link", {name: "Dashboard", exact: true}).click();
  await expect(completed).toHaveText(new Intl.NumberFormat("es-MX").format(before + 1));
  await page.reload();
  await expect(completed).toHaveText(new Intl.NumberFormat("es-MX").format(before + 1));
  await expect(page.locator(".dashboard [role=alert]")).toHaveCount(0);
});
