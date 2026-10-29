# Claude Assistant para Linux

App de escritorio con pestañas para Claude Code: cada pestaña es una sesión de `claude`, con vista de chat
o terminal, presets, varias cuentas, uso del plan, dictado por voz (Whisper local), WhatsApp y atajos globales.

## Instalar

**rpm (Fedora):**

```bash
sudo dnf install ./claude-assistant-*.x86_64.rpm
```

Aparece en el menú de aplicaciones como «Claude Assistant».

**AppImage (sin instalar):**

```bash
chmod +x Claude-Assistant-*.AppImage
./Claude-Assistant-*.AppImage
```

Si no abre, instala FUSE: `sudo dnf install fuse fuse-libs` (en Arch, `sudo pacman -S fuse2`).

## Primer arranque

Se abre una **puesta a punto** que comprueba lo necesario y te dice qué falta (se vuelve a abrir desde el menú ⌄ › Puesta a punto):

- **Claude Code**: la app trae uno, pero conviene el oficial, que se actualiza solo:
  `curl -fsSL https://claude.ai/install.sh | bash`
- **Cuenta**: inicia sesión con tu suscripción de Claude (Pro, Max, Team) o pon una API key.
- **Carpeta de trabajo** donde se abren las pestañas nuevas.
- Opcional: dictado por voz (descarga ~550 MB una vez), `sudo dnf install wl-clipboard` para pegar
  imágenes con Ctrl+V, `git` y `gh`, Claude in Chrome y WhatsApp.

Después, crea tus **presets** (carpeta, modelo, instrucciones…) desde «Crear mi primer preset» o en Configuración › Presets, o pídeselo a Claude en cualquier pestaña («créame un preset para la carpeta ~/proyecto con Sonnet»).

## GNOME

- **Bandeja**: GNOME no la muestra sin la extensión AppIndicator:
  `sudo dnf install gnome-shell-extension-appindicator`, actívala en Extensiones y cierra sesión.
- **Atajos globales** (mostrar la app, voz, recorte) con Wayland: GNOME no deja a las aplicaciones capturar
  teclas fuera de su ventana, así que la app los da de alta ella misma en Configuración › Teclado ›
  Atajos personalizados («Claude Assistant · …») y los actualiza cuando los cambias en la app.
  Cada uno lanza `claude-assistant --toggle`, `--voice` o `--snip`, que llegan a la app abierta
  (también puedes usar esas órdenes en tus propios atajos o scripts).

## Arch Linux (y Manjaro, EndeavourOS, CachyOS…)

- Usa el **AppImage** (el rpm es para Fedora). Necesita `fuse2`: `sudo pacman -S fuse2`.
- La puesta a punto detecta Arch y da los comandos con `pacman`. Los paquetes con otro nombre:
  GitHub CLI es `github-cli` y PyGObject (para el recorte con Wayland) es `python-gobject`, que en Arch
  no viene instalado.
- Claude Code se instala en `~/.local/bin`, que Arch no pone en el PATH: la app lo encuentra igual, pero para
  usar `claude` o `ca` en la terminal añade `export PATH="$HOME/.local/bin:$PATH"` a `~/.bashrc` (o `~/.zshrc`).
- **Hyprland y Sway** no dejan a las aplicaciones registrar atajos globales ni leen `~/.config/autostart`:
  la puesta a punto te da las líneas para tu configuración, por ejemplo en `~/.config/hypr/hyprland.conf`:
  ```
  bind = CTRL SHIFT, SPACE, exec, "/ruta/Claude-Assistant.AppImage" --toggle
  bind = CTRL ALT, SPACE, exec, "/ruta/Claude-Assistant.AppImage" --voice
  bind = CTRL ALT, S, exec, "/ruta/Claude-Assistant.AppImage" --snip
  exec-once = "/ruta/Claude-Assistant.AppImage" --hidden
  ```
  (en Sway: `bindsym Ctrl+Shift+space exec …` y `exec … --hidden`). La bandeja necesita el módulo `tray` de
  Waybar, y el recorte, un portal con captura (`xdg-desktop-portal-hyprland` o `xdg-desktop-portal-wlr`).
- KDE Plasma pide permiso para los atajos globales la primera vez; GNOME funciona como en Fedora.
- `ca` abre la ventana nueva (tecla T) en la terminal de `$TERMINAL` o, si no, en la primera que encuentre
  (Ptyxis, Consola de GNOME, Konsole, kitty, Alacritty, foot, Ghostty, WezTerm…).

## Datos

- Configuración: `~/.config/claude-assistant/`
- Conversaciones: las de Claude Code, en `~/.claude/projects`
- Modelo de voz: `~/.cache/claude-assistant-whisper/`

## Recorte de pantalla con Wayland

Con Wayland ninguna aplicación puede ver la pantalla por su cuenta: el atajo de recorte abre el **recorte del
propio escritorio** (el de GNOME, KDE…), eliges la zona y la app la adjunta a lo que pidas por voz. La captura
no se queda guardada en Imágenes. Necesita `python3` con `gi` (en Fedora y Ubuntu viene instalado); si no está,
se usa el recorte de la app, que con Wayland pide elegir la pantalla cada vez.

## Versión de terminal

Los mismos presets y cuentas desde cualquier terminal, con el `claude` de siempre. Necesita Node.js
(`sudo dnf install nodejs`, `sudo pacman -S nodejs`…). Con el rpm, la app está en `/opt/Claude Assistant/resources/app`:

```bash
ln -s "/opt/Claude Assistant/resources/app/terminal/ca" ~/.local/bin/ca   # una vez
ca                 # menú: ↑↓ elegir, Enter aquí, T ventana nueva, M modelo, E effort, R retomar, C cuenta
ca trabajo         # directo (--resume, --continue, --model, --effort, --dry-run)
```

## Diferencias con la versión de Windows

- No hay **control de aplicaciones** (manejar otros programas): Wayland no deja a una aplicación leer ni
  pulsar en las ventanas de otras. El resto de presets (carpeta, Chrome, WhatsApp, plugins…) es igual.
- Los procesos de cada pestaña van en su propio *scope* de systemd (o en su grupo de procesos si no hay
  systemd) y se cierran con la pestaña o al salir de la app, también los que se lanzan en segundo plano.
- La clave de las cuentas queda en un archivo que solo puede leer tu usuario (en Windows la protege DPAPI).
- El asistente por voz aparece donde lo coloque el escritorio: Wayland no deja elegir la posición ni ponerlo
  por encima de todo.
