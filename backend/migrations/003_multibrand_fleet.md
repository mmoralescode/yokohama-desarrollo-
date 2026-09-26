# Migración 003: flotilla multimarcas

La aplicación reconoce ahora las versiones `{1, 2, 3}`. Las bases v1 conservan
su upgrade v1→v2 sin cambios y continúan, dentro de la misma transacción, al
upgrade v2→v3. Una base v2 se actualiza directamente a v3. Una base nueva se
crea ya con las tres filas históricas de versión.

## Cambios en `vehicles`

- Se amplía el año modelo permitido a `1886..2100`.
- `variant_id` pasa a ser nullable: es una referencia opcional de catálogo, no
  un requisito para una unidad manual de otra marca.
- Se agregan `make`, `model`, `fuel_type`, `color` y `maintenance_catalog`.
- Las unidades existentes se copian con su mismo `id` y con
  `make=Mazda`, `model=Mazda3` y
  `maintenance_catalog=mazda3-mx.v0.1.0`. No se modifica ningún historial,
  lectura, pronóstico, alerta, visita, falla ni relación existente.

SQLite no permite modificar el CHECK de año modelo ni la nulabilidad en sitio,
por lo que se crea `vehicles_v3`, se copian todas las columnas y filas, y se
renombra dentro de una transacción. Las claves foráneas se validan antes y
durante el cambio; su aplicación se desactiva sólo durante el intercambio de la
tabla padre y se restaura antes de devolver la conexión al pool. La migración
comprueba `foreign_key_check`, `quick_check` y el conteo de unidades antes del
commit.

Para una base SQLite en archivo se genera un respaldo consistente
`<archivo>.pre-v3-<fecha-UTC>-<id>.bak` antes de cambiar una base v2. Una base
v1 conserva su único respaldo `pre-v2`, que contiene el estado anterior a toda
la actualización atómica. No existe downgrade automático.

## Reglas de catálogo

El catálogo Mazda3 se mantiene íntegro. Sólo se usa cuando una unidad tiene la
clave `mazda3-mx.v0.1.0`; una unidad manual sin catálogo (o con uno aún no
cargado) no recibe reglas Mazda. Aun así conserva la estimación de uso y el
triage de fallas; se muestra gris y recibe una alerta de datos hasta que se
asigne un catálogo técnico compatible. Una falla accionable o crítica mantiene
su prioridad ámbar o roja.

Pruebas: `python -m pytest tests/test_migrations_v2.py tests/test_multibrand.py -q`.
