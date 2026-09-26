# Panel local de Yokohama

Aplicación independiente de EXCOBA. Next.js 16, React 19, TypeScript y CSS sin librería de interfaz ni fuentes externas. En operación local consume el backend. La compilación de propuesta pública usa ejemplos sintéticos separados con persistencia en el navegador.

## Arranque

1. Instala Node.js >= 20.9 y ejecuta `npm ci` en esta carpeta.
2. Copia `.env.example` a `.env.local`. Define `YOKOHAMA_API_KEY` con la misma clave local del backend. No la subas a Git ni uses una variable `NEXT_PUBLIC_*`.
3. Inicia primero la API en `http://127.0.0.1:8000` siguiendo el [README del proyecto](../README.md).
4. Ejecuta `npm run dev` y abre `http://127.0.0.1:3001`.

Para verificar: `npm run typecheck`, `npm run build` y `npm run test:e2e`. Para arrancar la compilación: `npm start`.

## Pantallas

- `/`: flotilla, filtros de estado, búsqueda, registro de unidades y recálculo.
- `/vehiculos/[id]`: estimación de uso, ventanas e incertidumbre, fuentes, visitas, historial y registro de lecturas, servicios, fallas y resoluciones.
- `/calendario`: agenda mensual, cambios de fecha con historial y registro retrospectivo de servicios (kilometraje opcional).
- `/alertas`: mantenimiento, fallas y problemas de datos; bandeja de notificaciones explícitamente simuladas.
- `/dashboard`: resumen administrativo, prioridades por unidad, agenda de siete días, actividad de seis meses y registros por completar. Se encuentra debajo de Alertas; [definiciones de los indicadores](../docs/dashboard.md).

Las proyecciones se etiquetan como provisionales. Una fecha o tolerancia desconocida no se presenta como una garantía de seguridad. Para diferir una falla se requiere evaluación y responsable documentados; el motor puede elevar la severidad o rechazar ese diferimiento. Las fallas críticas indican detener la operación y coordinar asistencia, no conducir al taller.

El visor 3D de Mazda está oculto temporalmente. Su componente, escena y activo local se conservan sin participar en datos ni pronósticos; para reactivarlo, cambia `SHOW_MAZDA_3D_VIEWER` a `true` en `lib/feature-flags.ts`.

## Límite de seguridad del MVP

La versión operativa mantiene acceso local: no existe autenticación de personas, sesiones ni roles. El servidor se enlaza a `127.0.0.1`; el proxy rechaza hosts que no sean loopback. La propuesta pública es una compilación independiente con `NEXT_PUBLIC_YOKOHAMA_PROPOSAL_MODE=true`: permite consultar las pantallas y operar ejemplos únicamente en el navegador, y bloquea todas las rutas `/api/*`.

El navegador utiliza `/api/backend/...`; solo el servidor agrega `X-API-Key`. El proxy permite únicamente rutas y métodos conocidos, exige Origin de la misma página en mutaciones, rechaza solicitudes cross-site, limita los cuerpos a 32 KiB y solo permite un upstream HTTP loopback sin redirecciones. Si faltan las variables de servidor, las consultas fallan cerradas. No se reenvían cookies, cabeceras de autenticación del navegador ni mensajes internos de error de la API.

Un futuro despliegue operativo compartido requiere autenticación, permisos y base de datos persistente. La propuesta no sustituye ese entorno: muestra un aviso de datos ficticios y de guardado por navegador. `vercel.json` selecciona ese modo al desplegar sólo `frontend`; `.vercelignore` excluye configuración privada, artefactos locales y los modelos 3D.

Versiones de runtime verificadas en el registro oficial npm al implementar: [Next](https://registry.npmjs.org/next/latest), [React](https://registry.npmjs.org/react/latest), [Playwright](https://registry.npmjs.org/@playwright/test/latest). Las versiones exactas se conservan en `package-lock.json`.
