"use client";
export default function Error({reset}: {error: Error & {digest?: string}; reset: () => void}) {return <div className="empty" role="alert"><p className="eyebrow">ERROR DEL PANEL</p><h1>No pudimos mostrar esta vista.</h1><p>Los registros permanecen en la API. Reintenta o revisa la configuración local.</p><button className="button primary" onClick={reset}>Reintentar</button></div>;}
