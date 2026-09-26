"use client";
import Link from "next/link";
import {usePathname} from "next/navigation";
import type {ReactNode} from "react";
import {Icon, IconName} from "./ui";
import {proposalMode} from "@/lib/proposal-mode";

const links: {href: string; label: string; icon: IconName}[] = [
  {href: "/", label: "Mi flotilla", icon: "fleet"},
  {href: "/calendario", label: "Calendario", icon: "calendar"},
  {href: "/alertas", label: "Alertas", icon: "bell"},
  {href: "/dashboard", label: "Dashboard", icon: "dashboard"}
];
export default function Shell({children}: {children: ReactNode}) {
  const path = usePathname();
  return <div className="app-shell"><a className="skip-link" href="#contenido">Ir al contenido</a>
    <aside className="sidebar"><Link href="/" className="brand" aria-label="Yokohama, inicio"><span>YOKOHAMA</span></Link>
      <p className="nav-caption">OPERACIÓN</p><nav aria-label="Navegación principal">{links.map(link => <Link key={link.href} href={link.href} className={`nav-link ${(link.href === "/" ? path === "/" || path.startsWith("/vehiculos") : path.startsWith(link.href)) ? "active" : ""}`} aria-current={(link.href === "/" ? path === "/" || path.startsWith("/vehiculos") : path.startsWith(link.href)) ? "page" : undefined}><Icon name={link.icon}/>{link.label}</Link>)}</nav>
      <div className="sidebar-bottom"><span className="sidebar-indicator"/>{proposalMode ? "PROPUESTA INTERACTIVA" : "ENTORNO LOCAL"}<p>Flotilla multimarca<br/>México</p><span className="sidebar-version">CONTROL ADMINISTRATIVO</span></div>
    </aside><div className="workspace"><header className="topbar"><span>Administración y mantenimiento de flotillas</span><div className="inline gap"><span className="demo-tag">{proposalMode ? "PROPUESTA" : "PANEL LOCAL"}</span><span className="avatar" aria-label="Operador">OP</span></div></header>
      <div className="demo-notice"><Icon name={proposalMode ? "fleet" : "warning"} size={17}/><p>{proposalMode ? <><strong>Prueba la propuesta.</strong> Las unidades, placas y nombres de conductores son ficticios. Tus cambios se conservan sólo en este navegador; no se comparten entre dispositivos. Usa datos de ejemplo.</> : <><strong>Control administrativo.</strong> Registra el día real del servicio, aunque lo captures después. Las proyecciones orientan la agenda y requieren revisión técnica.</>}</p></div>
      <main id="contenido" tabIndex={-1}>{children}</main><footer className="footer"><span>Yokohama · Administración de flotillas</span><span>{proposalMode ? "Datos de ejemplo · Sin envíos reales" : "Sin notificaciones reales · Acceso local"}</span></footer>
    </div>
  </div>;
}
