# Claude Assistant

Asistente de IA de escritorio para Windows (con copias para Linux y macOS). Cada pestaña es el `claude` interactivo de la terminal,
que la app enseña como un chat (o tal cual, en la vista de terminal).

## Qué hace igual que Claude Code

- Tu login, `CLAUDE.md`, servidores MCP, skills, hooks y settings (`user`, `project` y `local`).
- **Comandos `/`** con autocompletado: los 87 de tu instalación (`/compact`, `/context`, `/usage`, `/init`, skills, plugins…).
  `/clear`, `/model`, `/config`, `/exit` y `/help` los resuelve la app, porque en la terminal son pantallas interactivas.
- **Menciones `@archivo`** con autocompletado sobre la carpeta de la pestaña. Claude Code las expande igual que en la terminal.
- **Escribir mientras trabaja:** como en Claude Code, el mensaje queda en cola y Claude lo lee en cuanto acaba el paso en curso (entre una herramienta y la siguiente), sin dejar lo que hace; si termina antes, sale como mensaje nuevo. Los comandos (`/…`, `!`) esperan a que acabe. Con la ✕ lo retiras para editarlo. **`Ctrl+Enter`** (o `Enter` con el cuadro vacío, o el rayo de la cola) lo envía ya: interrumpe a Claude y le manda lo que haya en cola, como en Claude Code.
- **`Esc`** (o `Ctrl+C` sin nada seleccionado) interrumpe sin cerrar la sesión. Lo que ya estaba en cola se le manda al cortar, como en Claude Code.
- Como en Claude Code: **`Esc` dos veces** borra lo escrito (con `↑` se recupera) o, con el cuadro vacío, abre **`/rewind`**: eliges el mensaje y qué restaurar (código, conversación o las dos; también resumir) y, si vuelve la conversación, ese mensaje queda en el cuadro para editarlo. Más rápido: el **lápiz** que aparece bajo cada mensaje tuyo (al pasar el ratón) vuelve justo antes de él restaurando solo la conversación y lo deja en el cuadro para editarlo y reenviarlo. Funciona también mientras Claude trabaja: primero lo interrumpe (lo que hubiera en cola queda en el cuadro, detrás). Como en claude.ai, el mensaje editado guarda sus **versiones**: con «‹ 1/2 ›» bajo él lees la anterior y su respuesta (solo para leer; Claude sigue con la última). **`Ctrl+C`** sin nada seleccionado borra lo escrito y, con el cuadro vacío, dos veces seguidas pregunta si quieres cerrar la pestaña.
- **`Shift+Tab`** cambia de modo: preguntar → editar libre → plan → acceso total.
- **Preguntas con opciones** (`AskUserQuestion`), con teclas 1–9, respuesta libre, selección múltiple y vista previa.
- **Aprobación de planes** (`ExitPlanMode`): ejecutar con ediciones automáticas, con acceso total, preguntando, o seguir planificando con comentarios.
- **Permisos** como en la terminal: «Sí», «Sí, y no volver a preguntar…» y «No, y decirle qué hacer distinto».
- **Imágenes:** pégalas con `Ctrl+V`, arrástralas o adjúntalas. Los demás archivos arrastrados se mencionan con `@`.
- **Carpeta de trabajo por pestaña:** se elige (o se cambia, con el chip de carpeta del cuadro) antes del primer mensaje: Claude Code se relanza en la carpeta nueva. Se carga el `CLAUDE.md` de esa carpeta.
- **Modelo por pestaña**, con la lista real de `/model` (y el de por defecto, en Configuración › Modelo, con la misma lista).
- **Sugerencia del siguiente mensaje:** la que propone Claude Code al terminar sale en gris en el cuadro vacío; `Tab` la escribe.
- **Lista de tareas** fija sobre el cuadro de texto (`TaskCreate`/`TaskUpdate`).
- **Razonamiento resumido** plegable.
- **Subagentes** con su actividad anidada; los que trabajan en segundo plano avisan al terminar.
- **En segundo plano:** los comandos y agentes que Claude deja corriendo salen sobre el cuadro («En segundo plano · …») y, al acabar, una nota dice si han terminado o fallado. Un clic en esa ficha (o `/tasks`) abre la lista, como en Claude Code: `↑`/`↓` y `Enter` para ver la salida en vivo de un comando (o lo que va haciendo un agente) y `K` o «Detener» para pararlo con todo lo que haya lanzado.
- **`/export`** (o el menú de la pestaña › «Exportar a Markdown…»): la conversación en Markdown, a un archivo o al portapapeles.
- **`/hooks`, `/permissions`, `/mcp`, `/memory` y `/config`** abren ventanas de la app (lo configurado en usuario, proyecto y local; los conectores; Configuración); desde ellas, «Editar en Claude Code…» lleva a su pantalla en la terminal.
- **Historial** con `↑`/`↓`.

## Presets

Al abrir una pestaña eliges un preset, como los perfiles de Chrome (teclas `1`–`9`). También puedes abrirlo directamente desde el menú `⌄`. Cada preset tiene:
- una cuenta opcional (si tienes varias): se abre en una ventana de esa cuenta, la que haya abierta o una nueva. Si se queda sin uso del plan, cambias la cuenta de esa ventana con su chip, como siempre («Duplicar» se queda en la ventana en la que estás);
- carpeta de trabajo (de donde se carga su `CLAUDE.md`) y carpetas adicionales;
- modelo, effort y modo de permisos propios;
- un selector de **conectores y herramientas** agrupado y con buscador: lo de la app (Claude in Chrome, WhatsApp en segundo plano, control de aplicaciones de Windows o del Mac), los conectores de claude.ai (los que están sin autorizar van plegados al final), los servidores MCP, los plugins (con un interruptor para no cargar ninguno) y las skills; cada grupo dice cuántos van activos y tiene «Todos» y «Ninguno»;
- instrucciones extra;
- un mensaje de arranque opcional.

Se crean, editan, reordenan y borran en Configuración → Presets, o con el lápiz de cada tarjeta.

Presets iniciales:
- **Trabajo:** la carpeta del proyecto de trabajo, con Chrome y un arranque que revisa el estado de sus repositorios y de Docker. Usa la cuenta de GitHub de trabajo para `git` y `gh`; el resto de pestañas, la de por defecto.
- **Servidores:** `servidores\` más `servidor-oracle\`. El índice de ambos está en `servidores\CLAUDE.md`.
- **Local:** la carpeta de usuario, con instrucciones para configurar el PC. Lleva un registro de cambios en `~\.claude\pc-cambios.md`. Sin plugins de programación.
- **Assist:** `Asistente\` con su propio `CLAUDE.md`, Gmail, skills de documentos y acceso a Documentos, Descargas y Escritorio. Va con Sonnet y effort bajo, y sin plugins de programación. Además:
  - **WhatsApp en segundo plano** con las herramientas propias de la app (ver abajo). Se le pide que para WhatsApp use siempre estas y no Windows-MCP, que cuesta varias veces más.
  - **Control de aplicaciones de Windows** con [Windows-MCP](https://github.com/CursorTouch/Windows-MCP) (`uvx windows-mcp serve`, sin telemetría y sin sus herramientas de registro, PowerShell, archivos ni Screenshot). En macOS, «Apps del Mac» usa macOS-MCP (`uvx macos-mcp`, con el permiso de Accesibilidad); en Linux no hay (Wayland no deja manejar otras ventanas). Es lo que más contexto gasta: se le pide que lo use solo si no hay otra forma y con `region`, y el texto de cada resultado se recorta a 12.000 caracteres.
  - **El navegador solo si se lo pides:** si no mencionas Chrome o una web, la app intercepta cualquier herramienta de navegador (Claude in Chrome, Playwright, chrome-devtools o abrir un navegador) y te pregunta antes.
- **Optimizaciones:** mejorar esta misma app desde la app, sobre una copia de pruebas (ver abajo).

**Pedírselo a Claude:** desde cualquier pestaña puedes escribir «créame un preset para la carpeta X con Sonnet y Chrome» (o «cámbiale el modelo al preset Y»). Las pestañas llevan un MCP `presets` servido por la app (`presets_list` y `presets_save`); el preset aparece al momento, sin reiniciar. Borrar se hace desde Configuración › Presets.

Los presets nuevos de `DEFAULT_PRESETS` se añaden una sola vez al arrancar, aunque ya tengas tu configuración (`presetsSeeded`). Si borras uno, no vuelve a aparecer.

### Consumo

- **Caché compartida entre pestañas:** el prompt de sistema va con `excludeDynamicSections`, así que su parte fija es igual en todas las pestañas y se lee de la caché en vez de volver a escribirse. Abrir una pestaña nueva del mismo preset cuesta unas 9 veces menos.
- **Contador por mensaje:** «nuevos → salida · en caché». Leer de la caché cuesta un 10 % de la entrada nueva, por eso va aparte. El coste en dólares solo se muestra con clave de API.
- **Registro de uso:** cada turno (tokens y coste) y cada cambio del % de la ventana de 5 h van a `usage-log.jsonl`, en la carpeta de datos. `node tools/usage-report.cjs [días]` compara cuántos tokens le cuesta a la app y a la terminal subir un 1 % la ventana. Hay un [issue abierto](https://github.com/anthropics/claude-code/issues/97074) que mide ~1,8× más en modo SDK.

## Mejorar la app desde la app

El preset **Optimizaciones** trabaja en `claude-assistant-dev`, una copia de pruebas (git worktree, rama `dev`) de esta carpeta (rama `main`):

1. Claude edita la copia y abre la **app de pruebas**, «Claude Assistant (pruebas)», con sus propios datos (`node tools/dev.cjs start`).
2. La pruebas mientras sigue cambiando cosas. Para cada cambio la reinicia (`dev.cjs restart`) y vuelve a abrir sus pestañas, así que no pierdes lo que estabas probando.
3. Cuando estás contento, Claude aplica (`node tools/apply.cjs "…"`): commit, paso a `main` y aviso en tu app. Puedes reiniciar ahora, cuando terminen las pestañas o más tarde. Al reiniciar, la app vuelve a abrir tus pestañas con su conversación, incluida la de Optimizaciones.
4. Si la versión nueva no llega a arrancar, `tools/watchdog.cjs` vuelve sola al commit anterior y te avisa.

El procedimiento completo para Claude está en `CLAUDE.md`.

## Pestañas de terminal

Cada pestaña ejecuta el `claude` interactivo de siempre dentro de la app (pseudoconsola + xterm.js), así que el uso del plan es exactamente el de la terminal. Se mantienen las pestañas, los presets (carpeta, carpetas extra, modelo, effort, permisos, instrucciones, Chrome, Windows-MCP, plugins, compactación, cuenta de GitHub), las cuentas, la barra de uso y la reapertura de pestañas al reiniciar (con `--resume`).

**Vista de chat (por defecto):** la terminal sigue funcionando por detrás, oculta, y la pestaña se ve como el chat de la app: tus mensajes, lo que Claude va contando (que separa el trabajo intermedio en fichas plegables, como en la terminal) y el «Trabajando…». Lo que escribes se teclea en el `claude` real (con imágenes adjuntas; si está trabajando, queda en la cola de la app y se envía al terminar la respuesta, así que la ✕ y `Esc` lo devuelven al cuadro de texto). La conversación se lee de su transcripción (`~/.claude/projects`), y las preguntas (`AskUserQuestion`), los permisos y el plan llegan por hooks y salen con los selectores de la app.
- El botón de terminal del cuadro de texto, o **Ctrl+º**, cambia entre el chat y la terminal real (para volver, el botón redondo de arriba a la derecha, con su margen propio para no tapar el texto). Si Claude Code muestra algo que el chat no sabe enseñar, la app pasa sola a la terminal.
- `/model`, `/effort`, el selector de modelo y el de modo (Shift+Tab) cambian solo esa pestaña: la confirmación «Switch model?» se acepta sola, y el modelo y el effort que Claude Code guardaría como predeterminados en `~/.claude/settings.json` se devuelven a lo que tenías. Los comandos con pantalla propia (`/config`, `/resume`…) abren la terminal.
- `/clear` deja el chat en blanco; al reiniciar se retoma la conversación nueva.

En la vista de terminal:
- El título de la pestaña es el tema que pone Claude Code; aviso al terminar si la app no tiene el foco.
- Ctrl+C con texto seleccionado copia; Ctrl+V o clic derecho pegan (una imagen se pega con Alt+V, como en la terminal); Shift+Enter es salto de línea; arrastrar archivos pega su ruta. Ctrl+T/W/Tab/1–9/, siguen siendo de la app.
- La pregunta de confianza de la carpeta se acepta sola.
- Si Claude Code se cierra, Enter vuelve a abrir la misma conversación.
- WhatsApp llega a las pestañas como servidor MCP local por HTTP (`mcp-http.mjs`). El asistente por voz también trabaja en una pestaña de terminal. Solo la lectura del uso del plan, la lista de modelos y comandos y el desglose del contexto usan el SDK (`@anthropic-ai/claude-agent-sdk`), sin abrir conversaciones.
- Si Claude Code cambia los textos que la app lee en su pantalla (plan, modo, «Switch model?»), lo apunta en `errores.log` de la carpeta de datos.

## Versión de terminal (sin SDK)

`terminal\ca.cmd` abre los mismos presets con el `claude` de la terminal, sin el SDK. Lee los presets de la configuración de la app (no la cambia) y lanza `claude` con su carpeta, carpetas extra, modelo, effort, modo de permisos, instrucciones, Chrome, Windows-MCP, plugins desactivados, compactación y cuenta de GitHub.

- `ca`: menú. ↑↓ o número para elegir, Enter abre aquí (al salir de Claude vuelve al menú), T en una pestaña nueva de Windows Terminal con el color del preset, M modelo, E effort, R retomar (elegir conversación / la última), C cuenta de Claude (las mismas que guarda la app).
- `ca trabajo`, `ca assist -Resume`, `ca local -Model claude-sonnet-5-5`: directo. `-DryRun` enseña el comando sin abrirlo.
- No hay WhatsApp (depende de la app) ni asistente por voz.
- En Linux y macOS, `terminal/ca` (Node, `ca.mjs`) hace lo mismo: `ca`, `ca trabajo --resume`, `--continue`, `--model`, `--effort`, `--dry-run`; T abre una ventana nueva (Terminal en macOS; Ptyxis, Consola de GNOME, Konsole… en Linux) y en macOS lleva macOS-MCP. Se enlaza una vez en el PATH (`ln -s …/terminal/ca ~/.local/bin/ca`).

## Uso del plan

En la barra de título hay tres indicadores:
- una batería con lo que queda de la sesión de 5 horas (verde, ámbar o rojo);
- una barrita con lo que queda de la semana;
- la cuenta atrás hasta el reinicio de la sesión.

Al hacer clic se ve el detalle, con las horas de reinicio. Los datos son los mismos que `/usage`. Se actualizan cada 90 s, al terminar cada respuesta y con los avisos de límite que llegan del servidor.

## Contexto

A su izquierda, un anillo con el contexto que ocupa la pestaña activa (como `/context`). Se pone ámbar y luego rojo al acercarse al compactado automático. Al hacer clic se ve el desglose por categorías (instrucciones, herramientas, memoria, skills, mensajes, reserva y libre) y la opción «Compactar ahora»; en las pestañas de terminal, sin desglose (se calcula con la transcripción). Aparece en cuanto la pestaña ha respondido una vez y se actualiza al terminar cada respuesta.

Para gastar menos, las pestañas compactan la conversación al llegar a 200k tokens en vez de esperar a llenar la ventana de 1M de Opus: cada respuesta vuelve a leer todo el contexto, así que una conversación de 800k cuesta unas 20 veces más por llamada que una recién empezada. Se cambia en Configuración → «Compactar la conversación al llegar a» (vacío = el máximo de cada modelo: 1M con Opus, Sonnet y Fable 5; 200k con Haiku). El anillo usa la ventana del modelo de cada pestaña.

## Procesos de cada pestaña

Cada pestaña mete su Claude Code en un Job Object de Windows (`jobhelper.ps1`). Todo lo que lance queda dentro: shells, servidores de desarrollo, ventanas abiertas con `Start-Process`. Al cerrar la pestaña se termina todo. `/clear` no lo cierra, porque la pestaña sigue abierta. Si la app se cierra, Windows termina esos procesos igualmente.

En Linux y macOS lo hace `unix-jobs.mjs`: cada pestaña arranca en su propio grupo de procesos (y en Linux con systemd, además, en un *scope* propio con `systemd-run --user --scope`, que atrapa también lo que se escapa del grupo). Se terminan al cerrar la pestaña y al salir de la app.

Los contenedores de Docker no son procesos de la pestaña: los gestiona Docker Desktop y siguen en marcha.

## Ejecutable e icono

`runtime\Claude Assistant.exe` es el runtime de Electron con nombre e icono propios, para que no aparezca «Electron». Se regenera con:
- `node tools/make-exe.cjs`, tras actualizar Electron;
- `npx electron tools/make-icon.cjs`, si cambias la chispa en `renderer/spark.js` (también genera el icono de macOS, `assets/icon-mac.png`, y el de su barra de menús, `assets/trayTemplate*.png`).

## Copia para Linux (Fedora)

`node tools/build-linux.cjs` genera en `dist/` un AppImage y un rpm **sin presets ni datos personales** (no incluye `personal.mjs`, donde están tus presets y accesos, ni las herramientas de desarrollo), junto con `LEEME-linux.md` para quien lo instale. Compila en un contenedor de Fedora con Docker (Docker Desktop tiene que estar abierto). En Linux, los procesos de cada pestaña van en un scope de systemd (o en un grupo de procesos), el recorte de pantalla con Wayland usa el del escritorio (portal Screenshot), la clave de las cuentas queda en un archivo solo para el usuario, el inicio automático va en `~/.config/autostart`, `Ctrl+V` pega imágenes (con wl-clipboard), en Arch y derivadas se usa el AppImage (con `fuse2`) y la puesta a punto da los comandos de `pacman` y, con Hyprland o Sway, las líneas de atajos y arranque para su configuración y no hay control de aplicaciones de Windows.

## Copia para macOS

`node tools/build-mac.cjs` genera en `dist/` un `.dmg` **sin presets ni datos personales** y `LEEME-mac.md`, la guía de instalación y puesta a punto para quien lo use. Solo se compila **en un Mac** (node-pty se compila allí) y sale para la arquitectura de ese Mac (Apple Silicon o Intel); en Windows solo prepara la copia limpia en `dist/mac-src`. Sin Mac: en GitHub, Actions › «Compilar para macOS» › Run workflow (`.github/workflows/build-mac.yml`) compila las dos y deja los `.dmg` en los artefactos de la ejecución. No lleva firma de Apple (se firma «ad hoc»), así que la primera vez hay que abrirla con «Abrir igualmente» (lo explica la guía).

En macOS: los atajos de la app van con `⌘` y `Ctrl` queda para Claude Code, como en su terminal (`Ctrl+Tab` sigue cambiando de pestaña); botones de ventana nativos a la izquierda, icono en la barra de menús, menú de la app con Edición (copiar, pegar, deshacer), inicio con la sesión, el `PATH` de la shell del usuario (para encontrar `claude`, `git` y Homebrew) y las cuentas en el **Llavero**, que es donde Claude Code guarda allí sus credenciales. Como en Linux, los procesos de cada pestaña van en un grupo de procesos. El control de aplicaciones va con macOS-MCP (permiso de Accesibilidad), el Dock tiene menú (nueva pestaña, ventana con otra cuenta, Configuración), ⌘/ abre los atajos, ⌘G busca el siguiente, ⌥ hace de Meta en la terminal (⌥P, ⌥T, ⌥Enter) y el recorte avisa si falta el permiso de grabación de pantalla.

Desde Windows, `node tools/build-mac.cjs` deja en `dist/mac-src` la carpeta para pasar al Mac, con `instalar.sh` (compila, da permiso al `spawn-helper` de node-pty, firma, prueba la terminal e instala en Aplicaciones) y `INSTALAR-CON-CLAUDE.md` (para que Claude Code en el Mac lo instale y guíe en lo manual). Al pasarla en zip, que sea con barras `/` (`tar -a -c -f x.zip carpeta`), no con `Compress-Archive`.

La copia limpia (Linux y macOS) la prepara `tools/build-src.cjs`: los archivos del repositorio sin `personal.mjs` ni las herramientas de desarrollo; se para si encuentra datos personales.

## Puesta a punto

La primera vez que se abre (sin configuración previa) sale la **puesta a punto**: comprueba Claude Code, la cuenta y la carpeta de trabajo, y si se usa el acceso total, que Claude Code lo tenga aceptado (en un equipo nuevo lo pide una vez y, hasta entonces, la pestaña no contesta: se acepta con un botón y lo escrito se envía al momento). También ofrece lo opcional (inicio automático, modelo de voz, git/gh, Claude in Chrome, WhatsApp; en Linux, wl-clipboard, la bandeja de GNOME y los atajos con Wayland; en macOS, los permisos de micrófono, grabación de pantalla y, si algún preset controla apps, Accesibilidad y uv), con el comando para instalar lo que falte. Se vuelve a abrir desde el menú `⌄` › Puesta a punto.

## Además

- Pestañas como Windows Terminal: `Ctrl+T`, `Ctrl+W`, `Ctrl+Tab`, `Ctrl+1…9`, clic central, arrastrar para reordenar y doble clic para renombrar. Si sueltas una pestaña fuera de la barra, se abre en una ventana nueva con su conversación (sigue trabajando); para devolverla, arrástrala a la barra de otra ventana. Al cerrar una ventana secundaria, sus pestañas vuelven a la principal, y al reiniciar todas se reabren en la principal.
- Arriba a la derecha, el **teclado** (o `F1`, `/help`, o el menú) abre la lista de todos los atajos de la app, incluidos los globales que tengas configurados, y el **engranaje** (o `Ctrl+,`) abre la configuración.
- **Apariencia:** en Configuración › Apariencia, paleta de colores (Claude, Océano, Bosque, Lavanda, Rosa, Ámbar, Grafito o una con el color que elijas, en claro y en oscuro), imagen de fondo difuminada con su visibilidad y su difuminado (se copia a la carpeta de datos, en `fondos`), tamaño del texto del chat, interlineado, ancho de la conversación, márgenes laterales, tipografía de las respuestas (sin serifa, serifa, monoespaciada u otra instalada), de la interfaz (si no eliges otra, la interfaz y lo que escribes van con la de las respuestas) y del código y la terminal, tamaño de la terminal y zoom de toda la interfaz, con vista previa al momento (Cancelar lo deshace). El zoom también va con `Ctrl` + rueda, `Ctrl++`, `Ctrl+-` y `Ctrl+0`.
- **Escribir sin hacer clic en el campo:** con el foco en la página (no en otro campo) y nada seleccionado, lo que teclees va directamente al campo del chat.
- **Buscar en la conversación:** `Ctrl+F` (en la vista de chat) abre una barra arriba a la derecha. No distingue mayúsculas ni tildes, resalta todas las coincidencias y salta entre ellas con `Enter`/`Shift+Enter` o `F3`/`Shift+F3`, desplegando las fichas plegadas que las contengan. `Esc` la cierra.
- **Conversaciones anteriores:** `Ctrl+H`, `/resume` sin argumento o el menú ⌄ abren el historial (no está siempre en pantalla). Muestra primero las de la carpeta de la pestaña; `Tab` cambia entre esa carpeta y todas, y se filtra escribiendo. `Enter` la reabre retomando la conversación con el preset de su carpeta (en la pestaña actual si está sin usar); si ya está abierta, salta a ella.
- **Ventanas marcadas por cuenta (como los perfiles de Chrome):** con varias cuentas guardadas, cada ventana lleva el color de la suya en la barra de título, el icono de Claude en ese color, con su propio botón en la barra de tareas (no se agrupa con las de otras cuentas), y el correo en el título (Alt+Tab, miniaturas). Para abrir una ventana con otra cuenta: menú ⌄ o el de la cuenta › «Nueva ventana con otra cuenta…», el icono de la bandeja › «Nueva ventana con», o clic derecho en el icono de la barra de tareas. El color se cambia en Configuración › Cuenta.
- **Dividir en dos:** `Ctrl+Shift+D` (o el menú ⌄ › «Dividir en dos»). Con la misma cuenta, la ventana se parte en dos mitades, cada una con sus pestañas (la derecha se cierra al cerrar su última pestaña; arrastrando pestañas se pasan de una mitad a otra). Si tienes varias cuentas, pregunta con cuál; con otra, abre una ventana nueva y coloca las dos repartiéndose la pantalla, así cada ventana trabaja con la suya. En el menú de una pestaña, «Mover a la otra mitad» la lleva allí con su conversación. «Colocar las ventanas lado a lado» recoloca todas las abiertas.
- Se inicia con Windows en la bandeja. `Ctrl+Shift+Espacio` muestra u oculta todas sus ventanas a la vez (y vuelve a mostrar las mismas).
- **Asistente por voz desde cualquier aplicación:** `Ctrl+Alt+Espacio` (aunque la ventana esté cerrada en la bandeja). Aparece Claude arriba a la izquierda con un bocadillo que va escribiendo lo que dices. Si no puedes hablar, haz clic en el bocadillo y escribe (`Enter` envía). Al callarte tienes 2,5 s para corregir (clic en el texto; `Enter` envía); si no tocas nada, se envía solo. Trabaja en segundo plano en una pestaña de voz (preset Assist) y la respuesta sale en el bocadillo. Si vuelves a pulsar el atajo en los 55 minutos siguientes, sigue la misma conversación y aprovecha su caché. Por defecto usa Sonnet con effort bajo. `Esc` cancela.
- **Pedir algo de la pantalla:** `Ctrl+Alt+S`. La pantalla se congela y arrastras para recortar la zona que quieres enseñarle, como con Impr. Pant. (un clic sin arrastrar sigue sin imagen, como `Ctrl+Alt+Espacio`; `Esc` o clic derecho cancela). Después sale el mismo bocadillo y el recorte (a 1024 px como mucho) se adjunta a lo que pidas; puedes quitarlo con su ficha. Los dos atajos, el preset, el modelo y el effort se cambian en Configuración › General.
- **WhatsApp en segundo plano:** los presets con WhatsApp activado (Assist) usan WhatsApp Web dentro de la app, en una ventana oculta, para buscar chats, leer, enviar mensajes y enviar archivos sin quitarte el foco. Se vincula una vez escaneando el QR: Configuración › General › WhatsApp en segundo plano › «Vincular o ver» (o desde el icono de la bandeja). Si prefieres verlo trabajar, puede mostrarse en la segunda pantalla. Es una automatización no oficial de WhatsApp Web.
- **Dictado por voz:** el micro junto a «Enviar» (o `Ctrl+M`) graba y, cuando te callas un momento (o lo vuelves a pulsar), transcribe y **envía el mensaje solo**. `Esc` cancela. Usa Whisper (`whisper-small`) en local, gratis y sin que el audio salga del PC. La primera vez descarga el modelo (~550 MB) a `%LOCALAPPDATA%\claude-assistant-whisper`.
- **Varias cuentas de Claude, una por ventana:** el selector de cuenta de la barra superior (la inicial de la cuenta en su color; al pasar el ratón se ve el correo), o `/login`, o Configuración › Cuenta cambia la cuenta **de esa ventana** con un clic, o inicia sesión con otra en el navegador. Así puedes tener una ventana con cada cuenta (saca una pestaña arrastrándola y cámbiale la cuenta); la barra de uso de cada ventana muestra el plan de su cuenta. La cuenta de Claude Code fuera de la app no cambia, salvo con «Hacer principal» (Configuración › Cuenta): esa pasa a ser la de la terminal y la de las ventanas nuevas, y las ventanas que iban con la anterior se pasan a ella (no deja hacerlo mientras alguna de sus pestañas trabaja). Las pestañas de la ventana se relanzan con la nueva cuenta retomando la conversación (las que estén trabajando, al terminar el turno). Si arrastras una pestaña a una ventana con otra cuenta, pregunta antes de cambiarla. Al reiniciar, la ventana conserva su cuenta y todas las pestañas vuelven con ella. Las cuentas se guardan cifradas en `%APPDATA%\claude-assistant\accounts.json` y cada una tiene su perfil en `perfiles\` (comparte con `~/.claude` conversaciones, ajustes y plugins).
- **Barra lateral:** `Ctrl+Shift+E` (o el botón de arriba a la izquierda) la muestra u oculta. Lleva «Nueva pestaña», «Buscar conversaciones» (el historial) y las conversaciones fijadas y recientes agrupadas por preset (cada grupo se pliega y muestra 6, con «Ver más»), con el estado de las que están abiertas. Clic para abrirla o saltar a su pestaña; con los tres puntos o clic derecho: fijar arriba, cambiar nombre, mover a otro grupo o eliminar (va a la papelera del sistema; antes hay que cerrar su pestaña).
- **Menú «+»** junto al cuadro de texto: adjuntar imagen, añadir archivos (se mencionan con `@ruta`), captura de pantalla (recortas una zona como con `Ctrl+Alt+S`; un clic, la pantalla entera), y los submenús **Skills** (escribe `/skill` en el cuadro) y **Conectores** (los de la cuenta de esa ventana; los enciende o apaga solo en esa pestaña: Claude Code se reinicia retomando la conversación, o al terminar el turno si está trabajando). Si un conector solo está conectado en otra de tus cuentas, lo dice al final («En otra@cuenta: Google Drive…») con un atajo para cambiar la cuenta de la ventana.
- **Conectores, skills y plugins:** en Configuración › Conectores ves, con el mismo selector que los presets, los conectores de claude.ai, servidores MCP, skills y plugins de tu Claude Code. Lo que apagues ahí no se carga en ningún preset (ahorras contexto), y cada preset puede cambiarlo para sí en su editor. Los conectores de claude.ai son de cada cuenta: salen en un grupo por cuenta (con su color), y cada pestaña usa los de la cuenta de su ventana. «Conectar más ↗» abre claude.ai en el navegador, que tiene que tener la sesión iniciada con esa cuenta; al volver a la app la lista se actualiza sola. También se añaden servidores MCP (como `claude mcp add-json`) y se quitan.
- **Pestañas en blanco para dudas generales:** las que se abren sin preset arrancan sin conectores, servidores MCP ni plugins (más rápidas y sin gastar contexto en herramientas). Si hace falta uno, se enciende solo en esa pestaña con el «+» del chat › Conectores. Se desactiva en Configuración › Conectores › «Pestañas en blanco sin conectores ni plugins».
- **Tareas programadas** (Configuración › Programadas): a su hora (días de la semana y hora, o cada N minutos), la app abre una pestaña con el preset elegido y le manda el prompt; al terminar avisa y el resultado queda en esa pestaña. Funcionan con la app abierta (también en la bandeja); si estaba cerrada, se lanzan al abrirla, como mucho 12 h después. «Ejecutar ahora» la lanza al momento.
- **Memoria** (Configuración › Memoria): la memoria automática de Claude Code de cada carpeta de trabajo (`MEMORY.md`, el índice que se carga en cada sesión, y un fichero por recuerdo) y tus instrucciones para todas las conversaciones (`~/.claude/CLAUDE.md`), para leerlas, corregirlas (`Ctrl+S` guarda) o borrar recuerdos (a la papelera).
- **Diagramas, fórmulas y vista previa:** los bloques ` ```mermaid ` se dibujan como diagrama y los SVG como imagen (con «Código» para ver el fuente); las fórmulas `$…$` y `$$…$$` (o `\(…\)` y `\[…\]`) salen con KaTeX; y los documentos HTML llevan «Vista previa». Esta, y «Abrir» en diagramas, SVG y documentos Markdown largos, los muestran en un **panel a la derecha del chat**, como los artefactos de claude.ai: Vista / Código, copiar, descargar, abrir en una ventana (HTML) y cerrar; el ancho se cambia arrastrando su borde. El HTML va aislado (sin acceso a la app ni a tus archivos; los enlaces se abren en el navegador). Los enlaces del chat a un servidor de este equipo (`http://localhost:…`) también se abren en ese panel, en vivo (vista previa de una web en desarrollo, del CV…); con Ctrl+clic o el botón ↗, en el navegador.
- **Documentos que Claude edita, a la vista:** cuando Claude crea o cambia un Word, Excel (también CSV y ODS), PowerPoint, PDF, HTML o imagen —escribiéndolo o con un script—, se abre solo en el panel y se actualiza en tiempo real con cada cambio, sin pulsar ningún enlace (los Markdown no se abren solos, pero salen en la lista). El Word se ve como una página, el Excel como una hoja con sus pestañas, barra de fórmulas, selección de celdas con el ratón o las flechas y las fórmulas calculadas aunque el archivo no traiga el resultado (las de los Excel hechos con un script), y el PowerPoint diapositiva a diapositiva. El título del panel despliega los documentos tocados en la conversación; sus botones abren el archivo con su aplicación o en su carpeta, y ⤢ lo pone a todo el ancho. El botón de documentos junto al de la terminal vuelve a abrir el panel si lo cerraste (cerrar un documento evita que se reabra solo). Se desactiva en Configuración › «Vista previa de lo que Claude edita».
- **Editar documentos desde el panel:** el Word se edita en su sitio (cada párrafo, título, elemento de lista o celda de tabla; se guarda solo el texto y se respeta el formato), el Excel y el CSV como en Excel (doble clic, F2 o escribir encima; Intro, Tab y flechas; Supr; copiar y pegar bloques; fórmulas con `=`, que Excel recalcula al abrirlo) y el PDF con pdf.js: escribir texto, dibujar, resaltar y rellenar formularios, con zoom. Los Markdown, HTML y SVG se editan en la pestaña «Código». Se guarda con **Ctrl+S** o el botón de la barra que sale al cambiar algo («Descartar» lo deshace); si el archivo cambia fuera mientras tanto, avisa en vez de pisarlo, y cerrar el panel con cambios sin guardar pide pulsar dos veces. Si Word o Excel tienen el archivo abierto, lo dice. Cada pestaña tiene su propio panel: al cambiar de pestaña se oculta tal cual (sin perder lo que estés editando) y vuelve al volver a ella.
- **Bajo cada respuesta:** copiar, leer en voz alta (con la voz del sistema) y, en la última, reintentar (vuelve al último mensaje, como `/rewind`, y lo manda otra vez).
- **Vista detallada:** `Ctrl+O` despliega todo el trabajo intermedio de la pestaña actual, como el modo detallado de Claude Code; en Configuración › Apariencia › «Vista de la conversación» se elige la de por defecto. Ahí mismo: **tema del código** (Claude, GitHub, Nord, Solarized, Monokai o Dracula) y **reducir movimiento** (sin animaciones).
- **Notificaciones** (Configuración › General): cuándo avisar (al terminar, al preguntar o pedir permiso, al acabar una tarea programada) y si con sonido. Solo cuando la ventana no está delante.
- Al abrir la app empiezas siempre con una pestaña limpia; solo se reabren las pestañas cuando se reinicia para aplicar cambios. Las sesiones quedan en `~/.claude/projects`, así que podrías retomarlas con `claude --resume`.

## Uso

```
npm install
npm start
```

## Estructura

- `main.mjs`: ventana, bandeja, atajo global, configuración e IPC.
- `terminals.mjs`: `claude` en una pseudoconsola por pestaña. `termchat.mjs`: su vista de chat (transcripción + hooks HTTP, cola, permisos, preguntas y planes).
- `mcp-http.mjs`: servidor MCP mínimo por HTTP (WhatsApp para las pestañas).
- `schedules.mjs`: tareas programadas.
- `tests/`: pruebas (`npm test`).
- `renderer/`: interfaz (`app.js`, `styles.css`, `parity.css`; `terminal.js` y `terminal.css` para la terminal).

La configuración está en `%APPDATA%\claude-assistant\config.json`. Los tokens se guardan cifrados con DPAPI.
