import Link from "next/link";
export default function NotFound() {return <div className="empty"><p className="eyebrow">404 · PÁGINA NO ENCONTRADA</p><h1>No encontramos esta ruta.</h1><p>Regresa al panel para consultar tus unidades.</p><Link href="/" className="button primary">Volver a flotilla</Link></div>;}
