declare module "@sketchfab/viewer-api" {
  export type Vector3 = [number, number, number];

  export type Camera = {
    position: Vector3;
    target: Vector3;
  };

  export type ViewerEventListener = (...arguments_: unknown[]) => void;

  export interface ViewerAPI {
    getCameraLookAt(callback: (error: unknown, camera: Camera) => void): void;
    setCameraLookAt(
      position: Vector3,
      target: Vector3,
      duration: number,
      callback?: (error?: unknown) => void,
    ): void;
    stop(): void;
    start(): void;
    setEnableCameraConstraints(
      enabled: boolean,
      options: Record<string, unknown>,
      callback?: (error?: unknown) => void,
    ): void;
    addEventListener(name: string, listener: ViewerEventListener): void;
    removeEventListener(name: string, listener: ViewerEventListener): void;
  }

  interface ViewerOptions {
    autostart: 1;
    autospin: 0;
    camera: 0;
    animation_autoplay: 0;
    dnt: 1;
    preload: 0;
    success: (api: ViewerAPI) => void;
    error: () => void;
  }

  // These private fields are specific to the pinned 1.12.1 SDK. Its public
  // interface has no destroy method, so the adapter owns their cleanup.
  export default class Sketchfab {
    constructor(version: string, iframe: HTMLIFrameElement);
    init(uid: string, options: ViewerOptions): void;
    _apiId: string;
    _version: string;
    _transmitOptions: Record<string, unknown>;
    _options?: ViewerOptions;
    _initializeAPIEmbedBinded?: (event: MessageEvent) => void;
    _client?: {
      _serverReceiveMessageBinded?: (event: MessageEvent) => void;
      _pendingRequests: Record<string, unknown>;
      _eventListeners: Record<string, ViewerEventListener[]>;
    };
  }
}
