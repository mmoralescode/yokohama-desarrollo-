# Modelo decorativo 3D local — demo no comercial

El Mazda3 se representa con el GLB proporcionado por el usuario. El modelo, sus texturas y el renderizador se sirven desde el mismo software: el giro y el zoom no dependen de Sketchfab ni de internet. La interfaz mantiene controles pequeños y los créditos en un desplegable.

## Origen y licencia

- **2020 Mazda 3 Hatchback**, publicado por **Ddiaz Design**: https://sketchfab.com/ddiaz-design
- Fuente: https://sketchfab.com/3d-models/2020-mazda-3-hatchback-a72de3f3c1604409a7e6fc6be9854c9d
- Licencia publicada: **CC BY-NC-SA 4.0**, https://creativecommons.org/licenses/by-nc-sa/4.0/
- Metadatos públicos consultados el 2026-09-20: https://api.sketchfab.com/v3/models/a72de3f3c1604409a7e6fc6be9854c9d
- La descripción del autor indica base en **Racing Master**, con créditos a **GM25**: https://www.facebook.com/p/GM25-100042237200164/

El usuario proporcionó el ZIP descargado del modelo y confirmó el uso no comercial. Se mantienen el crédito al autor, el origen y la licencia. La confirmación del usuario no certifica de forma independiente todos los derechos de origen ni autoriza usos comerciales. Antes de distribuir comercialmente el software, retirar el recurso o conseguir autorización suficiente. El modelo y la miniatura no se relicencian como código del proyecto.

El GLB se incorporó **sin modificar su geometría, materiales o texturas**. Las operaciones de cámara, encuadre e iluminación del visor no sobrescriben el archivo original. Es un recurso decorativo de 2020, no una réplica oficial de agencia ni una referencia mecánica. No cambia el alcance de mantenimiento de **Mazda3 México 2021–2026**.

## Archivo local y trazabilidad

- ZIP aportado por el usuario: `2020-mazda-3-hatchback.zip`.
- SHA-256 del ZIP: `8b754430a129c785970465f26d429d64dfc2be6f25232a4b85fda2dc2f484d2d`.
- Entrada extraída: `source/2020 Mazda 3 Hatchback.glb`.
- Destino: `frontend/public/models/mazda3-hatchback-2020.glb`.
- Tamaño: **13,282,052 bytes**.
- SHA-256 del GLB: `6c0233e309c8ec096bf941d0e4ea1bff5a6d62a483cb1e4abba97570dd2a54ee`.
- Formato: glTF binario 2.0; generador declarado `Khronos glTF Blender I/O v3.4.50`.
- Contenido: 149 nodos, 149 mallas, 26 materiales y tres imágenes JPEG embebidas. Sin animaciones internas; el movimiento corresponde a la cámara.
- No hay URI externas ni extensiones glTF requeridas. No necesita decodificadores remotos Draco/KTX2.

Los tres JPEG sueltos de `textures/` en el ZIP no se copiaron: el GLB ya incluye sus texturas por `bufferView`. La extracción se limitó a la entrada esperada y a una ruta local fija; no se ejecutó contenido del archivo adjunto. El ZIP original permanece intacto fuera del repositorio.

El archivo aportado incluye pintura `Machine_Gray_Metallic`. Se conservó este color y se sustituyó la miniatura roja anterior por una captura del renderizador local, coherente con el GLB.

### Miniatura local

- Archivo: `frontend/public/models/mazda3-hatchback-2020-local-preview.jpg`.
- Captura del canvas local: 1024 × 576, 40,475 bytes; iluminación y encuadre del software. No se editó posteriormente la imagen.
- Derivada del GLB indicado arriba, con los mismos créditos y licencia CC BY-NC-SA 4.0.
- SHA-256: `16c98a19529eb2369abc7cf544032100de970fc51cd2500bbe99d3028f6b7b46`.

## Funcionamiento sin internet

El visor utiliza `three@0.186.0` (MIT), `GLTFLoader`, `OrbitControls` e iluminación generada localmente mediante `RoomEnvironment`. Las dependencias y sus versiones se fijan en `frontend/package-lock.json`; no se cargan scripts, texturas, entornos HDR o visores desde un CDN. El modelo no recibe ni envía datos de la flotilla. Los enlaces de crédito únicamente requieren internet si el usuario decide abrirlos. Referencia del renderizador: https://threejs.org/.

No hay animación automática, inercia ni bucle continuo. Se dibuja bajo demanda al mover la cámara, redimensionar o recuperar visibilidad. Cerrar el visor cancela la carga y libera geometrías, texturas, bitmaps, observadores y contexto WebGL. La carga tiene un plazo de 30 segundos y permite reintentar ante error. El cargador rechaza referencias externas del modelo; sus texturas deben continuar embebidas.

**Sin internet no significa sin servidor:** para usar el panel se deben mantener funcionando los procesos locales de frontend y backend, o acceder a una instalación disponible en la red local. La instalación inicial de dependencias requiere disponer de sus paquetes. El renderizado necesita WebGL en el navegador; la vista previa permite conservar una representación si el equipo no puede renderizar 3D.

## Verificación

La revisión del archivo confirmó la cabecera GLB 2.0, la longitud total, las texturas embebidas y la ausencia de referencias externas. El 2026-09-20 pasaron diez pruebas de interfaz con Chromium completo, contextos nuevos, GLB real y conexiones HTTP/WebSocket externas bloqueadas antes de abrir la página. Verificaron cambios reales en las capturas al girar/acercar, teclado y foco, créditos, reposo sin bucle de renderizado, cancelación, archivo ausente y reintento, timeout, falta/pérdida de WebGL y móvil sin desbordamiento. Solo se simulan las consultas de flotilla y los fallos deliberados; no el automóvil ni el renderizador. La comprobación visual adicional registró cero solicitudes externas y cero errores de JavaScript.
