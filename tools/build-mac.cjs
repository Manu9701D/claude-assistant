// Copia para macOS (.dmg), sin datos personales: se prepara en dist/mac-src (ver build-src.cjs) y se
// compila en un Mac (node-pty se compila allí). Sale para la arquitectura de ese Mac: Apple Silicon
// (arm64) o Intel (x64). Desde Windows, la acción «Compilar para macOS» de GitHub Actions hace las dos.
//   node tools/build-mac.cjs
// Sin firma de Apple: se firma «ad hoc» (lo mínimo para que arranque en Apple Silicon) y la primera vez
// hay que abrirla con clic derecho › Abrir (ver LEEME-mac.md).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ROOT, prepareSource } = require('./build-src.cjs');

const DIST = path.join(ROOT, 'dist');
const SRC = path.join(DIST, 'mac-src');
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';

const pkg = prepareSource(SRC, {
  files: [
    '**/*',
    '!out/**',
    // onnxruntime trae binarios de todas las plataformas: solo hace falta el de macOS
    '!node_modules/onnxruntime-node/bin/napi-v*/{linux,win32}/**',
    '!assets/icon.ico',
  ],
  mac: {
    target: 'dir', // el .dmg se hace abajo, después de firmar
    icon: 'assets/icon-mac.png',
    category: 'public.app-category.developer-tools',
    identity: null,
    hardenedRuntime: false,
    darkModeSupport: true,
    extendInfo: {
      NSMicrophoneUsageDescription: 'Claude Assistant usa el micrófono para el dictado por voz (se transcribe en tu Mac).',
    },
  },
});

// Para compilarla en el Mac sin el repositorio: bash instalar.sh (o pidiéndoselo a Claude Code con INSTALAR-CON-CLAUDE.md)
fs.copyFileSync(path.join(__dirname, 'instalar-mac.sh'), path.join(SRC, 'instalar.sh'));
fs.chmodSync(path.join(SRC, 'instalar.sh'), 0o755);
for (const f of ['LEEME-mac.md', 'INSTALAR-CON-CLAUDE.md']) fs.copyFileSync(path.join(__dirname, f), path.join(SRC, f));

if (process.platform !== 'darwin') {
  console.log(`\nCopia limpia preparada en ${path.relative(ROOT, SRC)}, pero el .dmg solo se puede compilar en un Mac:`);
  console.log('  · con esa carpeta en el Mac:  bash instalar.sh  (compila e instala en Aplicaciones)');
  console.log('  · en un Mac: clona el repositorio y ejecuta  node tools/build-mac.cjs');
  console.log('  · o en GitHub: Actions › «Compilar para macOS» › Run workflow (Apple Silicon e Intel)');
  process.exit(0);
}

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: SRC, stdio: 'inherit', ...opts });
run('npm', ['install', '--no-audit', '--no-fund']);
run('npx', ['electron-builder', '--mac', `--${arch}`, '--publish', 'never']);

const outDir = fs.readdirSync(path.join(SRC, 'out')).map((d) => path.join(SRC, 'out', d)).find((d) => fs.existsSync(path.join(d, 'Claude Assistant.app')));
const appDir = path.join(outDir, 'Claude Assistant.app');
// El spawn-helper de node-pty (con el que arranca cada terminal) a veces llega sin permiso de ejecución
run('find', [appDir, '-name', 'spawn-helper', '-exec', 'chmod', '755', '{}', '+']);
// electron-builder cambia el nombre y el Info.plist de Electron: sin volver a firmar, Apple Silicon no lo abre
run('codesign', ['--force', '--deep', '--sign', '-', appDir]);

// .dmg con la app y un acceso a Aplicaciones, para arrastrarla
const stage = path.join(SRC, 'out', 'dmg');
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
run('ditto', [appDir, path.join(stage, 'Claude Assistant.app')]);
fs.symlinkSync('/Applications', path.join(stage, 'Aplicaciones'));
fs.mkdirSync(DIST, { recursive: true });
const dmg = path.join(DIST, `Claude-Assistant-${pkg.version}-mac-${arch}.dmg`);
run('hdiutil', ['create', '-volname', 'Claude Assistant', '-srcfolder', stage, '-ov', '-format', 'UDZO', dmg]);

fs.copyFileSync(path.join(__dirname, 'LEEME-mac.md'), path.join(DIST, 'LEEME-mac.md'));
console.log(`\nListo: ${path.relative(ROOT, dmg)} y dist/LEEME-mac.md`);
