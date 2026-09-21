import type Sketchfab from "@sketchfab/viewer-api";
import type { ViewerAPI } from "@sketchfab/viewer-api";
import { MAZDA_MODEL } from "./mazda-model";

export type { Camera, Vector3, ViewerAPI } from "@sketchfab/viewer-api";

const SDK_VERSION = "1.12.1";
const VIEWER_ORIGIN = "https://sketchfab.com";
const READY_TIMEOUT_MS = 25_000;
const connections = new WeakMap<HTMLIFrameElement, () => void>();
let connectionSequence = 0;

type SDKWindow = Window & { sketchfabAPIinstances?: Sketchfab[] };

/** Call only after the visitor opens the viewer. Importing this module is SSR-safe. */
export function connectSketchfab(
  iframe: HTMLIFrameElement,
  callbacks: { onReady: (api: ViewerAPI) => void; onError: () => void },
): () => void {
  if (typeof window === "undefined") return () => {};

  connections.get(iframe)?.();

  const sdkWindow = window as SDKWindow;
  // The SDK derives IDs from a global array's length. Removing closed instances
  // would otherwise reuse IDs when React remounts the same iframe.
  const instanceId = `mazda-${Date.now()}-${++connectionSequence}`;
  let disposed = false;
  let ready = false;
  let preparing = false;
  let sdk: Sketchfab | undefined;
  let api: ViewerAPI | undefined;
  let timer: number | undefined;

  function cleanup() {
    if (disposed) return;
    disposed = true;
    window.clearTimeout(timer);
    window.removeEventListener("message", guardMessage, true);

    if (api) {
      api.removeEventListener("viewerready", handleViewerReady);
      // A detached or failed frame may no longer accept SDK messages.
      try { api.stop(); } catch { /* The iframe is unloaded below. */ }
    }

    // SDK 1.12.1 leaves both window listeners and a global instance reference.
    // Recheck the client here because api.ready may precede init's success.
    if (sdk?._initializeAPIEmbedBinded) {
      window.removeEventListener("message", sdk._initializeAPIEmbedBinded);
    }
    if (sdk?._client) {
      if (sdk._client._serverReceiveMessageBinded) {
        window.removeEventListener("message", sdk._client._serverReceiveMessageBinded);
      }
      sdk._client._pendingRequests = {};
      sdk._client._eventListeners = {};
    }
    if (sdk) {
      const index = sdkWindow.sketchfabAPIinstances?.indexOf(sdk) ?? -1;
      if (index !== -1) sdkWindow.sketchfabAPIinstances?.splice(index, 1);
      sdk._options = undefined;
    }

    if (connections.get(iframe) === cleanup) {
      connections.delete(iframe);
      iframe.removeAttribute("src");
    }
    api = undefined;
    sdk = undefined;
  }

  function fail() {
    if (disposed) return;
    cleanup();
    callbacks.onError();
  }

  function guardMessage(event: MessageEvent) {
    const data: unknown = event.data;
    if (typeof data !== "object" || data === null) return;
    const message = data as { type?: unknown; instanceId?: unknown; results?: unknown };
    if (message.instanceId !== instanceId || typeof message.type !== "string" || !message.type.startsWith("api.")) return;

    // The SDK checks origin OR source incompletely at different handshake
    // stages. Capture runs before its window listeners and requires both.
    if (event.origin !== VIEWER_ORIGIN || event.source !== iframe.contentWindow) {
      event.stopImmediatePropagation();
      return;
    }
    // The SDK throws on initialization errors instead of calling options.error.
    if (message.type === "api.initialize.result" && (!Array.isArray(message.results) || message.results[0])) {
      event.stopImmediatePropagation();
      fail();
    }
  }

  function handleViewerReady() {
    if (disposed || ready || preparing || !api) return;
    preparing = true;
    const activeAPI = api;
    try {
      activeAPI.setEnableCameraConstraints(false, {}, (error) => {
        if (disposed || ready) return;
        if (error) { fail(); return; }
        ready = true;
        window.clearTimeout(timer);
        callbacks.onReady(activeAPI);
      });
    } catch {
      fail();
    }
  }

  connections.set(iframe, cleanup);
  window.addEventListener("message", guardMessage, true);
  timer = window.setTimeout(fail, READY_TIMEOUT_MS);

  // The package is a browser UMD bundle that accesses self/window at evaluation.
  // Keep the runtime import inside this user-triggered client operation.
  void import("@sketchfab/viewer-api").then(({ default: SketchfabConstructor }) => {
    if (disposed) return;
    sdk = new SketchfabConstructor(SDK_VERSION, iframe);
    sdk._apiId = instanceId;
    // URL skfb_* parameters must not override privacy or motion settings.
    sdk._transmitOptions = {};
    sdk._version = SDK_VERSION;
    sdk.init(MAZDA_MODEL.uid, {
      autostart: 1,
      autospin: 0,
      camera: 0,
      animation_autoplay: 0,
      dnt: 1,
      preload: 0,
      success(connectedAPI) {
        if (disposed) return;
        api = connectedAPI;
        try {
          api.addEventListener("viewerready", handleViewerReady);
          api.start();
        } catch {
          fail();
        }
      },
      error: fail,
    });
  }).catch(fail);

  return cleanup;
}
