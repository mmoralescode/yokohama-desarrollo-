"use client";
import Link from "next/link";
import {usePathname} from "next/navigation";
import type {ReactNode} from "react";
import {Icon, IconName} from "./ui";

const links: {href: string; label: string; icon: IconName}[] = [
  {href: "/", label: "Mi flotilla", icon: "fleet"},
  {href: "/calendario", label: "Calendario", icon: "calendar"},
  {href: "/alertas", label: "Alertas", icon: "bell"}
];
export default function Shell({children}: {children: ReactNode}) {
  const path = usePathname();
  return <div className="app-shell"><a className="skip-link" href="#contenido">Ir al contenido</a>
    <aside className="sidebar"><Link href="/" className="brand" aria-label="Yokohama, inicio"><span className="brand-mark" aria-hidden="true">Y</span><span>YOKOHAMA<small>FLEET INTELLIGENCE</small></span></Link>
      <p className="nav-caption">OPERACIÓN</p><nav aria-label="Navegación principal">{links.map(link => <Link key={link.href} href={link.href} className={`nav-link ${(link.href === "/" ? path === "/" || path.startsWith("/vehiculos") : path.startsWith(link.href)) ? "active" : ""}`} aria-current={(link.href === "/" ? path === "/" || path.startsWith("/vehiculos") : path.startsWith(link.href)) ? "page" : undefined}><Icon name={link.icon}/>{link.label}</Link>)}</nav>
      <div className="sidebar-bottom"><span className="sidebar-indicator"/>ENTORNO LOCAL<p>Mazda3 · México<br/>Modelos 2021–2026</p><span className="sidebar-version">MVP / REGLAS DOCUMENTADAS</span></div>
    </aside><div className="workspace"><header className="topbar"><span>Gestión predictiva de mantenimiento</span><div className="inline gap"><span className="demo-tag">DEMO LOCAL</span><span className="avatar" aria-label="Operador local">OP</span></div></header>
      <div className="demo-notice"><Icon name="warning" size={17}/><p><strong>Proyecciones provisionales.</strong> No sustituyen una inspección ni autorizan retrasar servicios. Los datos sin validar no se consideran seguros.</p></div>
      <main id="contenido" tabIndex={-1}>{children}</main><footer className="footer"><span>Yokohama · Planeación de flotillas</span><span>Sin notificaciones reales · Acceso local</span></footer>
    </div>
  </div>;
}
