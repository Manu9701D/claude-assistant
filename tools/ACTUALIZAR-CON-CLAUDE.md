# Actualizar Claude Assistant desde la propia app (guía para Claude)

> **Para el usuario:** guarda esta carpeta donde quieras (por ejemplo, en Descargas). Abre Claude Assistant,
> abre una pestaña nueva (⌘T) y escribe:
>
> **«Actualiza Claude Assistant siguiendo ACTUALIZAR-CON-CLAUDE.md de la carpeta ~/Downloads/Claude Assistant para Mac»**
>
> (cambia la ruta si la has puesto en otro sitio). Tus presets, cuentas y conversaciones se conservan.

---

## Instrucciones para Claude

Estás en una pestaña de **Claude Assistant**, la app que vas a actualizar. Habla con el usuario en
**castellano**, con frases cortas. Haz tú lo que puedas desde la terminal; para lo que solo puede hacer
el usuario (avisos de macOS, cerrar la app), **para y dile exactamente qué pulsar**.

Reglas:

- **No borres ni edites** `~/Library/Application Support/claude-assistant` ni `~/.claude`: ahí están su
  configuración, sus presets, sus cuentas y sus conversaciones. La actualización solo cambia la app.
- No uses `sudo`. No compiles nada: la versión nueva va ya hecha en los `.dmg` de esta carpeta.
- No cierres la app tú (nada de `killall`, `pkill` ni `osascript … quit`): esta sesión corre dentro de ella.

### Paso 1 · Comprobar

```bash
cd "<la carpeta que te ha dicho el usuario>"
ls
uname -m
```

En la carpeta tiene que estar `actualizar.sh` y el `.dmg` de su procesador: `…-mac-arm64.dmg` si `uname -m`
da `arm64` (Apple Silicon), `…-mac-x64.dmg` si da `x86_64` (Intel). Si macOS pregunta si *Claude Assistant*
puede acceder a la carpeta Descargas (o Documentos, o Escritorio), **dile que pulse Permitir**.

Si hay presets propios, tranquilízale: se conservan. Puedes enseñárselos con
`node -e 'const c=require(process.env.HOME+"/Library/Application Support/claude-assistant/config.json");console.log(c.presets.map(p=>p.name).join(", "))'`.

### Paso 2 · Preparar la actualización

```bash
bash actualizar.sh
```

Tarda menos de un minuto. Tiene que acabar en:
*«Falta un paso: cierra Claude Assistant del todo (⌘Q)…»*.

### Paso 3 · Cerrar la app (lo hace el usuario)

Dile: **«Ya está preparada. Pulsa ⌘Q (o Claude Assistant › Salir). En unos segundos se abre sola la
versión nueva. Esta conversación se cortará al cerrarla; es normal. Si al volver quieres comprobar que todo
está bien, ábrela de nuevo desde el panel de conversaciones.»**

Si la app tiene pestañas trabajando y pregunta al salir, que confirme.

---

## Si algo falla

| Síntoma | Qué hacer |
|---|---|
| `No está el .dmg para este Mac` | Falta el `.dmg` de su procesador en la carpeta: que pida la carpeta completa. |
| `No se ha podido abrir … .dmg` | Descarga incompleta o dañada: que lo vuelva a descargar. |
| `No se puede escribir en …` | Que abra el `.dmg` con doble clic y arrastre la app a Aplicaciones (*Reemplazar*), con la app cerrada. |
| Tras ⌘Q no se abre sola en 30 s | Que la abra desde Aplicaciones. Si sigue la versión vieja, mira `~/Library/Caches/claude-assistant-actualizacion/actualizar.log` (desde la Terminal de macOS) y repite con la app cerrada: `bash actualizar.sh`. |
| macOS dice que «no se puede verificar» | ** › Ajustes del Sistema › Privacidad y seguridad** › *Abrir igualmente* (pide la contraseña). |

Al abrirse la versión nueva puede aparecer un preset nuevo, *Mejorar Claude Assistant*: sirve para pedirle
arreglos o mejoras de la propia app. Los suyos siguen igual.
