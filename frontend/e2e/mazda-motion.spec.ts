import {test as base, expect, type Locator} from "@playwright/test";

// Every backend request is intercepted; this spec never contacts or changes a fleet.
const test = base.extend<{isolatedBackend: void}>({
  isolatedBackend: [async ({page}, use) => {
    const unexpectedRequests: string[] = [];
    const responses: Record<string, unknown> = {
      "/api/backend/vehicles": [],
      "/api/backend/variants": {variantes: []},
    };
    await page.route("**/api/backend/**", async route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (request.method() === "GET" && Object.hasOwn(responses, pathname)) {
        await route.fulfill({json: responses[pathname]});
        return;
      }
      unexpectedRequests.push(`${request.method()} ${pathname}`);
      await route.abort("blockedbyclient");
    });
    await use();
    expect(unexpectedRequests, "Only explicitly mocked backend reads are allowed").toEqual([]);
  }, {auto: true}],
});

test.use({
  baseURL: process.env.YOKOHAMA_VISUAL_TEST_URL || "http://127.0.0.1:3001",
  reducedMotion: "no-preference",
});

function movingParts(scene: Locator) {
  return scene.locator('[data-testid="mazda-wheel"], [data-testid="mazda-road"]');
}

async function transforms(parts: Locator) {
  return parts.evaluateAll(elements => elements.map(element => getComputedStyle(element).transform));
}

async function wheelAngles(scene: Locator) {
  return scene.getByTestId("mazda-wheel").evaluateAll(elements => elements.map(element => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return Math.atan2(matrix.b, matrix.a);
  }));
}

async function expectMoving(scene: Locator) {
  await expect(scene).toHaveAttribute("data-paused", "false");
  const parts = movingParts(scene);
  await expect(parts).toHaveCount(3);
  for (const part of await parts.all()) {
    await expect(part).toHaveCSS("animation-play-state", "running");
    await expect(part).not.toHaveCSS("animation-name", "none");
  }
  const before = await transforms(parts);
  const anglesBefore = await wheelAngles(scene);
  await expect.poll(async () => {
    const after = await transforms(parts);
    return after.map((transform, index) => transform !== before[index]);
  }, {message: "Both wheels and the road must visibly move", timeout: 5_000, intervals: [75, 125, 175]})
    .toEqual([true, true, true]);
  await expect.poll(async () => (await wheelAngles(scene)).map((angle, index) =>
    Math.abs(angle - anglesBefore[index]) > 0.01),
  {message: "Both wheels must rotate", timeout: 5_000, intervals: [75, 125, 175]}).toEqual([true, true]);
}

async function expectPaused(scene: Locator) {
  await expect(scene).toHaveAttribute("data-paused", "true");
  const parts = movingParts(scene);
  await expect(parts).toHaveCount(3);
  for (const part of await parts.all()) {
    await expect(part).toHaveCSS("animation-play-state", "paused");
  }
  // Observe multiple rendered frames, including the frame after CSS applies the pause.
  const samples = await parts.evaluateAll(async elements => {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const result: string[][] = [];
    for (let frame = 0; frame < 12; frame++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      result.push(elements.map(element => getComputedStyle(element).transform));
    }
    return result;
  });
  expect(samples.every(sample => sample.every((value, index) => value === samples[0][index])),
    "Pausing must hold the wheel and road positions across rendered frames").toBe(true);
}

async function expectReducedMotion(scene: Locator) {
  await expect(scene).toHaveAttribute("data-paused", "true");
  await expect(scene.getByRole("button", {name: "Movimiento reducido", exact: true})).toBeDisabled();
  await expect.poll(() => scene.evaluate(element =>
    [element, ...element.querySelectorAll("*")].every(node =>
      getComputedStyle(node).animationName.split(",").every(name => name.trim() === "none"))),
  {message: "Reduced motion must remove every animation in the scene"}).toBe(true);
}

test("Mazda3 accesible con las dos ruedas y la carretera en movimiento", async ({page}, testInfo) => {
  await page.setViewportSize({width: 1440, height: 1000});
  await page.goto("/");
  const scene = page.getByTestId("mazda-motion");
  await scene.scrollIntoViewIfNeeded();
  await expect(scene.getByRole("img", {name: "Ilustración de un Mazda3 rojo en carretera", exact: true})).toBeVisible();
  await expect(scene.getByTestId("mazda-wheel")).toHaveCount(2);
  // Horizontal stroked SVG paths have a zero-height geometry box in Chromium.
  await expect(scene.getByTestId("mazda-road")).toHaveCount(1);
  await expect(scene.getByRole("button", {name: "Pausar animación", exact: true})).toBeEnabled();
  await expectMoving(scene);
  await expect(page.getByRole("heading", {name: "Aún no hay unidades", exact: true})).toBeVisible();
  await scene.getByRole("button", {name: "Pausar animación", exact: true}).click();
  await expectPaused(scene);
  await page.screenshot({path: testInfo.outputPath("mazda-desktop.png"), fullPage: true});
});

test("el teclado permite pausar sin saltos y reanudar el movimiento", async ({page}) => {
  await page.goto("/");
  const scene = page.getByTestId("mazda-motion");
  await scene.scrollIntoViewIfNeeded();
  await expectMoving(scene);
  const pause = scene.getByRole("button", {name: "Pausar animación", exact: true});
  await pause.focus();
  await pause.press("Space");
  const resume = scene.getByRole("button", {name: "Reanudar animación", exact: true});
  await expect(resume).toBeFocused();
  await expectPaused(scene);
  await resume.press("Enter");
  await expect(scene.getByRole("button", {name: "Pausar animación", exact: true})).toBeFocused();
  await expectMoving(scene);
});

test("respeta movimiento reducido desde la primera carga", async ({page}) => {
  await page.emulateMedia({reducedMotion: "reduce"});
  await page.goto("/");
  const scene = page.getByTestId("mazda-motion");
  await scene.scrollIntoViewIfNeeded();
  await expectReducedMotion(scene);
});

test("responde a cambios de preferencia y conserva una pausa elegida por el usuario", async ({page}) => {
  await page.goto("/");
  const scene = page.getByTestId("mazda-motion");
  await scene.scrollIntoViewIfNeeded();
  await expectMoving(scene);
  await page.emulateMedia({reducedMotion: "reduce"});
  await expectReducedMotion(scene);
  await page.emulateMedia({reducedMotion: "no-preference"});
  await expectMoving(scene);
  await scene.getByRole("button", {name: "Pausar animación", exact: true}).click();
  await expectPaused(scene);
  await page.emulateMedia({reducedMotion: "reduce"});
  await expectReducedMotion(scene);
  await page.emulateMedia({reducedMotion: "no-preference"});
  await expect(scene.getByRole("button", {name: "Reanudar animación", exact: true})).toBeEnabled();
  await expectPaused(scene);
});

test("se detiene fuera de pantalla y vuelve a moverse al regresar", async ({page}) => {
  await page.setViewportSize({width: 1280, height: 500});
  await page.goto("/");
  const scene = page.getByTestId("mazda-motion");
  await scene.scrollIntoViewIfNeeded();
  await expectMoving(scene);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(scene).not.toBeInViewport();
  await expectPaused(scene);
  await scene.scrollIntoViewIfNeeded();
  await expectMoving(scene);
});

test("a 375 px conserva la escena y los controles de flotilla sin desbordamiento", async ({page}, testInfo) => {
  await page.setViewportSize({width: 375, height: 812});
  await page.goto("/");
  const scene = page.getByTestId("mazda-motion");
  await scene.scrollIntoViewIfNeeded();
  await expect(scene).toBeVisible();
  await expect(scene.getByRole("button", {name: "Pausar animación", exact: true})).toBeVisible();
  await expectMoving(scene);
  const controls = [
    page.getByRole("button", {name: "Agregar unidad", exact: true}),
    page.getByRole("button", {name: "Recalcular planes", exact: true}),
    page.getByRole("searchbox", {name: "Buscar unidad", exact: true}),
    page.getByRole("combobox", {name: "Filtrar estado", exact: true}),
  ];
  for (const control of controls) {
    await expect(control).toBeVisible();
    await expect(control).toBeEnabled();
    const bounds = await control.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(376);
  }
  await page.getByRole("searchbox", {name: "Buscar unidad", exact: true}).fill("PRUEBA");
  await page.getByRole("combobox", {name: "Filtrar estado", exact: true}).selectOption("red");
  await expect(page.getByRole("heading", {name: "Sin coincidencias", exact: true})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await scene.scrollIntoViewIfNeeded();
  await scene.getByRole("button", {name: "Pausar animación", exact: true}).click();
  await expectPaused(scene);
  await page.screenshot({path: testInfo.outputPath("mazda-mobile.png"), fullPage: true});
});

test.describe("antes de la hidratación", () => {
  test.use({javaScriptEnabled: false});

  test("la ilustración inicial mantiene las animaciones en pausa", async ({page}) => {
    await page.goto("/");
    const scene = page.getByTestId("mazda-motion");
    await expect(scene).toBeVisible();
    await expect(scene).toHaveAttribute("data-paused", "true");
    await expect(movingParts(scene)).toHaveCount(3);
    for (const part of await movingParts(scene).all()) {
      await expect(part).toHaveCSS("animation-play-state", "paused");
    }
  });
});
