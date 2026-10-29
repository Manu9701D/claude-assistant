#!/bin/bash
# Compila e instala (o actualiza) Claude Assistant en este Mac desde la carpeta en la que está este script.
#   bash instalar.sh            compila, instala en Aplicaciones y la abre
#   bash instalar.sh --check    solo comprueba los requisitos
# La configuración, los presets y las conversaciones se conservan al actualizar.
set -euo pipefail
cd "$(dirname "$0")"
SRC="$PWD"
APP_NAME="Claude Assistant"
DATA="$HOME/Library/Application Support/claude-assistant"

step() { printf '\n\033[1;35m▸ %s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
fail() { printf '\n\033[1;31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

# ¿Se está ejecutando desde una pestaña de la propia app? Entonces no se puede cerrar sin cortarse a sí mismo
inside_app() {
  local pid=$$
  while [ "${pid:-1}" -gt 1 ]; do
    case "$(ps -o comm= -p "$pid" 2>/dev/null)" in *"$APP_NAME.app/"*) return 0 ;; esac
    pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
  done
  return 1
}

# ---------------------------------------------------------------------------------------------------
step "Requisitos"
[ "$(uname)" = Darwin ] || fail "Este script es para macOS."
[ -f package.json ] && [ -f main.mjs ] || fail "Ejecútalo dentro de la carpeta descomprimida (donde están package.json y main.mjs)."

MACOS=$(sw_vers -productVersion)
[ "${MACOS%%.*}" -ge 12 ] || fail "Hace falta macOS 12 o posterior (tienes $MACOS)."
ok "macOS $MACOS"

if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = 1 ]; then ARCH=arm64; else ARCH=x64; fi
ok "Procesador: $([ $ARCH = arm64 ] && echo 'Apple Silicon' || echo Intel)"

xcode-select -p >/dev/null 2>&1 || fail "Faltan las herramientas de línea de comandos de Xcode. Ejecuta:  xcode-select --install
  (se abre una ventana: pulsa Instalar y espera a que termine), y vuelve a lanzar este script."
ok "Command Line Tools de Xcode"

command -v node >/dev/null 2>&1 || fail "Falta Node.js 20 o posterior: descárgalo de https://nodejs.org (LTS) o  brew install node"
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] || fail "Node.js $(node -v) es antiguo: hace falta la 20 o posterior (https://nodejs.org)."
ok "Node.js $(node -v)"

CLAUDE=$(command -v claude 2>/dev/null || true)
[ -z "$CLAUDE" ] && [ -x "$HOME/.local/bin/claude" ] && CLAUDE="$HOME/.local/bin/claude"
if [ -n "$CLAUDE" ]; then ok "Claude Code $("$CLAUDE" --version 2>/dev/null | head -1)"
else warn "Claude Code no está instalado (la app usará la copia que trae, que no se actualiza). Recomendado:
    curl -fsSL https://claude.ai/install.sh | bash"; fi

[ "${1:-}" = "--check" ] && { printf '\nTodo listo para instalar.\n'; exit 0; }

# ---------------------------------------------------------------------------------------------------
step "Instalando dependencias (unos minutos la primera vez)"
npm install --no-audit --no-fund

step "Compilando la app ($ARCH)"
rm -rf out
# Sin recompilar node-pty: trae binarios para Mac (N-API, valen para Electron) y así no dependemos de las
# Command Line Tools, que a veces no casan con su propio SDK y el enlazado falla
npx --yes electron-builder --mac dir "--$ARCH" --publish never -c.npmRebuild=false
BUILT=$(find "$SRC/out" -maxdepth 2 -name "$APP_NAME.app" -type d | head -1)
[ -n "$BUILT" ] || fail "No se ha generado la app: mira los mensajes de arriba."

# node-pty trae su spawn-helper sin permiso de ejecución: sin él, ninguna pestaña arranca Claude Code
find "$BUILT" -name spawn-helper -exec chmod 755 {} +
# Firma «ad hoc»: lo mínimo para que Apple Silicon la abra (electron-builder cambia el Info.plist)
codesign --force --deep --sign - "$BUILT"
ok "Compilada y firmada: $BUILT"

step "Probando la terminal interna (node-pty)"
PTY_OUT=$(ELECTRON_RUN_AS_NODE=1 "$BUILT/Contents/MacOS/$APP_NAME" -e '
  const pty = require(process.argv[1]);
  let out = "";
  const p = pty.spawn("/bin/sh", ["-c", "echo pty-ok; sleep 0.3"], { cols: 80, rows: 10, env: process.env });
  p.onData((d) => (out += d));
  p.onExit(() => setTimeout(() => { console.log(out.trim()); process.exit(0); }, 200));
  setTimeout(() => { console.log("timeout"); process.exit(1); }, 5000);
' "$BUILT/Contents/Resources/app/node_modules/node-pty" 2>&1 || true)
case "$PTY_OUT" in *pty-ok*) ok "La terminal arranca" ;; *) fail "La terminal interna no arranca:
$PTY_OUT" ;; esac

# ---------------------------------------------------------------------------------------------------
step "Instalando en Aplicaciones"
DEST_DIR=/Applications
[ -w "$DEST_DIR" ] || { DEST_DIR="$HOME/Applications"; mkdir -p "$DEST_DIR"; }
DEST="$DEST_DIR/$APP_NAME.app"

install_app() {
  rm -rf "$DEST"
  ditto "$BUILT" "$DEST"
  xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true
}

if pgrep -xq "$APP_NAME"; then
  if inside_app; then
    # Se cambia en cuanto se cierre la app, y se vuelve a abrir sola
    LOG="$SRC/instalar.log"
    nohup bash -c "while pgrep -xq '$APP_NAME'; do sleep 1; done; rm -rf '$DEST'; ditto '$BUILT' '$DEST'; xattr -dr com.apple.quarantine '$DEST' 2>/dev/null; open '$DEST'" >"$LOG" 2>&1 &
    disown
    printf '\n\033[1;33m%s\033[0m\n' "Falta un paso: cierra Claude Assistant del todo (⌘Q). En cuanto se cierre se instala la versión nueva y se abre sola."
    exit 0
  fi
  osascript -e "quit app \"$APP_NAME\"" >/dev/null 2>&1 || true
  for _ in $(seq 1 20); do pgrep -xq "$APP_NAME" || break; sleep 0.5; done
  pgrep -xq "$APP_NAME" && fail "Claude Assistant sigue abierta: ciérrala (⌘Q) y vuelve a lanzar el script."
fi
install_app
ok "Instalada en $DEST"
open "$DEST"

printf '\n\033[1;32m%s\033[0m\n' "Listo. Claude Assistant está en $DEST_DIR y se ha abierto."
echo "Configuración y registro de errores: $DATA (errores.log)"
