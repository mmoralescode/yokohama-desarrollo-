# Operación, datos y límites — versión 0.2

Esta entrega amplía el MVP existente; no certifica ausencia de fallos ni seguridad mecánica. El panel continúa **local**, sin cuentas de operadores, roles empresariales ni aislamiento multiempresa. No abrir los puertos a Internet. El modelo decorativo del Mazda conserva su licencia no comercial; revisar su permiso antes de usarlo comercialmente.

## Antes de cargar información de la compañía

1. Usar una base independiente de la demostración, mediante `YOKOHAMA_DATABASE_URL`. No ejecutar `--seed` en la base empresarial. El seed no borra registros, pero son datos ficticios.
2. Confirmar los 40 servicios del catálogo con Mazda. Se conservan fuentes, incertidumbre y reglas por condición, sin inventar intervalos para batería, transmisión o desgaste. `mode=demo` muestra fechas provisionales; `operational` bloquea reglas no validadas. Ver investigación y `service_overrides`.
3. Preparar VIN/placas únicos, versión mexicana correcta, odómetro actual y fecha de puesta en servicio. Cargar el historial original de servicios por componente; no se supone mantenimiento a km cero.
4. Respaldar, ensayar una restauración y ejecutar las pruebas con una muestra anonimizada representativa del volumen real. SQLite es el alcance verificado de este MVP; un servidor local, un worker de Uvicorn. No hay SLA ni capacidad ilimitada. Para varios servidores/operadores remotos hace falta PostgreSQL, autenticación, despliegue y una prueba de carga propia.
5. Definir responsable de revisar alertas, datos rechazados, capacidad de taller, respaldos y espacio en disco. Los avisos de correo/WhatsApp siguen simulados.

## Lecturas y carga por lotes

`POST /api/vehicles/{id}/readings` acepta:

```json
{"recorded_at":"2026-09-20T18:30:00-06:00","odometer_km":45200.5,"source":"manual"}
```

Hora con offset obligatoria cuando se proporciona `recorded_at`; almacenamiento UTC, operación en `America/Mexico_City` (incluye reglas históricas de horario de verano). También se acepta la entrada histórica `date: "2026-09-20"` sin hora: queda marcada `time_precision=date`, no como una medición horaria real. Las lecturas antiguas se migran como medianoche local, fuente manual **asumida**, conservando su fecha y kilometraje originales.

`POST /api/vehicles/{id}/readings/batch`:

```json
{"readings":[
  {"recorded_at":"2026-09-18T18:30:00-06:00","odometer_km":45000,"source":"manual"},
  {"recorded_at":"2026-09-19T18:30:00-06:00","odometer_km":45100,"source":"manual"}
]}
```

Máximo 500 entradas por lote y `api.max_request_bytes` bytes (262144 por defecto). Ordenadas internamente; un dato inválido cancela **todo el lote**. Reenvíos con fecha/hora, km, fuente y precisión idénticos se omiten. Una contradicción devuelve 409, sin sobrescribir datos. No se reintentan automáticamente escrituras desde el panel. Consultar el historial si se pierde la conexión después de enviar.

Los km deben ser finitos, entre 0 y 2000000. Se rechazan retrocesos, fechas futuras, conflictos y saltos mayores a `usage.max_daily_km` por día transcurrido. Para intervalos intradía se mantiene un margen mínimo de un día: es un detector de saltos de odómetro, **no** un detector de velocidad instantánea. Lecturas con hora posteriores a una lectura antigua sin hora no pueden retroceder respecto de esa referencia; los conflictos requieren revisión, no corrección automática. GPS/OBD son etiquetas de procedencia; `app.integrations` solo define contratos, no conexiones reales.

## Pronósticos y supuestos

- Promedio ponderado por recencia dentro de `usage.window_days`; se conservan limpieza robusta y escenarios. Si no hay suficientes intervalos, se usa el promedio de otras unidades con observaciones suficientes y recientes, de la misma cohorte real/demo. Si tampoco existe, se usa `default_km_per_day`. Ambos respaldos tienen confianza baja.
- Intervalos de catálogo `intervalo_km`, `intervalo_dias`, `intervalo_meses`. Overrides validados `interval_km`, `interval_days`, `interval_months`. Meses son calendario, no 30 días. Si coexisten, vence el primero.
- `severity_multiplier` entre 0.1 y 1: 0.8 acorta a 80 % los intervalos. Nunca amplía tolerancias. Ajustable en la unidad con `PATCH /api/vehicles/{id}` junto con `usage_regime`; los cambios quedan en las evaluaciones auditadas. Para altas sin valor explícito se usa `planning.default_severity_multiplier`.
- `planning.grouping_window_days=15` busca agrupar límites próximos **solo si existe intersección real de ventanas seguras**. No concede 15 días adicionales ni retrasa críticos o vencidos. La ventana demo de adelanto de 7 días sigue siendo provisional.
- Alertas 30/14/7 + vencido. Se conserva un aviso abierto por ciclo y las notificaciones simuladas se deduplican por etapa, ciclo, canal y generación. Saltar varios umbrales entre recálculos genera la etapa vigente, no avisos retrospectivos innecesarios.
- No hay ML de fallas implementado. `FailurePredictor` es únicamente el contrato de extensión; los escenarios no son probabilidades calibradas.

## Servicios, retroalimentación y métricas

Cada servicio conserva tipo, km, fecha, notas, catálogo original y costo opcional **MXN**. Un costo ausente es `null`, no cero. Solo reinicia el componente correspondiente. `maintenance_type`: `preventive`, `corrective`, `unknown`; vínculo opcional `fault_id` solo para correctivos de la misma unidad/componente. Registrar un servicio no cierra silenciosamente un reporte de falla.

Para evitar sesgo retrospectivo, se guarda la fecha pronosticada de la última evaluación existente **anterior al día local del servicio** y su ID. `prediction_error_days = fecha_real - fecha_predicha`; positivo = se hizo después. Si no existe una predicción previa usable, queda `null`: nunca se fabrica una predicción con el propio servicio recién cargado. Los servicios históricos importados normalmente carecerán de este dato.

En fallas, `was_predicted` es una clasificación explícita del operador: verdadero, falso o desconocido. `service_id` permite asociar el componente. No se considera “prevista” una falla simplemente porque exista cualquier alerta de esa unidad.

`GET /api/metrics?synthetic=false` devuelve solo datos reales por defecto. `true` muestra demostración y `null` combina ambos (solo para inspección explícita). Métricas:

| Métrica | Definición y ausencia de datos |
| --- | --- |
| Servicios antes de falla | Preventivos / (preventivos + correctivos) × 100, clasificación del operador. No prueba causalmente una falla evitada. Sin clasificados: null. |
| Error de fecha | Media del error firmado y del error absoluto; muestra cantidad de muestras con referencia previa. |
| Fallas no previstas | Conteo `was_predicted=false`, con conteos total y clasificado para hacer visible lo desconocido. |
| Días fuera de servicio | Suma de intervalos reales / 24 h. Paros abiertos hasta `as_of`. Sin registros significa “sin tiempo registrado”, no disponibilidad perfecta. |

Registrar paros mediante `POST /api/vehicles/{id}/downtime` con `started_at`, `ended_at` opcional y notas. Cerrarlos con `PATCH /api/vehicles/{id}/downtime/{id}`. Fechas con zona, no futuras, posteriores a la puesta en servicio; se rechazan traslapes y cierre repetido. Una cita propuesta o una duración estimada no se contabilizan como paro real.

## Migraciones, respaldos y recuperación

La migración explícita v1→v2 conserva los registros, crea un respaldo SQLite consistente que incluye WAL, comprueba integridad y revierte en caso de error. No ejecutar dos versiones distintas de la aplicación sobre la misma base. No restaurar un archivo mientras el servidor lo utiliza. Detalles en `backend/migrations/002_fleet_reliability.md`.

Desde `backend`, crear respaldos periódicos a un directorio protegido existente, fuera del repositorio:

```sh
python -m app.backup backup --source data/yokohama.db --target /directorio-seguro/yokohama-fecha.bak
python -m app.backup restore --source /directorio-seguro/yokohama-fecha.bak --target /directorio-seguro/recuperada.db
```

Ambos destinos deben ser **nuevos**: nunca sobrescribe una base. El comando usa la API de backup de SQLite, verifica integridad y referencias; no basta copiar un `.db` activo ignorando su WAL. Para restaurar: detener con `scripts/dev.ps1 -Stop`, verificar la copia recuperada, apuntar `YOKOHAMA_DATABASE_URL` a ella y reiniciar. Conservar el original y probar lecturas/servicios/alertas antes de reanudar captura. Retención, cifrado, programación y respaldo fuera del equipo son responsabilidades operativas aún por configurar.

Errores de datos devuelven 422/409 sin mutaciones parciales; base temporalmente no disponible devuelve 503. Los límites de cuerpo también se aplican a peticiones sin `Content-Length`. El panel muestra un error recuperable; no incluye claves API ni trazas internas.
