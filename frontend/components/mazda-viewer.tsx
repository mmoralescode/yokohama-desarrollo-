"use client";

import Image from "next/image";
import {useEffect, useId, useRef, useState} from "react";
import {MAZDA_MODEL} from "@/lib/mazda-model";
import {connectSketchfab, type Camera, type Vector3, type ViewerAPI} from "@/lib/sketchfab-viewer";
import styles from "./mazda-viewer.module.css";

type ViewState = "poster" | "loading" | "ready" | "error";
type Action = "left" | "right" | "above" | "below" | "closer" | "farther" | "reset";
const controls: {action: Action; label: string; symbol: string}[] = [
  {action: "left", label: "Girar a la izquierda", symbol: "↶"},
  {action: "right", label: "Girar a la derecha", symbol: "↷"},
  {action: "above", label: "Ver desde arriba", symbol: "↑"},
  {action: "below", label: "Ver desde abajo", symbol: "↓"},
  {action: "closer", label: "Acercar", symbol: "+"},
  {action: "farther", label: "Alejar", symbol: "−"},
];

function validCamera(camera?: Camera): camera is Camera {
  return !!camera && [camera.position, camera.target].every(vector =>
    Array.isArray(vector) && vector.length === 3 && vector.every(Number.isFinite));
}
function distance(camera: Camera) {
  return Math.hypot(...camera.position.map((value, index) => value - camera.target[index]));
}

export default function MazdaViewer() {
  const id = useId();
  const frame = useRef<HTMLIFrameElement>(null);
  const launch = useRef<HTMLButtonElement>(null);
  const firstControl = useRef<HTMLButtonElement>(null);
  const api = useRef<ViewerAPI | null>(null);
  const originalCamera = useRef<Camera | null>(null);
  const activated = useRef(false);
  const controlPending = useRef(false);
  const controlTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [active, setActive] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ViewState>("poster");
  const [cameraReady, setCameraReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [controlError, setControlError] = useState<string | null>(null);

  useEffect(() => {
    if (!active || !frame.current) {
      if (activated.current) launch.current?.focus();
      return;
    }
    let disposed = false;
    let cameraTimer: ReturnType<typeof setTimeout> | undefined;
    const disconnect = connectSketchfab(frame.current, {
      onReady(viewer) {
        if (disposed) return;
        api.current = viewer;
        setState("ready");
        let settled = false;
        cameraTimer = setTimeout(() => {
          if (disposed || settled) return;
          settled = true;
          setControlError("Usa los controles dentro del visor; no pudimos preparar los botones de cámara.");
        }, 5000);
        viewer.getCameraLookAt((error, camera) => {
          if (disposed || settled) return;
          settled = true;
          clearTimeout(cameraTimer);
          if (error || !validCamera(camera) || distance(camera) < 0.001) {
            setControlError("Usa los controles dentro del visor; no pudimos preparar los botones de cámara.");
            return;
          }
          originalCamera.current = {position: [...camera.position], target: [...camera.target]};
          setCameraReady(true);
        });
      },
      onError() {
        if (disposed) return;
        api.current = null;
        setCameraReady(false);
        setState("error");
      },
    });
    return () => {
      disposed = true;
      clearTimeout(cameraTimer);
      clearTimeout(controlTimer.current);
      controlPending.current = false;
      disconnect();
      api.current = null;
      originalCamera.current = null;
    };
  }, [active, attempt]);

  useEffect(() => {
    if (cameraReady && active) firstControl.current?.focus();
  }, [cameraReady, active]);

  function open() {
    activated.current = true;
    setCameraReady(false); setBusy(false); setControlError(null);
    setState("loading"); setActive(true); setAttempt(value => value + 1);
  }
  function close() {
    setActive(false); setState("poster"); setCameraReady(false); setBusy(false); setControlError(null);
  }

  function moveCamera(action: Action) {
    const viewer = api.current;
    const initial = originalCamera.current;
    if (!viewer || !initial || controlPending.current) return;
    controlPending.current = true;
    setBusy(true); setControlError(null);
    let complete = false;
    const finish = (error?: unknown) => {
      if (complete || api.current !== viewer) return;
      complete = true;
      clearTimeout(controlTimer.current);
      controlPending.current = false;
      setBusy(false);
      if (error) setControlError("La cámara no respondió. Puedes usar el visor o volver a cargarlo.");
    };
    controlTimer.current = setTimeout(() => finish(true), 5000);
    const setCamera = (position: Vector3, target: Vector3) => {
      if (complete || api.current !== viewer) return;
      const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 0.25;
      viewer.setCameraLookAt(position, target, duration, finish);
    };
    if (action === "reset") { setCamera([...initial.position], [...initial.target]); return; }
    viewer.getCameraLookAt((error, camera) => {
      if (complete || api.current !== viewer) return;
      if (error || !validCamera(camera)) { finish(true); return; }
      const delta = camera.position.map((value, index) => value - camera.target[index]) as Vector3;
      const radius = Math.hypot(...delta);
      if (radius < 0.001) { finish(true); return; }
      const next: Vector3 = [...delta];
      if (action === "left" || action === "right") {
        const angle = (action === "left" ? 1 : -1) * Math.PI / 6;
        next[0] = delta[0] * Math.cos(angle) - delta[1] * Math.sin(angle);
        next[1] = delta[0] * Math.sin(angle) + delta[1] * Math.cos(angle);
      } else if (action === "above" || action === "below") {
        // Sketchfab's viewer camera uses Z-up; leave a small horizontal offset.
        const azimuth = Math.atan2(delta[1], delta[0]);
        const elevation = (action === "above" ? 1 : -1) * Math.PI * 0.43;
        next[0] = radius * Math.cos(elevation) * Math.cos(azimuth);
        next[1] = radius * Math.cos(elevation) * Math.sin(azimuth);
        next[2] = radius * Math.sin(elevation);
      } else {
        const baseRadius = distance(initial);
        // Native gestures can exceed our button limits; never reverse a zoom.
        const newRadius = action === "closer"
          ? Math.min(radius, Math.max(baseRadius * 0.25, radius * 0.8))
          : Math.max(radius, Math.min(baseRadius * 3, radius * 1.25));
        for (let index = 0; index < 3; index++) next[index] *= newRadius / radius;
      }
      setCamera(next.map((value, index) => value + camera.target[index]) as Vector3, [...camera.target]);
    });
  }

  return <section className={styles.card} data-testid="mazda-viewer" data-state={state} aria-labelledby={`${id}-title`}>
    <div className={styles.content}>
      <div className={styles.copy}>
        <p className={styles.eyebrow}>EXPLORADOR 3D / MODELO 2020</p>
        <h2 id={`${id}-title`}>Mazda3<br/>{" "}Hatchback.</h2>
        <p>Explora su diseño desde cada ángulo.</p>
        <ul className={styles.instructions} id={`${id}-instructions`}>
          <li>Arrastra para girar e inclinar.</li>
          <li>Usa la rueda o dos dedos para acercar.</li>
          <li>También puedes usar los botones de cámara.</li>
        </ul>
        {!active ? <button ref={launch} type="button" className="button primary" onClick={open} aria-controls={`${id}-stage`}>Explorar en 3D <span aria-hidden="true">↗</span></button>
          : <button type="button" className="button secondary" onClick={close}>Volver a vista previa</button>}
        <p className={styles.connection}>Al activar el visor te conectas con Sketchfab. Requiere internet y gráficos 3D compatibles.</p>
      </div>
      <div className={styles.visual}>
        <div className={styles.stage} id={`${id}-stage`}>
          {(!active || state === "error") ? <Image className={styles.poster} src={MAZDA_MODEL.poster} width={MAZDA_MODEL.posterWidth} height={MAZDA_MODEL.posterHeight} alt="Vista previa del Mazda3 Hatchback 2020" loading="eager" unoptimized/>
            : <iframe ref={frame} id={`${id}-frame-${attempt}`} title="Modelo 3D del Mazda3 Hatchback 2020" className={styles.frame} aria-describedby={`${id}-instructions`} allow="fullscreen; autoplay" allowFullScreen referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-popups"/>}
          {!active && <span className={styles.previewLabel}>VISTA PREVIA · ACTIVA EL VISOR PARA GIRAR</span>}
        </div>
        {state === "loading" && <p className={styles.status} role="status">Cargando modelo 3D desde Sketchfab…</p>}
        {state === "error" && <div className={styles.error} role="alert"><p>No se pudo cargar el modelo 3D. Comprueba tu conexión, los permisos de contenido externo y la aceleración gráfica del navegador.</p><button type="button" className="button secondary small-button" onClick={open}>Reintentar 3D</button> <a href={MAZDA_MODEL.source} target="_blank" rel="noopener noreferrer">Abrir modelo en Sketchfab ↗</a></div>}
        {state === "ready" && <div className={styles.controls} role="group" aria-label="Controles de cámara 3D">
          {controls.map((control, index) => <button ref={index === 0 ? firstControl : undefined} key={control.action} type="button" className={styles.cameraButton} aria-label={control.label} title={control.label} disabled={!cameraReady} aria-disabled={busy || !cameraReady} onClick={() => moveCamera(control.action)}><span aria-hidden="true">{control.symbol}</span></button>)}
          <button type="button" className={styles.reset} disabled={!cameraReady} aria-disabled={busy || !cameraReady} onClick={() => moveCamera("reset")}>Restablecer vista</button>
        </div>}
        {controlError && <p className={styles.status} role="status">{controlError}</p>}
      </div>
    </div>
    <footer className={styles.credit}>
      <p><a href={MAZDA_MODEL.source} target="_blank" rel="noopener noreferrer">{MAZDA_MODEL.title}</a> por <a href={MAZDA_MODEL.authorUrl} target="_blank" rel="noopener noreferrer">{MAZDA_MODEL.author}</a> · <a href={MAZDA_MODEL.licenseUrl} target="_blank" rel="noopener noreferrer">{MAZDA_MODEL.license}</a> · Solo uso no comercial.</p>
      <p>La publicación declara base en Racing Master; créditos: <a href="https://www.facebook.com/p/GM25-100042237200164/" target="_blank" rel="noopener noreferrer">GM25</a>. Modelo sin modificaciones.</p>
      <p>Decoración 2020, no modelo oficial ni diagnóstico. El sistema de mantenimiento conserva su alcance Mazda3 México 2021–2026.</p>
    </footer>
  </section>;
}
