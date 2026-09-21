# Verificación de la ampliación — 21 de septiembre de 2026

Entorno: Windows, Python 3.13, SQLite local, Node 20.20.2. No se modificó EXCOBA. Rama de trabajo: `feat/fleet-reliability`.

## Resultado

- Backend: **212 pruebas aprobadas**; prueba de capacidad excluida de la corrida rápida y ejecutada por separado. Dos avisos de deprecación preexistentes de Starlette/HTTPX, sin fallos.
- Capacidad opt-in: **1 prueba aprobada**, 100 unidades sintéticas, 12108 lecturas, 16 solicitudes concurrentes mezclando flotilla, alertas, plan individual y recálculo. Cero errores; 1717 alertas y 3434 notificaciones simuladas, claves sin duplicados, conteos e integridad conservados.
- Rendimiento de esa carga: p50 13.545 s, p95/máximo 19.538 s; tramo concurrente 20.097 s. Antes de optimizar las consultas repetidas era 42.085 s. Son mediciones del cliente HTTP de pruebas en esta máquina, con caché previamente calentada; **no un SLA ni un límite universal de capacidad**.
- Frontend: typecheck y compilación de producción aprobados; 4 pruebas de fechas/orden y 2 pruebas de formularios/métricas en Chromium aprobadas. Fixtures de API aislados, navegador en zona Tokio para verificar la conversión a Ciudad de México; sin errores JavaScript ni desbordamiento móvil.
- Pruebas de migración: 11, incluidas dentro del backend; preservación de datos, rollback DDL, respaldo, esquemas desconocidos, restricciones y arranque simultáneo.
- Prueba de copia/restauración: incluye páginas WAL, integridad y rechazo de sobrescritura.

## Migración de la demo conservada

Se detuvieron únicamente los procesos registrados por `scripts/dev.ps1`. Se inició la versión compilada desde `.next-reliability`, sin seed ni reinicialización de base. Migración automática v1→v2 con respaldo `.bak` junto a la base; integridad `ok`, cero referencias inválidas.

| Registros originales | Antes | Después |
| --- | ---: | ---: |
| Unidades | 20 | 20 |
| Lecturas | 433 | 433 |
| Servicios realizados | 456 | 456 |
| Reportes de falla | 3 | 3 |

Comprobación HTTP y navegador mediante el proxy real del panel: `/health` ok, flotilla de 20, unidad prioritaria roja, detalle con timestamps, métricas sintéticas con 456 servicios y ningún paro ficticio generado. Smoke de producción en móvil de 390 px, sin desbordamiento ni errores JavaScript; ninguna escritura de datos. El sistema queda local en `http://127.0.0.1:3001`.

## Componentes ampliados

- Persistencia: `backend/app/models.py`, `database.py`, migraciones 001/002.
- Reglas y alertas: `engine.py`, `planner.py`, `settings.py`, `config/policy.json`.
- Captura/API: `main.py`, `schemas.py`, `odometer.py`, `time_utils.py`, `seed.py`.
- Métricas, respaldo y extensiones: `metrics.py`, `backup.py`, `integrations.py`.
- Panel: home, detalle y calendario; componentes `fleet-metrics.tsx`, `vehicle-records.tsx`; tipos, fechas, orden y proxy de API.
- Pruebas nuevas de datos, migración, robustez, carga, utilidades y formularios; se actualizan fixtures anteriores sin alterar el Mazda.
- Dependencia `tzdata` fijada para que Windows disponga de las reglas IANA históricas.

## Repetición

Desde `backend`, con el entorno virtual:

```powershell
./.venv/Scripts/python.exe -m pytest -q
$env:YOKOHAMA_RUN_LOAD_TESTS='1'
./.venv/Scripts/python.exe -m pytest tests/test_capacity.py -q -s
```

Desde `frontend`, con API fixtures (sin escribir en la base):

```powershell
npm run typecheck
npm run test:e2e -- operational-helpers.spec.ts reliability-ui.spec.ts
npm run build
```

Antes de producción empresarial quedan validación mecánica, permisos del activo 3D, identidad/roles, infraestructura, respaldos programados y pruebas con volumen/muestra real. No se declara disponibilidad del 100 % ni que un software pueda garantizar ausencia de fallas mecánicas. Ver [operación y supuestos](operacion-datos.md).
