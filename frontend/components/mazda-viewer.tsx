"use client";

import Image from "next/image";
import {useEffect, useId, useRef, useState, type KeyboardEvent} from "react";
import {MAZDA_MODEL} from "@/lib/mazda-model";
import type {CameraAction, MazdaScene} from "@/lib/mazda-scene";
import styles from "./mazda-viewer.module.css";

const controls: {action: CameraAction; label: string; symbol: string}[] = [
  {action: "left", label: "Girar a la izquierda", symbol: "↶"},
  {action: "right", label: "Girar a la derecha", symbol: "↷"},
  {action: "above", label: "Ver desde arriba", symbol: "↑"},
  {action: "below", label: "Ver desde abajo", symbol: "↓"},
  {action: "closer", label: "Acercar", symbol: "+"},
  {action: "farther", label: "Alejar", symbol: "−"},
  {action: "reset", label: "Restablecer vista", symbol: "⟲"},
];

export default function MazdaViewer() {
  const id = useId();
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<MazdaScene | null>(null);
  const launch = useRef<HTMLButtonElement>(null);
  const firstControl = useRef<HTMLButtonElement>(null);
  const activated = useRef(false);
  const [active, setActive] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<"poster" | "loading" | "ready" | "error">("poster");

  useEffect(() => {
    if (!active || !canvas.current) {
      if (activated.current) launch.current?.focus();
      return;
    }
    let disposed = false;
    const target = canvas.current;
    void import("@/lib/mazda-scene").then(({createMazdaScene}) => {
      if (disposed) return;
      scene.current = createMazdaScene(target, {
        onReady() { if (!disposed) setState("ready"); },
        onError() { if (!disposed) { scene.current = null; setState("error"); } },
      });
    }).catch(() => { if (!disposed) setState("error"); });
    return () => {
      disposed = true;
      scene.current?.dispose();
      scene.current = null;
    };
  }, [active, attempt]);

  useEffect(() => { if (state === "ready") firstControl.current?.focus(); }, [state]);
  function open() {
    activated.current = true;
    setState("loading"); setActive(true); setAttempt(value => value + 1);
  }
  function close() { setActive(false); setState("poster"); }
  function keyboard(event: KeyboardEvent<HTMLCanvasElement>) {
    const keys: Record<string, CameraAction> = {ArrowLeft: "left", ArrowRight: "right", ArrowUp: "above", ArrowDown: "below", "+": "closer", "=": "closer", "-": "farther", Home: "reset"};
    const action = keys[event.key];
    if (action) { event.preventDefault(); scene.current?.move(action); }
  }

  return <section className={styles.card} data-testid="mazda-viewer" data-state={state} aria-labelledby={`${id}-title`}>
    <header className={styles.header}>
      <h2 id={`${id}-title`}>Mazda3</h2>
      {active && <button type="button" className={styles.iconButton} aria-label="Volver a vista previa" title="Volver a vista previa" onClick={close}><span aria-hidden="true">×</span></button>}
    </header>
    <div className={styles.stage} id={`${id}-stage`}>
      {(!active || state === "error") ? <Image className={styles.poster} src={MAZDA_MODEL.poster} width={MAZDA_MODEL.posterWidth} height={MAZDA_MODEL.posterHeight} alt="Vista previa del Mazda3 Hatchback 2020" loading="eager" unoptimized/>
        : <canvas ref={canvas} className={styles.frame} tabIndex={state === "ready" ? 0 : -1} role="img" aria-label="Modelo 3D del Mazda3 Hatchback 2020" aria-describedby={`${id}-instructions`} onKeyDown={keyboard}/>}
      {!active && <button ref={launch} type="button" className={styles.launch} aria-label="Explorar en 3D" onClick={open} aria-controls={`${id}-stage`}>Ver en 3D</button>}
    </div>
    {state === "loading" && <p className={styles.status} role="status">Cargando 3D…</p>}
    {state === "error" && <div className={styles.error} role="alert"><p>No se pudo abrir el modelo. Reintenta o activa los gráficos 3D del navegador.</p><button type="button" className="button secondary small-button" onClick={open}>Reintentar 3D</button></div>}
    {state === "ready" && <div className={styles.controls} role="group" aria-label="Controles de cámara 3D">
      {controls.map((control, index) => <button ref={index === 0 ? firstControl : undefined} key={control.action} type="button" className={styles.cameraButton} aria-label={control.label} title={control.label} onClick={() => scene.current?.move(control.action)}><span aria-hidden="true">{control.symbol}</span></button>)}
    </div>}
    <footer className={styles.credit}>
      <p className={styles.hint} id={`${id}-instructions`}>Arrastra para girar · Desliza para acercar<span className="sr-only">. Con teclado: flechas para girar, más y menos para zoom, Inicio para restablecer.</span></p>
      <details className={styles.references}>
        <summary>Créditos</summary>
        <div>
          <p><a href={MAZDA_MODEL.source} target="_blank" rel="noopener noreferrer">{MAZDA_MODEL.title}</a> por <a href={MAZDA_MODEL.authorUrl} target="_blank" rel="noopener noreferrer">{MAZDA_MODEL.author}</a>.</p>
          <p><a href={MAZDA_MODEL.licenseUrl} target="_blank" rel="noopener noreferrer">{MAZDA_MODEL.license}</a> · Solo uso no comercial.</p>
          <p>Base: Racing Master / <a href="https://www.facebook.com/p/GM25-100042237200164/" target="_blank" rel="noopener noreferrer">GM25</a>. Geometría y materiales originales; iluminación local. Decorativo, no diagnóstico.</p>
        </div>
      </details>
    </footer>
  </section>;
}
