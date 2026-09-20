# Migración 001: esquema inicial

La función `app.database.migrate()` crea las tablas declaradas en `app.models`
en una transacción y registra la versión 1 en `schema_migrations`. Es idempotente
y rechaza bases sin versión o con versiones desconocidas; no usa `create_all`
para aparentar que una base existente fue actualizada. No hay downgrade ni borrado.

Tablas de negocio: `vehicles`, `odometer_readings`, `service_catalog`,
`service_history`, `fault_reports`, `alerts`, `visit_plans`.
Tablas de soporte: `plan_evaluations`, `notification_outbox`, `schema_migrations`.
Las entidades del alcance están representadas (el catálogo y sus registros
se almacenan en `service_catalog`; cada plan contiene varias visitas).

VIN/placas son únicos; una lectura por fecha/unidad; un servicio del mismo tipo
por fecha/unidad; claves estables para alertas, visitas y entregas simuladas.
Las claves foráneas se activan explícitamente en SQLite. No hay cascadas destructivas.
`service_history` preserva evidencia del catálogo; `plan_evaluations` conserva
entradas, resultado y versiones/configuración/fuentes que explican cada cálculo.

SQLAlchemy utiliza Date/JSON/String/Boolean portables. Para PostgreSQL se requiere
instalar el controlador elegido, una base vacía y cambiar YOKOHAMA_DATABASE_URL.
La transferencia de datos debe ser explícita, respaldada y verificada; cambiar
la URL NO migra el contenido. No se ha validado PostgreSQL en este MVP.

Para versiones futuras, agregar un upgrade numerado real y pruebas de migración;
no modificar la versión existente de una base ya entregada.
