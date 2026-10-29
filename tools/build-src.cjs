// Copia del repositorio para empaquetar (Linux y macOS), sin datos personales: los archivos del
// repositorio (también los nuevos aún sin commit) sin personal.mjs, donde están tus presets y accesos,
// ni las herramientas de desarrollo. Escribe su package.json con la configuración de electron-builder.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
// terminal/: solo la versión de Linux y macOS (ca + ca.mjs); la de Windows es de PowerShell
const EXCLUDE = [/^tools\//, /^terminal\/(ca\.ps1|ca\.cmd|accounts-cli\.mjs)$/, /^\.github\//, /^personal\.mjs$/, /^CLAUDE\.md$/, /^README\.md$/, /^jobhelper\.ps1$/, /^package-lock\.json$/, /^\.gitignore$/, /\.ico$/];
// Lo que no puede aparecer en la copia: una expresión regular por línea en tools/personal.txt (no se versiona)
const PERSONAL_FILE = path.join(__dirname, 'personal.txt');
const PERSONAL = fs.existsSync(PERSONAL_FILE)
  ? new RegExp(fs.readFileSync(PERSONAL_FILE, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join('|'), 'i')
  : null;

// dest: carpeta de la copia; build: configuración de electron-builder (sin appId ni productName)
function prepareSource(dest, build) {
  fs.rmSync(dest, { recursive: true, force: true });
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter((f) => f && !EXCLUDE.some((re) => re.test(f)));
  for (const f of files) {
    if (!fs.existsSync(path.join(ROOT, f))) continue; // borrado y aún sin commit
    fs.mkdirSync(path.dirname(path.join(dest, f)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, f), path.join(dest, f));
  }
  // Identificador de la app sin el usuario de Windows
  const mainFile = path.join(dest, 'main.mjs');
  fs.writeFileSync(mainFile, fs.readFileSync(mainFile, 'utf8').replace(/com\.mnldz\.claude-assistant/g, 'app.claude-assistant'));

  const leaks = files.filter((f) => /\.(m?js|cjs|html|css|json|md)$/.test(f) && fs.existsSync(path.join(dest, f)) && PERSONAL && PERSONAL.test(fs.readFileSync(path.join(dest, f), 'utf8')));
  if (leaks.length) { console.error('Hay datos personales en:', leaks.join(', ')); process.exit(1); }

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  delete pkg.devDependencies.rcedit;
  // Electron, la versión exacta del package-lock (también sin node_modules, p. ej. en GitHub Actions)
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  pkg.devDependencies.electron = lock.packages['node_modules/electron'].version;
  pkg.devDependencies['electron-builder'] = '^26.0.0';
  pkg.author = { name: 'Claude Assistant', email: 'claude-assistant@localhost' };
  pkg.homepage = 'https://claude.ai/code';
  pkg.build = {
    appId: 'app.claude-assistant',
    productName: 'Claude Assistant',
    asar: false, // Claude Code, node-pty y onnxruntime se ejecutan desde node_modules
    directories: { output: 'out' },
    ...build,
  };
  fs.writeFileSync(path.join(dest, 'package.json'), JSON.stringify(pkg, null, 2));
  return pkg;
}

module.exports = { ROOT, prepareSource };
