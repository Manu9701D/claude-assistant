// Copia para Linux (AppImage + rpm), sin datos personales: se prepara en dist/linux-src (ver build-src.cjs)
// y se compila en un contenedor de Fedora con Docker (node-pty se compila allí para Linux). Resultado en dist/.
//   node tools/build-linux.cjs
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ROOT, prepareSource } = require('./build-src.cjs');

const DIST = path.join(ROOT, 'dist');
const SRC = path.join(DIST, 'linux-src');

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', ...opts });

const pkg = prepareSource(SRC, {
  files: [
    '**/*',
    '!out/**',
    // onnxruntime trae binarios de todas las plataformas: solo hace falta el de Linux
    '!node_modules/onnxruntime-node/bin/napi-v*/{darwin,win32}/**',
    '!node_modules/@anthropic-ai/claude-agent-sdk-linux-*-musl/**',
    '!assets/{icon-mac,trayTemplate*}.png',
  ],
  linux: {
    target: ['AppImage', 'rpm'],
    executableName: 'claude-assistant',
    icon: 'assets/icon.png',
    category: 'Development',
    synopsis: 'Claude Code en pestañas',
    maintainer: 'Claude Assistant',
  },
  rpm: { depends: ['libXScrnSaver', 'nss', 'gtk3'] },
});
pkg.build.linux.description = pkg.description;
// Electron lo usa como app_id en Wayland: así GNOME y KDE asocian la ventana a su .desktop (icono y nombre en el dock)
pkg.desktopName = 'claude-assistant.desktop';
fs.writeFileSync(path.join(SRC, 'package.json'), JSON.stringify(pkg, null, 2));

// Compilación en Fedora: se copia dentro del contenedor (node_modules en el disco de Windows sería muy lento)
const script = [
  'set -e',
  'dnf install -y -q nodejs npm gcc-c++ make python3 rpm-build git libxcrypt-compat >/dev/null',
  'cp -r /src /build && cd /build',
  'npm install --no-audit --no-fund',
  'npx electron-builder --linux --x64 --publish never',
  'mkdir -p /src/out && cp out/*.AppImage out/*.rpm /src/out/',
].join('\n');
run('docker', ['run', '--rm', '-v', `${SRC}:/src`, 'fedora:latest', 'bash', '-c', script]);

for (const f of fs.readdirSync(path.join(SRC, 'out'))) fs.copyFileSync(path.join(SRC, 'out', f), path.join(DIST, f));
fs.copyFileSync(path.join(__dirname, 'LEEME-linux.md'), path.join(DIST, 'LEEME-linux.md'));
console.log('\nListo en dist/:', fs.readdirSync(DIST).filter((f) => !f.endsWith('-src')).join(', '));
