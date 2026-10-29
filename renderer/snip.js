// Recorte de pantalla para el asistente (lo abre assist.mjs con su atajo). Se arrastra un
// rectángulo sobre la captura congelada; un clic sin arrastrar sigue sin imagen.
const $ = (s) => document.querySelector(s);
const sel = $('#sel');
let start = null;

snip.on(({ src }) => {
  start = null;
  sel.hidden = true;
  document.body.className = '';
  $('#img').onload = () => snip.ready();
  $('#img').src = src;
});

const rectOf = (e) => ({
  x: Math.min(start.x, e.clientX), y: Math.min(start.y, e.clientY),
  width: Math.abs(e.clientX - start.x), height: Math.abs(e.clientY - start.y),
});
const finish = (rect) => {
  start = null;
  snip.done(rect && { ...rect, viewW: innerWidth, viewH: innerHeight });
};

addEventListener('mousedown', (e) => {
  if (e.button !== 0) return finish(null); // clic derecho: cancelar
  start = { x: e.clientX, y: e.clientY };
});
addEventListener('mousemove', (e) => {
  if (!start) return;
  const r = rectOf(e);
  if (r.width < 4 && r.height < 4) return;
  document.body.className = 'drag';
  sel.hidden = false;
  Object.assign(sel.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
  const k = devicePixelRatio;
  $('#size').textContent = `${Math.round(r.width * k)} × ${Math.round(r.height * k)}`;
});
addEventListener('mouseup', (e) => {
  if (!start || e.button !== 0) return;
  const r = rectOf(e);
  finish(r.width < 4 || r.height < 4 ? { none: true } : r);
});
addEventListener('keydown', (e) => { if (e.key === 'Escape') finish(null); });
addEventListener('contextmenu', (e) => e.preventDefault());
