# Instalar Claude Assistant en este Mac (guía para Claude Code)

> **Para el usuario:** abre la app **Terminal**, entra en esta carpeta y arranca Claude Code:
> ```bash
> cd ~/Downloads/claude-assistant-mac   # o donde la hayas descomprimido
> claude
> ```
> Y dile: **«Sigue INSTALAR-CON-CLAUDE.md»**. Si ya tienes Claude Assistant instalada, hazlo desde la
> **Terminal** de macOS, no desde una pestaña de la app: hay que cerrarla para cambiarla.

---

## Instrucciones para Claude

Vas a instalar o actualizar **Claude Assistant**, una app Electron que muestra sesiones de Claude Code en
pestañas, a partir del código de esta carpeta. Habla con el usuario en **castellano**, con frases cortas.
Haz tú todo lo que puedas desde la terminal. Para lo que solo puede hacer el usuario (ventanas de macOS,
contraseñas, permisos, inicio de sesión), **para y explícale exactamente qué pulsar**. Luego espera a que te
confirme y comprueba que ha funcionado.

Reglas:

- No uses `sudo` salvo que un paso lo diga. Si algo pide la contraseña del Mac, avisa antes al usuario.
- No borres `~/.claude` ni `~/Library/Application Support/claude-assistant`: ahí están sus conversaciones y su configuración.
- Si un paso falla, lee el error, prueba el arreglo de la sección *Problemas* y, si no sale, cuéntaselo al usuario con el mensaje exacto.
- Al terminar cada fase, dile al usuario en una línea qué está hecho y qué viene.

### Fase 1 · Requisitos

Ejecuta:

```bash
bash instalar.sh --check
```

Según lo que falte:

| Falta | Qué haces tú | Qué hace el usuario |
|---|---|---|
| **Command Line Tools de Xcode** | Ejecuta `xcode-select --install` | **Guíale:** sale una ventana; que pulse *Instalar*, acepte la licencia y espere (5-15 min). Te avisa cuando acabe. |
| **Node.js 20+** | Si hay Homebrew (`command -v brew`): `brew install node`. Si no, no instales Homebrew por tu cuenta. | **Guíale:** que descargue el instalador LTS de https://nodejs.org, lo abra y pulse *Continuar* hasta el final (pide la contraseña del Mac). Después, que cierre y vuelva a abrir la Terminal y relance `claude` en esta carpeta. |
| **Claude Code** (aviso, no error) | `curl -fsSL https://claude.ai/install.sh \| bash` | Nada. |

Repite `bash instalar.sh --check` hasta que acabe en *Todo listo para instalar*.

### Fase 2 · Compilar e instalar

```bash
bash instalar.sh
```

Tarda varios minutos: descarga Electron y compila node-pty. Ejecútalo con un tiempo de espera largo
(10 minutos) o en segundo plano y ve mirando la salida. El script:

1. instala las dependencias (`npm install`);
2. compila la app para el procesador de este Mac (`electron-builder --mac dir`);
3. da permiso de ejecución al `spawn-helper` de node-pty. **Esto es lo que fallaba antes:** sin él, ninguna pestaña arrancaba Claude Code y los mensajes se quedaban «en cola»;
4. la firma «ad hoc» (`codesign --sign -`);
5. **prueba que la terminal interna arranca**: tiene que salir `✓ La terminal arranca`;
6. cierra la versión anterior si está abierta, la sustituye en `/Applications` (o `~/Applications`), quita la cuarentena y la abre.

Si sale *«Falta un paso: cierra Claude Assistant del todo (⌘Q)»*, el script se ha lanzado desde una
pestaña de la propia app. **Guíale:** que pulse ⌘Q en Claude Assistant. Se instala sola y se vuelve a abrir.
Esta sesión se cortará en ese momento; es normal.

### Fase 3 · Primera apertura

Como no está firmada por Apple, macOS puede bloquearla la primera vez. Pregunta al usuario si se ha
abierto la ventana de Claude Assistant. Si no:

- **Sale «no se puede verificar» o «Apple no puede comprobar…».** **Guíale:** que pulse *Hecho* y vaya a
  ** › Ajustes del Sistema › Privacidad y seguridad**. Que baje hasta *«Claude Assistant» se ha bloqueado* y
  pulse **Abrir igualmente** (pide la contraseña). En macOS 14 o anterior basta con hacer clic derecho sobre
  la app en Aplicaciones › **Abrir** › **Abrir**.
- **Sale «está dañada».** Ejecuta tú
  `xattr -dr com.apple.quarantine "/Applications/Claude Assistant.app" && open "/Applications/Claude Assistant.app"`.

### Fase 4 · Puesta a punto (la hace el usuario en la app, tú le guías)

Al abrirse sale la **puesta a punto**. Si no sale: botón **Menú** (junto al **+** de la barra superior) › *Puesta a punto*.
Explícale cada punto:

1. **Claude Code** en verde. Si no lo encuentra: *Elegir…* › `~/.local/bin/claude`. En el selector, ⌘⇧. muestra las carpetas ocultas.
2. **Cuenta**: *Iniciar sesión* abre el navegador. Si ya usa Claude Code en la Terminal, sale directamente.
3. **Carpeta de trabajo**: la de sus proyectos.
4. **Acceso total**: *Aceptar*. Las pestañas abren Claude Code en modo de acceso total (ejecuta y modifica sin
   preguntar) y Claude Code exige aceptarlo una vez en cada equipo; **hasta entonces no contesta nada**.
   Explícale qué supone. Si prefiere que pregunte antes de actuar, que cambie el modo en *Configuración*.
5. **Micrófono**: *Permitir* y aceptar el aviso de macOS (para el dictado y el asistente por voz).
6. **Grabación de pantalla**: *Permitir*. Se abre *Ajustes › Privacidad y seguridad › Grabación de pantalla y
   audio*: que active **Claude Assistant**. macOS pedirá **salir y volver a abrir** la app: que acepte.
7. Opcional: *Iniciar con el sistema*, el modelo de voz (~550 MB) y `brew install git gh` + `gh auth login`.
8. **Empezar**.

### Fase 5 · Comprobación final

Pídele que abra una pestaña nueva (⌘T) y escriba `hola`. Debe contestar en unos segundos.

Mientras, mira tú el registro:

```bash
tail -n 30 ~/Library/Application\ Support/claude-assistant/errores.log 2>/dev/null || echo "sin errores"
```

- Si contesta y no hay líneas nuevas de `pestaña:`, **está hecho**. Resúmele lo instalado y recuérdale los atajos básicos: ⌘T pestaña, ⌃º chat/terminal, ⌃⇧Espacio mostrar u ocultar, F1 todos los atajos.
- Si el mensaje se queda **«en cola»**: que pulse **⌃º** para ver la terminal de esa pestaña y te diga qué
  pone. Puede ser una pregunta de Claude Code (acceso total, elegir tema, iniciar sesión): que la
  conteste ahí y vuelva con ⌃º. Revisa también `errores.log` (ver *Problemas*).

---

## Problemas

| Síntoma | Causa y arreglo |
|---|---|
| `posix_spawnp failed` en `errores.log` o en el chat, o *«La terminal interna no arranca»* en el script | Falta el permiso del `spawn-helper`: `find "/Applications/Claude Assistant.app" -name spawn-helper -exec chmod 755 {} +` y vuelve a abrir la app. La versión nueva también lo corrige sola al arrancar. |
| `pestaña: Claude Code no ha puesto su título en 20 s. En pantalla: …` | Claude Code arrancó pero espera algo. El texto que sigue dice qué: login, tema, confianza en la carpeta, actualización… Que lo conteste en la terminal (⌃º). |
| En el chat: *«Claude Code pide confirmar el acceso total»*, o la terminal muestra *Bypass Permissions mode* | Falta aceptar el acceso total: *Menú › Puesta a punto › Acceso total › Aceptar* (las pestañas abiertas siguen solas y envían lo que esperaba). Equivale a `"skipDangerousModePermissionPrompt": true` en `~/.claude/settings.json`. |
| `npm install` falla con `gyp` o `make` | Faltan las Command Line Tools: `xcode-select --install`. Si ya están, `sudo xcode-select --reset` (pide contraseña; avisa antes). |
| `npm install` falla al descargar Electron | Red o proxy. Repite `bash instalar.sh`. |
| `EACCES` al copiar a `/Applications` | El script usa `~/Applications` si no puede escribir en `/Applications`. Díselo al usuario para que la busque ahí. |
| La puesta a punto no encuentra Claude Code | `ls -l ~/.local/bin/claude`. Si no existe, instálalo (Fase 1). Luego, que cierre la app con ⌘Q y la vuelva a abrir. |
| Los acentos o los símbolos salen raros en la terminal | `locale` debe dar UTF-8. La app ya fuerza `LANG=es_ES.UTF-8` si falta. |
| El recorte de pantalla sale negro | Falta *Grabación de pantalla* (Fase 4, punto 6), y hay que volver a abrir la app. |

Datos de la app: `~/Library/Application Support/claude-assistant/` (`config.json`, `errores.log`).
Conversaciones: `~/.claude/projects`. Guía completa para el usuario: `LEEME-mac.md`.
