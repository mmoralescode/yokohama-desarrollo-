# Verificación del MVP — 19 de septiembre de 2026

Registro histórico de la verificación anterior al traslado a GitHub. Las rutas y el estado de Git que siguen describen aquel entorno; para el repositorio independiente consultar [estructura y traslado](repositorio-independiente.md).

Rama local: `sistema-para-yokohama`. Entorno Windows, Python 3.13, Node 20.20.2. Cambios limitados a `yokohama/`. Sin despliegue, envío de notificaciones reales, commit ni push durante esta implementación.

## Resultados

| Verificación | Resultado |
| --- | --- |
| Motor de reglas | 82 pruebas aprobadas |
| API y persistencia | 27 pruebas aprobadas |
| Suite Python completa | 109 aprobadas; 2 advertencias de deprecación del cliente de pruebas |
| TypeScript y compilación Next.js | Aprobados |
| Auditoría npm de dependencias de ejecución | 0 vulnerabilidades reportadas al verificar |
| Playwright contra API/SQLite reales de prueba | 3 recorridos aprobados, sin mocks |
| Vista móvil de 390 px | Tabla desplazable en su contenedor, sin desbordamiento del documento |
| Catálogo histórico | 40 reglas, 0 habilitadas para producción |
| Arranque, parada y reinicio local | Verificados; la base se conserva |

Los recorridos de navegador incluyen flotilla, unidad con pocos datos, calendario, alertas y notificaciones simuladas; alta de unidad sintética, lectura, rechazo de duplicados, servicio, falla crítica, persistencia tras recarga, resolución explícita y falla menor evaluada con fecha límite; bloqueo de solicitudes sin clave, origen externo y rutas no permitidas.

La base de E2E se mantuvo separada en `.runtime/e2e-demo.db`. La demostración entregada usa `backend/data/yokohama.db` con las 20 unidades generadas. No se eliminaron bases ni historiales para limpiar las pruebas.

## Correcciones comprobadas durante integración

- Reconciliación de alertas/visitas al restaurar una configuración cuyo cálculo ya estaba en caché.
- Ancla de kilometraje documentada por un servicio más reciente que la lectura de odómetro; no vencer antes del servicio realizado.
- Diferimiento y severidad efectivos coherentes entre motor, API y panel, conservando la declaración original.
- Validación de política al inicio y protección de transacciones concurrentes.
- Reintento único de transporte para consultas GET ante un socket local interrumpido; nunca se repiten POST/PATCH ni errores HTTP. Registro de diagnóstico sin claves ni contenido del formulario.
- Formularios alineados con el contrato API y contención de etiquetas accesibles en tablas desplazables.

## Particularidades del entorno

OneDrive bloqueó limpieza de algunos directorios generados (`EPERM`). La compilación final se verificó en `.next-build-final` mediante `YOKOHAMA_BUILD_DIR`; las capturas E2E se guardaron en una carpeta temporal nueva. No se alteraron permisos ni se borraron directorios del usuario. README documenta ambas alternativas.

La demo compilada sigue enlazada a loopback. “Production” en el script solo significa `next start`, no autorización de uso operativo. Siguen pendientes la validación mecánica con Mazda, autenticación y roles de personas, canales reales, disponibilidad de taller y calibración con datos de Yokohama.
