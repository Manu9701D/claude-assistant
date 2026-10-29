// Ventana flotante del asistente por voz (la abre assist.mjs con el atajo global).
// Fases: listen (escuchando, con transcripción en directo) → review (unos segundos para
// corregir; si no tocas nada, se envía) → edit (corrigiendo) → work → answer.
// Un clic en el bocadillo mientras escucha deja de escuchar y pasa a escribir (edit).
const $ = (s) => document.querySelector(s);
const wrap = $('#wrap'), textEl = $('#text'), answerEl = $('#answer'), bar = $('#bar');

const SILENCE_MS = 1600;  // silencio tras haber hablado que da la petición por terminada
const VOICE_LVL = 0.08;   // nivel a partir del cual se considera voz
const VOICE_MS = 350;     // voz acumulada necesaria (un golpe o un clic no cuentan)
const MAX_MS = 90000;     // como mucho, minuto y medio de grabación
const REVIEW_S = 2.5;     // tiempo para corregir antes de enviarse solo
const JUNK = /^\W*(subtítulos (realizados|por)\b.*|gracias por ver.*|.*amara\.org.*|música)\W*$/i;

$('#orb').innerHTML = `<svg viewBox="${SPARK_VIEWBOX}"><path d="${SPARK_PATH}"/></svg>`;

let phase = 'idle';
let rec = null;      // grabación en curso
let withShot = true;

function setPhase(p, label = '') {
  phase = p;
  document.body.className = p;
  $('#label').textContent = label;
  assist.phase(p);
}
function show({ hint = '', send = false, open = false, shot = null, countdown = false } = {}) {
  $('#hint').textContent = hint;
  $('#send').hidden = !send;
  $('#open').hidden = !open;
  $('#shot').hidden = shot == null ? $('#shot').hidden : !shot;
  bar.hidden = !countdown;
  bar.classList.remove('run');
  if (countdown) { void bar.offsetWidth; bar.style.setProperty('--secs', `${REVIEW_S}s`); bar.classList.add('run'); }
  $('#foot').hidden = !hint && !send && !open && $('#shot').hidden;
}

new ResizeObserver(() => assist.size(wrap.offsetHeight)).observe(wrap);

// ---------- Escuchar ----------
async function listen({ shot, follow }) {
  stopAudio();
  textEl.textContent = '';
  textEl.contentEditable = 'false';
  textEl.dataset.ph = 'Habla cuando quieras…';
  answerEl.hidden = true;
  withShot = !!shot;
  $('#shot').classList.remove('off');
  if (shot) $('#shot img').src = shot;
  setPhase('listen', `${shot ? '¿Qué quieres del recorte?' : 'Te escucho'}${follow ? ' · sigue la conversación' : ''}`);
  show({ hint: 'Clic para escribir · Esc cancela', send: true, shot: !!shot });
  assist.prepare().catch(() => {});

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  } catch {
    return fail('No puedo usar el micrófono');
  }
  const ctx = new AudioContext({ sampleRate: 16000 }); // Whisper espera 16 kHz mono
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(1024, 1, 1);
  src.connect(proc);
  proc.connect(ctx.destination);
  const r = rec = { stream, ctx, chunks: [], len: 0, voiced: 0, lastVoice: 0, start: performance.now(), partialLen: 0, busy: false };
  proc.onaudioprocess = (e) => {
    if (rec !== r) return;
    const d = new Float32Array(e.inputBuffer.getChannelData(0));
    r.chunks.push(d);
    r.len += d.length;
    let sum = 0;
    for (const v of d) sum += v * v;
    const lvl = Math.min(1, Math.sqrt(sum / d.length) * 6);
    $('#orb').style.setProperty('--lvl', lvl.toFixed(2));
    const now = performance.now();
    if (lvl > VOICE_LVL) { r.voiced += (d.length / 16); r.lastVoice = now; }
    if ((r.voiced > VOICE_MS && now - r.lastVoice > SILENCE_MS) || now - r.start > MAX_MS) finishListening();
    else if (!r.busy && r.voiced > VOICE_MS && r.len - r.partialLen > 12000) partial(r);
  };
}

function audioOf(r) {
  const out = new Float32Array(r.len);
  let o = 0;
  for (const c of r.chunks) { out.set(c, o); o += c.length; }
  return out;
}

// Transcripción en directo mientras hablas
async function partial(r) {
  r.busy = true;
  r.partialLen = r.len;
  try {
    const t = await assist.transcribe(audioOf(r));
    if (rec === r && phase === 'listen' && t && !JUNK.test(t)) { textEl.textContent = t; textEl.classList.add('partial'); }
  } catch {}
  r.busy = false;
}

function stopAudio() {
  if (!rec) return null;
  const r = rec;
  rec = null;
  r.stream.getTracks().forEach((t) => t.stop());
  r.ctx.close();
  $('#orb').style.setProperty('--lvl', 0);
  return r;
}

async function finishListening() {
  const r = stopAudio();
  if (!r || phase !== 'listen') return;
  if (r.voiced < VOICE_MS / 2) return fail('No te he oído');
  setPhase('transcribe', 'Transcribiendo…');
  show({ shot: withShot || null });
  let t = '';
  try { t = await assist.transcribe(audioOf(r)); } catch (e) { return fail(`No he podido transcribir: ${e.message || e}`); }
  if (phase !== 'transcribe') return;
  if (t.replace(/[^\p{L}\p{N}]/gu, '').length < 2 || JUNK.test(t)) return fail('No te he entendido');
  textEl.textContent = t;
  textEl.classList.remove('partial');
  review();
}

// ---------- Revisar, corregir y enviar ----------
function review() {
  setPhase('review', 'Lo envío…');
  show({ hint: 'Clic en el texto para corregir', send: true, shot: !$('#shot').hidden, countdown: true });
}
bar.addEventListener('animationend', () => { if (phase === 'review') send(); });

function edit() {
  if (!['listen', 'review', 'edit'].includes(phase)) return;
  const typing = phase === 'listen';
  if (typing) {
    stopAudio();
    textEl.classList.remove('partial');
    textEl.dataset.ph = 'Escribe lo que quieras…';
  }
  setPhase('edit', typing ? 'Escribe y pulsa Enter' : 'Corrige y pulsa Enter');
  show({ hint: 'Enter envía · Esc cancela', send: true, shot: !$('#shot').hidden });
  assist.focus();
  textEl.contentEditable = 'plaintext-only';
  textEl.focus();
  const sel = getSelection();
  sel.selectAllChildren(textEl);
  sel.collapseToEnd();
}
textEl.addEventListener('mousedown', () => { if (phase === 'review') setTimeout(edit); });
// Si no puedes hablar: clic en el bocadillo (fuera de sus botones) y escribes
$('#bubble').addEventListener('mousedown', (e) => { if (phase === 'listen' && !e.target.closest('button')) setTimeout(edit); });
textEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

async function send() {
  if (phase === 'listen') return finishListening();
  if (phase !== 'review' && phase !== 'edit') return;
  const text = textEl.innerText.trim();
  if (!text) return close();
  textEl.contentEditable = 'false';
  textEl.scrollTop = 0;
  setPhase('work', 'Trabajando…');
  show({ open: true, shot: false });
  await assist.send({ text, withShot });
}

$('#send').onclick = send;
$('#x').onclick = () => close();
$('#open').onclick = () => assist.open();
$('#shot').onclick = () => {
  withShot = !withShot;
  $('#shot').classList.toggle('off', !withShot);
  $('#shot').title = withShot ? 'Se adjunta el recorte. Clic para quitarlo.' : 'Recorte quitado. Clic para volver a adjuntarlo.';
};

function close() {
  stopAudio();
  setPhase('idle');
  assist.close();
}
function fail(msg) {
  stopAudio();
  setPhase('error', msg);
  show({});
  setTimeout(() => { if (phase === 'error') close(); }, 1800);
}

// ---------- Mientras trabaja y la respuesta ----------
const TOOL_LABELS = [
  [/^mcp__(windows|macos)-mcp__/, 'Usando el ordenador…'],
  [/^mcp__claude-in-chrome__|chrome/i, 'Usando Chrome…'],
  [/^(Bash|PowerShell)$/, 'Ejecutando comandos…'],
  [/^(Read|Glob|Grep)$/, 'Leyendo archivos…'],
  [/^(Edit|Write|NotebookEdit)$/, 'Editando archivos…'],
  [/^WebSearch$/, 'Buscando en internet…'],
  [/^WebFetch$/, 'Leyendo una web…'],
  [/^(Task|Agent)$/, 'Con un subagente…'],
];
const toolLabel = (name) => TOOL_LABELS.find(([re]) => re.test(name))?.[1] || 'Trabajando…';

assist.on((type, data) => {
  if (type === 'listen') listen(data);
  else if (type === 'stop') finishListening();
  else if (type === 'send') send();
  else if (type === 'cancel') close();
  else if (type === 'progress' && phase === 'work') $('#label').textContent = data.tool ? toolLabel(data.tool) : 'Trabajando…';
  else if (type === 'prompt') {
    $('#label').textContent = data.kind === 'permission' ? 'Claude necesita tu permiso' : 'Claude tiene una pregunta para ti';
    show({ hint: '', open: true });
  } else if (type === 'answer') {
    setPhase('answer', 'Claude');
    answerEl.innerHTML = DOMPurify.sanitize(marked.parse(data.text || ''));
    answerEl.hidden = false;
    answerEl.scrollTop = 0;
    show({ open: true });
  }
});
answerEl.addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (a) { e.preventDefault(); window.open(a.href); }
});
