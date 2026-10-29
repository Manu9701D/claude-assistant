// Cuentas de Claude para ca.ps1: las mismas que guarda la app (accounts.json + accounts.key).
//   node accounts-cli.mjs list        -> JSON con las cuentas (y recuerda la activa)
//   node accounts-cli.mjs use <key>   -> cambia la cuenta activa
import path from 'node:path';
import os from 'node:os';
import { createAccounts } from '../accounts.mjs';

// La misma carpeta de datos que la app (app.getPath('appData') de Electron)
const appData = process.platform === 'win32' ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support')
  : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
const accounts = createAccounts({
  file: path.join(appData, 'claude-assistant', 'accounts.json'),
  legacyDecrypt: () => null, // las de safeStorage solo las lee la app
  claudeExe: () => 'claude',
  env: () => process.env,
});

const [cmd, arg] = process.argv.slice(2);
try {
  if (cmd === 'list') console.log(JSON.stringify(accounts.list()));
  else if (cmd === 'use') console.log(JSON.stringify(accounts.use(arg)));
  else throw new Error('Uso: list | use <key>');
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
