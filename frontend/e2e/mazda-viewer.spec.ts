import {test as base, expect, type Locator, type Page} from "@playwright/test";

const modelId = "a72de3f3c1604409a7e6fc6be9854c9d";
const iframeTitle = "Modelo 3D del Mazda3 Hatchback 2020";
const initialCamera = {position: [4, -6, 3], target: [0, 0, 1]};
type ApiCall = {member: string; arguments: unknown[]};
type MockViewer = {mode: "ready" | "silent" | "error" | "initialize-error" | "camera-silent"; requests: string[]; calls: ApiCall[]};

// Exercise the installed SDK's real postMessage protocol without contacting Sketchfab.
function viewerHtml(mode: MockViewer["mode"], parentOrigin: string) {
  return `<!doctype html><html lang="es"><meta charset="utf-8"><title>Visor 3D simulado</title>
    <body style="margin:0;background:#f0f1ed;color:#46534a;display:grid;place-items:center;height:100vh;font:16px sans-serif">
    <p>Modelo 3D simulado para pruebas</p><script>
    const instanceId = new URLSearchParams(location.search).get("api_id");
    const parentOrigin = ${JSON.stringify(parentOrigin)};
    let camera = ${JSON.stringify(initialCamera)};
    let cameraReads = 0;
    window.setMockViewerCamera = next => { camera = next; };
    const send = message => parent.postMessage({instanceId, ...message}, parentOrigin);
    addEventListener("message", event => {
      if (event.source !== parent || event.origin !== parentOrigin || event.data.instanceId !== instanceId) return;
      const message = event.data;
      if (message.type === "api.initialize") {
        send({type: "api.initialize.result", requestId: message.requestId,
          results: mode === "initialize-error" ? ["Simulated initialization failure"] :
            [null, "1.12.1", ["start", "stop", "getCameraLookAt", "setCameraLookAt", "setEnableCameraConstraints"]]});
      } else if (message.type === "api.request") {
        window.recordMockViewerCall({member: message.member, arguments: message.arguments});
        if (message.member === "getCameraLookAt" && mode === "camera-silent" && ++cameraReads === 1) return;
        if (message.member === "setCameraLookAt") {
          camera = {position: message.arguments[0], target: message.arguments[1]};
        }
        send({type: "api.request.result", requestId: message.requestId,
          results: message.member === "getCameraLookAt" ? [null, camera] : [null]});
        if (message.member === "start") send({type: "api.event", results: ["viewerready"]});
      }
    });
    const mode = ${JSON.stringify(mode)};
    if (mode === "ready" || mode === "initialize-error" || mode === "camera-silent") send({type: "api.ready"});
    if (mode === "error") send({type: "api.ready", error: "Simulated viewer unavailable"});
    </script></body></html>`;
}

const test = base.extend<{mockViewer: MockViewer}>({
  mockViewer: [async ({page, context, baseURL}, use) => {
    const mock: MockViewer = {mode: "ready", requests: [], calls: []};
    const unexpected: string[] = [];
    const appOrigin = new URL(baseURL!).origin;
    await page.exposeFunction("recordMockViewerCall", (call: ApiCall) => mock.calls.push(call));
    await context.route("**/*", async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === appOrigin) {
        if (url.pathname.startsWith("/api/backend/")) {
          if (request.method() === "GET" && url.pathname === "/api/backend/vehicles") {
            await route.fulfill({json: []});
            return;
          }
          unexpected.push(`${request.method()} ${url.pathname}`);
          await route.abort("blockedbyclient");
          return;
        }
        await route.continue();
        return;
      }
      if (url.origin === "https://sketchfab.com" && url.pathname === `/models/${modelId}/embed`
          && request.method() === "GET" && request.isNavigationRequest()) {
        mock.requests.push(request.url());
        await route.fulfill({contentType: "text/html", body: viewerHtml(mock.mode, appOrigin)});
        return;
      }
      unexpected.push(`${request.method()} ${request.url()}`);
      await route.abort("blockedbyclient");
    });
    await use(mock);
    expect(unexpected, "The tests must not reach external services or mutate backend data").toEqual([]);
  }, {auto: true}],
});

test.use({
  baseURL: process.env.YOKOHAMA_VISUAL_TEST_URL || "http://127.0.0.1:3001",
  reducedMotion: "no-preference",
  serviceWorkers: "block",
});

async function credits(viewer: Locator) {
  const author = viewer.getByRole("link", {name: "Ddiaz Design", exact: true});
  await expect(author).toBeVisible();
  await expect(author).toHaveAttribute("href", "https://sketchfab.com/ddiaz-design");
  const source = viewer.getByRole("link", {name: "2020 Mazda 3 Hatchback", exact: true});
  await expect(source).toBeVisible();
  await expect(source).toHaveAttribute("href", new RegExp(`${modelId}$`));
  const license = viewer.locator('a[href="https://creativecommons.org/licenses/by-nc-sa/4.0/"]');
  await expect(license).toBeVisible();
  await expect(license).toContainText(/CC BY.NC.SA 4\.0/i);
}

async function openViewer(page: Page) {
  await page.goto("/");
  const viewer = page.getByTestId("mazda-viewer");
  await expect(viewer).toHaveAttribute("data-state", "poster");
  await viewer.getByRole("button", {name: "Explorar en 3D", exact: true}).click();
  return viewer;
}

function cameraCalls(mock: MockViewer) {
  return mock.calls.filter(call => call.member === "setCameraLookAt");
}

async function keyboardCamera(viewer: Locator, mock: MockViewer, name: string, key = "Enter") {
  const before = cameraCalls(mock).length;
  const control = viewer.getByRole("button", {name, exact: true});
  await expect(control).toBeEnabled();
  await control.focus();
  await control.press(key);
  await expect.poll(() => cameraCalls(mock).length, {timeout: 5_000}).toBe(before + 1);
  await expect(control).toBeFocused({timeout: 5_000});
  const call = cameraCalls(mock).at(-1)!;
  expect(call.arguments[0]).toEqual([expect.any(Number), expect.any(Number), expect.any(Number)]);
  expect(call.arguments[1]).toEqual([expect.any(Number), expect.any(Number), expect.any(Number)]);
  expect((call.arguments[0] as number[]).every(Number.isFinite)).toBe(true);
  expect((call.arguments[1] as number[]).every(Number.isFinite)).toBe(true);
  return call;
}

test("la vista previa y sus créditos no contactan Sketchfab antes del clic", async ({page, mockViewer}, testInfo) => {
  await page.setViewportSize({width: 1440, height: 1000});
  await page.goto("/");
  const viewer = page.getByTestId("mazda-viewer");
  await expect(viewer).toHaveAttribute("data-state", "poster");
  await expect(viewer.getByRole("img", {name: "Vista previa del Mazda3 Hatchback 2020", exact: true})).toBeVisible();
  await expect(viewer.getByRole("button", {name: "Explorar en 3D", exact: true})).toBeEnabled();
  await expect(viewer.locator("iframe")).toHaveCount(0);
  await credits(viewer);
  await expect(page.getByRole("heading", {name: "Aún no hay unidades", exact: true})).toBeVisible();
  expect(mockViewer.requests).toEqual([]);
  await page.screenshot({path: testInfo.outputPath("mazda-viewer-desktop.png"), fullPage: true});
});

test("el teclado abre el modelo, opera todos sus controles y devuelve el foco al cerrar", async ({page, mockViewer}) => {
  await page.goto("/?skfb_autospin=5&skfb_animation_autoplay=1&skfb_camera=1&skfb_dnt=0&skfb_api_version=0.0.0");
  const viewer = page.getByTestId("mazda-viewer");
  const explore = viewer.getByRole("button", {name: "Explorar en 3D", exact: true});
  await explore.focus();
  await explore.press("Enter");
  await expect(viewer).toHaveAttribute("data-state", "ready");
  await expect(viewer.getByTitle(iframeTitle, {exact: true})).toBeVisible();
  await credits(viewer);
  expect(mockViewer.requests).toHaveLength(1);
  const embed = new URL(mockViewer.requests[0]);
  expect(embed.searchParams.get("autospin")).toBe("0");
  expect(embed.searchParams.get("animation_autoplay")).toBe("0");
  expect(embed.searchParams.get("camera")).toBe("0");
  expect(embed.searchParams.get("dnt")).toBe("1");
  expect(embed.searchParams.get("api_version")).toBe("1.12.1");
  for (const call of cameraCalls(mockViewer)) expect(call.arguments[2]).toBe(0);
  for (const [index, name] of ["Girar a la izquierda", "Girar a la derecha", "Ver desde arriba", "Ver desde abajo", "Acercar", "Alejar"].entries()) {
    await keyboardCamera(viewer, mockViewer, name, index % 2 ? "Space" : "Enter");
  }
  const reset = await keyboardCamera(viewer, mockViewer, "Restablecer vista");
  expect(reset.arguments[0]).toEqual(initialCamera.position);
  expect(reset.arguments[1]).toEqual(initialCamera.target);
  const close = viewer.getByRole("button", {name: "Volver a vista previa", exact: true});
  await close.focus();
  await close.press("Space");
  await expect(viewer).toHaveAttribute("data-state", "poster");
  await expect(viewer.locator("iframe")).toHaveCount(0);
  await expect(explore).toBeFocused();
  await credits(viewer);
});

test("una carga incompleta se puede cancelar y un mensaje tardío no revive el visor", async ({page, mockViewer}) => {
  mockViewer.mode = "silent";
  const viewer = await openViewer(page);
  await expect(viewer).toHaveAttribute("data-state", "loading");
  await expect(viewer.getByRole("status")).toBeVisible();
  await expect.poll(() => mockViewer.requests.length).toBe(1);
  await credits(viewer);
  await page.evaluate(title => {
    const iframe = document.querySelector<HTMLIFrameElement>(`iframe[title="${title}"]`)!;
    const saved = {source: iframe.contentWindow, instanceId: new URL(iframe.src).searchParams.get("api_id")};
    Object.assign(window, {sendLateMockViewerMessage: () => window.dispatchEvent(new MessageEvent("message", {
      origin: "https://sketchfab.com", source: saved.source,
      data: {type: "api.ready", instanceId: saved.instanceId, error: "Late callback"},
    }))});
  }, iframeTitle);
  await viewer.getByRole("button", {name: "Volver a vista previa", exact: true}).click();
  await expect(viewer).toHaveAttribute("data-state", "poster");
  await page.evaluate(async () => {
    (window as unknown as {sendLateMockViewerMessage: () => void}).sendLateMockViewerMessage();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  });
  await expect(viewer).toHaveAttribute("data-state", "poster");
  await expect(viewer.getByRole("alert")).toHaveCount(0);
  await expect(viewer.locator("iframe")).toHaveCount(0);
  mockViewer.mode = "ready";
  await viewer.getByRole("button", {name: "Explorar en 3D", exact: true}).click();
  await expect(viewer).toHaveAttribute("data-state", "ready");
  expect(mockViewer.requests).toHaveLength(2);
});

for (const failure of ["error", "initialize-error"] as const) {
  test(`un fallo del proveedor (${failure}) permite reintentar con una instancia nueva`, async ({page, mockViewer}) => {
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    mockViewer.mode = failure;
    const viewer = await openViewer(page);
    await expect(viewer).toHaveAttribute("data-state", "error");
    await expect(viewer.getByRole("alert")).toBeVisible();
    await credits(viewer);
    mockViewer.mode = "ready";
    await viewer.getByRole("button", {name: "Reintentar 3D", exact: true}).click();
    await expect(viewer).toHaveAttribute("data-state", "ready");
    await expect(viewer.getByRole("alert")).toHaveCount(0);
    expect(mockViewer.requests).toHaveLength(2);
    expect(new URL(mockViewer.requests[0]).searchParams.get("api_id"))
      .not.toBe(new URL(mockViewer.requests[1]).searchParams.get("api_id"));
    expect(pageErrors).toEqual([]);
  });
}

test("el evento load del iframe no evita el timeout de 25 segundos", async ({page, mockViewer}) => {
  mockViewer.mode = "silent";
  await page.clock.install();
  const viewer = await openViewer(page);
  await expect.poll(() => mockViewer.requests.length).toBe(1);
  await expect(viewer).toHaveAttribute("data-state", "loading");
  await expect(viewer.getByRole("status")).toBeVisible();
  await page.clock.fastForward(24_000);
  await expect(viewer).toHaveAttribute("data-state", "loading");
  await page.clock.fastForward(2_000);
  await expect(viewer).toHaveAttribute("data-state", "error");
  await expect(viewer.getByRole("alert")).toBeVisible();
  await expect(viewer.getByRole("button", {name: "Reintentar 3D", exact: true})).toBeEnabled();
  await credits(viewer);
});

test("rechaza mensajes con origen o ventana distintos del iframe autorizado", async ({page, mockViewer}) => {
  mockViewer.mode = "silent";
  const viewer = await openViewer(page);
  await expect.poll(() => mockViewer.requests.length).toBe(1);
  await expect(viewer).toHaveAttribute("data-state", "loading");
  for (const invalidOrigin of [true, false]) {
    await page.evaluate(async ({title, invalidOrigin}) => {
      const iframe = document.querySelector<HTMLIFrameElement>(`iframe[title="${title}"]`)!;
      window.dispatchEvent(new MessageEvent("message", {
        origin: invalidOrigin ? "https://untrusted.invalid" : "https://sketchfab.com",
        source: invalidOrigin ? iframe.contentWindow : window,
        data: {type: "api.ready", instanceId: new URL(iframe.src).searchParams.get("api_id"), error: "Spoofed failure"},
      }));
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }, {title: iframeTitle, invalidOrigin});
    await expect(viewer).toHaveAttribute("data-state", "loading");
    await expect(viewer.getByRole("alert")).toHaveCount(0);
  }
});

test("movimiento reducido usa cambios de cámara inmediatos incluso al cambiar la preferencia", async ({page, mockViewer}) => {
  await page.emulateMedia({reducedMotion: "reduce"});
  const viewer = await openViewer(page);
  await expect(viewer).toHaveAttribute("data-state", "ready");
  for (const name of ["Girar a la izquierda", "Ver desde arriba", "Acercar", "Restablecer vista"]) {
    const call = await keyboardCamera(viewer, mockViewer, name);
    expect(call.arguments[2]).toBe(0);
  }
  await page.emulateMedia({reducedMotion: "no-preference"});
  const animated = await keyboardCamera(viewer, mockViewer, "Girar a la derecha");
  expect(animated.arguments[2]).toBeGreaterThan(0);
  await page.emulateMedia({reducedMotion: "reduce"});
  const immediate = await keyboardCamera(viewer, mockViewer, "Alejar");
  expect(immediate.arguments[2]).toBe(0);
});

test("una lectura inicial de cámara sin respuesta conserva el visor y explica cómo continuar", async ({page, mockViewer}) => {
  mockViewer.mode = "camera-silent";
  await page.clock.install();
  const viewer = await openViewer(page);
  await expect(viewer).toHaveAttribute("data-state", "ready");
  await expect.poll(() => mockViewer.calls.filter(call => call.member === "getCameraLookAt").length).toBe(1);
  const controls = viewer.getByRole("group", {name: "Controles de cámara 3D", exact: true}).getByRole("button");
  await expect(controls).toHaveCount(7);
  for (const control of await controls.all()) await expect(control).toBeDisabled();
  await page.clock.fastForward(6_000);
  await expect(viewer.getByRole("status")).toContainText("Usa los controles dentro del visor");
  await expect(viewer).toHaveAttribute("data-state", "ready");
  await expect(viewer.getByTitle(iframeTitle, {exact: true})).toBeVisible();
  await expect(viewer.getByRole("alert")).toHaveCount(0);
  for (const control of await controls.all()) await expect(control).toBeDisabled();
  await viewer.getByRole("button", {name: "Volver a vista previa", exact: true}).click();
  mockViewer.mode = "ready";
  await viewer.getByRole("button", {name: "Explorar en 3D", exact: true}).click();
  await expect(viewer.getByRole("button", {name: "Acercar", exact: true})).toBeEnabled();
  await expect(viewer.getByRole("status")).toHaveCount(0);
});

test("el zoom no invierte su dirección después de gestos fuera de los límites de los botones", async ({page, mockViewer}) => {
  const viewer = await openViewer(page);
  await expect(viewer).toHaveAttribute("data-state", "ready");
  await expect(viewer.getByRole("button", {name: "Acercar", exact: true})).toBeEnabled();
  const frame = page.frame({url: mockViewer.requests[0]})!;
  const radius = (position: number[], target: number[]) =>
    Math.hypot(...position.map((value, index) => value - target[index]));
  for (const scale of [0.1, 5]) {
    const camera = {
      position: initialCamera.position.map((value, index) =>
        initialCamera.target[index] + scale * (value - initialCamera.target[index])),
      target: [...initialCamera.target],
    };
    const before = radius(camera.position, camera.target);
    for (const name of ["Acercar", "Alejar"]) {
      // Change only the mock iframe's camera, as a native drag/pinch would.
      await frame.evaluate(next => {
        (window as unknown as {setMockViewerCamera: (camera: typeof next) => void}).setMockViewerCamera(next);
      }, camera);
      const call = await keyboardCamera(viewer, mockViewer, name);
      const after = radius(call.arguments[0] as number[], call.arguments[1] as number[]);
      expect(call.arguments[1]).toEqual(camera.target);
      if (name === "Acercar") expect(after).toBeLessThanOrEqual(before + 1e-8);
      else expect(after).toBeGreaterThanOrEqual(before - 1e-8);
      if (scale === 5 && name === "Acercar") expect(after).toBeLessThan(before);
      if (scale === 0.1 && name === "Alejar") expect(after).toBeGreaterThan(before);
    }
  }
  const reset = await keyboardCamera(viewer, mockViewer, "Restablecer vista");
  expect(reset.arguments[0]).toEqual(initialCamera.position);
  expect(reset.arguments[1]).toEqual(initialCamera.target);
});

test("en 375 px el visor y los controles de flotilla permanecen utilizables sin desbordamiento", async ({page, mockViewer}, testInfo) => {
  await page.setViewportSize({width: 375, height: 812});
  await page.goto("/");
  const viewer = page.getByTestId("mazda-viewer");
  await viewer.scrollIntoViewIfNeeded();
  await expect(viewer.getByRole("img", {name: "Vista previa del Mazda3 Hatchback 2020", exact: true})).toBeVisible();
  await credits(viewer);
  await page.screenshot({path: testInfo.outputPath("mazda-viewer-mobile.png"), fullPage: true});
  await viewer.getByRole("button", {name: "Explorar en 3D", exact: true}).click();
  await expect(viewer).toHaveAttribute("data-state", "ready");
  await keyboardCamera(viewer, mockViewer, "Acercar");
  for (const control of [
    viewer.getByTitle(iframeTitle, {exact: true}),
    viewer.getByRole("button", {name: "Volver a vista previa", exact: true}),
    page.getByRole("button", {name: "Agregar unidad", exact: true}),
    page.getByRole("button", {name: "Recalcular planes", exact: true}),
    page.getByRole("searchbox", {name: "Buscar unidad", exact: true}),
    page.getByRole("combobox", {name: "Filtrar estado", exact: true}),
  ]) {
    await expect(control).toBeVisible();
    const bounds = await control.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(376);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.getByRole("searchbox", {name: "Buscar unidad", exact: true}).fill("PRUEBA");
  await page.getByRole("combobox", {name: "Filtrar estado", exact: true}).selectOption("red");
  await expect(page.getByRole("heading", {name: "Sin coincidencias", exact: true})).toBeVisible();
});
