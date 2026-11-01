// Automejora de las copias para otros (sin personal.mjs): el preset «Mejorar Claude Assistant» trabaja en
// una copia editable del código de la app, <datos>/mejoras/app (con git: la rama «original» es la versión
// instalada y «main», la del usuario), y la prueba y aplica con mejorar/herramienta.mjs. «Aplicar» la congela en
// <datos>/mejoras/aplicada, que es la que arranca boot.mjs (mejoras.json); si no arranca, vuelve a la original.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
export const SELF_ID = 'mejorar-app';
// Lo que no se copia: dependencias (se enlazan), compilaciones y lo que genera la herramienta
const SKIP = new Set(['node_modules', 'out', '.git', 'dist']);

export const selfDir = (dataDir) => path.join(dataDir, 'mejoras', 'app');
export const selfStateFile = (dataDir) => path.join(dataDir, 'mejoras.json');
export const buildId = (appDir) => { try { return JSON.parse(fs.readFileSync(path.join(appDir, 'build.json'), 'utf8')).id; } catch { return 'dev'; } };

export function selfPreset(dataDir) {
  return {
    id: SELF_ID,
    name: 'Mejorar Claude Assistant',
    emoji: '🛠️',
    color: '#d97757',
    description: 'Arregla un problema de la app o añade lo que eches en falta',
    cwd: selfDir(dataDir),
    addDirs: [dataDir],
    model: '',
    effort: '',
    permissionMode: 'acceptEdits',
    chrome: false,
    chromeAsk: false,
    desktop: false,
    whatsapp: false,
    plugins: false,
    instructions: 'Trabajas en el código de Claude Assistant, la app desde la que el usuario habla contigo: una copia editable (la carpeta actual) que, una vez aplicada, sustituye a la instalada. Lee CLAUDE.md antes de nada y sigue su flujo: reproduce el problema en la instancia de pruebas, cambia lo mínimo, compruébalo allí y solo aplica con el visto bueno del usuario. El usuario puede no saber programar: explícale en llano qué pasa y qué vas a hacer.',
    startupPrompt: '',
  };
}

// Copia editable: se crea la primera vez (y si se borra). Cada arranque renueva mejorar/entorno.json, con
// lo que mejorar/herramienta.mjs necesita para abrir la instancia de pruebas y pedir el reinicio.
export async function prepareSelf({ dataDir, appDir, exe, exeArgs, log }) {
  const dir = selfDir(dataDir);
  const build = buildId(appDir);
  try {
    if (!fs.existsSync(path.join(dir, 'main.mjs'))) {
      await fs.promises.mkdir(dir, { recursive: true });
      await copySource(appDir, dir);
      await fs.promises.writeFile(path.join(dir, '.gitignore'), 'node_modules\nmejorar/entorno.json\nmejorar/ca\nmejorar/ca.cmd\n*.log\n');
      // Sin git funciona igual, pero sin historial (ni «actualizar» ni «parche»)
      try {
        await git(dir, ['init', '-q', '-b', 'main']).catch(() => git(dir, ['init', '-q']).then(() => git(dir, ['checkout', '-q', '-b', 'main'])));
        await git(dir, ['config', 'user.name', 'Claude Assistant']);
        await git(dir, ['config', 'user.email', 'claude-assistant@localhost']);
        await git(dir, ['config', 'core.autocrlf', 'false']);
        await git(dir, ['add', '-A']);
        await git(dir, ['commit', '-q', '-m', `Versión original (${build})`]);
        await git(dir, ['branch', 'original']);
      } catch (e) { log?.('mejoras: git', e); }
    }
    // node_modules: enlace a los de la app instalada (boot.mjs lo rehace si su ruta cambia)
    const link = path.join(dir, 'node_modules');
    let ok = false;
    try { ok = fs.realpathSync(link) === fs.realpathSync(path.join(appDir, 'node_modules')); } catch {}
    if (!ok) {
      // unlink: rmSync con recursive, en Windows, vaciaría la carpeta a la que apunta el junction
      const st = (() => { try { return fs.lstatSync(link); } catch { return null; } })();
      if (st?.isSymbolicLink()) fs.unlinkSync(link);
      else if (st) fs.rmSync(link, { recursive: true, force: true });
      fs.symlinkSync(path.join(appDir, 'node_modules'), link, process.platform === 'win32' ? 'junction' : 'dir');
    }
    // Envoltorios para ejecutar la herramienta con el Node que trae la app (el usuario puede no tener Node).
    // La herramienta es la de la app instalada: la de la copia se queda en la versión con la que se creó
    const tool = path.join(dir, 'mejorar');
    const script = path.join(appDir, 'mejorar', 'herramienta.mjs');
    await fs.promises.mkdir(tool, { recursive: true });
    await fs.promises.writeFile(path.join(tool, 'entorno.json'), JSON.stringify({ exe, exeArgs, original: appDir, data: dataDir, build, platform: process.platform }, null, 2));
    if (process.platform === 'win32') {
      await fs.promises.writeFile(path.join(tool, 'ca.cmd'), `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\nset "CA_SELF_DIR=%~dp0.."\r\n"${exe}" "${script}" %*\r\n`);
    } else {
      await fs.promises.writeFile(path.join(tool, 'ca'), `#!/bin/sh\nCA_SELF_DIR="$(dirname "$0")/.." ELECTRON_RUN_AS_NODE=1 exec "${exe}" "${script}" "$@"\n`, { mode: 0o755 });
    }
  } catch (e) {
    log?.('mejoras', e);
  }
}

async function copySource(from, to) {
  for (const entry of await fs.promises.readdir(from, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    await fs.promises.cp(path.join(from, entry.name), path.join(to, entry.name), { recursive: true, dereference: true });
  }
  // Las instrucciones del preset, en la raíz como CLAUDE.md (Claude Code las lee solo)
  const guide = path.join(to, 'mejorar', 'CLAUDE.md');
  if (fs.existsSync(guide)) await fs.promises.copyFile(guide, path.join(to, 'CLAUDE.md'));
}

const git = (cwd, args) => run('git', args, { cwd, windowsHide: true, timeout: 60000 });
