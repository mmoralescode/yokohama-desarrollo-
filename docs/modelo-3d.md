# Modelo decorativo 3D — demo no comercial

## Recurso seleccionado

- Título: **2020 Mazda 3 Hatchback**. No es un modelo 2026 ni se presenta como una réplica oficial de agencia.
- Publicado por **Ddiaz Design**: https://sketchfab.com/ddiaz-design
- Modelo y visor: https://sketchfab.com/3d-models/2020-mazda-3-hatchback-a72de3f3c1604409a7e6fc6be9854c9d
- Metadatos públicos consultados el 2026-09-20: https://api.sketchfab.com/v3/models/a72de3f3c1604409a7e6fc6be9854c9d
- Licencia publicada: **CC BY-NC-SA 4.0**, https://creativecommons.org/licenses/by-nc-sa/4.0/
- La descripción declara base en un modelo de **Racing Master**, con créditos a **GM25**: https://www.facebook.com/p/GM25-100042237200164/
- El usuario confirmó uso no comercial. Esta confirmación no constituye una autorización comercial ni una validación independiente de los derechos de todos los recursos de origen. Antes de distribuir comercialmente el software, retirar este recurso o conseguir autorización suficiente.

Se conservan créditos, enlaces de origen/licencia y las marcas del visor. No se modificó la geometría ni sus materiales; no se descarga, convierte, extrae ni publica un archivo GLB/FBX del modelo. Se usa la inserción pública de Sketchfab. La miniatura también queda bajo la licencia indicada por su publicación; no se relicencia como código del proyecto.

## Miniatura local

- Archivo: `frontend/public/models/mazda3-hatchback-2020-preview.jpg`.
- Copia sin edición de la miniatura 1024 × 576 (58,878 bytes).
- Origen: https://media.sketchfab.com/models/a72de3f3c1604409a7e6fc6be9854c9d/thumbnails/5f86f869c69247e8a86c8095100dd94e/1117a5ad5aef486a8e03c049a6ff34b0.jpeg
- SHA-256: `9a18acb9a089d865a674b732ca3cf0ca7bf7e933a1cc0a1f25caad87d5fd76a7`.

## Funcionamiento y privacidad

La primera pantalla solo muestra la miniatura servida localmente. Al pulsar «Explorar en 3D» se importa el cliente SDK local y se crea una conexión al visor de Sketchfab. Requiere internet, WebGL y que el proveedor mantenga el modelo público. El proveedor recibe los datos de conexión del navegador, pero la integración no le envía vehículos, lecturas, VIN, placas, usuarios ni claves de la API.

Se usa `dnt=1` (opción del proveedor para desactivar analítica), `referrerPolicy=no-referrer`, origen fijo, iframe restringido y validación del origen **y** ventana emisora de los mensajes. Se ignoran opciones `skfb_*` de la URL. No se eliminan avisos/marcas del proveedor ni se habilitan cámara, micrófono o AR.

`autospin=0`, `animation_autoplay=0` y `camera=0` evitan giros y transiciones iniciales automáticos. Las transiciones de nuestros botones usan duración cero con movimiento reducido. Los gestos dentro del iframe son controlados por Sketchfab. «Volver a vista previa» descarga el visor y limpia listeners; navegar a otra página también lo desconecta. El timeout de conexión es 25 segundos, con reintento y enlace de origen. Un `load` del iframe no se trata como confirmación de que el modelo 3D esté listo.

Los botones cambian la cámara, no el vehículo ni el motor predictivo. El catálogo de mantenimiento sigue limitado a **Mazda3 México 2021–2026**; mostrar el recurso 2020 no añade compatibilidad mecánica para ese año.

## Dependencia y mantenimiento

Cliente: `@sketchfab/viewer-api@1.12.1`, paquete oficial publicado con licencia ISC; https://github.com/sketchfab/viewer-api. Se instala mediante npm y su integridad queda fijada en `package-lock.json`; no se carga un script remoto de terceros dentro de la página principal. Referencias: https://sketchfab.com/developers/viewer y https://sketchfab.com/developers/viewer/initialization.

El SDK no expone un método público `destroy`. El adaptador usa campos privados de la versión fijada exclusivamente para limpiar referencias y listeners. Al actualizar la dependencia, revisar esos campos y repetir pruebas de handshake, errores, mensajes falsificados y cierre durante carga.

## Verificación

El 2026-09-20 se comprobó la carga del modelo público real con Chromium y aceleración gráfica, incluyendo giro, zoom, vistas superior e inferior y presentación móvil. La geometría disponible por debajo es simplificada: este recurso es visual, no una referencia de piezas o reparación. El proveedor rechazó el renderizador por software de la prueba automatizada con `No Hardware Support for Webgl`; si sucede en otro equipo, activar aceleración gráfica o usar la vista previa. Las once pruebas locales de regresión simulan el proveedor para verificar controles, privacidad y recuperación de errores de manera reproducible; no prueban su disponibilidad futura.
