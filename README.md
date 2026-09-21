# Sistema para Yokohama — MVP local

Panel y API independientes para planear mantenimiento de Mazda3 mexicanos 2021–2026. Repositorio: [mmoralescode/yokohama-desarrollo-](https://github.com/mmoralescode/yokohama-desarrollo-), rama `main`. La aprobación de desarrollo permite las fases 2–4; **no sustituye la validación mecánica del catálogo por Mazda**.

Todo vive en este directorio: no modifica rutas, usuarios, folios, base de datos ni despliegue de EXCOBA. No publicar esta demostración en Internet: aún no implementa identidad de operadores, roles ni aislamiento entre clientes.

El código se trasladó a este repositorio independiente sin importar el historial de EXCOBA, bases de datos, credenciales ni archivos generados. Ver [estructura y traslado](docs/repositorio-independiente.md). Publicar el código en GitHub no despliega el panel ni habilita acceso público a los datos de una flotilla.

## Qué incluye

- Flotilla con búsqueda y semáforo, detalle por unidad, calendario y bandeja de alertas en español; diseño adaptable a móvil.
- Visor minimalista del Mazda3 Hatchback **2020** de Ddiaz Design para la demo **no comercial**, con créditos y licencia CC BY-NC-SA 4.0 en un desplegable. Modelo y texturas locales: giro, inclinación, zoom y teclado **sin internet**, al pulsar «Ver en 3D». Sin visor externo ni giro automático; solo renderiza cuando cambia la vista. Requiere mantener el servidor local encendido y un navegador con gráficos 3D. No cambia las reglas de mantenimiento. [Fuente, licencia y límites](docs/modelo-3d.md).
- Registro de unidades, lecturas con fecha/hora y fuente, servicios con costo MXN, fallas/DTC y paros reales. Validación de cronología y cargas JSON atómicas de hasta 500 lecturas.
- Estimación ponderada y robusta de km/día, respaldo del promedio de flotilla (sin mezclar demo con datos reales), escenarios y confianza. Vence lo primero: km, días o meses naturales, ajustado por severidad de cada unidad.
- Agrupación de ventanas en la última fecha común posible. Servicios vencidos generan evaluación hoy, sin inventar una prórroga; críticos reciben atención inmediata.
- Alertas 30/14/7 días y etapa vencido, sin duplicar cada recálculo. Correo y WhatsApp **solo simulados**, sin envío ni destinatarios reales.
- Flotilla ordenada por urgencia, métricas separadas real/demo, error de pronóstico y días fuera de servicio.
- SQLite con migración v1→v2 y respaldo previo verificado; auditoría de insumos/catálogo/política y generador reproducible de 20 unidades sintéticas. [Operación, supuestos y carga de datos](docs/operacion-datos.md).

## Inicio rápido en Windows

Requisitos: Python 3.11+ con `py`, Node.js 20.9+ y npm en PATH. Se verificó con Python 3.13 y Node 20.20.2. Desde la raíz del repositorio:

```powershell
./scripts/dev.ps1 -Install -Seed
```

Abrir **http://127.0.0.1:3001**. La API escucha únicamente en `127.0.0.1:8000`; estado público en `/health`. El script crea una clave efímera compartida por los dos procesos; no la imprime ni la guarda. Si PowerShell bloquea scripts, revisar la política de ejecución con el administrador; no desactivar protecciones globales.

Siguientes inicios (sin reinstalar ni crear otra flotilla):

```powershell
./scripts/dev.ps1
# Detener únicamente los procesos registrados por este script:
./scripts/dev.ps1 -Stop
```

Los procesos se abren ocultos. Registros y PIDs: `.runtime/` (ignorado por Git). La base `backend/data/yokohama.db` se conserva al detener. `-Seed` es idempotente: no borra ni sobrescribe unidades existentes. Los VIN `DEM…` y placas `DEMO-001` a `DEMO-020` son ficticios.

Para presentar la demo sin recompilación de desarrollo: detener con `-Stop`, ejecutar `npm run build` en `frontend` y arrancar el script con `-Production`. Este nombre solo selecciona el servidor compilado de Next: sigue siendo una demo local sin autenticación de usuarios.

En carpetas sincronizadas como OneDrive pueden bloquearse directorios generados. Sin borrar archivos ni cambiar permisos, establecer `$env:YOKOHAMA_BUILD_DIR='.next-demo-1'` (nombre nuevo) antes de compilar y conservar esa misma variable al iniciar con `-Production`. Solo se permiten nombres `.next` o `.next-NOMBRE` dentro del panel; sus artefactos quedan fuera de Git.

## Inicio manual / otros sistemas

En `backend`:

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
# Generar una clave local; conservarla solo en el entorno de ambos procesos.
export YOKOHAMA_API_KEY="$(python -c 'import secrets; print(secrets.token_urlsafe(32))')"
python -m app.seed --seed 2026
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

En otra terminal, establecer **la misma clave** en `YOKOHAMA_API_KEY`, establecer `YOKOHAMA_API_URL=http://127.0.0.1:8000` y ejecutar desde `frontend`:

```sh
npm ci
npm run dev
```

No usar prefijos `NEXT_PUBLIC_` para la clave. Los `.env.example` documentan las variables: Next puede leer `.env.local`; la API recibe variables de proceso (no carga `.env` automáticamente). No guardar secretos en Git. La API rechaza accesos sin clave; el proxy web solo admite host local y origen permitido. Esto es protección de desarrollo, **no autenticación de producción**.

`backend/requirements.lock.txt` conserva las versiones transitivas verificadas en Windows/Python 3.13; en ese entorno puede instalarse con `python -m pip install -r requirements.lock.txt`. En otros sistemas, verificar compatibilidad y pruebas antes de actualizar ese registro.

Opcionales del backend:

- `YOKOHAMA_DATABASE_URL`: URL SQLAlchemy; por defecto SQLite bajo `backend/data/`. Usar otra base independiente para pruebas.
- `YOKOHAMA_POLICY_PATH`: archivo JSON de política; por defecto `config/policy.json`.

## Pruebas

Resultados actuales: [verificación de fiabilidad y capacidad](docs/verificacion-fiabilidad.md). Historial: [verificación inicial del MVP](docs/verificacion-mvp.md).

Desde `backend` con el entorno activo:

```sh
python -m pytest -q
```

En Windows: `./.venv/Scripts/python.exe -m pytest -q`. Las pruebas API usan bases temporales, no la base de la demostración. Incluyen lecturas duplicadas/decrecientes/futuras, datos atípicos y escasos, límites km/meses, intersecciones y vencimientos, fallas críticas/menores, persistencia y notificaciones idempotentes.

Desde `frontend`:

```sh
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
```

Para E2E deben estar activos API y panel en 8000/3001, con los 20 vehículos demo. **Usar una base local de pruebas**: el test agrega una unidad `TST…` / `E2E-…` sintética y sus movimientos; nunca borra registros. Capturas y trazas se guardan en `test-results/`, fuera de Git. Cubre navegación, formularios, persistencia, alertas críticas, resolución, diferimiento evaluado, móvil y bloqueo de accesos indebidos.

Si OneDrive bloquea la limpieza de resultados de una corrida anterior, usar una carpeta temporal nueva: `npm run test:e2e -- --output RUTA_TEMPORAL_NUEVA`. No se necesita borrar la base ni cambiar permisos de la carpeta del proyecto.

La prueba visual `npm run test:e2e -- mazda-viewer.spec.ts` solo requiere el panel: bloquea conexiones externas antes de abrir cada sesión, carga el **GLB local real** e intercepta las consultas de flotilla sin escribir en la API. Comprueba cámara y zoom por gestos/teclado, créditos, cierre y reapertura, errores, pérdida de contexto WebGL y móvil. Usa Chromium completo con soporte WebGL; no simula un visor externo ni sustituye el automóvil por una figura de prueba. Para probar otro puerto local, establecer `YOKOHAMA_VISUAL_TEST_URL` (por defecto `http://127.0.0.1:3001`). El componente está en `frontend/components/mazda-viewer.tsx`, el renderizador bajo demanda en `frontend/lib/mazda-scene.ts` y el modelo en `frontend/public/models/`.

## Catálogos, configuración y límites

La investigación aprobada sigue intacta:

- [Investigación, fuentes y pendientes](docs/investigacion-fase-1.md).
- [40 reglas de servicios y campañas/fallas documentadas](catalogos/mazda3-mx.v0.1.0.json).
- [Variantes mexicanas por año, motor y transmisión](catalogos/variantes-mx.v0.1.0.json).
- [Política configurable](config/policy.json), [decisiones y límites](docs/decisiones-mvp.md).

El modo por defecto es `demo`: fechas **provisionales**. No se predice una avería por kilometraje cuando la evidencia solo permite inspección por condición o consulta por VIN. Las campañas no se convierten en probabilidad de falla. No se fabrica historial a km cero. Si falta historial, intervalo o equipo confirmado, la regla queda pendiente y puede no tener fecha.

El uso combina limpieza robusta de lecturas con tasas ponderadas por recencia. Los límites consideran el escenario de uso alto y un cuantil conservador de tasas observadas. Los rangos son escenarios, **no probabilidades calibradas**. La confianza incorpora datos de uso y evidencia de la regla; no garantiza seguridad mecánica.

| Grupo de configuración | Controla |
| --- | --- |
| `alert_days` | Anticipaciones 30/14/7 días; vencido es una etapa adicional |
| `usage` | Respaldo 80 km/día, ventana, ponderación, muestras mínimas, máximo plausible e incertidumbre |
| `planning` | Adelanto demostrativo de 7 días, horizonte y reserva previa al límite |
| `triage` | Síntomas de escalamiento preventivo y listas DTC sujetas a validación |
| `api.refresh_seconds` | Recálculo periódico (300 segundos; 0 lo desactiva) |
| `service_overrides` | Parámetros por servicio respaldados por validación explícita |

80 km/día y 7 días de adelanto son supuestos de demo, no datos Mazda/Yokohama. `null` en tolerancia conserva el desconocimiento: no se permite extensión, pero **esto no acredita un límite seguro**. Duraciones desconocidas no son cero. Sin duración/capacidad/piezas confirmadas no se garantizan días de inmovilización ni cita.

Para validar una regla, registrar en `service_overrides[ID]`: `validated: true`, `validated_by`, `validated_on` (ISO no futura), `evidence_url` HTTPS y los IDs de `resolved_conflicts`. Solo con evidencia real incorporar `interval_km`, `interval_months`, `tolerance_km`, `tolerance_days`, `advance_days`, `duration_hours` y `workshop_buffer_days`. No activar indicadores solo para conseguir fechas. Cambiar `policy_version` y reiniciar al modificar política. En `operational`, reglas no habilitadas/conflictos sin resolver permanecen bloqueados.

La fecha límite toma el criterio más temprano entre km y tiempo, usando uso conservador y restando el buffer de taller. Las visitas usan la intersección **común**, no una cadena de solapes. No diferir críticos, síntomas críticos detectados ni DTC no autorizados. Una falla menor exige evaluación, responsable documentado y fecha límite; seleccionar “menor” no basta. Se conserva el reporte original aunque el motor eleve severidad.

### Actualización del catálogo

1. Mantener IDs estables; revisar fuente, página/localizador, mercado, año, motor y equipamiento por VIN.
2. Intersectar restricciones con la matriz de variantes. No extrapolar programas de otros países.
3. Diferenciar km/meses, inspección/reemplazo y servicios programados; un cambio de aceite intermedio no acredita servicio completo.
4. Añadir URL, fecha, mercado, páginas y hash cuando proceda; preservar revisión anterior y aumentar versión.
5. Conservar `null` cuando falte evidencia. Resolver conflictos con Mazda documentando alcance por VIN/configuración. No publicar datos personales reales.
6. Actualizar explícitamente rutas/versiones consumidas en `app/main.py` y `app/seed.py`, ejecutar pruebas y verificar snapshots.

## Arquitectura y API

`backend/app/engine.py` contiene reglas puras sin red ni base de datos; `UsagePredictor` permite incorporar ML calibrado sin saltarse límites de seguridad. `planner.py` persiste evaluaciones, alertas, visitas y notificaciones. `notifications.py` define canales simulados. `frontend/` es una aplicación Next separada con proxy y clave únicamente en servidor.

Entidades: `Vehicle`, `OdometerReading`, `ServiceCatalog`, `ServiceHistory`, `FaultReport`, `Alert`, `VisitPlan`; además `PlanEvaluation`, `Notification` y `SchemaMigration` para auditoría/versionado. No requiere Prisma ni migraciones de EXCOBA. Ver [migración inicial](backend/migrations/001_initial.md): solo crea bases nuevas, rechaza esquemas desconocidos. Cambios futuros requieren migraciones explícitas; `create_all` no altera tablas. SQLAlchemy usa tipos portables: PostgreSQL necesita driver, pruebas y migración de datos, no solo cambiar URL.

Todos los endpoints bajo `/api` requieren `X-API-Key`; `/health` no. [Contrato detallado](docs/contrato-mvp.md).

| Método y ruta | Función |
| --- | --- |
| `GET/POST /api/vehicles` | Consultar/registrar flotilla |
| `GET /api/vehicles/{id}` | Historial y fallas efectivas |
| `POST /api/vehicles/{id}/readings` | Lectura fechada |
| `POST /api/vehicles/{id}/services` | Servicio realizado |
| `POST /api/vehicles/{id}/faults` | Reporte y alerta inmediata |
| `PATCH /api/faults/{id}/resolve` | Resolución documentada |
| `GET /api/vehicles/{id}/plan` | Fechas, confianza, ventanas y visitas |
| `GET /api/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD` | Agenda (máximo 366 días) |
| `GET /api/alerts`, `GET /api/notifications` | Alertas y salida simulada |
| `GET /api/catalog`, `GET /api/variants` | Catálogos fuente |
| `POST /api/recalculate` | Actualizar flotilla |

Se validan VIN/placas únicos, variante/año/transmisión, fechas, números finitos, descensos y velocidades imposibles. El MVP admite una lectura por día; registros del mismo día deben coincidir en km. Múltiples capturas diarias requieren timestamps en una migración futura. Registrar mantenimiento no cierra una falla real: la resolución es explícita.

## Antes de operar con vehículos reales

Validación con agencia; autenticación/roles y auditoría de usuarios; infraestructura separada de EXCOBA; TLS, secretos, respaldo/restauración y monitoreo; capacidad/piezas de taller; campañas por VIN; protección de datos; pruebas con historial real y calibración del estimador. El temporizador local no es un servicio 24/7 si se apaga la computadora. No hay despliegue ni envíos externos en este MVP.
