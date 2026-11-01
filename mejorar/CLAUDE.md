# Mejorar Claude Assistant

Estás en el código de **Claude Assistant**, la app de escritorio desde la que el usuario habla contigo
(cada pestaña es un `claude` interactivo en una terminal, visto como chat). Esta carpeta es una **copia
editable**: la app instalada no se toca, y mientras editas la app en uso tampoco cambia. Al aplicar, se
congela una copia de esta carpeta y la app se reinicia con ella; si no arranca, vuelve sola a la instalada.

El usuario viene a que le arregles un problema o le añadas algo. Puede no saber programar: habla en llano,
dile qué pasa y qué vas a hacer, y no le pidas que toque código ni comandos.

## Herramienta

Todo pasa por `mejorar/ca` (en Windows, `mejorar\ca.cmd`), que usa el Node de la propia app:

| Orden | Qué hace |
|---|---|
| `mejorar/ca estado` | Versión en uso, cambios hechos y si hay que integrar una versión nueva |
| `mejorar/ca registros` | Lo último de `errores.log` y `cuelgues.log` (la app en uso y la de pruebas) |
| `mejorar/ca prueba` | Abre o reabre una **instancia de pruebas** con el código de esta carpeta (ventana aparte, datos aparte) |
| `mejorar/ca captura` | Captura de la instancia de pruebas (te da la ruta: léela para verla) |
| `mejorar/ca eval "<js>"` | Ejecuta JavaScript en su interfaz (admite promesas): `state.convs`, `state.tabs`, `openSession({})`, `openSettings()` |
| `mejorar/ca parar` | Cierra la instancia de pruebas |
| `mejorar/ca comprobar` | Revisa la sintaxis de todo el código |
| `mejorar/ca aplicar "qué cambia"` | Comprueba, guarda en git y la app ofrece reiniciarse con esta versión |
| `mejorar/ca original` | Vuelve a la versión instalada (los cambios se quedan aquí) |
| `mejorar/ca actualizar` | Tras instalar una versión nueva de la app: la trae y mezcla los cambios propios |
| `mejorar/ca parche` | Guarda los cambios en un `.patch` en el Escritorio, para compartirlos |

## Flujo

1. **Entiende el problema.** `mejorar/ca estado` y `mejorar/ca registros`; pregunta al usuario lo que no
   esté claro (qué hacía, qué esperaba, qué ha pasado).
2. **Reprodúcelo** en la instancia de pruebas (`prueba`, `eval`, `captura`). Nunca experimentes con la app
   en uso: es donde está esta conversación.
3. **Cambia lo mínimo**, siguiendo el estilo del código que lo rodea. Nada de refactors que nadie ha pedido.
4. **Compruébalo** en la instancia de pruebas (`prueba` otra vez para cargar los cambios, `captura` para
   verlo). «Hecho» es visto funcionando, no «debería funcionar».
5. **Aplica solo con el visto bueno del usuario**, avisándole de que la app ofrecerá reiniciarse: `mejorar/ca
   aplicar "…"`. Esta conversación vuelve sola al reiniciar.
6. Si tras aplicar algo va mal: `mejorar/ca original`. Si la versión aplicada no llega a arrancar, la app vuelve
   sola a la original y se lo avisa al usuario; el motivo sale en `mejorar/ca estado`.

Cuando la app instalada se actualiza, arranca con la versión original hasta que integres los cambios:
`mejorar/ca actualizar` (si hay conflictos, resuélvelos con cuidado, conservando lo nuevo de la versión
instalada), pruébalo y aplícalo. Ramas de git: `original` es la versión instalada y `main`, la del usuario.

## Cómo es la app

- `boot.mjs`: entrada; elige esta copia o la instalada. `main.mjs`: ventana, bandeja, atajos,
  configuración, presets, uso del plan, IPC, procesos por pestaña, reinicio (`restartApp`).
- `preload.cjs`: puente IPC (`api.*` en la interfaz). `renderer/app.js`: toda la interfaz (variables
  globales: `state`, `openSession`, `openSettings`…). CSS: `styles` (general), `parity` (piezas como Claude
  Code), `output`, `presets`, `appearance`. `renderer/terminal.js` + `terminal.css`: la terminal (xterm.js).
- `terminals.mjs`: lanza `claude` en node-pty por pestaña. `termchat.mjs`: lee la transcripción `.jsonl`
  de Claude Code y la convierte en mensajes del chat; permisos, preguntas y plan llegan por hooks HTTP. Los
  textos que se leen de la pantalla de la terminal están en `SCREEN` (terminal.js) y `TRUST_ASK`
  (terminals.mjs): si Claude Code cambia sus textos, ahí es donde hay que actualizarlos.
- `accounts.mjs`: cuentas. `schedules.mjs`: tareas programadas. `assist.mjs` + `renderer/overlay.*`:
  asistente por voz (Whisper local). `whatsapp.mjs` + `mcp-http.mjs`: WhatsApp. `docview.mjs`,
  `docedit.mjs`: vista previa y edición de documentos. `hangs.mjs`: registro de cuelgues. `mejoras.mjs`:
  este preset y la copia editable.
- Multiplataforma: lo de Windows va tras `IS_WIN`, lo de macOS tras `IS_MAC` (en la interfaz, `K()` pasa
  `Ctrl+` a `⌘`). Piensa siempre en las tres.
- Datos de la app: `mejorar/entorno.json` dice dónde (`data`). Conversaciones: `~/.claude/projects`.
- Pruebas automáticas: `tests/` (`ELECTRON_RUN_AS_NODE=1 "<exe de entorno.json>" --test tests/*.test.mjs`).

## Reglas

- No cierres ni mates la app en uso; la de pruebas, solo con `mejorar/ca parar`.
- No toques la carpeta de la app instalada (`original` en `entorno.json`) ni `node_modules` (es un enlace a
  la de la app instalada: no se pueden añadir dependencias).
- No edites `config.json` de la carpeta de datos a mano: la app lo sobrescribe.
- Si lo que pide el usuario no se puede hacer con seguridad (o rompería algo que usa a diario), díselo
  antes y propón otra forma.
