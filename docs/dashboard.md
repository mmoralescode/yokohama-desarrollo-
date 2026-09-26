# Dashboard administrativo

Ruta `/dashboard`, debajo de **Alertas** en la navegación. Consume las unidades,
alertas y agenda existentes tanto en operación local como en el modo de
propuesta. No introduce migraciones ni reemplaza datos o pronósticos.

## Qué significan las cifras

- **Unidades en flotilla:** unidades distintas de la selección actual.
- **Atención prioritaria:** unidades en rojo o con una alerta crítica abierta;
  varias alertas de la misma unidad cuentan una sola vez.
- **Próximos 7 días:** hoy y los seis días siguientes, en Ciudad de México.
  Se distinguen fechas registradas de propuestas. Recomendaciones técnicas
  inmediatas o vencidas no se muestran como citas ordinarias diferibles.
- **Servicios realizados:** trabajos individuales del mes actual, por fecha
  real del servicio, no por la fecha de captura. Una visita puede incluir varios
  trabajos. Se deduplica unidad + fecha real + identificador de servicio.

La gráfica abarca seis meses naturales, incluido el actual aún en curso. Sólo
cuenta servicios registrados; no inventa trabajos que todavía no se capturan.
Las capturas tardías se reflejan en el mes en que realmente se hizo el trabajo.

## Acciones y pendientes

Las prioridades agrupan alertas técnicas por unidad, con las críticas primero.
A igual severidad crítica, una falla reportada va antes que mantenimiento vencido;
después se ordena por fecha límite.
Un límite proviene de la alerta técnica, nunca de una reprogramación de agenda.
Las fechas registradas pasadas sin cierre aparecen como **fechas por revisar**,
no como prueba de que el servicio no se realizó; se consultan los últimos seis
meses. Los enlaces abren el mes y la placa correspondientes en el calendario.

**Completar registros** permite localizar unidades sin conductor, sin catálogo
asignado o con semáforo de datos insuficientes. Los grupos pueden coincidir;
no se suman como si fueran unidades distintas. Cada fila abre su ficha.
Los accesos rápidos abren directamente el alta de unidad y la captura de
servicio realizado, sin modificar registros hasta que el usuario los guarde.

El selector separa unidades reales, de ejemplo o todas. Cualquier combinación
que contenga ejemplos se advierte explícitamente. La ausencia de alertas o
pendientes no acredita seguridad mecánica.

Una falla de consulta no se convierte en ceros: se muestra el error con
reintento. Al actualizar, las tres fuentes reemplazan el resumen juntas;
si falla alguna, se conserva el último resumen correcto con su hora y aviso.

## Verificación

`e2e/dashboard-helpers.spec.ts` cubre fechas, duplicados, captura tardía,
prioridades y fechas pasadas. `e2e/dashboard.spec.ts` simula todas las solicitudes
para probar filtros, errores, accesos y navegación móvil sin escribir en la base.
`e2e/public-dashboard.spec.ts` verifica el modo público real, su navegación y
que una captura ficticia se refleje en el resumen tras recargar, sin usar la API
privada ni modificar la base operativa.
