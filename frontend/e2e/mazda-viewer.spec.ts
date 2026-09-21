import {test as base, expect, type Locator, type Page, type Route} from "@playwright/test";

const modelId = "a72de3f3c1604409a7e6fc6be9854c9d";
const modelPath = "/models/mazda3-hatchback-2020.glb";
const canvasLabel = "Modelo 3D del Mazda3 Hatchback 2020";
type Camera = {position: number[]; target: number[]};
type OfflineNetwork = {
  mode: "normal" | "pending" | "missing";
  modelRequests: string[];
  externalRequests: string[];
  releasePending: () => Promise<void>;
};

// Every test gets a clean browser context. Successful loads use the real local
// GLB and its embedded textures; there is no simulated renderer or model.
const test = base.extend<{offlineNetwork: OfflineNetwork}>({
  offlineNetwork: [async ({context, baseURL}, use) => {
    const appOrigin = new URL(baseURL!).origin;
    const pending: Route[] = [];
    const unexpectedBackend: string[] = [];
    const network: OfflineNetwork = {
      mode: "normal", modelRequests: [], externalRequests: [],
      async releasePending() {
        for (const route of pending.splice(0)) {
          // Closing the viewer can already have aborted the held request.
          await route.continue().catch(() => {});
        }
      },
    };
    await context.route("**/*", async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.protocol === "data:" || (url.protocol === "blob:" && url.origin === appOrigin)) {
        await route.continue();
        return;
      }
      if (url.origin !== appOrigin) {
        network.externalRequests.push(request.url());
        await route.abort("blockedbyclient");
        return;
      }
      if (url.pathname.startsWith("/api/backend/")) {
        if (request.method() === "GET" && url.pathname === "/api/backend/vehicles") {
          await route.fulfill({json: []});
        } else if (request.method() === "GET" && url.pathname === "/api/backend/metrics") {
          await route.fulfill({json: {total_services: 0, classified_services: 0, preventive_services: 0, services_before_failure_percent: null, prediction_samples: 0, mean_absolute_error_days: null, mean_signed_error_days: null, unpredicted_failures: 0, classified_failures: 0, total_failures: 0, downtime_days: 0, open_downtimes: 0, as_of: "2026-09-21", timezone: "America/Mexico_City"}});
        } else {
          unexpectedBackend.push(`${request.method()} ${url.pathname}`);
          await route.abort("blockedbyclient");
        }
        return;
      }
      if (url.pathname === modelPath) {
        network.modelRequests.push(request.url());
        if (network.mode === "missing") {
          await route.fulfill({status: 404, body: "Model unavailable for this failure test"});
          return;
        }
        if (network.mode === "pending") {
          pending.push(route);
          return;
        }
      }
      await route.continue();
    });
    await context.routeWebSocket("**", socket => {
      const url = new URL(socket.url());
      if (url.host === new URL(appOrigin).host) socket.connectToServer();
      else {
        network.externalRequests.push(socket.url());
        socket.close();
      }
    });
    await use(network);
    for (const route of pending.splice(0)) await route.abort("aborted").catch(() => {});
    expect(network.externalRequests, "The viewer must never attempt external HTTP or WebSocket connections").toEqual([]);
    expect(unexpectedBackend, "Only mocked fleet/metrics reads are allowed; no real backend access or mutations").toEqual([]);
  }, {auto: true}],
});

test.use({
  baseURL: process.env.YOKOHAMA_VISUAL_TEST_URL || "http://127.0.0.1:3001",
  channel: "chromium",
  reducedMotion: "no-preference",
  serviceWorkers: "block",
});

function canvasIn(viewer: Locator) {
  return viewer.locator(`canvas[aria-label="${canvasLabel}"]`);
}

async function camera(canvas: Locator): Promise<Camera> {
  const result = JSON.parse((await canvas.getAttribute("data-camera"))!) as Camera;
  expect(result.position).toHaveLength(3);
  expect(result.target).toHaveLength(3);
  expect([...result.position, ...result.target].every(Number.isFinite)).toBe(true);
  return result;
}

function radius(pose: Camera) {
  return Math.hypot(...pose.position.map((value, index) => value - pose.target[index]));
}

function expectSameCamera(actual: Camera, expected: Camera) {
  for (const field of ["position", "target"] as const) {
    for (let index = 0; index < 3; index++) expect(actual[field][index]).toBeCloseTo(expected[field][index], 6);
  }
}

async function renderCount(canvas: Locator) {
  return Number(await canvas.getAttribute("data-render-count"));
}

async function ready(viewer: Locator) {
  await expect(viewer).toHaveAttribute("data-state", "ready", {timeout: 60_000});
  const canvas = canvasIn(viewer);
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute("tabindex", "0");
  await expect.poll(() => renderCount(canvas)).toBeGreaterThan(0);
  await camera(canvas);
  await expect(viewer.locator("iframe")).toHaveCount(0);
  return canvas;
}

async function openViewer(page: Page) {
  await page.goto("/");
  const viewer = page.getByTestId("mazda-viewer");
  await expect(viewer).toHaveAttribute("data-state", "poster");
  await viewer.getByRole("button", {name: "Explorar en 3D", exact: true}).click();
  return viewer;
}

async function credits(viewer: Locator) {
  const disclosure = viewer.locator("details");
  const summary = disclosure.locator("summary");
  await expect(summary).toHaveText("Créditos");
  const wasOpen = await disclosure.getAttribute("open") !== null;
  if (!wasOpen) await summary.click();
  try {
    const author = disclosure.getByRole("link", {name: "Ddiaz Design", exact: true});
    await expect(author).toBeVisible();
    await expect(author).toHaveAttribute("href", "https://sketchfab.com/ddiaz-design");
    const source = disclosure.getByRole("link", {name: "2020 Mazda 3 Hatchback", exact: true});
    await expect(source).toBeVisible();
    await expect(source).toHaveAttribute("href", new RegExp(`${modelId}$`));
    const license = disclosure.locator('a[href="https://creativecommons.org/licenses/by-nc-sa/4.0/"]');
    await expect(license).toBeVisible();
    await expect(license).toContainText(/CC BY.NC.SA 4\.0/i);
  } finally {
    if (!wasOpen) await summary.click();
  }
  await expect(disclosure).toHaveJSProperty("open", wasOpen);
}

async function moveWithButton(viewer: Locator, name: string, key = "Enter") {
  const canvas = canvasIn(viewer);
  const before = await canvas.getAttribute("data-camera");
  const count = await renderCount(canvas);
  const control = viewer.getByRole("button", {name, exact: true});
  await expect(control).toBeEnabled();
  await control.focus();
  await control.press(key);
  await expect(canvas).not.toHaveAttribute("data-camera", before!);
  await expect.poll(() => renderCount(canvas)).toBeGreaterThan(count);
  await expect(control).toBeFocused();
  return camera(canvas);
}

test("la vista previa mínima mantiene los créditos cerrados y no descarga el GLB", async ({page, offlineNetwork}, testInfo) => {
  await page.setViewportSize({width: 1440, height: 1000});
  await page.goto("/");
  const viewer = page.getByTestId("mazda-viewer");
  const disclosure = viewer.locator("details");
  const summary = disclosure.locator("summary");
  await expect(viewer).toHaveAttribute("data-state", "poster");
  await expect(viewer.getByRole("img", {name: "Vista previa del Mazda3 Hatchback 2020", exact: true})).toBeVisible();
  await expect(viewer.getByRole("heading", {name: "Mazda3", exact: true})).toBeVisible();
  await expect(viewer.locator("p:visible")).toHaveCount(1);
  await expect(viewer.locator("p:visible")).toContainText("Arrastra para girar · Desliza para acercar");
  await expect(viewer.getByRole("heading", {name: "Mazda3 Hatchback.", exact: true})).toHaveCount(0);
  await expect(viewer.locator("canvas, iframe")).toHaveCount(0);
  await expect(disclosure).toHaveJSProperty("open", false);
  await credits(viewer);
  await summary.focus();
  await summary.press("Enter");
  await expect(disclosure).toHaveJSProperty("open", true);
  await credits(viewer);
  await summary.press("Space");
  await expect(disclosure).toHaveJSProperty("open", false);
  await expect(page.getByRole("heading", {name: "Aún no hay unidades", exact: true})).toBeVisible();
  expect(offlineNetwork.modelRequests).toEqual([]);
  await page.screenshot({path: testInfo.outputPath("mazda-local-preview-desktop.png"), fullPage: true});
});

test("el GLB real carga sin red externa y los gestos cambian la imagen renderizada", async ({page, offlineNetwork}, testInfo) => {
  await page.setViewportSize({width: 1440, height: 1000});
  const responsePromise = page.waitForResponse(response =>
    new URL(response.url()).pathname === modelPath && response.status() === 200);
  const viewer = await openViewer(page);
  const canvas = await ready(viewer);
  const response = await responsePromise;
  const bytes = await response.body();
  expect(bytes.subarray(0, 4).toString("ascii")).toBe("glTF");
  expect(bytes.readUInt32LE(4)).toBe(2);
  expect(bytes.byteLength).toBeGreaterThan(1_000_000);
  expect(bytes.readUInt32LE(8)).toBe(bytes.byteLength);
  expect(offlineNetwork.modelRequests).toHaveLength(1);
  expect(offlineNetwork.externalRequests).toEqual([]);
  const initial = await camera(canvas);
  const before = await canvas.screenshot({path: testInfo.outputPath("mazda-real-initial.png")});
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.6, {steps: 10});
  await page.mouse.up();
  await expect.poll(() => camera(canvas)).not.toEqual(initial);
  const rotated = await canvas.screenshot({path: testInfo.outputPath("mazda-real-rotated.png")});
  expect(rotated.equals(before), "Dragging must change the actual rendered model").toBe(false);
  const beforeZoom = radius(await camera(canvas));
  await page.mouse.wheel(0, -250);
  await expect.poll(async () => radius(await camera(canvas))).toBeLessThan(beforeZoom);
  const zoomed = await canvas.screenshot({path: testInfo.outputPath("mazda-real-zoomed.png")});
  expect(zoomed.equals(rotated), "Zooming must change the actual rendered model").toBe(false);
  await page.screenshot({path: testInfo.outputPath("mazda-local-ready-desktop.png"), fullPage: true});
});

test("los siete botones y el teclado del canvas operan la cámara y restauran el foco", async ({page}) => {
  await page.goto("/");
  const viewer = page.getByTestId("mazda-viewer");
  const launch = viewer.getByRole("button", {name: "Explorar en 3D", exact: true});
  await launch.focus();
  await launch.press("Enter");
  const canvas = await ready(viewer);
  const initial = await camera(canvas);
  await expect(viewer.getByRole("button", {name: "Girar a la izquierda", exact: true})).toBeFocused();
  for (const [index, name] of ["Girar a la izquierda", "Girar a la derecha", "Ver desde arriba", "Ver desde abajo", "Acercar", "Alejar"].entries()) {
    await moveWithButton(viewer, name, index % 2 ? "Space" : "Enter");
  }
  expectSameCamera(await moveWithButton(viewer, "Restablecer vista"), initial);
  await canvas.focus();
  const scrollBefore = await page.evaluate(() => scrollY);
  for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Shift+Equal", "-"]) {
    const before = await canvas.getAttribute("data-camera");
    await canvas.press(key);
    await expect(canvas).not.toHaveAttribute("data-camera", before!);
    await expect(canvas).toBeFocused();
  }
  expect(await page.evaluate(() => scrollY)).toBe(scrollBefore);
  await canvas.press("Home");
  await expect.poll(async () => {
    const current = await camera(canvas);
    return Math.max(...current.position.map((value, index) => Math.abs(value - initial.position[index])),
      ...current.target.map((value, index) => Math.abs(value - initial.target[index])));
  }).toBeLessThan(1e-6);
  const close = viewer.getByRole("button", {name: "Volver a vista previa", exact: true});
  await close.focus();
  await close.press("Space");
  await expect(viewer).toHaveAttribute("data-state", "poster");
  await expect(viewer.locator("canvas")).toHaveCount(0);
  await expect(launch).toBeFocused();
});

test("el visor no gira ni renderiza continuamente y respeta movimiento reducido", async ({page}) => {
  await page.clock.install();
  const viewer = await openViewer(page);
  const canvas = await ready(viewer);
  await canvas.screenshot();
  const initial = await camera(canvas);
  let count = await renderCount(canvas);
  await page.clock.fastForward(5_000);
  expect(await renderCount(canvas)).toBe(count);
  expectSameCamera(await camera(canvas), initial);
  await page.emulateMedia({reducedMotion: "reduce"});
  await moveWithButton(viewer, "Girar a la izquierda");
  await canvas.screenshot();
  count = await renderCount(canvas);
  const stopped = await camera(canvas);
  await page.clock.fastForward(5_000);
  expect(await renderCount(canvas)).toBe(count);
  expectSameCamera(await camera(canvas), stopped);
  expectSameCamera(await moveWithButton(viewer, "Restablecer vista"), initial);
});

test("cancelar una descarga pendiente impide que el visor reaparezca después", async ({page, offlineNetwork}) => {
  offlineNetwork.mode = "pending";
  await page.clock.install();
  const viewer = await openViewer(page);
  await expect.poll(() => offlineNetwork.modelRequests.length).toBe(1);
  await expect(viewer).toHaveAttribute("data-state", "loading");
  await expect(viewer.getByRole("status")).toBeVisible();
  await viewer.getByRole("button", {name: "Volver a vista previa", exact: true}).click();
  await expect(viewer).toHaveAttribute("data-state", "poster");
  await offlineNetwork.releasePending();
  await page.clock.fastForward(35_000);
  await expect(viewer).toHaveAttribute("data-state", "poster");
  await expect(viewer.locator("canvas")).toHaveCount(0);
  await expect(viewer.getByRole("alert")).toHaveCount(0);
  offlineNetwork.mode = "normal";
  await viewer.getByRole("button", {name: "Explorar en 3D", exact: true}).click();
  await ready(viewer);
});

test("un GLB ausente muestra un error recuperable y reintenta con el archivo real", async ({page, offlineNetwork}) => {
  offlineNetwork.mode = "missing";
  const viewer = await openViewer(page);
  await expect(viewer).toHaveAttribute("data-state", "error");
  await expect(viewer.getByRole("alert")).toBeVisible();
  await expect(viewer.getByRole("img", {name: "Vista previa del Mazda3 Hatchback 2020", exact: true})).toBeVisible();
  await expect(viewer.locator("canvas")).toHaveCount(0);
  await credits(viewer);
  offlineNetwork.mode = "normal";
  await viewer.getByRole("button", {name: "Reintentar 3D", exact: true}).click();
  await ready(viewer);
  expect(offlineNetwork.modelRequests).toHaveLength(2);
  await expect(viewer.getByRole("alert")).toHaveCount(0);
});

test("una descarga bloqueada vence a los 30 segundos y permite reintentar", async ({page, offlineNetwork}) => {
  offlineNetwork.mode = "pending";
  await page.clock.install();
  const viewer = await openViewer(page);
  await expect.poll(() => offlineNetwork.modelRequests.length).toBe(1);
  await page.clock.fastForward(20_000);
  await expect(viewer).toHaveAttribute("data-state", "loading");
  await page.clock.fastForward(11_000);
  await expect(viewer).toHaveAttribute("data-state", "error");
  await expect(viewer.getByRole("alert")).toBeVisible();
  offlineNetwork.mode = "normal";
  await offlineNetwork.releasePending();
  await viewer.getByRole("button", {name: "Reintentar 3D", exact: true}).click();
  await ready(viewer);
});

test("sin WebGL conserva la vista previa y comunica el problema", async ({page}) => {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = new Proxy(HTMLCanvasElement.prototype.getContext, {
      apply(target, receiver, args) {
        if (["webgl", "webgl2", "experimental-webgl"].includes(String(args[0]))) return null;
        return Reflect.apply(target, receiver, args);
      },
    });
  });
  const viewer = await openViewer(page);
  await expect(viewer).toHaveAttribute("data-state", "error");
  await expect(viewer.getByRole("alert")).toBeVisible();
  await expect(viewer.getByRole("img", {name: "Vista previa del Mazda3 Hatchback 2020", exact: true})).toBeVisible();
  await expect(viewer.locator("canvas")).toHaveCount(0);
  await expect(viewer.getByRole("button", {name: "Reintentar 3D", exact: true})).toBeEnabled();
  await credits(viewer);
});

test("la pérdida real del contexto WebGL se recupera con una nueva carga", async ({page}) => {
  const viewer = await openViewer(page);
  const canvas = await ready(viewer);
  const lost = await canvas.evaluate(node => {
    const context = (node as HTMLCanvasElement).getContext("webgl2");
    const extension = context?.getExtension("WEBGL_lose_context");
    if (!extension) return false;
    extension.loseContext();
    return true;
  });
  expect(lost, "Chromium must expose the real WebGL context-loss extension").toBe(true);
  await expect(viewer).toHaveAttribute("data-state", "error");
  await expect(viewer.getByRole("alert")).toBeVisible();
  await expect(viewer.locator("canvas")).toHaveCount(0);
  await viewer.getByRole("button", {name: "Reintentar 3D", exact: true}).click();
  await ready(viewer);
});

test("en 375 px el modelo real y los controles de flotilla funcionan sin desbordamiento", async ({page}, testInfo) => {
  await page.setViewportSize({width: 375, height: 812});
  const viewer = await openViewer(page);
  const canvas = await ready(viewer);
  await moveWithButton(viewer, "Acercar");
  for (const control of [
    canvas,
    viewer.getByRole("button", {name: "Volver a vista previa", exact: true}),
    page.getByRole("button", {name: "Agregar unidad", exact: true}),
    page.getByRole("button", {name: "Recalcular planes", exact: true}),
    page.getByRole("searchbox", {name: "Buscar unidad", exact: true}),
    page.getByRole("combobox", {name: "Filtrar estado", exact: true}),
  ]) {
    await expect(control).toBeVisible();
    const bounds = (await control.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(376);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await credits(viewer);
  await viewer.scrollIntoViewIfNeeded();
  await page.screenshot({path: testInfo.outputPath("mazda-local-ready-mobile.png"), fullPage: true});
  await page.getByRole("searchbox", {name: "Buscar unidad", exact: true}).fill("PRUEBA");
  await page.getByRole("combobox", {name: "Filtrar estado", exact: true}).selectOption("red");
  await expect(page.getByRole("heading", {name: "Sin coincidencias", exact: true})).toBeVisible();
});
