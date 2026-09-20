# Fase 1 — Catálogo Mazda3 México para Yokohama

Fecha de corte: 19 de septiembre de 2026. Versión: 0.1.0. Estado: **borrador para aprobación, no habilitado para uso operativo**.

Se completó la revisión documental inicial. No se programaron motor, API, base de datos, interfaz ni notificaciones. EXCOBA y su despliegue permanecen sin cambios.

## Resultado para revisión

- 40 registros de servicios, inspecciones y componentes por condición.
- 4 antecedentes de fallas/campañas, distinguiendo México de Estados Unidos.
- 12 fichas mexicanas, una por año/carrocería; 48 registros año-versión-carrocería y 60 combinaciones al separar transmisiones.
- 3 familias mecánicas: 2.5 atmosférico, 2.5 turbo y 2.0 MHEV.
- Todas las filas contienen los campos solicitados, incluidos los desconocidos como `null`.
- Los seis años modelo 2021–2026 están dentro del alcance. No son cinco años modelo.

Catálogo completo: [mazda3-mx.v0.1.0.json](../catalogos/mazda3-mx.v0.1.0.json).
Matriz mecánica y fuentes por versión: [variantes-mx.v0.1.0.json](../catalogos/variantes-mx.v0.1.0.json).

## Tres puntos que impiden prometer una fecha «sin riesgo»

1. **C01 — 6 frente a 12 meses.** Los manuales consultados, en su sección México, indican 10,000 km/6 meses; el portal comercial actual indica 10,000 km/12 meses. No se encontró una aclaración que permita declarar uno universalmente sustituido. Se requiere confirmación escrita por VIN y régimen.
2. **C02 — filtro de cabina.** La tabla española repite la etiqueta «filtro de aire». Se corroboró el renglón de 40,000 km/24 meses como habitáculo en la tabla México en inglés. Los paquetes comerciales lo incluyen cada dos servicios. No fusionar ambas frecuencias sin validar.
3. **C03 — tolerancia de garantía.** El margen publicado de ±1,000 km/±1 mes trata de garantía. No demuestra una tolerancia mecánica segura para cada componente. Un mes tampoco equivale siempre a 30 días.

Fuentes: [programa comercial Mazda México](https://www.mazda.mx/servicio-mazda/mantenimiento-mazda/mantenimiento), [manual 2022, México](https://www.mazdausa.com/static/manuals/2022/mazda3/contents/07020603.html), [manual 2026 español, páginas 9-9 a 9-11](https://www.mazda.mx/static/manuals/2026/mazda3/2026_mazda3_web_om_sp.pdf), [corroboración inglesa 2026, México](https://www.mazdausa.com/static/manuals/2026/mazda3/contents/69030900.html).

**Propuesta del equipo, no instrucción del fabricante:** no autorizar prórrogas cuando falte evidencia; usar provisionalmente el vencimiento más temprano aplicable, si el usuario lo aprueba. Conservar la discrepancia visible hasta validarla con Mazda. No decir «seguro hasta tal fecha» cuando ese dato no existe.

Esto no impide reducir visitas: se pueden agrupar trabajos en ventanas de adelanto aprobadas o en tolerancias específicas validadas. No se puede garantizar ahorro de días parados extendiendo arbitrariamente los intervalos.

## Catálogo resumido completo

En los pares km/meses vence el primero. «Inspección» no significa cambio obligatorio de la pieza. El detalle JSON conserva acción, fuente, confianza, aplicabilidad y condiciones.

| `aceite_normal` | Aceite de motor y filtro, uso normal | 10,000 km / 6 meses | importante | Oficial** |
| `aceite_severo` | Aceite de motor y filtro, uso severo | 5,000 km / 3 meses | importante | Oficial** |
| `bujias_inspeccion` | Bujías: inspección | 10,000 km / 6 meses | importante | Tabla oficial → equivalencia* |
| `bujias_turbo` | Bujías 2.5 turbo | 64,000 km | importante | Oficial** |
| `bujias_no_turbo` | Bujías 2.5 atmosférico / 2.0 MHEV | 120,000 km | importante | Oficial** |
| `filtro_motor` | Filtro de aire del motor | 20,000 km / 12 meses | importante | Tabla oficial → equivalencia* |
| `filtro_cabina` | Filtro de habitáculo | 40,000 km / 24 meses | menor | Oficial** |
| `filtro_combustible` | Filtro de combustible | 60,000 km | importante | Oficial** |
| `correas_accesorios` | Correas de accesorios | 10,000 km / 6 meses | importante | Tabla oficial → equivalencia* |
| `nivel_refrigerante` | Nivel de refrigerante | 10,000 km / 6 meses | importante | Tabla oficial → equivalencia* |
| `refrigerante_inicial` | Refrigerante: primer cambio | 192,000 km / 120 meses | importante | Oficial** |
| `refrigerante_sucesivo` | Refrigerante: cambios posteriores | 96,000 km / 60 meses | importante | Oficial** |
| `lineas_combustible` | Líneas y mangueras de combustible | 40,000 km / 24 meses | importante | Tabla oficial → equivalencia* |
| `emisiones` | Mangueras y tuberías de emisiones | 40,000 km / 24 meses | importante | Tabla oficial → equivalencia* |
| `lineas_freno` | Líneas, mangueras y conexiones de freno | 20,000 km / 12 meses | importante | Tabla oficial → equivalencia* |
| `servofreno` | Servofreno de vacío y manguera | 20,000 km / 12 meses | importante | Tabla oficial → equivalencia* |
| `nivel_frenos_embrague` | Nivel de líquido de frenos y embrague | 10,000 km / 6 meses | importante | Tabla oficial → equivalencia* |
| `liquido_frenos` | Líquido de frenos | 40,000 km / 24 meses | importante | Tabla oficial → equivalencia* |
| `frenos_inspeccion` | Balatas y discos: inspección | 10,000 km / 6 meses | importante | Tabla oficial → equivalencia* |
| `balatas_cambio` | Balatas: sustitución por condición | Por condición / pendiente | importante | Condición / validar |
| `discos_cambio` | Discos: sustitución por condición | Por condición / pendiente | importante | Condición / validar |
| `llantas_rotacion` | Rotación de llantas | 10,000 km | menor | Oficial** |
| `llantas_inspeccion` | Llantas: presión y desgaste en servicio | 10,000 km / 6 meses | importante | Tabla oficial → equivalencia* |
| `llantas_presion` | Presión en frío, incluida refacción | 1 meses | importante | Oficial** |
| `llantas_cambio` | Llantas: sustitución por desgaste, daño o envejecimiento | Por condición / pendiente | importante | Condición / validar |
| `direccion` | Dirección y articulaciones | 10,000 km / 6 meses | importante | Tabla oficial → equivalencia* |
| `suspension_rodamientos` | Suspensión, rótulas y juego de rodamientos | 20,000 km / 12 meses | importante | Tabla oficial → equivalencia* |
| `guardapolvos` | Guardapolvos de semiejes | 20,000 km / 12 meses | importante | Tabla oficial → equivalencia* |
| `tornilleria` | Pernos y tuercas de chasis y carrocería | 20,000 km / 12 meses | importante | Tabla oficial → equivalencia* |
| `escape` | Escape y protecciones térmicas | 20,000 km / 12 meses | importante | Tabla oficial → equivalencia* |
| `kit_neumatico` | Kit de reparación de llantas | 12 meses | menor | Oficial** |
| `luces` | Funcionamiento de luces | 10,000 km / 6 meses | importante | Tabla oficial → equivalencia* |
| `bateria_12v` | Batería de 12 V y sistema de carga | Por condición / pendiente | importante | Condición / validar |
| `bateria_mhev` | Batería y sistema MHEV | Por condición / pendiente | importante | Condición / validar |
| `transmision_at` | Fluido y estado de transmisión automática | Por condición / pendiente | importante | Condición / validar |
| `transmision_mt` | Aceite de transmisión manual y embrague | Por condición / pendiente | importante | Condición / validar |
| `awd` | Transferencia y diferencial AWD | Por condición / pendiente | importante | Condición / validar |
| `distribucion` | Distribución: cadena/correa, tensores y guías | Por condición / pendiente | importante | Condición / validar |
| `limpiadores` | Limpiaparabrisas y lavaparabrisas | Por condición / pendiente | menor | Condición / validar |
| `chapas_bisagras` | Lubricación de chapas y bisagras | 10,000 km / 12 meses | menor | Web comercial** |

\* Equivalencia nominal calculada a partir del número de servicios de la tabla y la base del manual de 10,000 km/6 meses. Es una derivación explícita, no un intervalo independiente publicado. Si la agencia confirma otra base, revisar todas estas filas; no cambiar 6 por 12 globalmente.

\*\* Oficial describe el origen del dato, no que haya desaparecido el conflicto o que la fila esté aprobada para producción.

Las filas de presión mensual y recomendaciones de envejecimiento se documentaron en el manual 2026, páginas 9-39 a 9-43. Su adopción homogénea en años anteriores requiere revisar el manual de la unidad. Las inspecciones de batería, transmisión, AWD y distribución sin intervalo fijo quedan pendientes; no se inventan sustituciones a 40,000, 60,000 o 100,000 km. Ausencia en la tabla no significa «sin mantenimiento» o «de por vida».

### Tolerancias, severidad, duración y confianza

- **Tolerancia:** `null` en las 40 filas. No hay autorización mecánica suficiente para prorrogar. El cero propuesto como política significa «sin extensión autorizada», no «riesgo cero».
- **Severidad:** propuesta operativa propia. Una revisión rutinaria de frenos no prueba que exista una falla crítica; si se reporta pérdida real de frenado, prevalece atención inmediata.
- **Consecuencias:** razonamiento técnico cualitativo, no estadística de fallas.
- **Duración:** `null` cuando no se obtuvo estancia real por operación. La oferta de [Servicio Express](https://www.mazda.mx/servicio-mazda/servicios-exclusivos/servicio-express) no se convierte en 45 minutos para cada servicio ni se suma por fila.
- **Confianza:** alta para dato explícito y aplicable; media para derivación/conflicto; baja para falta de intervalo o aplicabilidad mexicana no confirmada. No es porcentaje de que el auto falle. En Fase 2 habrá que separar confianza del catálogo y confianza de la proyección de uso.

## Regímenes y desgaste

El aceite tiene reglas excluyentes normal/severa. Para uso severo el manual prescribe 5,000 km/3 meses; no acorta automáticamente el resto del programa. Ralentí prolongado, baja velocidad tipo taxi, polvo, temperaturas extremas y trayectos cortos son motivos para evaluar ese régimen. «Es flotilla» por sí solo no describe las condiciones reales. [Manual 2023, México, páginas 6-9 a 6-11](https://www.mazda.mx/static/manuals/2023/mazda3/2023_mazda3_web_om_sp.pdf).

No encontré una curva de vida útil validada para México que permita afirmar «las balatas fallan entre X y Y km», ni una distribución equivalente para batería, discos, llantas o transmisión. Requerirán mediciones e historial: espesores, profundidad de dibujo, presión, fecha de fabricación, pruebas de batería y diagnóstico. Los km ayudan a proyectar una revisión programada, no a certificar la condición.

El envejecimiento de llantas empieza en la fecha de fabricación de cada llanta, no en el año del vehículo. Debe resolverse con Yokohama el criterio de retiro por edad, desgaste y daño; el manual no garantiza que una llanta pueda circular seis años sin inspección.

Para distribución, falta validar por VIN el sistema y sus piezas en documentación de taller. No se usó una póliza genérica de garantía para concluir que todos los motores usan la misma cadena/correa.

## Fallas y recalls: catálogo de antecedentes, no predictor estadístico

| Antecedente | Años modelo dentro del alcance | Evidencia y mercado | Km de aparición | Tratamiento propuesto |
|---|---|---|---|---|
| Válvulas de llantas, alerta 33/2021 | 2021 | Profeco, México | No publicado | Verificar VIN y reparación previa; prioridad crítica si afectado, sin diferir por agrupación |
| SSPD5, consumo de aceite / P250F:00 | 2021–2022, 2.5 turbo | Mazda, programa EE.UU. | No publicado | Diagnóstico y validación local; nivel/presión/síntomas definen urgencia |
| SSPD8, termostato / P0126:00 | 2021–2023, 2.5 atmosférico en matriz mexicana | Mazda, extensión de garantía EE.UU. | No publicado | Validar VIN; no asumir que todo código exige reemplazo |
| 25V357 / 7525E, módulo SAS de bolsas de aire | 2024–2025 | Recall EE.UU. | No publicado | Consultar aplicabilidad mexicana; falla de seguridad confirmada no se agrupa |

Fuentes: [Profeco/RAR, válvulas](https://alertas.gob.mx/detallealerta.php?alerta=642&site=RAR), [SSPD5](https://static.nhtsa.gov/odi/tsbs/2024/MC-11003694-0001.pdf), [SSPD8](https://static.nhtsa.gov/odi/tsbs/2025/MC-11016300-0001.pdf), [NHTSA 25V357](https://static.nhtsa.gov/odi/rcl/2025/RCAK-25V357-5527.pdf).

La corrección de válvulas tiene una duración publicada aproximada de 90 minutos; no incluye toda la indisponibilidad logística. SSPD8 publica 1.5 horas de mano de obra para Mazda3, pero no tiempo total en taller. Ambas magnitudes deben permanecer separadas.

No confundir:

- Los 2,000 km de prueba de consumo de SSPD5 con kilometraje de aparición o margen seguro.
- Los 240,000 km de cobertura de SSPD8 con una predicción de falla.
- «Fabricado en México» con «vendido en México» o cobertura local.
- Año de publicación del recall con año modelo: el recall 23V487 es para Mazda3 2014–2018, fuera del alcance.
- Falta de un resultado de búsqueda para 2026 con garantía de que no hay campañas.

La búsqueda pública no certifica exhaustividad. Antes de operar se debe consultar cada VIN en [Mazda México](https://www.mazda.mx/servicio-mazda/agenda-tu-cita/llamado-a-revision) y obtener de la agencia su estado vigente. No se envió ningún VIN ni formulario durante esta investigación.

## Cobertura de versiones mexicanas

| Año | Sedán documentado | Hatchback documentado |
|---|---|---|
| 2021 | i, i Sport, i Grand Touring | i Sport, i Grand Touring, s Grand Touring, Signature |
| 2022 | i, i Sport, i Sport MHEV, i Grand Touring, Signature | i Sport, i Grand Touring, Signature |
| 2023 | i, i Sport, i Sport MHEV, i Grand Touring, Signature, Carbon Edition | i Sport, i Grand Touring, Signature, Carbon Edition |
| 2024 | i, i Sport, i Sport MHEV, i Grand Touring, Signature | i Sport, i Grand Touring, Signature |
| 2025 | i, i Sport, i Grand Touring, Signature | i Sport, i Grand Touring, Signature |
| 2026 | i, i Sport, i Grand Touring, i Grand Touring MHEV, Signature | i Sport, i Grand Touring, Signature |

Las 12 URLs originales y combinaciones motor/transmisión/tracción están en el JSON de variantes. La edición 100 Aniversario de ambas carrocerías se registra como candidata pendiente de año por VIN; no se deduce el año solo de la carpeta web. No se presume que estas fichas capturen todas las actualizaciones a mitad de año.

Las fichas confirman cambios importantes: 2.0 MHEV en sedán; turbo con AWD; disponibilidad de manual variable por año. El catálogo evita importar versiones extranjeras. Ejemplos primarios: [sedán 2023](https://www.mazda.mx/siteassets/descargables-2023/mazda3-sedan/ficha-tecnica/ficha-tecnica-mazda3-sedan-2023-v01.pdf) y [sedán 2026](https://www.mazda.mx/siteassets/descargables-2026/mazda3-sedan/ficha-tecnica/ficha-tecnica-mazda3-sedan-2026-v04.pdf).

## Evidencia y limitaciones de acceso

Los manuales 2023–2026 se descargaron desde los enlaces de Mazda México. Se extrajeron las tablas México y sus notas; se revisaron visualmente tablas seleccionadas y fichas con celdas combinadas. Se conservaron los SHA-256 de esos cuatro PDF en el catálogo para identificar la revisión.

El manual interactivo 2021 se pudo leer con acceso HTTP aunque el lector web falló. Para 2022, el enlace del portal mexicano conduce a una ficha técnica; se usó la sección expresamente México del manual oficial alojado en Mazda USA. La edición española 2022 queda pendiente de confirmar. El PDF de la alerta Profeco devolvió 403; se verificó la misma alerta en el portal oficial RAR.

La información no procede de foros ni de promedios anónimos. No se copiaron procedimientos de reparación ni tablas de otros mercados para llenar huecos.

## Decisiones para aprobar antes de Fase 2

1. Aceptar este catálogo como base documental provisional, no como certificación mecánica.
2. Aprobar la política de no prorrogar sin evidencia y permitir agrupación con adelantos/tolerancias específicamente validados.
3. Mantener bloqueadas las reglas incompletas y los antecedentes extranjeros hasta validar aplicabilidad; mostrar «pendiente de validar», nunca «sin riesgo».
4. Resolver con la agencia C01–C03, duraciones, campañas por VIN y límites de desgaste. La aprobación del usuario no sustituye esa validación.
5. Confirmar quién de Yokohama validará operación normal/severa y proporcionará historial real.

Con aprobación del usuario, la Fase 2 puede construirse con reglas provisionales claramente rotuladas y datos sintéticos, sin habilitar decisiones operativas no validadas. Hasta esa aprobación, el trabajo se detiene aquí.

