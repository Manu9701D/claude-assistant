// Crea runtime\Claude Assistant.exe: una copia del runtime de Electron con su propio nombre e icono,
// para que en la barra de tareas, Alt+Tab y el Administrador de tareas no salga «Electron».
// Uso: node tools/make-exe.cjs   (repetir tras actualizar Electron o cambiar el icono)
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'node_modules', 'electron', 'dist');
const runtime = path.join(root, 'runtime');
const exe = path.join(runtime, 'Claude Assistant.exe');

(async () => {
  const mod = require('rcedit');
  const rcedit = typeof mod === 'function' ? mod : mod.rcedit || mod.default;
  fs.rmSync(runtime, { recursive: true, force: true });
  fs.cpSync(dist, runtime, { recursive: true });
  fs.renameSync(path.join(runtime, 'electron.exe'), exe);
  const version = require(path.join(root, 'package.json')).version;
  await rcedit(exe, {
    icon: path.join(root, 'assets', 'icon.ico'),
    'file-version': version,
    'product-version': version,
    'version-string': {
      FileDescription: 'Claude Assistant',
      ProductName: 'Claude Assistant',
      InternalName: 'Claude Assistant',
      OriginalFilename: 'Claude Assistant.exe',
      CompanyName: '',
      LegalCopyright: '',
    },
  });
  console.log('creado', exe);
})().catch((e) => { console.error(e); process.exit(1); });
