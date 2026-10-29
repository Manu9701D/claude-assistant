# Claude Assistant para macOS

App de escritorio para trabajar con **Claude Code** en pestañas. Cada pestaña es una sesión real de `claude`
(la misma que en la Terminal), que se ve como un chat o, con un atajo, como la terminal tal cual.
Incluye presets de trabajo, varias cuentas, el uso del plan siempre a la vista, dictado por voz en local,
asistente por voz desde cualquier app, recorte de pantalla y WhatsApp en segundo plano.

---

## Requisitos

| | |
|---|---|
| **macOS** | 12 Monterey o posterior (probada hasta macOS 26 Tahoe) |
| **Mac** | Apple Silicon (M1, M2, M3, M4…) o Intel: hay un `.dmg` para cada uno |
| **Cuenta** | Suscripción de Claude (Pro, Max, Team o Enterprise) o una API key de la consola de Anthropic |
| **Espacio** | ~600 MB para la app; ~550 MB más si usas el dictado por voz |

**¿Qué `.dmg` me bajo?**  menú  › *Acerca de este Mac*. Si en **Chip** pone *Apple M…*, el que termina en
`-mac-arm64.dmg`. Si pone **Procesador** *Intel*, el que termina en `-mac-x64.dmg`.

---

## Instalación (5 minutos)

### 1. Instala Claude Code (recomendado)

Abre la app **Terminal** y pega:

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

Comprueba que está con `claude --version`. Este es el oficial y se actualiza solo.
Si te lo saltas, la app usa una copia que trae dentro, pero no se actualiza.

### 2. Copia la app a Aplicaciones

1. Abre el `.dmg` con doble clic.
2. Arrastra **Claude Assistant** a la carpeta **Aplicaciones** de la misma ventana.
3. Expulsa el disco «Claude Assistant» (botón ⏏ en el Finder).

### 3. Ábrela la primera vez

La app no está firmada por Apple, así que la primera vez macOS la bloquea. Se desbloquea una sola vez:

- **macOS 15 Sequoia o posterior:** abre la app (te dirá que no se puede verificar y pulsa *Hecho*), ve a
  **Ajustes del Sistema › Privacidad y seguridad**, baja hasta *«Claude Assistant» se ha bloqueado…* y pulsa
  **Abrir igualmente**. Confirma con tu contraseña.
- **macOS 12 a 14:** en Aplicaciones, **clic derecho** (o Control + clic) sobre Claude Assistant › **Abrir** › **Abrir**.

Si macOS dice que la app **«está dañada»**, no lo está: es la marca de «descargado de internet». Quítala en la Terminal:

```bash
xattr -dr com.apple.quarantine "/Applications/Claude Assistant.app"
```

A partir de ahí se abre como cualquier otra app (Launchpad, Spotlight o el Dock).

### Sin `.dmg`: desde la carpeta con el código

Si te han pasado la carpeta (o el zip) con el código en vez del `.dmg`, necesitas las *Command Line Tools*
(`xcode-select --install`) y [Node.js](https://nodejs.org) 20 o posterior. Después, en la Terminal:

```bash
cd ruta/a/la/carpeta
bash instalar.sh
```

El script compila la app para tu Mac, comprueba que la terminal interna arranca, la deja en Aplicaciones
y la abre. Para que lo haga Claude Code por ti y te guíe en lo que no pueda hacer él, abre `claude` en esa
carpeta y dile *«Sigue INSTALAR-CON-CLAUDE.md»*.

Compilar necesita unos **2 GB libres** mientras dura (dependencias y Electron). Cuando la app ya esté en
Aplicaciones, la carpeta del código no hace falta: puedes borrarla y recuperas casi 1 GB.

No la abras con `npm start` desde esa carpeta: así no es la app instalada sino un Electron genérico, que se
queda en *Ítems de inicio* como «Electron» y no tiene sus permisos de macOS. Usa siempre `bash instalar.sh`.

---

## Puesta a punto (primer arranque)

Al abrirla por primera vez sale la **puesta a punto**, que comprueba lo necesario y te dice qué falta.
Se vuelve a abrir cuando quieras desde el botón **Menú** de la barra superior (junto al **+** de nueva pestaña) › *Puesta a punto*.

**Imprescindible**

1. **Claude Code**: debe salir en verde con su versión. Si no lo encuentra, instálalo (paso 1), pulsa
   *Volver a comprobar* o *Elegir…* y selecciona `~/.local/bin/claude`.
2. **Cuenta de Claude**: *Iniciar sesión* abre el navegador para entrar con tu suscripción. Si ya habías
   iniciado sesión en Claude Code desde la Terminal, aparece directamente. También puedes usar una API key.
3. **Carpeta de trabajo**: donde se abren las pestañas nuevas (por ejemplo, la carpeta de tus proyectos).
4. **Acceso total**: las pestañas abren Claude Code en modo de acceso total (ejecuta y modifica sin
   preguntar), y Claude Code pide aceptarlo una vez en cada equipo. Pulsa *Aceptar*; si prefieres que
   pregunte antes de actuar, cambia el modo en *Configuración*.

**Opcional**

- **Iniciar con el sistema**: arranca oculta al iniciar sesión, lista para el atajo.
- **Dictado por voz**: descarga una vez el modelo Whisper (~550 MB); después funciona sin conexión.
- **Git** y **GitHub CLI**: `brew install git gh` (con [Homebrew](https://brew.sh)) y luego `gh auth login`.
- **Claude in Chrome** y **WhatsApp**: para los presets que los usen.

Pulsa **Empezar** y ya está.

### Permisos de macOS

La puesta a punto muestra el estado del **micrófono** y de la **grabación de pantalla**: pulsa *Permitir*
y macOS te lo preguntará. Si ya lo habías denegado, el botón es *Abrir Ajustes* y te lleva a su panel.
Todos están en **Ajustes del Sistema › Privacidad y seguridad**.

| Permiso | Para qué | Cómo |
|---|---|---|
| **Micrófono** | Dictado y asistente por voz | *Permitir* en la puesta a punto (o la primera vez que dictes) |
| **Grabación de pantalla** | Recorte de pantalla (⌃⌥S) | *Permitir* en la puesta a punto, activa Claude Assistant en *Grabación de pantalla y audio* y **vuelve a abrir la app** |
| **Accesibilidad** | Control de aplicaciones (presets con *Apps del Mac*) | Sale en la puesta a punto si algún preset lo usa: *Permitir* y activa Claude Assistant en *Accesibilidad* |
| **Notificaciones** | Aviso cuando una pestaña termina o te necesita | Lo pide solo; se cambia en *Ajustes › Notificaciones* |
| **Llavero** | Cambiar de cuenta de Claude | Si al cambiar de cuenta pregunta por «Claude Code-credentials», pulsa **Permitir siempre** |

---

## Primeros pasos

- **Nueva pestaña** (⌘T): eliges un preset o empiezas en blanco, y escribes como en Claude Code.
- **Presets**: perfiles con carpeta, modelo, effort, permisos e instrucciones. Créalos desde
  *Configuración › Presets* o pídeselo a Claude en cualquier pestaña:
  *«créame un preset para la carpeta ~/proyectos/web con Sonnet»*.
- **Chat o terminal**: ⌃º cambia entre la vista de chat y la terminal real de Claude Code.
- **Uso del plan**: la batería de la barra superior es lo que te queda de la sesión de 5 horas; al lado,
  la semana y la cuenta atrás. Clic para el detalle.
- **Cerrar la ventana** (botón rojo) no cierra la app: sigue en la **barra de menús** (la chispa, arriba a la
  derecha) y en el Dock. Para salir del todo, **⌘Q** o *Salir* en el icono de la barra de menús.

### Atajos

Los de la app van con **⌘**; **Ctrl** queda para Claude Code, como en su terminal.

| Atajo | Qué hace |
|---|---|
| ⌘T / ⌘W | Nueva pestaña / cerrar pestaña |
| ⌃Tab / ⌃⇧Tab | Pestaña siguiente / anterior |
| ⌘1…8 / ⌘9 | Ir a esa pestaña / a la última |
| ⌘F | Buscar en la conversación |
| ⌘H | Conversaciones anteriores (en esta app no oculta la ventana) |
| ⌘⇧D | Dividir la ventana en dos |
| ⌘M | Dictar por voz (en esta app no minimiza) |
| ⌘, | Configuración |
| ⌘+ / ⌘− / ⌘0 | Zoom (también pellizcando en el trackpad) |
| ⌃º | Cambiar entre chat y terminal |
| ⌘Enter | Enviar ya lo que hay en cola (interrumpe a Claude), como en Claude Code |
| Esc | Interrumpir a Claude |
| Esc Esc | Con texto, borrarlo; sin texto, volver a un mensaje anterior (/rewind). También el lápiz bajo cada mensaje tuyo: lo devuelve al cuadro para editarlo, aunque Claude esté trabajando |
| ⇧Tab | Cambiar de modo (preguntar → editar → plan → acceso total) |
| ⌘C / ⌘V | Copiar y pegar (también imágenes) |
| ⌃C / ⌃V | En la terminal: interrumpir / pegar una imagen, como en Claude Code |
| F1 | Lista de todos los atajos (o el botón del teclado, arriba a la derecha) |

**Globales** (funcionan con la app oculta; se cambian en *Configuración › General*):

| Atajo | Qué hace |
|---|---|
| ⌃⇧Espacio | Mostrar u ocultar la app |
| ⌃⌥Espacio | Asistente por voz desde cualquier app |
| ⌃⌥S | Recortar la pantalla y preguntar sobre ella |

Para usar ⌘ en un atajo global, escríbelo como `Command+Shift+Space`. Evita ⌃Espacio solo: macOS lo usa
para cambiar de idioma del teclado.

---

## Dónde se guarda todo

| Qué | Dónde |
|---|---|
| Configuración de la app | `~/Library/Application Support/claude-assistant/` |
| Conversaciones | Las de Claude Code: `~/.claude/projects` (también se retoman con `claude --resume`) |
| Cuentas | Llavero de macOS + `accounts.json` cifrado en la carpeta de configuración |
| Modelo de voz | `~/.cache/claude-assistant-whisper/` |
| Registro de errores | `errores.log` en la carpeta de configuración |

## Actualizar

Descarga el `.dmg` nuevo y arrastra la app a Aplicaciones (*Reemplazar*). Con la carpeta del código,
`bash instalar.sh` en la versión nueva, que cierra la anterior y la sustituye. Tu configuración, presets y
conversaciones se conservan. Claude Code se actualiza solo.

## Desinstalar

1. Sal de la app (⌘Q) y arrastra *Claude Assistant* de Aplicaciones a la Papelera.
2. Si quieres borrar también sus datos:
   ```bash
   rm -rf ~/Library/Application\ Support/claude-assistant ~/.cache/claude-assistant-whisper
   ```
   Tus conversaciones y Claude Code (`~/.claude`) no se tocan.

---

## Problemas frecuentes

**«No se puede abrir porque Apple no puede comprobar…» o «está dañada».**
Ver [Ábrela la primera vez](#3-ábrela-la-primera-vez).

**La puesta a punto no encuentra Claude Code.**
Instálalo (paso 1), cierra la app del todo (⌘Q) y ábrela de nuevo. Si sigue sin verlo:
*Elegir…* › `~/.local/bin/claude` (en el selector, ⌘⇧. muestra las carpetas ocultas).

**Lo que escribo se queda «en cola» y Claude no contesta.**
Si en el chat sale *«Claude Code pide confirmar el acceso total»*, acéptalo en *Menú › Puesta a punto ›
Acceso total*: la pestaña sigue sola. Si no, pulsa ⌃º para ver la terminal de esa pestaña: ahí se ve qué
está esperando Claude Code (la primera vez puede pedir elegir tema o iniciar sesión; contéstalo ahí y vuelve con ⌃º). Si pone *No se pudo abrir
Claude Code*, el motivo sale en el chat y en `errores.log`.

**Un atajo global no hace nada.**
Otra app o macOS lo tiene ocupado. Cámbialo en *Configuración › General* (por ejemplo, `Command+Shift+Space`).

**El recorte de pantalla sale en negro o solo con el fondo.**
Falta el permiso de *Grabación de pantalla*: actívalo y vuelve a abrir la app.

**El dictado no oye nada.**
*Ajustes del Sistema › Privacidad y seguridad › Micrófono*: activa Claude Assistant.

**No veo mi cuenta o no deja cambiar de cuenta.**
Inicia sesión desde la app (*Configuración › Cuenta › Iniciar sesión*). Si macOS pregunta por el Llavero,
*Permitir siempre*.

**En *Ítems de inicio* aparece «Electron».**
Es de haberla abierto alguna vez con `npm start` desde la carpeta del código. Quítalo en *Ajustes del
Sistema › General › Ítems de inicio y extensiones* (botón −). La app instalada aparece como Claude Assistant.

**Algo falla y no sabes por qué.**
Mira `~/Library/Application Support/claude-assistant/errores.log`.

---

## Diferencias con la versión de Windows

- El **control de aplicaciones** (presets con *Apps del Mac*: Finder, Mail, Keynote…) usa macOS-MCP en vez
  de Windows-MCP. Necesita [uv](https://docs.astral.sh/uv/) (`brew install uv`) y el permiso de Accesibilidad.
- Los atajos de la app usan ⌘ en vez de Ctrl; además ⌘/ abre la lista de atajos y ⌘G / ⌘⇧G van al
  resultado siguiente / anterior al buscar. En la terminal, ⌥ hace de Meta como en Claude Code
  (⌥P modelo, ⌥T pensamiento, ⌥Enter salto de línea).
- Clic derecho en el icono del Dock: nueva pestaña, nueva ventana con otra cuenta y Configuración.
- Los procesos que lanza cada pestaña van en su propio grupo de procesos y se cierran con la pestaña o al salir.
- **Versión de terminal**: los mismos presets y cuentas desde la Terminal. Necesita Node.js (`brew install node`).
  ```bash
  mkdir -p ~/.local/bin && ln -s "/Applications/Claude Assistant.app/Contents/Resources/app/terminal/ca" ~/.local/bin/ca
  ca             # menú: ↑↓ elegir, Enter aquí, T ventana nueva, M modelo, E effort, R retomar, C cuenta
  ca trabajo     # directo (--resume, --continue, --model, --effort, --dry-run)
  ```
