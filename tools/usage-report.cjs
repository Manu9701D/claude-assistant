// Cuánto gasta la app frente a la terminal por cada 1 % de la ventana de 5 h.
//
//   node tools/usage-report.cjs [días=7] [--dev]
//
// La app apunta en usage-log.jsonl el % de la ventana de 5 h cada vez que cambia (es el % de toda
// la cuenta, no solo de la app). Entre dos lecturas seguidas, se suman los tokens de los
// transcripts de ~/.claude/projects de ese intervalo, separados en app (entrypoint sdk-*) y
// terminal (cli). Los intervalos en los que solo trabajó una de las dos dicen cuántos tokens
// cuesta a cada una subir un 1 %. Los tokens se ponderan por su precio relativo: entrada ×1,
// escritura en caché ×2, lectura de caché ×0,1 y salida ×5 («tokens equivalentes»).
// Contexto: https://github.com/anthropics/claude-code/issues/97074 mide ~1,8× más gasto de
// ventana por token en modo SDK que en la terminal interactiva.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { PROD_DATA, DEV_DATA } = require('./common.cjs');

const days = Number(process.argv.find((a) => /^\d+$/.test(a)) || 7);
const since = Date.now() - days * 864e5;
const logFile = path.join(process.argv.includes('--dev') ? DEV_DATA : PROD_DATA, 'usage-log.jsonl');

// Lecturas del % de la ventana de 5 h
const readings = [];
for (const line of (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '').split('\n')) {
  let e;
  try { e = JSON.parse(line); } catch { continue; }
  if (e.at < since) continue;
  if (e.kind === 'poll' && e.session != null) readings.push({ at: e.at, pct: e.session, resetsAt: String(e.resetsAt || '') });
  else if (e.kind === 'rate' && e.type === 'five_hour') readings.push({ at: e.at, pct: e.utilization <= 1 ? e.utilization * 100 : e.utilization, resetsAt: String(e.resetsAt || '') });
}
readings.sort((a, b) => a.at - b.at);
if (readings.length < 2) {
  console.log(`Aún no hay lecturas suficientes en ${logFile}. Usa la app un tiempo y vuelve a probar.`);
  process.exit(0);
}

// Llamadas al modelo de los transcripts: momento, origen y tokens equivalentes
const calls = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.jsonl') && fs.statSync(p).mtimeMs >= since) {
      const seen = new Set();
      let entry = null;
      for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
        if (!line.includes('"usage"') && !line.includes('"entrypoint"')) continue;
        let j;
        try { j = JSON.parse(line); } catch { continue; }
        entry ||= j.entrypoint;
        const m = j.message;
        if (j.type !== 'assistant' || !m?.usage || seen.has(m.id)) continue;
        seen.add(m.id);
        const at = Date.parse(j.timestamp);
        if (at < since) continue;
        const u = m.usage;
        const eq = (u.input_tokens || 0) + 2 * (u.cache_creation_input_tokens || 0) + 0.1 * (u.cache_read_input_tokens || 0) + 5 * (u.output_tokens || 0);
        const who = (j.entrypoint || entry || '').startsWith('sdk') ? 'app' : 'terminal';
        calls.push({ at, who, eq, model: m.model || '?' });
      }
    }
  }
})(path.join(os.homedir(), '.claude', 'projects'));
calls.sort((a, b) => a.at - b.at);

// Intervalos entre lecturas de la misma ventana en los que el % subió
const acc = { app: { eq: 0, pct: 0, models: {} }, terminal: { eq: 0, pct: 0, models: {} } };
let mixed = 0;
for (let i = 1; i < readings.length; i++) {
  const a = readings[i - 1];
  const b = readings[i];
  if (a.resetsAt !== b.resetsAt || b.pct <= a.pct) continue;
  const inside = calls.filter((c) => c.at > a.at && c.at <= b.at);
  const whos = new Set(inside.map((c) => c.who));
  if (whos.size !== 1) { if (whos.size > 1) mixed++; continue; }
  const k = acc[[...whos][0]];
  k.pct += b.pct - a.pct;
  for (const c of inside) {
    k.eq += c.eq;
    k.models[c.model] = (k.models[c.model] || 0) + c.eq;
  }
}

const fmt = (n) => Math.round(n).toLocaleString('es');
console.log(`Últimos ${days} días · ${readings.length} lecturas de la ventana de 5 h · ${mixed} intervalos mezclados (descartados)\n`);
for (const [name, k] of Object.entries(acc)) {
  if (!k.pct) { console.log(`${name.padEnd(9)} sin intervalos en los que trabajara solo`); continue; }
  const models = Object.entries(k.models).sort((x, y) => y[1] - x[1]).map(([m, v]) => `${m.replace('claude-', '')} ${Math.round((100 * v) / k.eq)} %`).join(', ');
  console.log(`${name.padEnd(9)} ${fmt(k.eq / k.pct)} tokens equivalentes por cada 1 %  (${k.pct.toFixed(0)} % medido; ${models})`);
}
if (acc.app.pct && acc.terminal.pct) {
  const r = (acc.terminal.eq / acc.terminal.pct) / (acc.app.eq / acc.app.pct);
  console.log(`\nLa app gasta ${r.toFixed(2)}× la ventana que gasta la terminal por el mismo trabajo${r > 1.2 ? ' (compara también la mezcla de modelos: Opus pesa más que Sonnet)' : ''}.`);
}
