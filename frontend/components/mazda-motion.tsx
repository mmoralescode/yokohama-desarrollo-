"use client";

import {useEffect, useId, useRef, useState} from "react";
import styles from "./mazda-motion.module.css";

/** Decorative only: animation never represents telemetry or authorizes operation. */
export default function MazdaMotion() {
  const id = useId();
  const scene = useRef<HTMLElement>(null);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [ready, setReady] = useState(false);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => setReducedMotion(preference.matches);
    const syncVisibility = () => setPageVisible(!document.hidden);
    syncPreference();
    syncVisibility();
    setReady(true);
    preference.addEventListener("change", syncPreference);
    document.addEventListener("visibilitychange", syncVisibility);

    // No animation-frame loop or timers: CSS does the work, only while visible.
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting));
    if (scene.current) observer.observe(scene.current);
    return () => {
      preference.removeEventListener("change", syncPreference);
      document.removeEventListener("visibilitychange", syncVisibility);
      observer.disconnect();
    };
  }, []);

  const stopped = !ready || paused || reducedMotion || !inView || !pageVisible;
  const gradient = (name: string) => `url(#${id}-${name})`;

  return <section ref={scene} className={styles.scene} data-testid="mazda-motion" data-paused={stopped} aria-labelledby={`${id}-heading`}>
    <div className={styles.copy}>
      <p className={styles.eyebrow}>MAZDA3 / MÉXICO</p>
      <h2 id={`${id}-heading`}>Cada kilómetro cuenta.</h2>
      <p className={styles.description}>Planea la próxima parada.<br/>{" "}Mantén el camino en mente.</p>
      <button type="button" className={styles.toggle} disabled={!ready || reducedMotion} onClick={() => setPaused(value => !value)} aria-controls={`${id}-illustration`}>
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          {paused || reducedMotion ? <path d="m5 3 8 5-8 5Z" fill="currentColor"/> : <path d="M5 3v10M11 3v10" stroke="currentColor" strokeWidth="2"/>}
        </svg>
        {reducedMotion ? "Movimiento reducido" : paused ? "Reanudar animación" : "Pausar animación"}
      </button>
    </div>

    <div className={styles.visual}>
      <svg id={`${id}-illustration`} className={styles.illustration} viewBox="0 0 780 280" role="img" aria-label="Ilustración de un Mazda3 rojo en carretera" focusable="false">
        <defs>
          <linearGradient id={`${id}-paint`} x1="0" y1="0" x2="0.15" y2="1">
            <stop offset="0" stopColor="#fe7370"/><stop offset=".36" stopColor="#d93640"/><stop offset=".62" stopColor="#af142a"/><stop offset=".86" stopColor="#e14046"/><stop offset="1" stopColor="#790c20"/>
          </linearGradient>
          <linearGradient id={`${id}-glass`} x1="0" y1="0" x2=".65" y2="1">
            <stop stopColor="#768b92"/><stop offset=".5" stopColor="#35464c"/><stop offset="1" stopColor="#202c31"/>
          </linearGradient>
          <linearGradient id={`${id}-chrome`} x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#f3f5f6"/><stop offset=".5" stopColor="#9faab2"/><stop offset="1" stopColor="#dce2e5"/>
          </linearGradient>
          <radialGradient id={`${id}-shadow`}>
            <stop stopColor="#1c2220" stopOpacity=".23"/><stop offset="1" stopColor="#1c2220" stopOpacity="0"/>
          </radialGradient>
          <clipPath id={`${id}-road-clip`}><path d="M25 252h730v10H25Z"/></clipPath>
        </defs>

        <path d="M32 204h95m522 0h98M65 172h44m535-37h63" stroke="#d8ddd6" strokeWidth="2" strokeLinecap="round"/>
        <path d="M42 237h696" stroke="#d8ddd6"/>
        <g clipPath={gradient("road-clip")}>
          <g className={styles.road} data-testid="mazda-road" stroke="#c0c7bf" strokeWidth="2" strokeLinecap="round">
            {Array.from({length: 12}, (_, index) => <path key={index} d={`M${index * 90} 257h35`}/>)}
          </g>
        </g>
        <ellipse cx="402" cy="237" rx="322" ry="17" fill={gradient("shadow")}/>

        <g className={styles.car}>
          {/* Original vector illustration inspired by the Mazda3 sedan silhouette. */}
          <path d="m96 160 13-27 65-12c37-15 76-48 113-53 36-5 93-6 125 3 31 9 64 35 88 52l153 18 43 17 20 28-4 27-20 10H101l-18-19 3-28Z" fill={gradient("paint")} stroke="#8a1a29" strokeWidth="1.5"/>
          <path d="M173 126c34-17 75-48 111-51 41-5 86-3 113 4 25 7 53 27 76 46Z" fill={gradient("glass")} stroke="#d8dce0" strokeWidth="2"/>
          <path d="m323 76-4 48h14l2-48M406 84l-11 40h13l9-33" fill="#222c31"/>
          <path d="m200 122 83-42 29-1-5 42Z" fill="#b8cbd0" opacity=".12"/>
          <path d="m343 81-2 40 54 1 9-34Z" fill="#c5d8df" opacity=".14"/>
          <path d="M112 136c104-1 202 1 356-4 80-1 151 9 204 21" fill="none" stroke="#ffb2a7" strokeWidth="2" opacity=".65"/>
          <path d="M130 159c117 4 210 37 325 14 47-10 104-21 155-19" fill="none" stroke="#ff9a92" strokeWidth="2" opacity=".55"/>
          <path d="m323 134-6 67q-2 10-16 11h-29m141-80 11 70q2 10-12 10h-77" fill="none" stroke="#8e1527" strokeWidth="1.5"/>
          <path d="m280 146 20-1m95 2 20-1" stroke="#822034" strokeWidth="5" strokeLinecap="round"/>
          <path d="m280 144 20-1m95 2 20-1" stroke="#f79690" strokeWidth="2" strokeLinecap="round"/>
          <path d="m454 126 11-7 21 4 2 10-27 1Z" fill="#a7192d" stroke="#f0807c"/>
          <path d="m463 133 7 6" stroke="#2a3032" strokeWidth="4"/>
          <path d="m647 148 36 11 10 11-52-8-15-11Z" fill="#e8f5f7" stroke="#831226" strokeWidth="2"/>
          <path d="m644 157 37 8" stroke="#fff" strokeWidth="2"/>
          <path d="m99 148 40-4 13 8-14 6-42 2" fill="#7d1424"/>
          <path d="m100 150 34-2 12 4-11 3-36 1" fill="#ffadb0"/>
          <path d="m696 180 12 5-2 20-19 5 5-22Z" fill="#202a2e"/>
          <path d="m705 183-5 20-9 3" fill="none" stroke="#cbd2d5" strokeWidth="2"/>
          <path d="M99 213h587l12-5-6 13H103Z" fill="#38262c"/>
          <path d="M274 216h260" stroke="#f46b6c" strokeWidth="2"/>
          {[214, 590].map((x) => <g key={x} transform={`translate(${x} 201)`}>
            <path d="M-51 20v-18a51 51 0 0 1 102 0v18" fill="#27292d" stroke="#861d2b" strokeWidth="3"/>
            <circle r="44" fill="#202429" stroke="#454b50" strokeWidth="2"/>
            <circle r="35" fill="#121b20" stroke="#87939b" strokeWidth="2"/>
            <g className={styles.wheel} data-testid="mazda-wheel">
              <circle r="31" fill="#28333b" stroke="#56636c"/>
              {Array.from({length: 5}, (_, index) => <g key={index} transform={`rotate(${index * 72})`} fill={gradient("chrome")}>
                <path d="m-5-7-4-23 6-1 7 24ZM5-7l10-19 5 4L10-2Z"/>
              </g>)}
              <circle r="9" fill="#bcc6cd" stroke="#3b4851" strokeWidth="2"/>
              <circle r="4" fill="#44525c"/>
            </g>
          </g>)}
          <path d="M162 199a52 52 0 0 1 104 0m272 0a52 52 0 0 1 104 0" fill="none" stroke="#f78a83" strokeWidth="1.5" opacity=".7"/>
        </g>
      </svg>
      <p className={styles.caption}>Ilustración animada · no representa el estado de las unidades</p>
    </div>
  </section>;
}
