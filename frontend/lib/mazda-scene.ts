import {
  ACESFilmicToneMapping, Box3, Color, DirectionalLight, HemisphereLight,
  LoadingManager, Material, Mesh, Object3D, PerspectiveCamera, PMREMGenerator,
  Scene, Spherical, Texture, Vector3, WebGLRenderer, WebGLRenderTarget,
} from "three";
import {GLTFLoader} from "three/addons/loaders/GLTFLoader.js";
import {OrbitControls} from "three/addons/controls/OrbitControls.js";
import {RoomEnvironment} from "three/addons/environments/RoomEnvironment.js";
import {MAZDA_MODEL} from "./mazda-model";

export type CameraAction = "left" | "right" | "above" | "below" | "closer" | "farther" | "reset";
export type MazdaScene = {move: (action: CameraAction) => void; dispose: () => void};

/** Textures and ImageBitmaps can be shared by many materials in this GLB. */
function releaseModels(roots: Object3D[]) {
  const geometries = new Set<Mesh["geometry"]>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  const bitmaps = new Set<ImageBitmap>();
  for (const root of roots) root.traverse(object => {
    if (!(object instanceof Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
    material.dispose();
  }
  for (const texture of textures) {
    if (typeof ImageBitmap !== "undefined" && texture.source.data instanceof ImageBitmap) bitmaps.add(texture.source.data);
    texture.dispose();
  }
  for (const bitmap of bitmaps) bitmap.close();
  for (const geometry of geometries) geometry.dispose();
}

/** Imported only on user activation. All assets, code and lighting stay local. */
export function createMazdaScene(canvas: HTMLCanvasElement, callbacks: {onReady: () => void; onError: () => void}): MazdaScene {
  const scene = new Scene();
  scene.background = new Color("#eef0ed");
  const camera = new PerspectiveCamera(35, 1, 0.01, 100);
  const direction = new Vector3(1, 0.48, 1.4).normalize();
  const right = new Vector3().crossVectors(camera.up, direction).normalize();
  const up = new Vector3().crossVectors(direction, right).normalize();
  const bounds = new Box3();
  const abort = new AbortController();
  let renderer: WebGLRenderer | undefined;
  let controls: OrbitControls | undefined;
  let environment: WebGLRenderTarget | undefined;
  let models: Object3D[] = [];
  let resizeObserver: ResizeObserver | undefined;
  let intersection: IntersectionObserver | undefined;
  let disposed = false;
  let ready = false;
  let visible = true;
  let frame = 0;
  let renders = 0;
  let fitDistance = 1;
  let projected = new Float32Array();
  const timer = window.setTimeout(fail, 30_000);

  function render() {
    frame = 0;
    if (disposed || !ready || !renderer || !controls || document.hidden || !visible) return;
    try {
      renderer.render(scene, camera);
      // Local diagnostics only; no telemetry, vehicle data or global SDK hooks.
      canvas.dataset.camera = JSON.stringify({position: camera.position.toArray(), target: controls.target.toArray()});
      canvas.dataset.renderCount = String(++renders);
    } catch { fail(); }
  }
  function schedule() {
    if (!frame && !disposed && ready && !document.hidden && visible) frame = requestAnimationFrame(render);
  }
  function visibility() {
    if (document.hidden) { cancelAnimationFrame(frame); frame = 0; }
    else schedule();
  }
  function lost(event: Event) { event.preventDefault(); fail(); }
  function dispose() {
    if (disposed) return;
    disposed = true;
    abort.abort();
    window.clearTimeout(timer);
    cancelAnimationFrame(frame);
    resizeObserver?.disconnect();
    intersection?.disconnect();
    document.removeEventListener("visibilitychange", visibility);
    canvas.removeEventListener("webglcontextlost", lost);
    controls?.removeEventListener("change", schedule);
    controls?.dispose();
    releaseModels(models);
    models = [];
    projected = new Float32Array();
    scene.clear();
    environment?.dispose();
    renderer?.dispose();
    renderer?.forceContextLoss();
  }
  function fail() {
    if (disposed) return;
    dispose();
    callbacks.onError();
  }
  function resize() {
    if (!renderer || !controls || disposed) return;
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    // Fit real vertices, not the mostly empty corners of the car's bounding box.
    const tanV = Math.tan(camera.fov * Math.PI / 360);
    const tanH = tanV * camera.aspect;
    let nextDistance = 0;
    for (let index = 0; index < projected.length; index += 3) {
      const depth = projected[index + 2];
      nextDistance = Math.max(nextDistance, depth + projected[index] / tanH, depth + projected[index + 1] / tanV);
    }
    nextDistance *= 1.08;
    camera.position.sub(controls.target).multiplyScalar(nextDistance / fitDistance).add(controls.target);
    fitDistance = nextDistance;
    controls.minDistance = fitDistance * 0.3;
    controls.maxDistance = fitDistance * 3;
    controls.update();
    schedule();
  }
  function move(action: CameraAction) {
    if (!ready || disposed || !controls) return;
    if (action === "reset") {
      controls.target.set(0, 0, 0);
      camera.position.copy(direction).multiplyScalar(fitDistance);
    } else {
      const sphere = new Spherical().setFromVector3(camera.position.clone().sub(controls.target));
      if (action === "left") sphere.theta -= Math.PI / 6;
      if (action === "right") sphere.theta += Math.PI / 6;
      if (action === "above") sphere.phi = 0.16;
      if (action === "below") sphere.phi = Math.PI - 0.16;
      if (action === "closer") sphere.radius = Math.max(controls.minDistance, sphere.radius * 0.8);
      if (action === "farther") sphere.radius = Math.min(controls.maxDistance, sphere.radius * 1.25);
      camera.position.setFromSpherical(sphere).add(controls.target);
    }
    controls.update();
    schedule();
  }

  async function initialize() {
    const response = await fetch(MAZDA_MODEL.model, {signal: abort.signal, credentials: "omit", redirect: "error"});
    if (!response.ok) throw new Error("Local model unavailable");
    const binary = await response.arrayBuffer();
    if (disposed) return;
    const manager = new LoadingManager();
    let textureFailed = false;
    manager.onError = () => { textureFailed = true; };
    // This verified GLB contains only embedded textures. Reject future external references.
    manager.setURLModifier(url => {
      if (!url.startsWith("blob:") && !url.startsWith("data:")) throw new Error("External model resource blocked");
      return url;
    });
    const gltf = await new GLTFLoader(manager).parseAsync(binary, "");
    if (disposed) { releaseModels(gltf.scenes); return; }
    models = gltf.scenes;
    if (textureFailed) throw new Error("Local texture unavailable");
    const model = gltf.scene;
    model.updateMatrixWorld(true);
    bounds.setFromObject(model);
    const size = bounds.getSize(new Vector3());
    const longest = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(longest) || longest <= 0) throw new Error("Invalid model bounds");
    model.scale.multiplyScalar(4.5 / longest);
    model.updateMatrixWorld(true);
    model.position.sub(bounds.setFromObject(model).getCenter(new Vector3()));
    model.updateMatrixWorld(true);
    bounds.setFromObject(model);
    scene.add(model);
    const coordinates: number[] = [];
    const vertex = new Vector3();
    model.traverse(object => {
      if (!(object instanceof Mesh)) return;
      const positions = object.geometry.getAttribute("position");
      for (let index = 0; index < positions.count; index++) {
        vertex.fromBufferAttribute(positions, index).applyMatrix4(object.matrixWorld);
        coordinates.push(Math.abs(vertex.dot(right)), Math.abs(vertex.dot(up)), vertex.dot(direction));
      }
    });
    projected = new Float32Array(coordinates);
    renderer = new WebGLRenderer({canvas, antialias: true, alpha: false, powerPreference: "low-power"});
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    const room = new RoomEnvironment();
    const pmrem = new PMREMGenerator(renderer);
    try { environment = pmrem.fromScene(room, 0.04); }
    finally { room.dispose(); pmrem.dispose(); }
    scene.environment = environment.texture;
    scene.add(new HemisphereLight(0xffffff, 0x7d817c, 2));
    const key = new DirectionalLight(0xffffff, 3);
    key.position.set(3, 5, 4);
    scene.add(key);
    camera.position.copy(direction);
    controls = new OrbitControls(camera, canvas);
    controls.enablePan = false;
    controls.enableDamping = false;
    controls.autoRotate = false;
    controls.minPolarAngle = 0.01;
    controls.maxPolarAngle = Math.PI - 0.01;
    controls.addEventListener("change", schedule);
    canvas.addEventListener("webglcontextlost", lost);
    document.addEventListener("visibilitychange", visibility);
    resize();
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    intersection = new IntersectionObserver(entries => {
      visible = entries[0]?.isIntersecting ?? false;
      if (!visible) { cancelAnimationFrame(frame); frame = 0; } else schedule();
    });
    intersection.observe(canvas);
    ready = true;
    window.clearTimeout(timer);
    render();
    if (!disposed) callbacks.onReady();
  }
  void initialize().catch(fail);
  return {move, dispose};
}
