// Linux y macOS: lo que lanza cada pestaña, para terminarlo entero al cerrarla o al salir de la app
// (en Windows lo hace un Job Object: ver jobhelper.ps1).
// - Linux con systemd: cada pestaña va en su propio scope (un cgroup) con systemd-run. Matar el scope
//   alcanza también a lo que se va a otro grupo o sesión (setsid, nohup, servidores con detached).
// - Si no (macOS): el grupo de procesos de la pestaña (node-pty abre una sesión nueva) y los de sus
//   descendientes, que se apuntan justo antes de cerrar Claude Code (después quedarían huérfanos).
import { execFileSync, spawn } from 'node:child_process';

const KILL_AFTER = 3000; // de SIGTERM a SIGKILL

export function createUnixJobs({ log = () => {} } = {}) {
  const tabs = new Map(); // key -> { pids: Set, groups: Set, units: Set }
  const entry = (key) => {
    if (!tabs.has(key)) tabs.set(key, { pids: new Set(), groups: new Set(), units: new Set() });
    return tabs.get(key);
  };

  // ¿Se pueden crear scopes de usuario? Se prueba una vez, al abrir la primera pestaña
  let systemd = null;
  function hasSystemd() {
    if (systemd !== null) return systemd;
    systemd = false;
    if (process.platform !== 'linux') return systemd;
    try {
      execFileSync('systemd-run', ['--user', '--scope', '--quiet', '--collect', 'true'], { stdio: 'ignore', timeout: 5000 });
      systemd = true;
    } catch (e) { log(e); }
    return systemd;
  }

  // El comando de una pestaña, dentro de su scope (systemd-run --scope lo ejecuta en su mismo proceso:
  // el pid, el entorno y la carpeta son los del comando)
  function wrap(key, file, args) {
    if (!hasSystemd()) return { file, args };
    const unit = `claude-assistant-${String(key).replace(/[^\w-]/g, '')}-${Date.now().toString(36)}.scope`;
    entry(key).units.add(unit);
    return { file: 'systemd-run', args: ['--user', '--scope', '--quiet', '--collect', `--unit=${unit}`, file, ...args] };
  }

  // Grupos de los procesos de esas pestañas y de todos sus descendientes (sin el de la app)
  function groupsOf(roots) {
    if (!roots.length) return [];
    let out = '';
    try { out = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,pgid='], { encoding: 'utf8', timeout: 3000 }); } catch { return roots; }
    const rows = out.trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number)).filter((r) => r.length === 3);
    const kids = new Map();
    const pgid = new Map();
    for (const [pid, ppid, g] of rows) {
      if (!kids.has(ppid)) kids.set(ppid, []);
      kids.get(ppid).push(pid);
      pgid.set(pid, g);
    }
    const own = pgid.get(process.pid);
    const seen = new Set();
    const stack = [...roots];
    while (stack.length) {
      const p = stack.pop();
      if (seen.has(p)) continue;
      seen.add(p);
      stack.push(...(kids.get(p) || []));
    }
    return [...new Set([...roots, ...[...seen].map((p) => pgid.get(p))])].filter((g) => g > 1 && g !== own);
  }

  // Antes de cerrar Claude Code: se apuntan los grupos de sus descendientes
  function collect(key) {
    const t = tabs.get(key);
    if (!t || t.units.size) return;
    for (const g of groupsOf([...t.pids])) t.groups.add(g);
  }

  const signal = (g, sig) => { try { process.kill(-g, sig); } catch {} };
  const systemctl = (units, sig) => {
    if (!units.length) return;
    try { spawn('systemctl', ['--user', 'kill', `--signal=${sig}`, ...units], { stdio: 'ignore' }).on('error', () => {}); } catch {}
  };

  function kill(key) {
    const t = tabs.get(key);
    tabs.delete(key);
    if (!t) return 'ok';
    const units = [...t.units];
    const groups = [...new Set([...t.pids, ...t.groups])];
    systemctl(units, 'SIGTERM');
    for (const g of groups) signal(g, 'SIGTERM');
    setTimeout(() => {
      systemctl(units, 'SIGKILL');
      for (const g of groups) signal(g, 'SIGKILL');
    }, KILL_AFTER);
    return 'ok';
  }

  // Al salir de la app: SIGTERM ya y SIGKILL desde un proceso aparte (la app no espera a mandarlo)
  function killAll() {
    if (!tabs.size) return;
    const units = [];
    const roots = [];
    for (const t of tabs.values()) {
      units.push(...t.units);
      if (!t.units.size) roots.push(...t.pids, ...t.groups);
    }
    const groups = groupsOf(roots);
    tabs.clear();
    if (units.length) { try { execFileSync('systemctl', ['--user', 'kill', '--signal=SIGTERM', ...units], { stdio: 'ignore', timeout: 3000 }); } catch {} }
    for (const g of groups) signal(g, 'SIGTERM');
    const later = [
      ...(units.length ? [`systemctl --user kill --signal=SIGKILL ${units.join(' ')}`] : []),
      ...(groups.length ? [`kill -9 ${groups.map((g) => `-${g}`).join(' ')}`] : []),
    ];
    if (!later.length) return;
    try {
      spawn('/bin/sh', ['-c', `sleep ${KILL_AFTER / 1000}; ${later.map((c) => `${c} 2>/dev/null`).join('; ')}`], { detached: true, stdio: 'ignore' }).unref();
    } catch {}
  }

  return {
    add: async (key, pid) => { entry(key).pids.add(pid); return 'ok'; },
    wrap, collect, kill: async (key) => kill(key), killAll,
  };
}
