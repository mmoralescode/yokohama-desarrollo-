# Repositorio independiente de Yokohama

Destino solicitado: https://github.com/mmoralescode/yokohama-desarrollo-

Se transfirió únicamente el proyecto Yokohama del directorio original, sin importar commits ni archivos de EXCOBA. El repositorio de destino estaba vacío; su rama inicial es `main`. La copia original y su demostración local se conservaron sin cambios.

## Estructura

- `backend/`: motor, FastAPI, persistencia, migración inicial, generador sintético y pruebas.
- `frontend/`: panel Next.js/TypeScript y recorridos de navegador.
- `catalogos/`: servicios, variantes, fuentes y pendientes de validación.
- `config/`: política de predicción, triage y anticipación.
- `docs/`: investigación, contrato, decisiones y verificaciones.
- `scripts/dev.ps1`: instalación, inicio y parada locales.

Para obtenerlo:

```sh
git clone https://github.com/mmoralescode/yokohama-desarrollo-.git
cd yokohama-desarrollo-
```

En Windows, con Python y Node instalados, ejecutar desde esa raíz:

```powershell
./scripts/dev.ps1 -Install -Seed
```

El generador recrea 20 unidades ficticias. No se suben bases de datos, unidades reales, entornos virtuales, `node_modules`, archivos `.env`, claves API, logs, compilaciones ni resultados de pruebas. Solo se versionan plantillas `.env.example` sin claves. `next-env.d.ts` se regenera al ejecutar Next y se ignora explícitamente, sin depender del repositorio anterior.

La investigación y los catálogos conservan la evidencia original; una aprobación de desarrollo no habilita reglas mecánicas para producción. GitHub aloja el código: este traslado no despliega servidores, conecta Vercel ni activa envíos por correo/WhatsApp.

## Comprobación del traslado

Las 109 pruebas del motor/API se volvieron a ejecutar desde `backend/` del repositorio independiente y pasaron (dos advertencias de deprecación del cliente de pruebas). Se verificó por SHA-256 que ambos catálogos y la investigación original permanecen idénticos. El script de arranque pasó la validación sintáctica de PowerShell. Las bases locales, secretos y artefactos están excluidos mediante reglas propias de este repositorio.

En `frontend/`, `npm ci`, `npm run build` y `npm run typecheck` finalizaron correctamente; la instalación reportó cero vulnerabilidades. No fue necesario modificar la lógica del motor ni del panel para independizarlos.
