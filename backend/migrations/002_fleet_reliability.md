# Migración 002: operación y retroalimentación de flotilla

Implementación: `app.database._upgrade_v1_to_v2`, invocada por `migrate()` al
arrancar. La base anterior debe tener exactamente la versión `{1}` y el esquema
reconocido. Después conserva la fila histórica de migración 1 y agrega la 2.
Una base nueva se crea directamente con el esquema actual y registra `{1, 2}`.

## Cambios compatibles con los registros existentes

- `vehicles.severity_multiplier`: 1 por defecto; permitido entre 0.1 y 1.
- `odometer_readings`: mantiene `date`, `id`, unidad y km; agrega `recorded_at`,
  `source` y `time_precision`. La unicidad pasa de unidad/fecha a unidad/timestamp.
- Las lecturas históricas se representan como medianoche de su fecha en
  `America/Mexico_City`, convertida a UTC. Se respeta el horario de verano
  histórico (por ejemplo, julio de 2021); no se aplica un desfase fijo a todo.
  `time_precision=date` indica que NO conocemos la hora real. `source=manual`
  es una suposición de migración, no una certificación del origen histórico.
- `service_history`: costo MXN nullable, tipo `unknown` por defecto, falla
  relacionada, fecha predicha, error en días y evaluación utilizada, nullable.
  No se inventan costos, clasificaciones ni pronósticos para servicios pasados.
- `fault_reports`: servicio relacionado y `was_predicted` nullable. Las fallas
  históricas no se etiquetan automáticamente como previstas o imprevistas.
- `downtime_periods`: intervalos reales de indisponibilidad, no tiempos estimados
  de visita. El final puede ser nulo para una estancia abierta; si existe debe
  ser posterior al inicio. La API valida además traslapes por unidad.

Los timestamps son UTC. SQLite almacena la representación sin zona; el código
de aplicación la interpreta explícitamente como UTC al leerla. La interfaz y
las fechas operativas utilizan `America/Mexico_City`.

## Seguridad de la actualización

1. Se rechazan versiones, tablas, columnas, tipos, nulabilidad, claves o triggers
   desconocidos y referencias inválidas antes de modificar el esquema.
2. Para SQLite en archivo se crea un respaldo consistente usando la API de backup
   de SQLite (incluye datos confirmados en WAL), junto a la base, con nombre
   `<archivo>.pre-v2-<fecha-UTC>-<id>.bak`. Un error de respaldo aborta el upgrade.
   Las bases en memoria no tienen respaldo en disco.
3. `BEGIN IMMEDIATE` hace explícita la transacción que cubre TODAS las operaciones
   DDL y de copia. Se reconstruye solamente la tabla de lecturas porque SQLite no
   permite retirar aquella restricción UNIQUE con ALTER COLUMN. Los mismos IDs
   y valores originales se copian por lotes; se comprueba el conteo.
4. Las claves foráneas permanecen activadas. Antes del commit se valida el
   esquema nuevo, `foreign_key_check` y `quick_check`. Un fallo revierte también
   los ALTER/DROP/CREATE ejecutados en esa transacción.
5. Repetir el arranque no duplica migraciones ni genera otro respaldo. Dos
   arranques simultáneos se serializan; después de obtener el bloqueo se revisa
   de nuevo la versión, de modo que solo un proceso respalda y actualiza.

No hay downgrade automático. Para una restauración: detener la aplicación y
todos sus procesos que usan la base; conservar la base fallida y su WAL/SHM para
diagnóstico; restaurar la copia con herramientas SQLite en una ruta nueva y
verificar integridad/conteos antes de cambiar la configuración. No sobrescribir
una base abierta ni mezclar un archivo restaurado con WAL/SHM de otra base.

La conexión SQLite usa WAL, espera de bloqueo de 30 segundos y
`synchronous=FULL`. Esto permite lectores concurrentes y escritura durable; no
elimina el límite de un escritor de SQLite. La migración v1→v2 se valida en
SQLite. PostgreSQL requiere un upgrade propio revisado, no se acepta en silencio.

Pruebas: `python -m pytest tests/test_migrations_v2.py -q`. Cubren preservación de
todas las tablas, respaldo, UTC/DST, unicidad por timestamp, defaults compatibles
con seeds, rollback de DDL, fecha dañada, disco no disponible, esquema desconocido,
referencias rotas y arranques concurrentes.
