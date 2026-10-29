// Aplica a la app en uso lo que hay en la copia de pruebas y le pide que se reinicie.
//   node tools/apply.cjs "Qué cambia"
// Guarda los cambios en un commit de la rama dev, los pasa a main (la app en uso), los sube a GitHub y avisa a la app,
// que pregunta antes de reiniciarse. Si la versión nueva no arranca, vuelve sola a la anterior.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { git, DEV_DIR, PROD_DIR, PROD_DATA, runningPid, requestRestart } = require('./common.cjs');

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (DEV_DIR === PROD_DIR) fail('Ejecuta esto desde la copia de pruebas (claude-assistant-dev), no desde la app en uso.');
const message = process.argv.slice(2).join(' ').trim() || 'Cambios desde Optimizaciones';

// 1. Que al menos se pueda cargar: errores de sintaxis en el código principal
const files = [...fs.readdirSync(DEV_DIR).filter((f) => /\.(mjs|cjs)$/.test(f)),
  ...fs.readdirSync(path.join(DEV_DIR, 'renderer')).filter((f) => f.endsWith('.js')).map((f) => `renderer/${f}`),
  ...fs.readdirSync(path.join(DEV_DIR, 'tools')).filter((f) => f.endsWith('.cjs')).map((f) => `tools/${f}`)];
for (const f of files) {
  try { execFileSync(process.execPath, ['--check', path.join(DEV_DIR, f)], { stdio: 'pipe' }); }
  catch (e) { fail(`Error de sintaxis en ${f}; no se aplica nada.\n${e.stderr}`); }
}

// 2. Commit en dev
git(DEV_DIR, 'add', '-A');
try { git(DEV_DIR, 'diff', '--cached', '--quiet'); }
catch { git(DEV_DIR, 'commit', '-q', '-m', message); }

// 3. La app en uso no debe tener cambios sueltos
const dirty = git(PROD_DIR, 'status', '--porcelain');
if (dirty) fail(`La app en uso (${PROD_DIR}) tiene cambios sin commit; no se aplica nada:\n${dirty}`);

// 4. dev debe contener main para poder avanzar main sin mezclas
try { git(DEV_DIR, 'merge-base', '--is-ancestor', 'main', 'HEAD'); }
catch {
  try { git(DEV_DIR, 'rebase', 'main'); }
  catch { try { git(DEV_DIR, 'rebase', '--abort'); } catch {} fail('main tiene cambios que chocan con los de dev; resuélvelo con un rebase de dev sobre main.'); }
}

const prev = git(PROD_DIR, 'rev-parse', 'HEAD');
if (prev === git(DEV_DIR, 'rev-parse', 'HEAD')) {
  console.log('No hay cambios nuevos que aplicar.');
  process.exit(0);
}
git(PROD_DIR, 'merge', '-q', '--ff-only', 'dev');
console.log(`Aplicado a la app en uso:\n${git(PROD_DIR, 'log', '--oneline', `${prev}..HEAD`)}`);

// 5. Dependencias nuevas
if (git(PROD_DIR, 'diff', '--name-only', prev, 'HEAD', '--', 'package-lock.json')) {
  console.log('Han cambiado las dependencias: npm install en la app en uso…');
  execFileSync('npm', ['install'], { cwd: PROD_DIR, stdio: 'inherit', shell: true });
}

// 6. Aviso a la app para que se reinicie (con el commit anterior por si hay que volver)
fs.writeFileSync(path.join(PROD_DATA, 'update.json'), JSON.stringify({ prev, at: Date.now() }));
if (runningPid(PROD_DATA)) {
  requestRestart(PROD_DATA, 'offer');
  console.log('Aviso enviado: la app pregunta antes de reiniciarse y reabre las pestañas.');
} else {
  console.log('La app no está abierta: usará los cambios la próxima vez que se abra.');
}

// 7. Copia en GitHub (si hay remoto); si falla, solo se avisa
if (git(DEV_DIR, 'remote')) {
  try { git(DEV_DIR, 'push', '-q', 'origin', 'main', 'dev'); console.log('Subido a GitHub (main y dev).'); }
  catch (e) { console.log(`No se pudo subir a GitHub; se hará en el siguiente apply o con git push.\n${e.stderr || e.message}`); }
}
