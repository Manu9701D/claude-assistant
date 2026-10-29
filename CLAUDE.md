# Claude Assistant · preset «Optimizaciones»

Se mejora **Claude Assistant**, la app Electron desde la que probablemente corre esta sesión. Español, breve y directo. Uso de la app: `README.md` (actualízalo si cambias algo visible).

## Carpetas
- `C:\Users\mnldz\claude-assistant-dev` (rama `dev`, worktree): **aquí se edita**.
- `C:\Users\mnldz\claude-assistant` (`main`): la app en uso. Solo cambia con `tools/apply.cjs`.

## Flujo
1. Edita en dev → `node tools/dev.cjs start` abre la app de pruebas («Claude Assistant (pruebas)», con datos propios). No la cierres sin motivo.
2. `node tools/dev.cjs restart` para ver cada cambio (reabre sus pestañas).
3. Comprueba antes de decir que está hecho: `node tools/cdp.cjs shot` (captura → Read) y `node tools/cdp.cjs eval "<js>"` (admite promesas; p. ej. `state.convs`, `state.tabs`, `openSession({ presetId })`). Con `--secundaria`, la ventana sacada arrastrando una pestaña (`owner` en `main.mjs` dice qué ventana muestra cada pestaña).
- En un Mac de la red (hace falta el alias `mac` en `~/.ssh/config` y la clave autorizada allí; ahora no hay ninguno conectado): `node tools/mac.cjs start|restart|stop` copia la fuente limpia a `~/claude-assistant-pruebas` y la abre allí; `node tools/cdp.cjs --mac shot|eval`. Si cambia la IP del Mac, actualiza el alias.
4. Solo con el visto bueno del usuario, y avisándole antes de que la app pedirá reiniciarse: `node tools/apply.cjs "Qué cambia"`. Comprueba la sintaxis, hace commit en dev, pasa a main (con `npm install` si hace falta), sube main y dev a GitHub (`origin`, privado, Manu9701D) y la app ofrece reiniciar. Esta pestaña vuelve con la conversación; la de pruebas no (`dev.cjs start`).
- Si la versión nueva no arranca en 45 s, `tools/watchdog.cjs` vuelve al commit anterior. Registro: `%APPDATA%\claude-assistant\watchdog.log` (o `claude-assistant-dev\`).

## Reglas
1. Nunca cierres ni mates la app en uso (nada de `Stop-Process`/`taskkill` sobre `Claude Assistant.exe`). La de pruebas, solo con `dev.cjs stop`.
2. No edites `C:\Users\mnldz\claude-assistant` ni `%APPDATA%\claude-assistant\config.json`: la app los sobrescribe. Para presets, `DEFAULT_PRESETS` en `personal.mjs` (sin seguimiento en git; se siembran una vez, ver `presetsSeeded`). Los datos personales (presets, accesos) van en `personal.mjs`, nunca en el código: `tools/build-linux.cjs` hace copias para otros sin él.
3. `node_modules` de dev es un junction al de main: antes de tocar dependencias, `cmd /c rmdir node_modules` + `npm install`.
4. `runtime\Claude Assistant.exe` es compartido. Regenerarlo (`node tools/make-exe.cjs` o `npx electron tools/make-icon.cjs` si cambia `renderer/spark.js`) exige cerrar la app: lo hace el usuario.

## La app
Cada pestaña es el `claude` interactivo de la terminal (node-pty), visto como chat. **El objetivo es parecerse lo más posible a la terminal de Claude Code.**
- `main.mjs`: ventana, bandeja, atajos, configuración, presets, uso del plan, IPC, procesos por pestaña, `restartApp`.
- `preload.cjs`: puente IPC. `renderer/app.js`: toda la interfaz. CSS: `styles` (general), `parity` (piezas como Claude Code), `output`, `presets`, `appearance` (variables de Configuración › Apariencia, que fija `applyAppearance`). `renderer/spark.js`: el icono.
- `assist.mjs` + `overlay-preload.cjs` + `renderer/overlay.*`: asistente por voz (Whisper local, `voice:transcribe`).
- `accounts.mjs`: cuentas (`/login`), cifradas con AES y una clave en `accounts.key` (DPAPI, compartida por las dos apps). Cambia la activa reescribiendo `~/.claude/.credentials.json` y `oauthAccount` de `~/.claude.json`. Cuenta por ventana (`winAccount`, `conv.account`): `profile(key)` monta `%APPDATA%\claude-assistant\perfiles\<cuenta>` (credenciales y `.claude.json` propios, junctions al resto de `~/.claude`) y la pestaña se lanza con `CLAUDE_CONFIG_DIR`; la activa global va sin él. Uso del plan: una sonda por cuenta.
- `schedules.mjs`: tareas programadas (Configuración › Programadas, `config.schedules`). Configuración › Memoria edita `~/.claude/projects/*/memory` y `~/.claude/CLAUDE.md` (IPC `memory:*`). Vista previa de HTML: ventana aislada (`preview:html`), que se inspecciona con `cdp.cjs --vista-previa`.
- `whatsapp.mjs`: WhatsApp Web oculto por CDP; MCP `whatsapp_*` para los presets con `desktop`, servido por `mcp-http.mjs` (MCP mínimo por HTTP) y pasado con `--mcp-config`.
- Pestañas (ya no hay modo SDK; el SDK solo se usa en sondas: uso del plan, modelos/comandos, contexto): `terminals.mjs` lanza el `claude` interactivo en node-pty (args en `terminalCommand` de `main.mjs`) y `renderer/terminal.js`/`terminal.css` lo pintan con xterm.js. Sin SDK (por el bug de consumo).
  - Vista de chat (por defecto; Ctrl+º o el botón alterna con la terminal): `termchat.mjs` lee la transcripción `.jsonl` y la convierte en mensajes como los del SDK; permisos, `AskUserQuestion` y plan llegan por hooks HTTP (`PermissionRequest`, `UserPromptSubmit`, `Stop`, `Notification`) y el plan se contesta tecleando en su diálogo (`termPlanOptions` en `terminal.js` lo lee de la pantalla). El fin de turno lo marca `turn_duration` (el texto final llega después de `Stop`). `/model` y `/effort` guardan el predeterminado en `~/.claude/settings.json`: `keepClaudeDefaults` lo repone. Los textos que se leen de la pantalla están en `SCREEN` (terminal.js) y `TRUST_ASK` (terminals.mjs); si no aparecen, se apunta en `errores.log`. A la interfaz solo viajan los mensajes cambiados (`from` en `conv:update`).
  - Pruebas: `npm test` (`tests/`, termchat con transcripciones de ejemplo y mcp-http).
- `jobhelper.ps1`: Job Object por pestaña (Windows); `unix-jobs.mjs`: lo mismo en Linux (scope de systemd) y macOS (grupo de procesos). `terminal/`: versión de terminal (`ca.ps1` en Windows, `ca`/`ca.mjs` en Linux y macOS). `tools/`: dev, cdp, apply, watchdog, common, make-exe, make-icon, build-linux (AppImage + rpm en Docker, ver `LEEME-linux.md`).
- Multiplataforma: lo de Windows va tras `IS_WIN` (main) o `.only-win` / `IS_WIN` (interfaz); lo de macOS, tras `IS_MAC` (en la interfaz, `K()` pasa `Ctrl+` a `⌘` en los atajos de la app; en `accounts.mjs`, las credenciales van al Llavero). Copias: `build-linux.cjs` y `build-mac.cjs` (o la acción de GitHub), con la fuente limpia de `build-src.cjs`. `setup:check` + `#setup` en app.js: puesta a punto del primer arranque (`setupDone`).
- Reinicio: `restart-request.json` en la carpeta de datos → `restartApp()` guarda `restore.json` → watchdog abre con `--restore` y espera `ready.json`. `CA_PROFILE=dev` usa `%APPDATA%\claude-assistant-dev`. Conversaciones: `~/.claude/projects`.

## Gustos del usuario (apunta aquí lo nuevo)
- Selectores y menús iguales a los de Claude Code (modelo, effort, `AskUserQuestion`), con Tab, flechas y ratón.
- Interfaz estilo Claude, cuidada. Salida limpia: el trabajo intermedio en fichas plegables, separadas por lo que Claude va contando (que se ve en el chat), y la respuesta debajo.
- Al abrir, pestaña limpia: solo se reabren las pestañas al reiniciar para aplicar cambios.
- Sin mensajes de arranque automáticos en los presets.
