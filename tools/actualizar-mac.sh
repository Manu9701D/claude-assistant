#!/bin/bash
# Actualiza Claude Assistant con el .dmg de esta carpeta que corresponde a este Mac, sin compilar nada.
#   bash actualizar.sh
# Vale desde una pestaña de la propia app: deja la instalación preparada y la hace en cuanto se cierra
# la app (⌘Q), que se vuelve a abrir sola. Configuración, presets, cuentas y conversaciones se conservan
# (están fuera de la app: ~/Library/Application Support/claude-assistant, el Llavero y ~/.claude).
set -euo pipefail
cd "$(dirname "$0")"
SRC="$PWD"
APP_NAME="Claude Assistant"
DATA="$HOME/Library/Application Support/claude-assistant"
STAGE="$HOME/Library/Caches/claude-assistant-actualizacion"
LOG="$STAGE/actualizar.log"

step() { printf '\n\033[1;35m▸ %s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { printf '\n\033[1;31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

# ¿Se está ejecutando desde una pestaña de la propia app? Entonces no se puede cerrar sin cortarse a sí mismo
inside_app() {
  [ -n "${CA_ACTUALIZAR_DENTRO:-}" ] && return 0 # (para probarlo)
  local pid=$$
  while [ "${pid:-1}" -gt 1 ]; do
    case "$(ps -o comm= -p "$pid" 2>/dev/null)" in *"$APP_NAME.app/"*) return 0 ;; esac
    pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
  done
  return 1
}

# Fuera de la app: en una sesión propia y colgado de launchd. Al cerrarse, la app termina lo que lanzaron
# sus pestañas (grupos de procesos y descendientes), y esto tiene que sobrevivirle
detach() {
  if command -v perl >/dev/null 2>&1; then
    perl -e 'use POSIX "setsid"; fork and exit; setsid; exec @ARGV' "$@" </dev/null >>"$LOG" 2>&1
  else
    launchctl submit -l "es.claude-assistant.actualizar.$$" -- "$@"
  fi
}

# ---------------------------------------------------------------------------------------------------
step "Versión nueva"
[ "$(uname)" = Darwin ] || fail "Este script es para macOS."
if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = 1 ]; then ARCH=arm64; else ARCH=x64; fi
DMG=$(ls Claude-Assistant-*-mac-"$ARCH".dmg 2>/dev/null | sort -V | tail -1 || true)
[ -n "$DMG" ] || fail "No está el .dmg para este Mac (Claude-Assistant-…-mac-$ARCH.dmg) en $SRC."
ok "$DMG ($([ $ARCH = arm64 ] && echo 'Apple Silicon' || echo Intel))"

mkdir -p "$STAGE"
NEW="$STAGE/$APP_NAME.app"
rm -rf "$NEW"
MNT=$(mktemp -d)
hdiutil attach -nobrowse -readonly -noautoopen -mountpoint "$MNT" "$DMG" -quiet || fail "No se ha podido abrir $DMG (¿descarga incompleta?)."
ditto "$MNT/$APP_NAME.app" "$NEW" || { hdiutil detach "$MNT" -quiet || true; fail "No se ha podido copiar la app del .dmg."; }
hdiutil detach "$MNT" -quiet || true
rmdir "$MNT" 2>/dev/null || true
xattr -dr com.apple.quarantine "$NEW" 2>/dev/null || true
find "$NEW" -name spawn-helper -exec chmod 755 {} +
[ -x "$NEW/Contents/MacOS/$APP_NAME" ] || fail "La app del .dmg está incompleta."
ok "Preparada"

# Donde ya está instalada (si no, en Aplicaciones o, sin permiso, en ~/Applications)
DEST=""
for d in /Applications "$HOME/Applications"; do [ -d "$d/$APP_NAME.app" ] && { DEST="$d/$APP_NAME.app"; break; }; done
if [ -z "$DEST" ]; then
  DEST_DIR=/Applications
  [ -w "$DEST_DIR" ] || { DEST_DIR="$HOME/Applications"; mkdir -p "$DEST_DIR"; }
  DEST="$DEST_DIR/$APP_NAME.app"
fi
[ -w "$(dirname "$DEST")" ] || fail "No se puede escribir en $(dirname "$DEST"): arrastra tú la app del .dmg a Aplicaciones (Reemplazar)."

# El cambio: espera a que la app esté cerrada, la sustituye y la abre
SWAP="while pgrep -xq '$APP_NAME'; do sleep 1; done; sleep 1
rm -rf '$DEST' && ditto '$NEW' '$DEST' && xattr -dr com.apple.quarantine '$DEST' 2>/dev/null
open '$DEST' && rm -rf '$NEW' && echo \"\$(date) actualizada en $DEST\""

step "Instalando"
if pgrep -xq "$APP_NAME" && inside_app; then
  detach /bin/bash -c "$SWAP"
  printf '\n\033[1;33m%s\033[0m\n' "Falta un paso: cierra Claude Assistant del todo (⌘Q). En unos segundos se instala la versión nueva y se abre sola."
  exit 0
fi
if pgrep -xq "$APP_NAME"; then
  osascript -e "quit app \"$APP_NAME\"" >/dev/null 2>&1 || true
  for _ in $(seq 1 20); do pgrep -xq "$APP_NAME" || break; sleep 0.5; done
  pgrep -xq "$APP_NAME" && fail "Claude Assistant sigue abierta: ciérrala (⌘Q) y vuelve a lanzar el script."
fi
/bin/bash -c "$SWAP" >>"$LOG" 2>&1 || fail "No se ha podido instalar: mira $LOG"
ok "Instalada en $DEST"

printf '\n\033[1;32m%s\033[0m\n' "Listo. Claude Assistant está actualizada y se ha abierto."
echo "Configuración y registro de errores: $DATA (errores.log)"
