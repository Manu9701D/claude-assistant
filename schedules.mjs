// Tareas programadas: a su hora, abren una pestaña con un preset y le mandan un prompt (como las
// tareas programadas de Claude, pero en local: solo con la app abierta). Al terminar, aviso.
// Cada tarea: { id, name, presetId, prompt, enabled, every (minutos; 0 = por días y hora),
//               days: [0–6, 0 = domingo], time: 'HH:MM', created (se cuenta desde aquí al crearla,
//               editarla o reactivarla), lastRun }

const CATCH_UP = 12 * 60 * 60 * 1000; // con la app cerrada a su hora: se lanza al abrir si no hace más de esto

// La siguiente vez después de «after» (ms), o null si no hay ninguna (sin días)
export function nextRun(s, after) {
  const every = Number(s.every) || 0;
  if (every > 0) return after + Math.max(5, every) * 60000;
  const days = Array.isArray(s.days) ? s.days.filter((d) => d >= 0 && d <= 6) : [];
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.time || '');
  if (!days.length || !m) return null;
  const base = new Date(after);
  for (let i = 0; i <= 7; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i, Number(m[1]), Number(m[2]), 0, 0);
    if (d.getTime() > after && days.includes(d.getDay())) return d.getTime();
  }
  return null;
}

// Lo que se guarda de una tarea (lo demás se descarta)
export function cleanSchedule(s, presetIds) {
  const every = Math.max(0, Math.min(7 * 24 * 60, parseInt(s?.every, 10) || 0));
  return {
    id: String(s?.id || '').slice(0, 64) || Math.random().toString(36).slice(2, 10),
    name: String(s?.name || '').trim().slice(0, 80) || 'Tarea programada',
    presetId: presetIds.includes(s?.presetId) ? s.presetId : null,
    prompt: String(s?.prompt || '').slice(0, 20000),
    enabled: s?.enabled !== false,
    every: every && Math.max(5, every),
    days: [...new Set((Array.isArray(s?.days) ? s.days : []).map(Number).filter((d) => d >= 0 && d <= 6))].sort(),
    time: /^\d{1,2}:\d{2}$/.test(s?.time || '') ? s.time : '09:00',
    created: Number(s?.created) || Date.now(),
    lastRun: Number(s?.lastRun) || 0,
  };
}

/**
 * @param {object} o
 * @param {() => object[]} o.list        las tareas (config.schedules)
 * @param {(id, patch) => void} o.update  guarda cambios de una (lastRun)
 * @param {(s) => object} o.launch        abre la pestaña y manda el prompt; devuelve la conversación
 * @param {(s, conv) => void} o.finished  la pestaña de una tarea ha terminado su turno
 */
export function createSchedules({ list, update, launch, finished }) {
  const running = new Map(); // convId -> tarea
  let timer = null;

  function run(s) {
    if (!s.prompt.trim()) return null;
    update(s.id, { lastRun: Date.now() });
    const conv = launch(s);
    if (conv) running.set(conv.id, s);
    return conv;
  }

  function tick() {
    const now = Date.now();
    for (const s of list()) {
      if (!s.enabled || !s.prompt?.trim()) continue;
      const next = nextRun(s, Math.max(s.lastRun || 0, s.created || 0) || now);
      if (next === null || next > now) continue;
      // Perdida con la app cerrada hace mucho: no se lanza, se da por pasada
      if (now - next > CATCH_UP) { update(s.id, { lastRun: now }); continue; }
      run(s);
    }
  }

  return {
    start() { if (!timer) { timer = setInterval(tick, 30000); setTimeout(tick, 5000); } },
    stop() { clearInterval(timer); timer = null; },
    run,
    tick,
    // Fin de turno de una pestaña: si es de una tarea, se avisa (una vez)
    done(convId, conv) {
      const s = running.get(convId);
      if (!s) return false;
      running.delete(convId);
      finished(s, conv);
      return true;
    },
    isScheduled: (convId) => running.has(convId),
    nextRun: (s) => (s.enabled ? nextRun(s, Math.max(s.lastRun || 0, s.created || 0) || Date.now()) : null),
  };
}
