# Propuesta web de Yokohama

Publicada en **https://yokohama-propuesta.vercel.app** el 26 de septiembre de 2026,
en el proyecto independiente `mmoralescode/yokohama-propuesta`.

## Qué puede probar la empresa

- Consultar 20 unidades ficticias, identificadas por placas como `YKH-101-A`.
- Abrir el [dashboard administrativo](https://yokohama-propuesta.vercel.app/dashboard)
  debajo de Alertas: prioridades, visitas de siete días, servicios por mes y
  registros pendientes, con accesos directos a captura y calendario.
- Registrar otras marcas y modelos.
- Asignar uno o varios conductores por unidad, editar la lista y buscar por
  nombre junto a la búsqueda por placa, en flotilla y calendario.
- Identificar el «Número de serie (VIN)» y mantener el factor de intervalo en
  «Configuración avanzada», con valor normal de 1.
- Cambiar fechas desde el calendario y consultar el historial de reprogramaciones.
- Registrar servicios realizados días atrás, varios trabajos en una captura,
  kilometraje pendiente y notas de comprobantes.
- Revisar trabajos realizados en su día real y distinguirlo de la fecha de captura.

La versión pública guarda cambios solamente en el navegador de cada visitante.
No sincroniza capturas entre equipos ni contiene la base operativa local. Los
pronósticos iniciales son ejemplos generados con el motor y datos sintéticos;
las capturas de prueba demuestran el flujo administrativo. Al completar un
servicio, su siguiente pronóstico queda por validar en la propuesta. La
aplicación local conserva el motor completo de cálculo.

## Preparación y publicación

Desde la raíz, `backend/.venv/Scripts/python.exe scripts/export-proposal.py`
regenera los ejemplos desde una base temporal nueva. Sólo se despliega
`frontend`, con el modo de propuesta configurado en `vercel.json`.
No se requieren claves de la API ni una copia de SQLite en Vercel.

El proxy público rechaza `/api/*`; archivos privados, datos operativos y activos
3D están excluidos del despliegue. La aplicación local conserva sus
restricciones de acceso loopback.

Verificación de esta publicación: compilación de Vercel y acceso anónimo
correctos; pruebas de navegador ejecutadas contra la URL pública comprobaron
reprogramación entre meses, persistencia al recargar, captura atrasada sin km,
alta de otra marca, asignación de varios conductores, búsquedas por nombre y
registro manual en móvil. Las propuestas guardadas antes de añadir conductores
conservan sus capturas y fechas; no reciben asignaciones inventadas.
