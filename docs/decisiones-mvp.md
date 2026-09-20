# Decisiones de implementación — MVP v1

## Aprobación de producto

El usuario aprobó continuar después de revisar la Fase 1 el 19 de septiembre de 2026. Se autoriza construir el motor, la API, la demostración y el panel. **No equivale a validación de Mazda ni a autorización de tolerancias mecánicas.** Los catálogos v0.1.0 se conservan como evidencia histórica, sin reescribir sus pendientes.

## Aislamiento

El desarrollo original vivió en `yokohama/` dentro de la rama `sistema-para-yokohama`. Por solicitud del usuario se trasladó a la raíz del repositorio independiente `mmoralescode/yokohama-desarrollo-`, rama `main`, sin importar historial de EXCOBA. Tiene dependencias, configuración y base SQLite propias. No comparte cuentas, folios, roles, Prisma, variables de producción ni despliegue con EXCOBA. No se agregan automatizaciones de despliegue.

## Alcance operativo

La entrega es una demostración local con datos sintéticos, no un sistema autorizado para decidir si una unidad real puede seguir circulando. El panel y la API permanecen en loopback. La API exige una clave; el panel usa un proxy servidor que no revela esa clave al navegador. Eso no sustituye autenticación de operadores, permisos por flotilla, TLS ni auditoría para un despliegue público.

## Predicción explicable

Un intervalo oficial predice vencimiento de mantenimiento, no fecha de avería. Las fechas optimista/probable/pesimista son escenarios de uso, no intervalos estadísticos calibrados. Un DTC requiere diagnóstico; no se transforma automáticamente en pieza averiada. La arquitectura separa el estimador de uso del planificador para permitir un estimador aprendido cuando exista historial suficiente y validado.

Los datos desconocidos se mantienen desconocidos. No se inventa servicio previo en kilómetro cero, capacidad de taller, tiempos de reparación o límites mecánicos. Un caso sin historial puede requerir una revisión inicial antes de ofrecer un plan completo.

## Ventanas y seguridad

La fecha nominal se calcula con kilómetros o tiempo, lo primero. El límite conservador toma en cuenta uso rápido y tiempo calendario. En el modo demostración, adelantos configurables ilustran agrupación; no representan una autorización técnica. Solo un ajuste expresamente validado puede permitir prórrogas. El planificador no debe unir ventanas que solo se conectan por parejas: todos los servicios de la visita deben compartir una intersección real.

Un servicio vencido conserva la fecha vencida y no recibe una nueva fecha límite ficticia. Las fallas críticas producen alerta inmediata y no esperan la visita agrupada. Un reporte menor solo puede diferirse con evaluación y fecha límite explícitas. Una falla desconocida requiere evaluación; no se presume segura.

## Notificaciones y trazabilidad

Correo y WhatsApp se modelan como canales intercambiables con salida simulada. No se contacta a destinatarios ni se utilizan cuentas existentes. Alertas y planes deben conservar versión de catálogo y evidencia del cálculo, evitar duplicados y reconciliar sus estados al registrar nueva información.

## Antes de producción

- Resolver C01–C03 del catálogo y aplicabilidad por VIN con agencia Mazda.
- Aprobar ventanas, retiro por desgaste y duraciones de cada operación con el responsable técnico.
- Sustituir datos sintéticos por unidades autorizadas, historial real y controles de calidad de odómetro.
- Incorporar autenticación real de usuarios, roles, HTTPS, respaldos, monitoreo y tratamiento de datos personales.
- Migrar almacenamiento y operaciones a PostgreSQL cuando sea necesario, con pruebas de migración y restauración.
- Calibrar tasas de uso e incertidumbre con datos reales; medir visitas evitadas y horas efectivas de indisponibilidad sin relajar seguridad.

La documentación técnica de referencia utilizada para la implementación es [FastAPI](https://fastapi.tiangolo.com/tutorial/testing/), [SQLAlchemy 2](https://docs.sqlalchemy.org/en/20/orm/quickstart.html) y [Next.js](https://nextjs.org/docs/app/getting-started/installation).
