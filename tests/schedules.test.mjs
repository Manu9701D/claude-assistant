// Pruebas de las tareas programadas (schedules.mjs): npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextRun, cleanSchedule, createSchedules } from '../schedules.mjs';

const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

test('nextRun por días y hora', () => {
  const s = { every: 0, days: [1, 2, 3, 4, 5], time: '09:00' };
  // Lunes 26/10/2026 a las 08:00 → ese mismo día a las 09:00
  assert.equal(nextRun(s, at(2026, 10, 26, 8)), at(2026, 10, 26, 9));
  // A las 09:00 justas ya no cuenta: el martes
  assert.equal(nextRun(s, at(2026, 10, 26, 9)), at(2026, 10, 27, 9));
  // Viernes por la tarde → lunes
  assert.equal(nextRun(s, at(2026, 10, 30, 18)), at(2026, 11, 2, 9));
  // Solo domingos, desde un domingo después de la hora → el siguiente domingo
  assert.equal(nextRun({ days: [0], time: '20:30' }, at(2026, 11, 1, 21)), at(2026, 11, 8, 20, 30));
  assert.equal(nextRun({ days: [], time: '09:00' }, at(2026, 10, 26)), null);
});

test('nextRun cada N minutos (mínimo 5)', () => {
  const t = at(2026, 10, 26, 10);
  assert.equal(nextRun({ every: 60 }, t), t + 3600000);
  assert.equal(nextRun({ every: 1 }, t), t + 5 * 60000);
});

test('cleanSchedule descarta lo que no vale', () => {
  const s = cleanSchedule({ id: 'a', presetId: 'otro', days: [9, '1', 1, 3], time: 'x', every: '2', extra: 1 }, ['trabajo']);
  assert.equal(s.presetId, null);
  assert.deepEqual(s.days, [1, 3]);
  assert.equal(s.time, '09:00');
  assert.equal(s.every, 5);
  assert.equal(s.name, 'Tarea programada');
  assert.equal('extra' in s, false);
});

test('tick lanza las pendientes, salta las muy atrasadas y avisa una vez al terminar', () => {
  const now = Date.now();
  const list = [
    { id: 'a', enabled: true, prompt: 'hola', every: 5, created: now - 6 * 60000, lastRun: 0 },
    { id: 'b', enabled: true, prompt: 'vieja', every: 5, created: now - 20 * 3600000, lastRun: 0 },
    { id: 'c', enabled: false, prompt: 'pausada', every: 5, created: now - 6 * 60000, lastRun: 0 },
    { id: 'd', enabled: true, prompt: 'aún no', every: 60, created: now, lastRun: 0 },
  ];
  const launched = [];
  const finished = [];
  const sch = createSchedules({
    list: () => list,
    update: (id, patch) => Object.assign(list.find((x) => x.id === id), patch),
    launch: (s) => { launched.push(s.id); return { id: `conv-${s.id}` }; },
    finished: (s) => finished.push(s.id),
  });
  sch.tick();
  assert.deepEqual(launched, ['a']);
  assert.ok(list[1].lastRun >= now); // la vieja se da por pasada
  assert.equal(sch.done('conv-a', {}), true);
  assert.equal(sch.done('conv-a', {}), false);
  assert.equal(sch.done('otra', {}), false);
  assert.deepEqual(finished, ['a']);
});
