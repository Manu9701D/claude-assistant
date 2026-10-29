// `api` lo expone preload.cjs como global (window.api)
const $ = (s) => document.querySelector(s);
const IS_WIN = api.platform === 'win32';
// macOS: los atajos de la app van con Cmd (Ctrl queda para Claude Code, como en su terminal)
const IS_MAC = api.platform === 'darwin';
const K = (s) => (IS_MAC ? s.replace(/Ctrl\+(?!º)/g, '⌘') : s);
const SEP = IS_WIN ? '\\' : '/';
document.documentElement.dataset.os = api.platform; // .only-win se oculta fuera de Windows; .only-desktop, en Linux
if (IS_MAC) {
  for (const el of document.querySelectorAll('.os-name')) el.textContent = 'del Mac';
  for (const el of document.querySelectorAll('.os-apps')) el.textContent = 'Finder, Mail, Keynote…';
  for (const el of document.querySelectorAll('.os-tray')) el.textContent = 'barra de menús';
}
if (IS_MAC) for (const el of document.querySelectorAll('[title*="Ctrl+"]')) el.title = K(el.title);

const state = {
  tabs: [],            // ids en orden visual
  convs: new Map(),    // id -> conversación (instantánea del proceso principal)
  activeId: null,
  unread: new Set(),   // pestañas en segundo plano que han terminado
  drafts: new Map(),   // id -> { text, attachments } al cambiar de pestaña
  config: null,
  meta: { models: [], commands: [], terminal: [] },
  openKeys: new Set(), // bloques <details> desplegados por el usuario
  shutKeys: new Set(), // … y plegados por él (en las vistas que los despliegan solos)
  views: new Map(),    // pestaña -> vista de la conversación elegida con Ctrl+O (si no, la de Apariencia)
  attachments: [],     // imágenes del mensaje en preparación
  history: [],
  histIdx: -1,
  promptSig: '',
  planRetries: new Map(), // plan de una pestaña de terminal -> veces que se han buscado sus opciones
};
const current = () => state.convs.get(state.activeId) || null;

// ---------- Iconos ----------
const I = {
  terminal: '<svg viewBox="0 0 20 20"><rect x="2.5" y="3.5" width="15" height="13" rx="2.5"/><path d="m6 8 2.5 2L6 12M10.5 12.5H14"/></svg>',
  file: '<svg viewBox="0 0 20 20"><path d="M5.5 2.5h6l3.5 3.5v11.5h-9.5z"/><path d="M11.5 2.5V6H15"/></svg>',
  folder: '<svg viewBox="0 0 20 20"><path d="M2.5 6V15a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V7.5A1.5 1.5 0 0 0 16 6h-6L8.5 4h-4.5A1.5 1.5 0 0 0 2.5 5.5z"/></svg>',
  edit: '<svg viewBox="0 0 20 20"><path d="M12.5 4.5l3 3L8 15H5v-3z"/><path d="M11 6l3 3"/></svg>',
  search: '<svg viewBox="0 0 20 20"><circle cx="9" cy="9" r="5.5"/><path d="m13 13 3.5 3.5"/></svg>',
  globe: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7.5"/><path d="M2.5 10h15M10 2.5c2.2 2.3 2.2 12.7 0 15M10 2.5c-2.2 2.3-2.2 12.7 0 15"/></svg>',
  list: '<svg viewBox="0 0 20 20"><path d="M8 5.5h8.5M8 10h8.5M8 14.5h8.5"/><path d="m3 5.5 1 1 1.8-2M3 10l1 1 1.8-2"/><circle cx="4.2" cy="14.5" r=".9"/></svg>',
  agent: '<svg viewBox="0 0 20 20"><circle cx="10" cy="7" r="3"/><path d="M4.5 16.5c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5"/></svg>',
  plug: '<svg viewBox="0 0 20 20"><path d="M7 2.5v4M13 2.5v4M5 6.5h10v3a5 5 0 0 1-10 0zM10 14.5v3"/></svg>',
  tool: '<svg viewBox="0 0 20 20"><path d="M12.5 3a4 4 0 0 0-3.8 5.2L3.5 13.4a1.5 1.5 0 0 0 2.1 2.1l5.2-5.2A4 4 0 0 0 16 6.5l-2.3 2.3-2.3-.2-.2-2.3L13.5 4z"/></svg>',
  spark: '<svg viewBox="0 0 20 20"><path d="M10 2.5v15M2.5 10h15M4.7 4.7l10.6 10.6M15.3 4.7 4.7 15.3"/></svg>',
  question: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7.5"/><path d="M7.8 7.8a2.3 2.3 0 1 1 3.2 2.1c-.6.3-1 .8-1 1.4v.4M10 14.2v.2"/></svg>',
  plan: '<svg viewBox="0 0 20 20"><path d="M6 3.5h8a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 14 17.5H6A1.5 1.5 0 0 1 4.5 16V5A1.5 1.5 0 0 1 6 3.5z"/><path d="M7.5 7.5h5M7.5 10.5h5M7.5 13.5h3"/></svg>',
  shield: '<svg viewBox="0 0 20 20"><path d="M10 2.5 4 5v4.5c0 3.8 2.6 6.6 6 8 3.4-1.4 6-4.2 6-8V5z"/></svg>',
  brain: '<svg viewBox="0 0 20 20"><path d="M10 4.5V16M10 4.5a2.5 2.5 0 0 0-4.6-1.3A2.8 2.8 0 0 0 3.5 8a2.8 2.8 0 0 0 .3 4.7A2.8 2.8 0 0 0 7 16.5a2.3 2.3 0 0 0 3-.5M10 4.5a2.5 2.5 0 0 1 4.6-1.3A2.8 2.8 0 0 1 16.5 8a2.8 2.8 0 0 1-.3 4.7 2.8 2.8 0 0 1-3.2 3.8 2.3 2.3 0 0 1-3-.5"/></svg>',
  copy: '<svg viewBox="0 0 20 20"><rect x="6.5" y="6.5" width="10" height="10" rx="2"/><path d="M13.5 6.5V5A1.5 1.5 0 0 0 12 3.5H5A1.5 1.5 0 0 0 3.5 5v7A1.5 1.5 0 0 0 5 13.5h1.5"/></svg>',
  check: '<svg viewBox="0 0 20 20"><path d="m4.5 10.5 3.5 3.5 7.5-8"/></svg>',
  circle: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="6"/></svg>',
  chevron: '<svg class="chev" viewBox="0 0 20 20"><path d="m7.5 5 5 5-5 5"/></svg>',
  chevronDown: '<svg viewBox="0 0 20 20"><path d="m5.5 8 4.5 4.5L14.5 8"/></svg>',
  warn: '<svg viewBox="0 0 20 20"><path d="M10 3 2.5 16.5h15z"/><path d="M10 8.5v3.5M10 14.3v.2"/></svg>',
  stop: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7.5"/><path d="M7.5 7.5h5v5h-5z"/></svg>',
  x: '<svg viewBox="0 0 20 20"><path d="m6 6 8 8M14 6l-8 8"/></svg>',
  plus: '<svg viewBox="0 0 20 20"><path d="M10 5v10M5 10h10"/></svg>',
  dots: '<svg viewBox="0 0 20 20"><path d="M5 10h.01M10 10h.01M15 10h.01" stroke-width="2.4"/></svg>',
  chat: '<svg viewBox="0 0 20 20"><path d="M4 15.5 5 12.6A6 6 0 1 1 7.4 15z"/></svg>',
  speaker: '<svg viewBox="0 0 20 20"><path d="M3.5 8v4h3l4 3.5v-11l-4 3.5z"/><path d="M13.5 7.5a3.5 3.5 0 0 1 0 5M15.5 5.5a6.5 6.5 0 0 1 0 9"/></svg>',
  retry: '<svg viewBox="0 0 20 20"><path d="M15.5 10a5.5 5.5 0 1 1-1.6-3.9"/><path d="M14.5 3v3.5H11"/></svg>',
  code: '<svg viewBox="0 0 20 20"><path d="M7 6l-4 4 4 4M13 6l4 4-4 4"/></svg>',
  play: '<svg viewBox="0 0 20 20"><path d="M6.5 4.5v11l9-5.5z"/></svg>',
  panel: '<svg viewBox="0 0 20 20"><rect x="2.5" y="3.5" width="15" height="13" rx="2"/><path d="M11.5 3.5v13"/></svg>',
  download: '<svg viewBox="0 0 20 20"><path d="M10 3.5v9M6 8.5l4 4 4-4M4 16h12"/></svg>',
  external: '<svg viewBox="0 0 20 20"><path d="M11.5 3.5h5v5M16.5 3.5 9.5 10.5M14.5 11.5v3a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>',
  pencil: '<svg viewBox="0 0 20 20"><path d="M12.5 4.5l3 3L8 15H5v-3z"/></svg>',
  grip: '<svg viewBox="0 0 20 20"><circle cx="7.5" cy="5.5" r=".9"/><circle cx="12.5" cy="5.5" r=".9"/><circle cx="7.5" cy="10" r=".9"/><circle cx="12.5" cy="10" r=".9"/><circle cx="7.5" cy="14.5" r=".9"/><circle cx="12.5" cy="14.5" r=".9"/></svg>',
  chrome: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7.5"/><circle cx="10" cy="10" r="3"/><path d="M10 7h7M7.4 11.5 3.9 5.5M12.6 11.5l-3.5 6"/></svg>',
  bolt: '<svg viewBox="0 0 20 20"><path d="M11 2.5 4.5 11H10l-1 6.5L15.5 9H10z"/></svg>',
  clock: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7.5"/><path d="M10 6v4l2.5 2"/></svg>',
  slash: '<svg viewBox="0 0 20 20"><path d="m12.5 3.5-5 13"/></svg>',
  at: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="3"/><path d="M13 10v1.2a2.3 2.3 0 0 0 4.5 0V10a7.5 7.5 0 1 0-3 6"/></svg>',
  compress: '<svg viewBox="0 0 20 20"><path d="M7 3v4H3M13 3v4h4M7 17v-4H3M13 17v-4h4"/></svg>',
};

// Chispa de Claude: rayos afilados de longitudes irregulares
// SPARK_PATH viene de spark.js (compartido con el icono de la app)
const sparkSvg = (extra = '') => `<svg class="spark-svg ${extra}" viewBox="${SPARK_VIEWBOX}"><path d="${SPARK_PATH}"/></svg>`;
document.querySelectorAll('[data-spark]').forEach((el) => (el.innerHTML = sparkSvg()));

// ---------- Textos ----------
const MODES = {
  default: { title: 'Preguntar siempre', short: 'Preguntar', desc: 'Confirma cada acción contigo' },
  acceptEdits: { title: 'Editar libremente', short: 'Editar libre', desc: 'Edita archivos sin preguntar; pide permiso para lo demás' },
  plan: { title: 'Modo plan', short: 'Plan', desc: 'Investiga y propone un plan sin tocar nada' },
  bypassPermissions: { title: 'Acceso total', short: 'Acceso total', desc: 'Ejecuta y modifica sin preguntar', hot: true },
  auto: { title: 'Modo automático', short: 'Auto', desc: 'Claude decide qué necesita tu permiso' },
};
const MODE_CYCLE = ['default', 'acceptEdits', 'plan', 'bypassPermissions'];

const SUGGESTIONS = [
  { icon: 'search', text: '¿Qué está ocupando más espacio en mi disco?' },
  { icon: 'file', text: 'Organiza mi carpeta de Descargas por tipo de archivo' },
  { icon: 'terminal', text: '¿Qué procesos están consumiendo más memoria ahora?' },
  { icon: 'globe', text: 'Resume las noticias de tecnología de hoy' },
];

// Comandos que resuelve la propia app (en la terminal son interfaces interactivas)
const LOCAL_COMMANDS = [
  { name: 'clear', description: 'Empieza una conversación nueva en esta pestaña', argumentHint: '' },
  { name: 'model', description: 'Elige el modelo de esta pestaña', argumentHint: '[modelo]' },
  { name: 'effort', description: 'Elige el esfuerzo de razonamiento', argumentHint: '[low|medium|high|xhigh|max|auto]' },
  { name: 'theme', description: 'Cambia el tema: sistema, claro u oscuro', argumentHint: '' },
  { name: 'usage', description: 'Uso del plan: sesión de 5 h y semana', argumentHint: '' },
  { name: 'status', description: 'Versión, cuenta, modelo, carpeta y modo', argumentHint: '' },
  { name: 'login', description: 'Cambia de cuenta de Claude o inicia sesión con otra', argumentHint: '' },
  { name: 'mcp', description: 'Servidores MCP: estado, reconectar, activar o desactivar', argumentHint: '' },
  { name: 'memory', description: 'Abre un CLAUDE.md para editarlo', argumentHint: '' },
  { name: 'permissions', description: 'Reglas de permisos (allow / ask / deny)', argumentHint: '' },
  { name: 'hooks', description: 'Hooks configurados: usuario, proyecto y local', argumentHint: '' },
  { name: 'add-dir', description: 'Da acceso a otra carpeta en esta sesión', argumentHint: '[carpeta]' },
  { name: 'config', description: 'Abre la configuración', argumentHint: '' },
  { name: 'exit', description: 'Cierra esta pestaña', argumentHint: '' },
  { name: 'help', description: 'Atajos de teclado y ayuda', argumentHint: '' },
  { name: 'resume', description: 'Retoma una conversación anterior en una pestaña nueva', argumentHint: '' },
  { name: 'export', description: 'Exporta la conversación: a un archivo Markdown o al portapapeles', argumentHint: '[archivo]' },
];

const TOOL_META = {
  Bash: ['terminal', 'Bash'], PowerShell: ['terminal', 'PowerShell'], BashOutput: ['terminal', 'Salida de proceso'], KillShell: ['terminal', 'Detener proceso'],
  Read: ['file', 'Leer'], Write: ['file', 'Crear archivo'],
  Edit: ['edit', 'Editar'], MultiEdit: ['edit', 'Editar'], NotebookEdit: ['edit', 'Editar notebook'],
  Glob: ['search', 'Buscar archivos'], Grep: ['search', 'Buscar en archivos'],
  WebFetch: ['globe', 'Abrir web'], WebSearch: ['globe', 'Buscar en la web'],
  Task: ['agent', 'Subagente'], Agent: ['agent', 'Subagente'],
  TodoWrite: ['list', 'Lista de tareas'], Skill: ['spark', 'Skill'],
  AskUserQuestion: ['question', 'Pregunta'], ExitPlanMode: ['plan', 'Plan'], EnterPlanMode: ['plan', 'Entrar en modo plan'],
  TaskCreate: ['list', 'Nueva tarea'], TaskUpdate: ['list', 'Actualizar tarea'], TaskList: ['list', 'Ver tareas'], TaskGet: ['list', 'Ver tarea'],
  TaskOutput: ['terminal', 'Salida de tarea'], TaskStop: ['terminal', 'Detener tarea'], ToolSearch: ['search', 'Buscar herramientas'],
  ListMcpResourcesTool: ['plug', 'Recursos MCP'], ReadMcpResourceTool: ['plug', 'Leer recurso MCP'],
};
function toolMeta(name) {
  if (TOOL_META[name]) return { icon: TOOL_META[name][0], label: TOOL_META[name][1] };
  if (name.startsWith('mcp__')) {
    const [, server, ...rest] = name.split('__');
    return { icon: 'plug', label: `${server} · ${rest.join('__')}` };
  }
  return { icon: 'tool', label: name };
}
const baseName = (p) => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;

function toolPreview(b) {
  const i = b.input || {};
  const STATUS = { pending: 'pendiente', in_progress: 'en curso', completed: 'completada', deleted: 'eliminada' };
  if (b.name === 'TaskCreate') return i.subject || '';
  if (b.name === 'TaskUpdate') return `#${i.taskId}${i.status ? ' → ' + (STATUS[i.status] || i.status) : ''}`;
  if (i.command) return i.description || i.command; // como Claude Code: la descripción del comando; el comando, al desplegar
  if (i.file_path) return baseName(i.file_path);
  if (i.notebook_path) return baseName(i.notebook_path);
  if (i.pattern) return i.pattern + (i.path ? ` · ${baseName(i.path)}` : '');
  if (i.url) return i.url;
  if (i.query) return i.query;
  if (i.description) return i.description;
  if (i.skill) return i.skill;
  if (b.name === 'AskUserQuestion') return i.questions?.map((q) => q.question).join(' · ') || '';
  if (i.prompt) return i.prompt;
  return '';
}

// ---------- Markdown ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LANG_BY_EXT = { js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'typescript', jsx: 'javascript', py: 'python', ps1: 'powershell', psm1: 'powershell', sh: 'bash', bat: 'dos', cmd: 'dos', json: 'json', md: 'markdown', html: 'xml', xml: 'xml', css: 'css', scss: 'scss', yml: 'yaml', yaml: 'yaml', java: 'java', cs: 'csharp', cpp: 'cpp', c: 'c', h: 'c', go: 'go', rs: 'rust', rb: 'ruby', php: 'php', sql: 'sql', toml: 'ini', ini: 'ini', kt: 'kotlin', swift: 'swift', lua: 'lua' };

function highlight(text, language) {
  try {
    if (language && hljs.getLanguage(language)) return hljs.highlight(text, { language, ignoreIllegals: true }).value;
  } catch {}
  return esc(text);
}
function codeBlock(text, language, label) {
  return `<div class="codeblock"><div class="code-head"><span>${esc(label || language || 'código')}</span>`
    + `<button class="code-copy" data-action="copy-code">${I.copy}<span>Copiar</span></button></div>`
    + `<pre><code class="hljs">${highlight(text, language)}</code></pre></div>`;
}

// ---------- Diagramas (Mermaid), SVG y HTML: como los artefactos de claude.ai ----------
// El dibujo va dentro del HTML del mensaje como <img> (aislado, sin scripts) sacado de una caché:
// así sobrevive a los repintados (morph) y a mdCache. Mermaid pesa: se carga la primera vez que hace falta.
const darkMq = matchMedia('(prefers-color-scheme: dark)');
const hashText = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(36); };
const diagrams = new Map(); // clave -> { src } | { img } | { error }
const codeShown = new Set(); // vistas previas en las que se ha pedido ver el código
const svgImg = (svg) => {
  // Con su tamaño real (Mermaid pone width="100%", que en un <img> no sirve)
  const vb = /viewBox="[\d.\-]+\s+[\d.\-]+\s+([\d.]+)\s+([\d.]+)"/.exec(svg);
  // (y los muy pequeños, más grandes: un icono de 24 px no se vería)
  if (vb) {
    const k = Math.min(8, Math.max(1, 240 / vb[1]));
    svg = svg.replace(/<svg\b[^>]*>/, (tag) => tag.replace(/\s(?:width|height)="[^"]*"/g, '').replace(/max-width:\s*[\d.]+px;?/, '')
      .replace('<svg', `<svg width="${Math.ceil(vb[1] * k)}" height="${Math.ceil(vb[2] * k)}"`));
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};
function previewBlock(kind, text, label) {
  const key = kind === 'mermaid' ? `m${hashText(text)}${darkMq.matches ? 'd' : 'l'}` : `s${hashText(text)}`;
  let d = diagrams.get(key);
  if (!d) {
    d = kind === 'svg' ? { img: svgImg(text) } : { src: text };
    if (diagrams.size > 300) diagrams.clear();
    diagrams.set(key, d);
  }
  if (d.src) queueDiagrams();
  const code = `<pre><code class="hljs">${highlight(text, kind === 'svg' ? 'xml' : kind)}</code></pre>`;
  const view = d.img ? `<div class="preview-view"><img src="${d.img}" alt="${esc(label)}"></div>`
    : d.error ? `<div class="preview-error">No se ha podido dibujar: ${esc(d.error)}</div>`
    : '<div class="preview-view loading">Dibujando…</div>';
  return `<div class="codeblock preview${codeShown.has(key) ? ' show-code' : ''}" data-preview="${key}" data-kind="${kind}"><div class="code-head"><span>${esc(label)}</span>`
    + `<button class="code-copy" data-action="open-artifact" title="Abrir en el panel lateral">${I.panel}<span>Abrir</span></button>`
    + `<button class="code-copy" data-action="toggle-code">${I.code}<span>Código</span></button>`
    + `<button class="code-copy" data-action="copy-code">${I.copy}<span>Copiar</span></button></div>`
    + view + code + '</div>';
}
// Se dibujan poco después y solo los que siguen en pantalla (mientras se escribe, los trozos a medias desaparecen)
let diagramTimer = null;
function queueDiagrams() {
  clearTimeout(diagramTimer);
  diagramTimer = setTimeout(drawDiagrams, 350);
}
let mermaidLoad = null;
function loadMermaid() {
  mermaidLoad ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '../node_modules/mermaid/dist/mermaid.min.js';
    s.onload = () => resolve(window.mermaid);
    s.onerror = () => { mermaidLoad = null; reject(new Error('no se pudo cargar Mermaid')); };
    document.head.append(s);
  });
  return mermaidLoad;
}
let diagramSeq = 0;
async function drawDiagrams() {
  // Solo lo que está en pantalla; lo del mensaje que aún se está escribiendo espera a que termine
  const writing = current()?.busy ? thread.lastElementChild : null;
  const todo = [];
  for (const [key, d] of diagrams) {
    if (!d.src) continue;
    const el = thread.querySelector(`[data-preview="${key}"]`);
    if (el && !writing?.contains(el)) todo.push([key, d]);
  }
  if (!todo.length) return;
  let mermaid;
  try { mermaid = await loadMermaid(); } catch (err) { todo.forEach(([, d]) => { d.error = err.message; delete d.src; }); refreshPreviews(); return; }
  for (const [key, d] of todo) {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: key.endsWith('d') ? 'dark' : 'default', fontFamily: 'system-ui, sans-serif', flowchart: { htmlLabels: false } });
    try {
      const { svg } = await mermaid.render(`mmd-${++diagramSeq}`, d.src);
      d.img = svgImg(svg);
    } catch (err) {
      d.error = String(err?.message || err).split('\n')[0].slice(0, 160);
      document.getElementById(`dmmd-${diagramSeq}`)?.remove(); // el aviso de error que deja Mermaid en <body>
    }
    delete d.src;
  }
  refreshPreviews();
}
function refreshPreviews() {
  mdCache.clear();
  if (state.activeId && current()?.messages) renderThread();
}
darkMq.addEventListener('change', () => { if ([...diagrams.keys()].some((k) => k[0] === 'm')) refreshPreviews(); });

// ---------- Panel de artefactos (como claude.ai): HTML, SVG, diagramas y documentos a un lado del chat ----------
// El HTML va en un <webview> aislado (main.mjs lo fuerza: sandbox, sin preload, sesión propia, solo data:)
const artEl = $('#artifact');
const ART = { html: ['Página', 'html', 'html'], svg: ['SVG', 'svg', 'xml'], mermaid: ['Diagrama', 'mmd', 'mermaid'], markdown: ['Documento', 'md', 'markdown'], url: ['Página local'] };
// Los enlaces del chat a un servidor de este equipo (vista previa en vivo, servidor de desarrollo) se abren en el panel
const LOCAL_URL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i;
let artifact = null; // { convId, kind, text, key, title, tab }
artEl.querySelector('[data-art="copy"]').innerHTML = I.copy;
artEl.querySelector('[data-art="save"]').innerHTML = I.download;
artEl.querySelector('[data-art="window"]').innerHTML = I.external;
artEl.querySelector('[data-art="close"]').innerHTML = I.x;
artEl.querySelector('[data-art="folder"]').innerHTML = I.folder;
artEl.querySelector('[data-art="wide"]').innerHTML = '<svg viewBox="0 0 20 20"><path d="M12 3.5h4.5V8M8 16.5H3.5V12M16.5 3.5 11.5 8.5M3.5 16.5l5-5"/></svg>';
artEl.querySelector('.artifact-title').addEventListener('click', () => { if (artifact) toggleFileList(); });
try { const w = Number(localStorage.getItem('artifactW')); if (w) artEl.style.width = `${w}px`; } catch {}
function openArtifactFrom(box) {
  const kind = box.dataset.kind;
  const text = box.querySelector('code').textContent;
  const title = kind === 'html' ? (/<title>([^<]{1,80})<\/title>/i.exec(text)?.[1].trim() || ART.html[0])
    : kind === 'markdown' ? (/^#{1,3}\s+(.{1,80})$/m.exec(text)?.[1] || ART.markdown[0]) : ART[kind][0];
  artifact = { convId: state.activeId, kind, text, key: box.dataset.preview, title, tab: 'view' };
  artEl.hidden = false;
  renderArtifact();
}
function openArtifactUrl(url, convId = state.activeId) {
  artifact = { convId, kind: 'url', text: url, title: new URL(url).host, tab: 'view' };
  artEl.hidden = false;
  renderArtifact();
}
// Claude la abre con la herramienta vista_previa: si su pestaña no está a la vista, al volver a ella
const artPending = new Map(); // convId -> url
api.onArtUrl(({ convId, url }) => {
  if (state.activeId === convId) openArtifactUrl(url, convId);
  else if (state.convs.has(convId)) artPending.set(convId, url);
});
// Documentos que Claude crea o cambia (conv.files, ver trackFiles en termchat.mjs): se abren solos en el
// panel y se recargan al cambiar (docview.mjs los sirve y los vigila). Markdown no se abre solo: en un
// proyecto de código serían muchos
const AUTO_DOC = /\.(docx|xlsx|xlsm|xls|ods|csv|tsv|pptx|pdf|html?|svg|png|jpe?g|gif|webp)$/i;
const filesSeen = new Map(); // convId -> fecha del último documento ya visto
const filePending = new Map(); // convId -> ruta que abrir al volver a esa pestaña
const fileDismissed = new Map(); // convId -> rutas cuyo panel se ha cerrado a mano (no se reabren solas)
let watching = null;
function watchFile(file) {
  if (watching === file) return;
  watching = file;
  api.previewWatch(file);
}
function openFileArtifact(file, convId = state.activeId) {
  fileDismissed.get(convId)?.delete(file);
  if (artifact?.kind === 'file' && artifact.path === file && artifact.convId === convId) { reloadFileArtifact(); return; }
  artifact = { convId, kind: 'file', path: file, text: file, title: baseName(file), tab: 'view' };
  artEl.hidden = false;
  renderArtifact();
}
function autoPreview(c) {
  const top = c.files?.[0];
  if (!top?.live || filesSeen.get(c.id) === top.at) return;
  filesSeen.set(c.id, top.at);
  if (state.config?.autoPreview === false || !AUTO_DOC.test(top.path) || fileDismissed.get(c.id)?.has(top.path)) return;
  if (artifact?.kind === 'file' && artifact.path === top.path && artifact.convId === c.id) return; // ya se ve: lo recarga su vigilancia
  if (c.id === state.activeId) openFileArtifact(top.path, c.id);
  else filePending.set(c.id, top.path);
}
// Recargar sin perder por dónde se iba (en las hojas de cálculo, el desplazamiento es de la cuadrícula)
const SCROLLER = "(document.querySelector('.grid') || document.scrollingElement)";
async function reloadFileArtifact() {
  const wv = artifact?.wv;
  if (!wv?.isConnected) return;
  let pos = null;
  try { pos = await wv.executeJavaScript(`(() => { const g = ${SCROLLER}; return g ? [g.scrollLeft, g.scrollTop] : null; })()`); } catch {}
  if (Array.isArray(pos)) {
    const [x, y] = pos.map((n) => Number(n) || 0);
    wv.addEventListener('did-finish-load', () => {
      wv.executeJavaScript(`(() => { const g = ${SCROLLER}; if (g) { g.scrollLeft = ${x}; g.scrollTop = ${y}; } })()`).catch(() => {});
    }, { once: true });
  }
  wv.reloadIgnoringCache();
}
api.onPreviewChanged((file) => { if (artifact?.kind === 'file' && artifact.path === file) reloadFileArtifact(); });
// Lista de los documentos de la conversación (al pulsar el título del panel)
const artFiles = artEl.querySelector('.artifact-files');
// De la pestaña actual (el panel sigue abierto al cambiar de pestaña) o, si no tiene, de la del panel
const filesConv = () => (current()?.files?.length ? current() : state.convs.get(artifact?.convId));
function toggleFileList(show = artFiles.hidden) {
  const c = filesConv();
  const files = c?.files || [];
  if (!show || !files.length) { artFiles.hidden = true; return; }
  artFiles.innerHTML = files.map((f) => `<button type="button" class="art-file${artifact.path === f.path ? ' on' : ''}" data-path="${esc(f.path)}" title="${esc(f.path)}">`
    + `<span class="art-file-name">${esc(baseName(f.path))}</span><span class="art-file-dir">${esc(shortPath(f.path.slice(0, -baseName(f.path).length - 1)))}</span>`
    + `<span class="art-file-at">${esc(agoText(f.at))}</span></button>`).join('');
  artFiles.hidden = false;
}
artFiles.addEventListener('click', (e) => {
  const b = e.target.closest('[data-path]');
  if (!b) return;
  artFiles.hidden = true;
  openFileArtifact(b.dataset.path, filesConv()?.id);
});
document.addEventListener('pointerdown', (e) => { if (!artFiles.hidden && !e.target.closest('.artifact-files, .artifact-title')) artFiles.hidden = true; });
function closeArtifact() {
  if (artifact?.kind === 'file') {
    if (!fileDismissed.has(artifact.convId)) fileDismissed.set(artifact.convId, new Set());
    fileDismissed.get(artifact.convId).add(artifact.path);
  }
  artifact = null;
  artEl.hidden = true;
  artEl.classList.remove('wide');
  artFiles.hidden = true;
  artEl.querySelector('.artifact-body').innerHTML = ''; // fuera el <webview> y su proceso
  watchFile(null);
  renderDocsButton();
}
// Botón del compositor para volver a abrir los documentos con el panel cerrado
function renderDocsButton() {
  const btn = $('#art-docs');
  const n = current()?.files?.length || 0;
  btn.hidden = !n || !artEl.hidden;
  btn.title = n === 1 ? `Ver ${baseName(current().files[0].path)}` : `Ver los documentos de esta conversación (${n})`;
}
function renderArtifact() {
  if (!artifact) return;
  const { kind, text, tab } = artifact;
  const file = kind === 'file';
  const title = artEl.querySelector('.artifact-title');
  title.textContent = artifact.title;
  title.title = file ? `${artifact.path}\nPulsa para ver los demás documentos de la conversación` : '';
  title.classList.toggle('pick', !!filesConv()?.files?.length);
  artEl.querySelectorAll('.artifact-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.art === tab));
  artEl.querySelector('[data-art="window"]').hidden = kind !== 'html' && kind !== 'url' && !file;
  artEl.querySelector('[data-art="window"]').title = kind === 'url' ? 'Abrir en el navegador' : file ? 'Abrir con su aplicación' : 'Abrir en una ventana';
  artEl.querySelector('.artifact-tabs').hidden = kind === 'url' || file;
  artEl.querySelector('[data-art="save"]').hidden = kind === 'url' || file;
  artEl.querySelector('[data-art="folder"]').hidden = !file;
  artEl.querySelector('[data-art="copy"]').title = kind === 'url' ? 'Copiar la dirección' : file ? 'Copiar la ruta' : 'Copiar';
  artEl.querySelector('[data-art="wide"]').title = artEl.classList.contains('wide') ? 'Volver al chat' : 'Ampliar sobre el chat';
  renderDocsButton();
  const body = artEl.querySelector('.artifact-body');
  body.className = `artifact-body ${tab === 'code' ? 'is-code' : `is-${kind === 'url' || file ? 'html' : kind}`}`;
  watchFile(file ? artifact.path : null);
  if (tab === 'code') { body.innerHTML = `<pre><code class="hljs">${highlight(text, ART[kind][2])}</code></pre>`; return; }
  if (file) {
    // Documento local: lo sirve docview.mjs (convertido si es Word, Excel o PowerPoint)
    const own = artifact;
    body.innerHTML = '<div class="preview-view loading">Abriendo…</div>';
    api.previewFile(own.path, state.convs.get(own.convId)?.cwd).then((url) => {
      if (artifact !== own) return;
      if (!url) { body.innerHTML = `<div class="preview-error">No encuentro ${esc(own.path)}: ¿se ha movido o borrado?</div>`; return; }
      const wv = document.createElement('webview');
      wv.setAttribute('partition', 'vista-previa');
      wv.setAttribute('src', url);
      own.wv = wv;
      body.replaceChildren(wv);
    }).catch(() => { if (artifact === own) body.innerHTML = `<div class="preview-error">No se ha podido abrir ${esc(own.path)}</div>`; });
  } else if (kind === 'url') {
    // Página viva de un servidor local: se actualiza ella sola; el título, el suyo
    const wv = document.createElement('webview');
    wv.setAttribute('partition', 'vista-previa');
    wv.setAttribute('src', text);
    const own = artifact;
    wv.addEventListener('page-title-updated', (ev) => {
      if (artifact !== own || !ev.title) return;
      own.title = ev.title;
      artEl.querySelector('.artifact-title').textContent = ev.title;
    });
    body.replaceChildren(wv);
  } else if (kind === 'html') {
    const wv = document.createElement('webview');
    wv.setAttribute('partition', 'vista-previa');
    wv.setAttribute('src', `data:text/html;charset=utf-8,${encodeURIComponent(text.slice(0, 1500000))}`);
    body.replaceChildren(wv);
  } else if (kind === 'markdown') {
    body.innerHTML = `<div class="md">${md(text)}</div>`;
  } else {
    const d = diagrams.get(artifact.key);
    artifact.img = d?.img;
    body.innerHTML = d?.img ? `<img src="${d.img}" alt="${esc(artifact.title)}">`
      : d?.error ? `<div class="preview-error">No se ha podido dibujar: ${esc(d.error)}</div>` : '<div class="preview-view loading">Dibujando…</div>';
  }
}
artEl.querySelector('.artifact-head').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-art]');
  if (!btn || !artifact) return;
  const a = btn.dataset.art;
  if (a === 'view' || a === 'code') { if (artifact.tab !== a) { artifact.tab = a; renderArtifact(); } }
  else if (a === 'close') closeArtifact();
  else if (a === 'window') { if (artifact.kind === 'file') api.openPath(artifact.path); else if (artifact.kind === 'url') window.open(artifact.text); else api.previewHtml(artifact.text); } // window.open → navegador
  else if (a === 'folder') api.showInFolder(artifact.path);
  else if (a === 'wide') { artEl.classList.toggle('wide'); btn.title = artEl.classList.contains('wide') ? 'Volver al chat' : 'Ampliar sobre el chat'; }
  else if (a === 'copy') { navigator.clipboard.writeText(artifact.text); flashCopied(btn); }
  else if (a === 'save') {
    const name = `${artifact.title.replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 60) || 'artefacto'}.${ART[artifact.kind][1]}`;
    const p = await api.exportChat({ name, text: artifact.text, cwd: current()?.cwd, title: 'Guardar el artefacto' });
    if (p) toast(`Guardado en ${shortPath(p)}`);
  }
});
$('#art-docs').addEventListener('click', () => { const f = current()?.files?.[0]; if (f) { openFileArtifact(f.path, current().id); if ((current().files.length || 0) > 1) toggleFileList(true); } });
// Ancho: arrastrando el borde izquierdo (el <webview> se tragaría el ratón: se desactiva mientras)
artEl.querySelector('.artifact-resize').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const handle = e.currentTarget;
  handle.setPointerCapture(e.pointerId);
  document.body.classList.add('art-resizing');
  const move = (ev) => {
    const w = Math.round(Math.min(window.innerWidth - 640, Math.max(300, artEl.getBoundingClientRect().right - ev.clientX)));
    artEl.style.width = `${w}px`;
  };
  const up = () => {
    handle.removeEventListener('pointermove', move);
    document.body.classList.remove('art-resizing');
    try { localStorage.setItem('artifactW', parseInt(artEl.style.width, 10)); } catch {}
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('lostpointercapture', up, { once: true });
});

// Fórmulas con KaTeX: $$…$$ o \[…\] en bloque, $…$ o \(…\) en línea. Para no confundir importes
// ni variables («cuesta $5 y $10», «$HOME/$USER»), el $ de cierre no va tras espacio ni antes de letra o cifra.
const tex = (src, displayMode) => {
  try { return katex.renderToString(src, { displayMode, throwOnError: false, output: 'html' }); } catch { return esc(src); }
};
const mathBlock = {
  name: 'mathBlock', level: 'block',
  start: (src) => src.match(/\$\$|\\\[/)?.index,
  tokenizer(src) {
    const m = /^\$\$([\s\S]+?)\$\$[^\S\n]*(?:\n|$)/.exec(src) || /^\\\[([\s\S]+?)\\\][^\S\n]*(?:\n|$)/.exec(src);
    if (m) return { type: 'mathBlock', raw: m[0], text: m[1].trim() };
  },
  renderer: (t) => `<div class="math-block">${tex(t.text, true)}</div>`,
};
const mathInline = {
  name: 'mathInline', level: 'inline',
  start: (src) => src.match(/\$|\\\(/)?.index,
  tokenizer(src) {
    const m = /^\$\$([^$]+?)\$\$/.exec(src) || /^\$(?![\s$])([^$\n]+?)(?<!\s)\$(?![\w$])/.exec(src) || /^\\\(([^\n]+?)\\\)/.exec(src);
    if (m) return { type: 'mathInline', raw: m[0], text: m[1].trim(), display: m[0].startsWith('$$') };
  },
  renderer: (t) => tex(t.text, t.display),
};

marked.use({
  gfm: true,
  breaks: true,
  extensions: window.katex ? [mathBlock, mathInline] : [],
  renderer: {
    code({ text, lang }) {
      const language = (lang || '').trim().split(/\s/)[0].toLowerCase();
      if (language === 'mermaid') return previewBlock('mermaid', text, 'Diagrama');
      if (language === 'svg' || (['xml', 'html', ''].includes(language) && /^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(text))) return previewBlock('svg', text, 'SVG');
      // HTML y documentos largos: «Vista previa» / «Abrir» los lleva al panel lateral (como los artefactos de claude.ai).
      // Solo páginas que se sostienen solas (documento completo o con su <style>/<script>): un fragmento recortado
      // de una web (clases de un CSS que no viene, iconos con «…») saldría sin estilos y con huecos
      const art = language === 'html' && /<(html|body|!doctype|head|script|style)\b/i.test(text) ? ['html', I.play, 'Vista previa']
        : ['markdown', 'md'].includes(language) && text.split('\n').length > 6 ? ['markdown', I.panel, 'Abrir'] : null;
      if (art) {
        return codeBlock(text, language).replace('<div class="codeblock">', `<div class="codeblock" data-kind="${art[0]}">`).replace('<button class="code-copy" data-action="copy-code">',
          `<button class="code-copy" data-action="open-artifact" title="Abrir en el panel lateral">${art[1]}<span>${art[2]}</span></button><button class="code-copy" data-action="copy-code">`);
      }
      return codeBlock(text, language);
    },
  },
});

const mdCache = new Map();
function md(text) {
  if (mdCache.has(text)) return mdCache.get(text);
  const html = DOMPurify.sanitize(marked.parse(text || ''));
  if (mdCache.size > 500) mdCache.clear();
  mdCache.set(text, html);
  return html;
}

// ---------- Pestañas ----------
const tabsEl = $('#tabs');
function tabTitle(id) {
  const c = state.convs.get(id);
  if (!c) return 'Nueva conversación';
  if (c.title === 'Nueva conversación' && c.preset) return c.preset.name;
  return c.title;
}
const presetAvatar = (p, cls = 'tab-avatar') => `<span class="${cls}" style="--c:${esc(p.color || '#c96442')}">${esc(p.emoji || p.name?.[0]?.toUpperCase() || '?')}</span>`;

// Mientras se arrastra una pestaña no se repinta la barra: se perdería el elemento arrastrado
// (y con él el arrastre); se pinta al soltar
let dragId = null;
let tabsDirty = false;
function renderTabs() {
  if (dragId) { tabsDirty = true; return; }
  tabsDirty = false;
  tabsEl.innerHTML = state.tabs.map((id) => {
    const c = state.convs.get(id);
    const active = id === state.activeId;
    let icon;
    if (c?.prompts?.length) icon = `<span class="tab-attn" title="Esperando tu respuesta">${I.question}</span>`;
    else if (c?.busy) icon = '<span class="tab-spinner"></span>';
    else if (state.unread.has(id)) icon = '<span class="tab-dot"></span>';
    else if (c?.preset) icon = presetAvatar(c.preset);
    else if (c?.picker) icon = `<span class="tab-icon picker-icon">${I.plus}</span>`;
    else icon = `<span class="tab-icon">${sparkSvg()}</span>`;
    const title = tabTitle(id);
    return `<div class="tab${active ? ' active' : ''}" data-id="${esc(id)}" draggable="true" title="${esc(title)}${c ? `\n${esc(c.cwd)}` : ''}">
      ${icon}<span class="tab-title">${esc(title)}</span>
      <button class="tab-close" data-close title="Cerrar pestaña (${K('Ctrl+W')})">${I.x}</button></div>`;
  }).join('');
  const c = current();
  // Como Chrome con los perfiles: con varias cuentas, la de la ventana al final
  renderSide();
  document.title = (c?.messages.length ? `${c.title} · Claude` : 'Claude Assistant') + (state.config?.profile ? ' (pruebas)' : '') + (state.markEmail ? ` — ${state.markEmail}` : '');
  syncTabOrder();
}

// El proceso principal conoce el orden de las pestañas para reabrirlas igual tras un reinicio
let lastOrderSig = '';
function syncTabOrder() {
  const order = state.tabs.filter((id) => !isPicker(id));
  const sig = order.join() + '|' + state.activeId;
  if (sig === lastOrderSig) return;
  lastOrderSig = sig;
  api.setTabOrder(order, isPicker(state.activeId) ? null : state.activeId);
}

function saveDraft() {
  if (!state.activeId) return;
  state.drafts.set(state.activeId, { text: input.value, attachments: state.attachments });
}
function restoreDraft(id) {
  const d = state.drafts.get(id);
  input.value = d?.text || '';
  state.attachments = d?.attachments || [];
  renderAttachments();
  autosize();
}

// Pestaña nueva = selector de presets (como el selector de perfiles de Chrome)
let pickerSeq = 0;
const isPicker = (id) => String(id).startsWith('picker-');
function newTab() {
  const id = `picker-${++pickerSeq}`;
  state.convs.set(id, { id, picker: true, title: 'Nueva pestaña', messages: [], prompts: [], queue: [], tasks: [] });
  const at = state.tabs.indexOf(state.activeId);
  state.tabs.splice(at < 0 ? state.tabs.length : at + 1, 0, id);
  activateTab(id);
}

// Abre una sesión real con un preset (o en blanco) en lugar de un selector o junto a la pestaña actual
// resume: id de una conversación que retomar (historial), con su título
// here: en esta ventana aunque el preset tenga otra cuenta
async function openSession({ presetId = null, cwd, replace, resume, title, here } = {}) {
  const conv = await api.createTab({ presetId, cwd, resume, title, here });
  const preset = state.config.presets?.find((p) => p.id === presetId);
  // Preset con otra cuenta: se ha abierto en una ventana de esa cuenta
  if (conv.elsewhere) {
    toast(`«${preset?.name || 'Preset'}» se abre en la ventana de ${conv.elsewhere === true ? 'su cuenta' : conv.elsewhere}`);
    if (preset?.startupPrompt?.trim()) api.send(conv.id, { text: preset.startupPrompt.trim(), auto: true });
    return conv;
  }
  state.convs.set(conv.id, conv);
  const idx = replace ? state.tabs.indexOf(replace) : -1;
  if (idx >= 0) {
    state.tabs[idx] = conv.id;
    state.convs.delete(replace);
    if (state.activeId === replace) state.activeId = null;
  } else {
    const at = state.tabs.indexOf(state.activeId);
    state.tabs.splice(at < 0 ? state.tabs.length : at + 1, 0, conv.id);
  }
  activateTab(conv.id);
  if (!resume && preset?.startupPrompt?.trim()) api.send(conv.id, { text: preset.startupPrompt.trim(), auto: true });
  return conv;
}

function activateTab(id) {
  if (!state.convs.has(id)) return;
  if (id !== state.activeId) {
    saveDraft();
    state.activeId = id;
    state.openKeys.clear();
    state.shutKeys.clear();
    restoreDraft(id);
  }
  state.unread.delete(id);
  closePopover();
  closeAc();
  state.promptSig = null; // repintar las preguntas aunque la nueva no tenga (si no, se quedaban las de la anterior)
  renderTabs();
  showView();
  focusInput();
  tabsEl.querySelector('.tab.active')?.scrollIntoView({ inline: 'nearest' });
}

// moved: la pestaña se ha ido a otra ventana; su sesión sigue abierta
async function closeTab(id, { moved } = {}) {
  const idx = state.tabs.indexOf(id);
  if (idx < 0) return;
  state.tabs.splice(idx, 1);
  state.unread.delete(id);
  state.drafts.delete(id);
  state.convs.delete(id);
  disposeTerm(id);
  if (!isPicker(id) && !moved) api.closeTab(id);
  // La barra lateral la tenía como abierta aquí: si no, la daría por abierta en otra ventana
  if (!moved && side.items.some((it) => it.openIn === id)) { for (const it of side.items) if (it.openIn === id) it.openIn = null; refreshSide(); }
  if (state.activeId === id) {
    state.activeId = null;
    const next = state.tabs[Math.min(idx, state.tabs.length - 1)];
    if (next) activateTab(next);
  }
  // Una ventana secundaria sin pestañas se cierra, como en Windows Terminal
  if (!state.tabs.length && state.secondary) api.closeWindow();
  else if (!state.tabs.length) await newTab();
  else renderTabs();
}

async function closeTabs(ids) {
  for (const id of ids) await closeTab(id);
}

function cycleTab(dir) {
  if (state.tabs.length < 2) return;
  const i = state.tabs.indexOf(state.activeId);
  activateTab(state.tabs[(i + dir + state.tabs.length) % state.tabs.length]);
}

function startRename(tab) {
  const id = tab.dataset.id;
  const titleEl = tab.querySelector('.tab-title');
  const inputEl = document.createElement('input');
  inputEl.className = 'tab-rename';
  inputEl.value = tabTitle(id);
  titleEl.replaceWith(inputEl);
  tab.draggable = false;
  inputEl.focus();
  inputEl.select();
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const title = inputEl.value.trim();
    if (save && title) {
      const c = state.convs.get(id);
      if (c) c.title = title;
      api.renameTab(id, title);
      if (c && !c.picker) saveSide({ titles: { ...sideCfg().titles, [c.sessionId || c.id]: title } });
    }
    renderTabs();
  };
  inputEl.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  inputEl.addEventListener('blur', () => finish(true));
}

tabsEl.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab || e.target.closest('input')) return;
  if (e.target.closest('[data-close]')) return closeTab(tab.dataset.id);
  if (tab.dataset.id !== state.activeId) activateTab(tab.dataset.id);
});
tabsEl.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
tabsEl.addEventListener('auxclick', (e) => {
  const tab = e.target.closest('.tab');
  if (tab && e.button === 1) closeTab(tab.dataset.id);
});
tabsEl.addEventListener('dblclick', (e) => {
  const tab = e.target.closest('.tab');
  if (tab && !e.target.closest('[data-close]')) startRename(tab);
});
tabsEl.addEventListener('contextmenu', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  e.preventDefault();
  const id = tab.dataset.id;
  const idx = state.tabs.indexOf(id);
  const c = state.convs.get(id);
  const items = [
    { value: 'rename', title: 'Renombrar pestaña' },
    ...(c?.picker ? [] : [{ value: 'dup', title: c?.preset ? `Otra pestaña de ${c.preset.name}` : 'Otra pestaña en la misma carpeta' }]),
    ...(c?.messages?.length ? [{ value: 'export', title: 'Exportar a Markdown…' }] : []),
    ...(c?.picker ? [] : [{ value: 'split', title: 'Mover a la otra mitad', desc: 'Con la misma cuenta, a la mitad derecha de esta ventana; con otra, a una ventana al lado' }]),
    { sep: true },
    { value: 'close', title: 'Cerrar pestaña', desc: K('Ctrl+W') },
  ];
  if (state.tabs.length > 1) items.push({ value: 'others', title: 'Cerrar las demás pestañas' });
  if (idx < state.tabs.length - 1) items.push({ value: 'right', title: 'Cerrar pestañas a la derecha' });
  openPopover(tab, tabTitle(id), items, (it) => {
    if (it.value === 'rename') startRename(tabsEl.querySelector(`.tab[data-id="${CSS.escape(id)}"]`));
    else if (it.value === 'dup') openSession({ presetId: c.preset?.id, cwd: c.cwd, here: true }); // con la cuenta de esta ventana
    else if (it.value === 'export') exportConversation(c, null, true);
    else if (it.value === 'split') splitWindow(tabsEl.querySelector(`.tab[data-id="${CSS.escape(id)}"]`) || $('#tb-menu'), id);
    else if (it.value === 'close') closeTab(id);
    else if (it.value === 'others') closeTabs(state.tabs.filter((t) => t !== id));
    else if (it.value === 'right') closeTabs(state.tabs.slice(state.tabs.indexOf(id) + 1));
  });
});

tabsEl.addEventListener('dragstart', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  dragId = tab.dataset.id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('application/x-tab', dragId);
  // La imagen que sigue al cursor es la pestaña tal cual; la de la barra se atenúa después
  // (si se atenúa antes, la imagen sale atenuada)
  e.dataTransfer.setDragImage(tab, e.clientX - tab.getBoundingClientRect().left, e.clientY - tab.getBoundingClientRect().top);
  requestAnimationFrame(() => tab.classList.add('dragging'));
});
tabsEl.addEventListener('dragover', (e) => {
  if (!e.dataTransfer.types.includes('application/x-tab')) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  // Pestaña de otra ventana: se puede soltar aquí (la recoge ui:take-tab)
  const tab = e.target.closest('.tab');
  if (!dragId || !tab || tab.dataset.id === dragId) return;
  // Reordenar moviendo el elemento, sin repintar
  const dragged = tabsEl.querySelector(`.tab[data-id="${CSS.escape(dragId)}"]`);
  const r = tab.getBoundingClientRect();
  const after = e.clientX > r.left + r.width / 2;
  const ref = after ? tab.nextElementSibling : tab;
  if (!dragged || ref === dragged || ref === dragged.nextElementSibling) return;
  tabsEl.insertBefore(dragged, ref);
  state.tabs = [...tabsEl.querySelectorAll('.tab')].map((el) => el.dataset.id);
});
// Al soltar fuera de la barra: otra ventana (o la barra de otra ventana); lo decide el proceso principal
tabsEl.addEventListener('dragend', async () => {
  const id = dragId;
  dragId = null;
  tabsEl.querySelector('.tab.dragging')?.classList.remove('dragging');
  if (tabsDirty) renderTabs(); else syncTabOrder();
  if (!id) return;
  const alone = state.tabs.length === 1;
  // Una pestaña nueva sin usar no tiene sesión: la otra ventana abre la suya
  if (await api.dropTab(isPicker(id) ? null : id, { alone }) === 'moved') closeTab(id, { moved: true });
});
// Arrastrando una pestaña, toda la ventana la acepta (si no, Windows enseña el cursor de prohibido)
window.addEventListener('dragover', (e) => {
  if (e.dataTransfer?.types.includes('application/x-tab')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
});
window.addEventListener('drop', (e) => { if (e.dataTransfer?.types.includes('application/x-tab')) e.preventDefault(); });

// Pestaña que llega de otra ventana: se coloca donde se soltó
api.onTakeTab(({ conv, x }) => {
  if (state.convs.has(conv.id)) return activateTab(conv.id);
  state.convs.set(conv.id, conv);
  let at = state.tabs.length;
  if (x != null) {
    const i = [...tabsEl.querySelectorAll('.tab')].findIndex((el) => { const r = el.getBoundingClientRect(); return x < r.left + r.width / 2; });
    if (i >= 0) at = i;
  }
  state.tabs.splice(at, 0, conv.id);
  // Si solo había una pestaña nueva sin usar, sobra
  const blank = state.tabs.filter((t) => isPicker(t) && !state.drafts.get(t)?.text);
  activateTab(conv.id);
  if (blank.length && state.tabs.length === blank.length + 1) blank.forEach((t) => closeTab(t));
});

$('#new-tab').addEventListener('click', () => newTab());
$('#tb-settings').addEventListener('click', () => openSettings());
$('#tb-keys').addEventListener('click', () => showHelp());
$('#tb-menu').addEventListener('click', (e) => {
  openPopover(e.currentTarget, 'Claude Assistant', [
    { value: 'new', title: 'Nueva pestaña', desc: K('Ctrl+T') },
    ...(state.config.presets || []).map((p) => ({ value: `preset:${p.id}`, title: `${p.emoji ? p.emoji + '  ' : ''}${p.name}`, desc: 'Abrir directamente' })),
    { value: 'history', title: 'Conversaciones anteriores', desc: K('Ctrl+H · retomar una conversación') },
    ...(current()?.messages?.length ? [{ value: 'export', title: 'Exportar la conversación…', desc: 'Markdown · /export' }] : []),
    { sep: true },
    ...(state.accountCount > 1 ? [{ value: 'account-window', title: 'Nueva ventana con otra cuenta…', desc: 'Cada ventana lleva el color de su cuenta' }] : []),
    { value: 'split', title: 'Dividir en dos', desc: K('Ctrl+Shift+D') + ' · con la misma cuenta, esta ventana en dos mitades; con otra, dos ventanas lado a lado' },
    { value: 'tile', title: 'Colocar las ventanas lado a lado' },
    { sep: true },
    { value: 'presets', title: 'Gestionar presets' },
    { value: 'settings', title: 'Configuración', desc: K('Ctrl+,') },
    { value: 'help', title: 'Atajos de teclado', desc: 'F1' },
    { value: 'setup', title: 'Puesta a punto', desc: 'Lo necesario para funcionar' },
  ], (it) => {
    if (it.value === 'setup') return openSetup();
    if (it.value === 'new') newTab();
    else if (it.value === 'history') openHistory();
    else if (it.value === 'export') exportConversation(current(), null, true);
    else if (it.value === 'split') splitWindow($('#tb-menu'));
    else if (it.value === 'account-window') openAccountWindowMenu();
    else if (it.value === 'tile') tileWindows();
    else if (it.value.startsWith('preset:')) openSession({ presetId: it.value.slice(7) });
    else if (it.value === 'presets') openSettings('presets');
    else if (it.value === 'settings') openSettings();
    else if (it.value === 'help') showHelp();
  });
});

// ---------- Vista principal ----------
const input = $('#input');
const thread = $('#thread');
const scroller = $('#messages');
const promptsEl = $('#prompts');

function greeting() {
  const h = new Date().getHours();
  const base = h < 6 ? 'Buenas noches' : h < 13 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches';
  const name = state.config?.userName?.trim();
  return name ? `${base}, ${name}` : base;
}

function showView() {
  const c = current();
  const picking = !!c?.picker;
  const terminal = !!c?.terminal;
  const termView = terminal && termViewOf(c.id) === 'terminal';
  $('#picker').hidden = !picking;
  $('#stage').hidden = picking || termView;
  $('#terms').hidden = !termView;
  $('#term-view').hidden = !terminal;
  if (picking) { promptsEl.innerHTML = ''; state.promptSig = null; renderPicker(); return; }
  if (termView) { renderContext(null); showTerminal(c); return; }
  // Vista de chat de una pestaña de terminal: la terminal sigue por detrás, oculta
  if (terminal) runTermHidden(c);
  const empty = !c || (c.messages.length === 0 && !c.busy);
  $('#main').classList.toggle('is-empty', empty);
  input.placeholder = empty ? (c?.preset ? `${c.preset.name}: ¿en qué te ayudo?` : '¿En qué te puedo ayudar?') : c.busy ? 'Escribe para añadir instrucciones; se enviarán en cuanto Claude pueda…' : idleHint(c);
  if (empty) $('#greeting').textContent = greeting();
  const wp = $('#welcome-preset');
  wp.innerHTML = c?.preset ? `${presetAvatar(c.preset, 'wp-avatar')}<span>${esc(c.preset.name)}</span>` : '';
  wp.hidden = !c?.preset;
  renderThread();
  renderPrompts();
  renderQueue();
  renderTasks();
  renderChips();
  renderDocsButton();
  updateComposer();
  scrollToBottom();
  updateToBottom();
}

$('#suggestions').innerHTML = SUGGESTIONS.map((s, i) => `<button class="suggestion" data-i="${i}">${I[s.icon]}${esc(s.text)}</button>`).join('');
$('#suggestions').addEventListener('click', (e) => {
  const b = e.target.closest('.suggestion');
  if (!b) return;
  input.value = SUGGESTIONS[b.dataset.i].text;
  submit();
});

// ---------- Herramientas ----------
function diffHtml(oldStr, newStr) {
  const lines = [];
  for (const l of String(oldStr ?? '').split('\n')) lines.push(`<span class="del">- ${esc(l)}</span>`);
  for (const l of String(newStr ?? '').split('\n')) lines.push(`<span class="add">+ ${esc(l)}</span>`);
  return `<pre class="diff">${lines.join('\n')}</pre>`;
}

function toolInputHtml(b) {
  const i = b.input || {};
  const ext = (i.file_path || '').split('.').pop().toLowerCase();
  switch (b.name) {
    case 'Bash':
    case 'PowerShell':
      return `${i.description ? `<div class="tool-desc">${esc(i.description)}</div>` : ''}<pre class="cmd">${highlight(i.command || '', b.name === 'Bash' ? 'bash' : 'powershell')}</pre>`;
    case 'Edit':
      return `<div class="tool-path">${esc(i.file_path)}${i.replace_all ? ' · todas las apariciones' : ''}</div>${diffHtml(i.old_string, i.new_string)}`;
    case 'MultiEdit':
      return `<div class="tool-path">${esc(i.file_path)}</div>${(i.edits || []).map((e) => diffHtml(e.old_string, e.new_string)).join('')}`;
    case 'Write':
      return `<div class="tool-path">${esc(i.file_path)}</div>${codeBlock(i.content || '', LANG_BY_EXT[ext], baseName(i.file_path))}`;
    case 'Read':
      return `<div class="tool-path">${esc(i.file_path)}${i.offset ? ` · desde la línea ${i.offset}` : ''}${i.limit ? ` · ${i.limit} líneas` : ''}</div>`;
    case 'Task':
    case 'Agent':
      return `<div class="tool-desc">${esc(i.description || '')}${i.subagent_type ? ` · ${esc(i.subagent_type)}` : ''}</div><details class="sub-prompt"><summary>Instrucciones al subagente</summary><div class="md">${md(i.prompt || '')}</div></details>`;
    case 'ExitPlanMode':
      return `<div class="md">${md(i.plan || '')}</div>`;
    case 'AskUserQuestion':
      return (i.questions || []).map((q) => `<div class="tool-desc"><b>${esc(q.header)}</b> · ${esc(q.question)}</div>`).join('');
    default:
      return `<pre>${esc(JSON.stringify(i, null, 2))}</pre>`;
  }
}

function toolResultHtml(b) {
  if (b.result === undefined) return '';
  if (b.name === 'Read' && !b.isError) {
    const lines = b.result.split('\n').length;
    return `<div class="label">Resultado</div><div class="tool-desc">${lines} líneas leídas</div>`;
  }
  if ((b.name === 'Task' || b.name === 'Agent') && !b.isError) {
    return `<div class="label">Informe del subagente</div><div class="md sub-result">${md(b.result)}</div>`;
  }
  return `<div class="label">${b.isError ? 'Error' : 'Resultado'}</div><pre>${esc(b.result || '(sin salida)')}</pre>`;
}

// Vista de la conversación (Apariencia o Ctrl+O): normal (todo plegado), con el razonamiento a la
// vista o detallada (todo desplegado, como el modo detallado de Claude Code). Lo que el usuario
// abre o pliega a mano manda sobre la vista.
const VIEWS = { normal: 'Normal', thinking: 'Con el razonamiento', verbose: 'Detallada' };
const viewOf = (c) => state.views.get(c?.id) || lookOf(state.config).transcript;
let viewNow = 'normal'; // la de la pestaña que se está pintando (la fija messageHtml)
function openAttr(key, kind) {
  if (state.openKeys.has(key)) return ' open';
  if (state.shutKeys.has(key)) return '';
  return viewNow === 'verbose' || (viewNow === 'thinking' && kind !== 'tool') ? ' open' : '';
}
function cycleView() {
  const c = current();
  if (!c || c.picker) return;
  const order = Object.keys(VIEWS);
  const next = order[(order.indexOf(viewOf(c)) + 1) % order.length];
  if (next === lookOf(state.config).transcript) state.views.delete(c.id); else state.views.set(c.id, next);
  state.openKeys.clear();
  state.shutKeys.clear();
  renderThread();
  toast(`Vista: ${VIEWS[next]}`);
}

function childrenHtml(children) {
  if (!children?.length) return '';
  const rows = children.map((ch) => {
    if (ch.type === 'text') return `<div class="sub-text">${esc(ch.text.split('\n')[0].slice(0, 200))}</div>`;
    const meta = toolMeta(ch.name);
    const st = ch.result === undefined ? 'running' : ch.isError ? 'failed' : 'ok';
    return `<div class="sub-tool ${st}"><span class="tool-icon xs">${I[meta.icon]}</span><span class="tool-name">${esc(meta.label)}</span><span class="tool-preview">${esc(toolPreview(ch))}</span></div>`;
  }).join('');
  return `<div class="label">Actividad del subagente · ${children.filter((c) => c.type === 'tool').length} acciones</div><div class="sub-list">${rows}</div>`;
}

function toolHtml(b, key, live) {
  const meta = toolMeta(b.name);
  const status = b.result === undefined ? (live ? 'running' : 'stopped') : b.isError ? 'failed' : 'ok';
  const stateText = { running: 'en curso', failed: 'error', stopped: 'detenido' }[status] || '';
  return `<details class="tool ${status}" data-key="${key}"${openAttr(key, 'tool')}>
    <summary><span class="tool-icon">${I[meta.icon]}</span><span class="tool-name">${esc(meta.label)}</span>
      <span class="tool-preview">${esc(toolPreview(b))}</span><span class="tool-state">${stateText}</span></summary>
    <div class="tool-body">${toolInputHtml(b)}${childrenHtml(b.children)}${toolResultHtml(b)}</div>
  </details>`;
}

function toolGroupHtml(tools, key, live) {
  const running = live && tools.some((t) => t.result === undefined);
  const metas = tools.map((t) => toolMeta(t.name));
  const icons = [...new Set(metas.map((m) => m.icon))].slice(0, 3).map((ic) => `<span>${I[ic]}</span>`).join('');
  let label;
  if (running) {
    const cur = tools.findLast((t) => t.result === undefined);
    const sub = cur.children?.length ? ` · ${cur.children.filter((c) => c.type === 'tool').length} acciones` : '';
    label = `${esc(toolMeta(cur.name).label)}<span class="tg-sub"> · ${esc(toolPreview(cur))}${sub}</span>`;
  } else {
    const names = [...new Set(metas.map((m) => m.label))];
    const failed = tools.filter((t) => t.isError).length;
    label = `${tools.length} ${tools.length === 1 ? 'acción' : 'acciones'}<span class="tg-sub"> · ${esc(names.slice(0, 3).join(', '))}${names.length > 3 ? '…' : ''}${failed ? ` · ${failed} con error` : ''}</span>`;
  }
  return `<details class="toolgroup" data-key="${key}"${openAttr(key, 'group')}>
    <summary><span class="tg-icons">${icons}</span><span class="tg-label">${label}</span>
      ${running ? '<span class="tg-spinner"></span>' : ''}${I.chevron}</summary>
    <div class="tool-list">${tools.map((t, j) => toolHtml(t, `${key}-${j}`, live)).join('')}</div>
  </details>`;
}

// Bloque único con todo el trabajo intermedio de una respuesta
function processHtml(steps, key, live) {
  const tools = steps.filter(({ b }) => b.type === 'tool').map(({ b }) => b);
  const thoughts = steps.filter(({ b }) => b.type === 'thinking').length;
  const running = live && tools.some((t) => t.result === undefined);
  const failed = tools.filter((t) => t.isError).length;
  const metas = tools.map((t) => toolMeta(t.name));
  const icons = [...new Set(metas.map((m) => m.icon))].slice(0, 3).map((ic) => `<span>${I[ic]}</span>`).join('');
  let label;
  if (live) {
    const cur = tools.findLast((t) => t.result === undefined) || tools.at(-1);
    label = `${running ? esc(toolMeta(cur.name).label) : 'Trabajando'}<span class="tg-sub"> · ${esc(running ? toolPreview(cur) : `${tools.length} ${tools.length === 1 ? 'acción' : 'acciones'}`)}</span>`;
  } else {
    const names = [...new Set(metas.map((m) => m.label))];
    label = `${tools.length} ${tools.length === 1 ? 'acción' : 'acciones'}${thoughts ? ` y ${thoughts} ${thoughts === 1 ? 'razonamiento' : 'razonamientos'}` : ''}`
      + `<span class="tg-sub"> · ${esc(names.slice(0, 3).join(', '))}${names.length > 3 ? '…' : ''}${failed ? ` · ${failed} con error` : ''}</span>`;
  }
  const items = steps.map(({ b, j }) => {
    const k = `${key}-${j}`;
    if (b.type === 'tool') return toolHtml(b, k, live);
    if (b.type === 'thinking') {
      return `<details class="tool step-think" data-key="${k}"${openAttr(k, 'think')}>
        <summary><span class="tool-icon">${I.brain}</span><span class="tool-name">Pensamiento</span><span class="tool-preview">${esc(b.text.split('\n').find((l) => l.trim()) || '')}</span></summary>
        <div class="tool-body"><div class="md">${md(b.text)}</div></div></details>`;
    }
    if (b.type === 'text') return `<div class="step-text"><span class="tool-icon">${I.spark}</span><div class="md">${md(b.text)}</div></div>`;
    if (b.type === 'note') return `<div class="step-text"><span class="tool-icon">${I.list}</span><div class="md">${esc(b.text)}</div></div>`;
    return '';
  }).join('');
  return `<details class="toolgroup process" data-key="${key}"${openAttr(key, 'group')}>
    <summary><span class="tg-icons">${icons}</span><span class="tg-label">${label}</span>
      ${running ? '<span class="tg-spinner"></span>' : ''}${I.chevron}</summary>
    <div class="tool-list">${items}</div>
  </details>`;
}

function todoHtml(todos) {
  const done = todos.filter((t) => t.status === 'completed').length;
  return `<div class="todo"><div class="todo-head">${I.list}<span>Tareas</span><span class="todo-count">${done}/${todos.length}</span></div>
    <ul>${todos.map((t) => {
      const icon = t.status === 'completed' ? I.check : t.status === 'in_progress' ? '<span class="todo-spin"></span>' : I.circle;
      const text = t.status === 'in_progress' ? (t.activeForm || t.content) : t.content;
      return `<li class="${t.status}">${icon}<span>${esc(text)}</span></li>`;
    }).join('')}</ul></div>`;
}

// ---------- Mensajes ----------
function renderStats(s) {
  if (!s) return '';
  const parts = [];
  if (s.durationMs) parts.push(s.durationMs < 60000 ? `${(s.durationMs / 1000).toFixed(1)} s` : `${Math.floor(s.durationMs / 60000)} min ${Math.round((s.durationMs % 60000) / 1000)} s`);
  const n = (v) => (v || 0).toLocaleString('es');
  // Entrada nueva y caché por separado: leer de la caché cuesta un 10 %, así que sumarlo todo engañaba
  if (s.tokensOut && 'cacheRead' in s) {
    parts.push(`<span title="Entrada nueva (incluye lo que se escribe en la caché) → salida">${n(s.input + s.cacheWrite)} → ${n(s.tokensOut)} tokens</span>`);
    if (s.cacheRead) parts.push(`<span title="Leído de la caché: cuesta un 10 % de la entrada nueva">${n(s.cacheRead)} en caché</span>`);
  } else if (s.tokensOut) parts.push(`${n(s.tokensIn)} → ${n(s.tokensOut)} tokens`);
  // Con la suscripción no se paga por mensaje: el coste en dólares solo con clave de API
  if (s.cost && s.tokensOut && state.config?.authMode === 'api-key') parts.push(`~${s.cost.toFixed(3)}`);
  return `<span class="stats">${parts.join(' · ')}</span>`;
}

function messageHtml(c, m, i, isLast) {
  viewNow = viewOf(c);
  const cls = `msg${isLast ? ' last' : ''}`;
  if (m.role === 'user') {
    const imgs = m.images?.length ? `<div class="msg-images">${m.images.map((src) => `<img src="${esc(src)}" alt="">`).join('')}</div>` : '';
    if (m.auto) {
      const key = `${i}-auto`;
      return `<div class="${cls} msg-auto" data-i="${i}"><details data-key="${key}"${state.openKeys.has(key) ? ' open' : ''}>
        <summary>${I.bolt}<span>Arranque automático${c.preset ? ` de ${esc(c.preset.name)}` : ''}</span>${I.chevron}</summary>
        <div class="auto-text">${esc(m.text)}</div></details></div>`;
    }
    const isCmd = m.text.startsWith('/');
    return `<div class="${cls} msg-user" data-i="${i}">${imgs}${m.text ? `<div class="bubble${isCmd ? ' cmd' : ''}">${esc(m.text)}</div>` : ''}
      <div class="msg-actions">${branchNav(c, m, i)}${c.terminal && !m.old && rewindable(m) ? `<button class="icon-btn sm" data-action="edit-msg" title="Editar (vuelve a este mensaje, como /rewind)">${I.pencil}</button>` : ''}<button class="icon-btn sm" data-action="copy-msg" title="Copiar">${I.copy}</button></div></div>`;
  }
  const live = isLast && c.busy && !m.done;
  const lastTodo = m.blocks.findLastIndex((b) => b.type === 'todo');
  let body = '';
  const blockHtml = (b, j) => {
    if (b.type === 'text') return `<div class="md">${md(b.text)}</div>`;
    if (b.type === 'thinking') {
      const key = `${i}-th${j}`;
      return `<details class="thinking" data-key="${key}"${openAttr(key, 'think')}><summary>${I.brain}<span>Pensamiento</span>${I.chevron}</summary><div class="md">${md(b.text)}</div></details>`;
    }
    if (b.type === 'todo' && j === lastTodo) return todoHtml(b.todos);
    if (b.type === 'note') return `<div class="note">${b.icon === 'task' ? I.list : b.icon === 'check' ? I.check : b.icon === 'x' ? I.x : I.compress}<span>${esc(b.text)}</span></div>`;
    if (b.type === 'interrupted') return `<div class="error soft">${I.stop}<span>${esc(b.text)}</span></div>`;
    if (b.type === 'error') return `<div class="error">${I.warn}<span>${esc(b.text)}</span></div>`;
    return '';
  };
  // Como Claude Code: lo que Claude va contando se ve en el chat y separa el trabajo intermedio
  // (razonamiento y herramientas) en fichas plegables; debajo, limpia, la respuesta final.
  let cut = m.blocks.length;
  while (cut > 0 && ['text', 'error', 'interrupted', 'note'].includes(m.blocks[cut - 1].type)) cut--;
  const head = m.blocks.slice(0, cut);
  if (head.some((b) => b.type === 'tool')) {
    let seg = [];
    const flush = (last) => {
      if (seg.some(({ b }) => b.type === 'tool')) body += processHtml(seg, `${i}-p${seg[0].j}`, live && last);
      else seg.forEach(({ b, j }) => { body += blockHtml(b, j); });
      seg = [];
    };
    head.forEach((b, j) => {
      if (b.type === 'todo') return;
      if (b.type === 'text') { flush(false); body += blockHtml(b, j); } else seg.push({ b, j });
    });
    flush(true);
    m.blocks.forEach((b, j) => { if (j >= cut || (b.type === 'todo' && j === lastTodo)) body += blockHtml(b, j); });
  } else {
    m.blocks.forEach((b, j) => { body += blockHtml(b, j); });
  }

  // Mientras trabaja, el indicador va aparte (#working) para que su animación no se reinicie en cada repintado
  if (!live && m.done && m.blocks.length) {
    const canRetry = isLast && !m.old && c.terminal && !c.busy && c.messages.some((x) => rewindable(x) && !x.images?.length);
    body += `<div class="msg-actions"><button class="icon-btn sm" data-action="copy-msg" title="Copiar respuesta">${I.copy}</button>`
      + `<button class="icon-btn sm${speaking === m ? ' on' : ''}" data-action="speak-msg" title="${speaking === m ? 'Dejar de leer' : 'Leer en voz alta'}">${I.speaker}</button>`
      + (canRetry ? `<button class="icon-btn sm" data-action="retry-msg" title="Reintentar (vuelve al último mensaje, como /rewind, y lo manda otra vez)">${I.retry}</button>` : '')
      + `${renderStats(m.stats)}</div>`;
  }
  if (!body) return `<div class="${cls} msg-assistant empty" data-i="${i}"></div>`;
  return `<div class="${cls} msg-assistant" data-i="${i}">${body}</div>`;
}

const nearBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;
const scrollToBottom = () => { scroller.scrollTop = scroller.scrollHeight; };

// Versiones de un mensaje editado (como las ramas de claude.ai): termchat cuelga las anteriores
// de él (m.prev). Ver una anterior es solo para leerla; Claude Code sigue en la última
const branchView = new Map(); // convId -> { i, k }: en el mensaje i se ve la versión k (0 = la primera)
function shownMessages(c) {
  const v = branchView.get(c?.id);
  const prev = v && !c.busy ? c.messages[v.i]?.prev?.[v.k] : null;
  if (!prev) return c?.messages || [];
  return [...c.messages.slice(0, v.i), ...prev.map((m, j) => ({ ...m, old: true, ...(j ? {} : { prev: c.messages[v.i].prev }) }))];
}
function stepBranch(c, i, step) {
  const prev = c.messages[i]?.prev;
  if (!prev?.length) return;
  const v = branchView.get(c.id);
  const k = (v?.i === i ? v.k : prev.length) + step; // prev.length = la última (la de ahora)
  if (k < 0 || k > prev.length) return;
  if (k === prev.length) branchView.delete(c.id); else branchView.set(c.id, { i, k });
  renderThread();
}
function branchNav(c, m, i) {
  const all = m.prev?.length;
  if (!all || c.busy) return '';
  const v = branchView.get(c.id);
  const k = v?.i === i ? v.k : all;
  return `<span class="branch-nav"><button class="icon-btn xs" data-action="branch" data-step="-1" title="Versión anterior"${k ? '' : ' disabled'}>‹</button><span>${k + 1}/${all + 1}</span><button class="icon-btn xs" data-action="branch" data-step="1" title="Versión siguiente"${k < all ? '' : ' disabled'}>›</button></span>`;
}

function renderThread() {
  const c = current();
  if (!c) { thread.innerHTML = ''; updateWorking(); return; }
  const msgs = shownMessages(c);
  const n = msgs.length;
  thread.innerHTML = msgs.map((m, i) => messageHtml(c, m, i, i === n - 1)).join('')
    + (msgs !== c.messages ? '<div class="branch-note">Versión anterior, solo para leer: Claude sigue con la última, y lo que escribas continúa desde ella.</div>' : '');
  thread.dataset.count = n;
  if (thread.querySelector('.preview-view.loading')) queueDiagrams(); // el HTML pudo salir de mdCache
  // El panel sigue abierto al cambiar de pestaña (con lo que mostraba), salvo que esta tenga algo nuevo que enseñar
  if (artPending.has(c.id)) { openArtifactUrl(artPending.get(c.id), c.id); artPending.delete(c.id); }
  else if (filePending.has(c.id)) { openFileArtifact(filePending.get(c.id), c.id); filePending.delete(c.id); }
  else if (artifact?.kind === 'mermaid' && !artifact.img) renderArtifact(); // quizá ya está dibujado
  if (artifact) { artFiles.hidden = true; artEl.querySelector('.artifact-title').classList.toggle('pick', !!filesConv()?.files?.length); }
  updateWorking();
}

// Indicador «Claude está trabajando»: un único elemento persistente; solo cambia su texto
const workingEl = $('#working');
workingEl.querySelector('.spark').innerHTML = sparkSvg();
function updateWorking() {
  const c = current();
  const last = c?.messages?.at(-1);
  const live = !!(c?.busy && !c.picker && last?.role === 'assistant' && !last.done);
  workingEl.hidden = !live;
  if (!live) return;
  const runningTool = last.blocks.findLast((b) => b.type === 'tool' && b.result === undefined);
  let label = 'Pensando…';
  if (c.prompts?.length) label = 'Esperando tu respuesta…';
  else if (runningTool) label = `${toolMeta(runningTool.name).label}…`;
  const labelEl = workingEl.querySelector('.shimmer');
  if (labelEl.textContent !== label) labelEl.textContent = label;
}

// Cambia en «el» solo lo que difiere de «next» (mismo mensaje repintado): los bloques que no han
// cambiado se quedan como están, con su selección de texto y sin volver a maquetarse
function morph(el, next) {
  if (el.tagName !== next.tagName || el.className !== next.className || el.attributes.length !== next.attributes.length) {
    el.replaceWith(next);
    return;
  }
  for (const a of next.attributes) if (el.getAttribute(a.name) !== a.value) el.setAttribute(a.name, a.value);
  const want = [...next.childNodes];
  const have = [...el.childNodes];
  want.forEach((n, k) => {
    const o = have[k];
    if (!o) el.append(n);
    else if (!o.isEqualNode(n)) o.replaceWith(n);
  });
  for (const o of have.slice(want.length)) o.remove();
}

// Si solo ha cambiado el último mensaje, se repinta solo ese
function renderLast() {
  const c = current();
  if (!c) return;
  const stick = nearBottom();
  const n = c.messages.length;
  const lastEl = thread.lastElementChild;
  if (!lastEl || Number(thread.dataset.count) !== n || shownMessages(c) !== c.messages || lastEl.classList.contains('branch-note')) {
    renderThread();
  } else {
    // El penúltimo puede haber pasado a "terminado" (por ejemplo, al entrar un mensaje en cola)
    const prev = lastEl.previousElementSibling;
    if (prev && n >= 2) {
      const tmpPrev = document.createElement('div');
      tmpPrev.innerHTML = messageHtml(c, c.messages[n - 2], n - 2, false);
      if (!tmpPrev.firstElementChild.isEqualNode(prev)) morph(prev, tmpPrev.firstElementChild);
    }
    const tmp = document.createElement('div');
    tmp.innerHTML = messageHtml(c, c.messages[n - 1], n - 1, true);
    morph(lastEl, tmp.firstElementChild);
    if (thread.lastElementChild?.querySelector('.preview-view.loading')) queueDiagrams();
  }
  updateWorking();
  if (stick) scrollToBottom();
  updateToBottom();
}

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; renderLast(); });
}

thread.addEventListener('toggle', (e) => {
  const key = e.target.dataset?.key;
  if (!key) return;
  if (e.target.open) { state.openKeys.add(key); state.shutKeys.delete(key); } else { state.openKeys.delete(key); state.shutKeys.add(key); }
}, true);

function swapIcon(btn, svg) {
  const holder = document.createElement('i');
  holder.innerHTML = svg;
  btn.querySelector('svg')?.replaceWith(holder.firstChild);
}
function flashCopied(btn) {
  const original = btn.querySelector('svg')?.outerHTML;
  const label = btn.querySelector('span');
  btn.classList.add('copied');
  swapIcon(btn, I.check);
  if (label) label.textContent = 'Copiado';
  setTimeout(() => {
    btn.classList.remove('copied');
    if (original) swapIcon(btn, original);
    if (label) label.textContent = 'Copiar';
  }, 1400);
}

thread.addEventListener('click', (e) => {
  const link = e.target.closest('a[href]');
  if (link && LOCAL_URL.test(link.href) && !e.ctrlKey && !e.metaKey) { e.preventDefault(); openArtifactUrl(link.href); return; }
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  if (btn.dataset.action === 'speak-msg') { speak(shownMessages(current())[btn.closest('.msg').dataset.i]); return; }
  if (btn.dataset.action === 'retry-msg') { retryLast(current()); return; }
  if (btn.dataset.action === 'branch') { stepBranch(current(), Number(btn.closest('.msg').dataset.i), Number(btn.dataset.step)); return; }
  if (btn.dataset.action === 'edit-msg') { editMessage(current(), shownMessages(current())[btn.closest('.msg').dataset.i]); return; }
  if (btn.dataset.action === 'toggle-code') {
    const box = btn.closest('.codeblock');
    const key = box.dataset.preview;
    if (codeShown.has(key)) codeShown.delete(key); else codeShown.add(key);
    box.classList.toggle('show-code', codeShown.has(key));
    mdCache.clear(); // el HTML guardado lleva la clase
    return;
  }
  if (btn.dataset.action === 'open-artifact') { openArtifactFrom(btn.closest('.codeblock')); return; }
  if (btn.dataset.action === 'copy-code') {
    navigator.clipboard.writeText(btn.closest('.codeblock').querySelector('code').innerText);
  } else if (btn.dataset.action === 'copy-msg') {
    const m = shownMessages(current())[btn.closest('.msg').dataset.i];
    navigator.clipboard.writeText(m.role === 'user' ? m.text : m.blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n\n'));
  }
  flashCopied(btn);
});

// Leer en voz alta una respuesta (la voz del sistema en español; otro clic la para)
let speaking = null;
function speak(m) {
  const synth = window.speechSynthesis;
  const was = speaking;
  synth.cancel();
  speaking = null;
  if (was !== m && m) {
    const text = m.blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n\n')
      .replace(/```[\s\S]*?```/g, ' (bloque de código) ')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_`#>|~]+/g, ' ');
    const u = new SpeechSynthesisUtterance(text);
    const voices = synth.getVoices();
    const voice = voices.find((v) => v.lang === 'es-ES') || voices.find((v) => v.lang?.startsWith('es'));
    if (voice) u.voice = voice;
    u.lang = voice?.lang || 'es-ES';
    u.onend = u.onerror = () => { if (speaking === m) { speaking = null; renderLast(); } };
    speaking = m;
    synth.speak(u);
  }
  renderThread();
}

// Reintentar: vuelve al último mensaje (como /rewind, solo la conversación) y lo manda otra vez.
// Lo que hubiera escrito en el cuadro se guarda y vuelve después.
async function retryLast(c) {
  const m = c?.messages.findLast(rewindable);
  if (!m || c.busy) return;
  const draft = input.value;
  input.value = '';
  await editMessage(c, m);
  if (current()?.id === c.id && input.value.trim() === m.text.trim()) await submit();
  if (draft && !input.value) { input.value = draft; autosize(); }
}

function updateToBottom() {
  $('#to-bottom').hidden = $('#main').classList.contains('is-empty') || nearBottom();
}
scroller.addEventListener('scroll', updateToBottom);
$('#to-bottom').addEventListener('click', () => scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' }));

// ---------- Peticiones: permisos, preguntas y planes ----------
function permissionBody(p) {
  const b = { name: p.toolName, input: p.input };
  return toolInputHtml(b);
}

function promptHtml(p) {
  if (p.kind === 'permission') {
    const meta = toolMeta(p.toolName);
    const opts = [
      `<button class="opt" data-act="allow"><kbd>1</kbd><span>Sí</span></button>`,
      p.canAlways ? `<button class="opt" data-act="always"><kbd>2</kbd><span>${esc(p.alwaysLabel)}</span></button>` : '',
      `<button class="opt" data-act="deny"><kbd>${p.canAlways ? 3 : 2}</kbd><span>No, y decirle qué hacer distinto</span></button>`,
    ].join('');
    return `<div class="prompt-card" data-id="${esc(p.id)}" data-kind="permission">
      <div class="prompt-head"><span class="prompt-icon">${I[meta.icon]}</span><div>
        <div class="prompt-title">${esc(p.title || `¿Permitir ${/^(Leer|Crear|Editar|Buscar|Abrir|Detener|Ver|Actualizar|Nueva|Salida|Entrar|Lista|Recursos)\b/.test(meta.label) ? meta.label[0].toLowerCase() + meta.label.slice(1) : meta.label}?`)}</div>
        ${p.description ? `<div class="prompt-sub">${esc(p.description)}</div>` : ''}
        ${p.reason ? `<div class="prompt-sub">${esc(p.reason)}</div>` : ''}
      </div></div>
      <div class="prompt-body tool-body">${permissionBody(p)}</div>
      <div class="opts">${opts}</div>
      <div class="feedback" hidden><textarea rows="2" placeholder="Dile a Claude qué debería hacer en su lugar…"></textarea>
        <div class="row-end"><button class="btn" data-act="deny-send">Enviar</button></div></div>
    </div>`;
  }
  if (p.kind === 'question') {
    const qs = p.input.questions || [];
    return `<div class="prompt-card" data-id="${esc(p.id)}" data-kind="question">
      <div class="prompt-head"><span class="prompt-icon">${I.question}</span><div><div class="prompt-title">Claude tiene ${qs.length === 1 ? 'una pregunta' : `${qs.length} preguntas`}</div></div></div>
      ${qs.map((q, qi) => `<div class="question" data-q="${qi}" data-multi="${q.multiSelect ? 1 : 0}">
        <div class="q-text"><span class="q-chip">${esc(q.header)}</span>${esc(q.question)}</div>
        <div class="q-layout${q.options.some((o) => o.preview) ? ' has-preview' : ''}">
          <div class="q-opts">${q.options.map((o, oi) => `<button class="q-opt" data-o="${oi}"><span class="q-mark">${q.multiSelect ? I.check : ''}</span><span class="q-num">${oi + 1}</span><span><span class="q-label">${esc(o.label)}</span><span class="q-desc">${esc(o.description)}</span></span></button>`).join('')}
            <label class="q-other"><span class="q-num">${q.options.length + 1}</span><input placeholder="Otra respuesta…"></label>
          </div>
          ${q.options.some((o) => o.preview) ? '<pre class="q-preview"></pre>' : ''}
        </div>
      </div>`).join('')}
      <div class="row-end"><button class="btn" data-act="skip">Omitir</button><button class="btn primary" data-act="answer" disabled>Responder</button></div>
    </div>`;
  }
  // plan: las opciones son las de su diálogo en la terminal, que se contesta con el teclado
  const read = termPlanOptions(current()?.id);
  const opts = read || [
    { n: 1, label: 'Sí, y aceptar ediciones automáticamente' },
    { n: 2, label: 'Sí, pero preguntar antes de cada cambio' },
    { n: 3, label: 'No, dile a Claude qué cambiar', keep: true },
  ];
  return `<div class="prompt-card plan" data-id="${esc(p.id)}" data-kind="plan"${read ? '' : ' data-retry="1"'}>
    <div class="prompt-head"><span class="prompt-icon">${I.plan}</span><div><div class="prompt-title">Plan listo para revisar</div><div class="prompt-sub">Claude no ha tocado nada todavía. ¿Quieres que lo ejecute?</div></div></div>
    <div class="plan-body md">${md(p.input.plan || '')}</div>
    <div class="opts">${opts.map((o, i) => `<button class="opt" data-act="${o.keep ? 'tkeep' : 'tplan'}" data-n="${o.n}"><kbd>${i + 1}</kbd><span>${esc(o.label)}</span></button>`).join('')}</div>
    <div class="feedback" hidden><textarea rows="2" placeholder="¿Qué quieres que cambie del plan?"></textarea>
    <div class="row-end"><button class="btn" data-act="tkeep-send">Enviar</button></div></div>
  </div>`;
}

function renderPrompts() {
  const c = current();
  const prompts = c?.prompts || [];
  const sig = prompts.map((p) => p.id).join(',');
  if (sig === state.promptSig) return;
  const stick = nearBottom();
  state.promptSig = sig;
  promptsEl.innerHTML = prompts.map(promptHtml).join('');
  promptsEl.querySelectorAll('.prompt-card').forEach((card) => {
    if (card.dataset.kind === 'question') initQuestion(card, prompts.find((p) => p.id === card.dataset.id));
  });
  if (prompts.length) { scrollToBottom(); promptsEl.querySelector('.opt, .q-opt')?.focus({ preventScroll: true }); } else if (stick) scrollToBottom();
  // El diálogo del plan aún no se había pintado en la terminal: se vuelven a leer sus opciones
  const retry = promptsEl.querySelector('.prompt-card[data-retry]');
  if (retry) {
    const id = retry.dataset.id;
    const n = (state.planRetries.get(id) || 0) + 1;
    state.planRetries.set(id, n);
    if (n === 12) termScreenMiss('opciones del plan («Would you like to proceed?»)', id);
    if (n < 12) setTimeout(() => { if (current()?.prompts?.some((p) => p.id === id)) { state.promptSig = null; renderPrompts(); } }, 400);
  }
}

function initQuestion(card, p) {
  const qs = p.input.questions || [];
  const sel = qs.map(() => new Set());
  const other = qs.map(() => '');
  const answerBtn = card.querySelector('[data-act="answer"]');
  const refresh = () => {
    card.querySelectorAll('.question').forEach((qEl, qi) => {
      qEl.querySelectorAll('.q-opt').forEach((b) => b.classList.toggle('selected', sel[qi].has(Number(b.dataset.o))));
    });
    answerBtn.disabled = !qs.every((_, qi) => sel[qi].size || other[qi].trim());
  };
  card.querySelectorAll('.question').forEach((qEl, qi) => {
    const q = qs[qi];
    const preview = qEl.querySelector('.q-preview');
    const showPreview = (oi) => { if (preview) preview.textContent = q.options[oi]?.preview || ''; };
    showPreview(0);
    qEl.querySelectorAll('.q-opt').forEach((b) => {
      const oi = Number(b.dataset.o);
      b.addEventListener('mouseenter', () => showPreview(oi));
      b.addEventListener('focus', () => showPreview(oi));
      b.addEventListener('click', () => {
        if (q.multiSelect) { sel[qi].has(oi) ? sel[qi].delete(oi) : sel[qi].add(oi); }
        else { sel[qi] = new Set([oi]); other[qi] = ''; qEl.querySelector('.q-other input').value = ''; }
        refresh();
        // Con una sola pregunta de opción única, elegir ya responde (como en la terminal)
        if (qs.length === 1 && !q.multiSelect) answerBtn.click();
      });
    });
    const otherInput = qEl.querySelector('.q-other input');
    otherInput.addEventListener('input', () => {
      other[qi] = otherInput.value;
      if (!q.multiSelect && other[qi].trim()) sel[qi].clear();
      refresh();
    });
    otherInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !answerBtn.disabled) { e.preventDefault(); answerBtn.click(); } });
  });
  card.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.ctrlKey || e.metaKey || e.altKey || !/^[1-9]$/.test(e.key)) return;
    const qEl = e.target.closest('.question') || card.querySelector('.question');
    const btn = qEl?.querySelectorAll('.q-opt')[Number(e.key) - 1];
    if (btn) { e.preventDefault(); btn.click(); } else if (Number(e.key) === qEl.querySelectorAll('.q-opt').length + 1) { e.preventDefault(); qEl.querySelector('.q-other input').focus(); }
  });
  answerBtn.addEventListener('click', () => {
    const answers = {};
    qs.forEach((q, qi) => {
      const labels = [...sel[qi]].sort().map((oi) => q.options[oi].label);
      if (other[qi].trim()) labels.push(other[qi].trim());
      answers[q.question] = labels.join(', ');
    });
    respond(p.id, { answers });
  });
  refresh();
}

function respond(promptId, payload) {
  const c = current();
  if (!c) return;
  api.respond(c.id, promptId, payload);
  promptsEl.querySelector(`.prompt-card[data-id="${CSS.escape(promptId)}"]`)?.classList.add('answered');
  setTimeout(focusInput, 50);
}

promptsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const card = btn.closest('.prompt-card');
  const id = card.dataset.id;
  const fb = card.querySelector('.feedback');
  switch (btn.dataset.act) {
    case 'allow': return respond(id, { decision: 'allow' });
    case 'always': return respond(id, { decision: 'always' });
    case 'deny':
      fb.hidden = false;
      fb.querySelector('textarea').focus();
      return undefined;
    case 'deny-send': return respond(id, { decision: 'deny', feedback: fb.querySelector('textarea').value });
    case 'tplan':
      termSyncMode(current());
      return respond(id, { option: Number(btn.dataset.n) });
    case 'tkeep':
      fb.dataset.n = btn.dataset.n;
      fb.hidden = false;
      fb.querySelector('textarea').focus();
      return undefined;
    case 'tkeep-send': return respond(id, { option: Number(fb.dataset.n), feedback: fb.querySelector('textarea').value });
    case 'skip': return respond(id, { skip: true });
    default: return undefined;
  }
});
// Selector de opciones como en la terminal: ↑/↓ recorren las opciones (y «Otra respuesta»),
// Enter/Espacio eligen, Tab pasa a los botones y el ratón mueve la misma selección.
const NAV = '.opt, .q-opt, .q-other input';
promptsEl.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const card = e.target.closest('.prompt-card');
  if (!card || e.target.tagName === 'TEXTAREA') return;
  const items = [...card.querySelectorAll(NAV)].filter((el) => el.offsetParent);
  if (!items.length) return;
  e.preventDefault();
  e.stopPropagation();
  const i = items.indexOf(document.activeElement);
  const next = items[i < 0 ? 0 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
  next.focus();
  next.scrollIntoView({ block: 'nearest' });
}, true);
promptsEl.addEventListener('mouseover', (e) => {
  const el = e.target.closest('.opt, .q-opt');
  if (el && document.activeElement !== el && document.activeElement?.tagName !== 'TEXTAREA') el.focus({ preventScroll: true });
});

promptsEl.addEventListener('keydown', (e) => {
  const card = e.target.closest('.prompt-card');
  if (!card || card.dataset.kind === 'question') return;
  if (e.target.tagName === 'TEXTAREA') {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      card.querySelector('[data-act="deny-send"], [data-act="tkeep-send"]')?.click();
    }
    return;
  }
  if (/^[1-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const opt = card.querySelectorAll('.opt')[Number(e.key) - 1];
    if (opt) { e.preventDefault(); opt.click(); }
  }
});

// ---------- Lista de tareas (fija sobre el cuadro de texto, como en la terminal) ----------
const collapsedTasks = new Set();
function renderTasks() {
  const c = current();
  const tasks = c?.tasks || [];
  const pending = tasks.some((t) => t.status !== 'completed');
  const el = $('#tasks');
  // Lo que sigue en segundo plano (como «· 1 shell» al pie de Claude Code)
  const bg = c?.background || [];
  const bgHtml = bg.length ? `<button type="button" class="bg-running" data-open-bg title="${esc(bg.map((x) => x.label).join('\n'))}&#10;&#10;Ver la salida o detener (/tasks)"><span class="todo-spin"></span><span class="q-label-sm">En segundo plano</span><span class="q-text-sm">${esc(bg.map((x) => x.label).join(' · '))}</span>${bg.length > 1 ? `<span class="todo-count">${bg.length}</span>` : ''}${I.chevron}</button>` : '';
  if ($('#bg-dialog').open) renderBackground();
  if (!tasks.length || (!pending && !c.busy)) { el.innerHTML = bgHtml; return; }
  const done = tasks.filter((t) => t.status === 'completed').length;
  const collapsed = collapsedTasks.has(c.id);
  const current_ = tasks.find((t) => t.status === 'in_progress');
  el.innerHTML = `<div class="todo tasks-panel${collapsed ? ' collapsed' : ''}">
    <button type="button" class="todo-head" data-toggle-tasks>${I.list}<span>Tareas</span>${collapsed && current_ ? `<span class="todo-now">${esc(current_.activeForm || current_.subject)}</span>` : ''}<span class="todo-count">${done}/${tasks.length}</span>${I.chevronDown}</button>
    ${collapsed ? '' : `<ul>${tasks.map((t) => {
      const icon = t.status === 'completed' ? I.check : t.status === 'in_progress' ? '<span class="todo-spin"></span>' : I.circle;
      const text = t.status === 'in_progress' ? (t.activeForm || t.subject) : t.subject;
      return `<li class="${t.status}">${icon}<span>${esc(text)}</span></li>`;
    }).join('')}</ul>`}</div>${bgHtml}`;
}
$('#tasks').addEventListener('click', (e) => {
  if (e.target.closest('[data-open-bg]')) { openBackground(current()); return; }
  if (!e.target.closest('[data-toggle-tasks]')) return;
  const id = state.activeId;
  if (collapsedTasks.has(id)) collapsedTasks.delete(id); else collapsedTasks.add(id);
  renderTasks();
});

// ---------- /tasks: lo que sigue en segundo plano ----------
// Como el diálogo de Claude Code: la lista (↑/↓, Enter para ver, K para detener) y, en cada una,
// su salida en vivo (los comandos) o lo que va haciendo (los agentes)
const bgDlg = { convId: null, sel: 0, view: null, timer: null, out: null };
const elapsedText = (ms) => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
};
function openBackground(c) {
  if (!c) return;
  Object.assign(bgDlg, { convId: c.id, sel: 0, view: null, out: null });
  const dlg = $('#bg-dialog');
  renderBackground();
  if (!dlg.open) dlg.showModal();
  $('#bg-body').focus();
  clearInterval(bgDlg.timer);
  bgDlg.timer = setInterval(() => { if (dlg.open) refreshBackground(); }, 1000);
}
function bgTasks() { return state.convs.get(bgDlg.convId)?.background || []; }
function renderBackground() {
  const tasks = bgTasks();
  const task = bgDlg.view && tasks.find((x) => x.id === bgDlg.view);
  if (bgDlg.view && !task) { bgDlg.view = null; bgDlg.out = null; } // ha terminado: de vuelta a la lista
  $('#bg-back').hidden = !task;
  $('#bg-heading').textContent = task ? task.label : 'Tareas en segundo plano';
  const body = $('#bg-body');
  const stopBtn = (x) => x.agent ? '' : `<button type="button" class="btn sm" data-bg-stop="${esc(x.id)}" ${x.stopping ? 'disabled' : ''}>${I.stop}${x.stopping ? 'Deteniendo…' : 'Detener'}</button>`;
  if (task) {
    const o = bgDlg.out;
    const kind = task.agent ? 'Agente' : task.tool === 'PowerShell' ? 'PowerShell' : 'Shell';
    const text = !o ? 'Cargando…' : o.missing ? 'Todavía no hay salida.' : o.text || (task.agent ? 'Todavía no ha hecho nada.' : 'Sin salida todavía.');
    const pre = body.querySelector('.bgt-out');
    const atEnd = !pre || pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 8;
    if (body.dataset.task !== task.id) {
      body.dataset.task = task.id;
      body.innerHTML = `<div class="bgt-meta"><span class="bgt-kind">${kind}</span><span class="bgt-time"></span><span class="bgt-gap"></span>${task.output ? `<button type="button" class="btn sm ghost" data-bg-file>${I.file}Abrir archivo</button>` : ''}<span class="bgt-stop"></span></div>
        ${task.command ? `<pre class="bgt-cmd">${esc(task.command)}</pre>` : ''}<pre class="bgt-out" tabindex="0"></pre>`;
    }
    body.querySelector('.bgt-time').textContent = `${task.stopping ? 'Deteniendo' : 'En marcha'} · ${elapsedText(task.startedAt)}`;
    body.querySelector('.bgt-stop').innerHTML = stopBtn(task);
    const out = body.querySelector('.bgt-out');
    const shown = (o?.cut ? '…\n' : '') + text;
    if (out.textContent !== shown) {
      out.textContent = shown;
      out.classList.toggle('empty', !o || o.missing || !o.text);
      if (atEnd) out.scrollTop = out.scrollHeight; // sigue el final, como un tail -f, salvo si se ha subido
    }
    $('#bg-hint').innerHTML = `${task.agent ? '' : '<kbd>K</kbd> detener · '}<kbd>Esc</kbd> volver`;
    return;
  }
  delete body.dataset.task;
  bgDlg.sel = Math.min(bgDlg.sel, Math.max(0, tasks.length - 1));
  body.innerHTML = tasks.length ? `<div class="bgt-list">${tasks.map((x, i) => `<div class="bgt-row${i === bgDlg.sel ? ' sel' : ''}" data-bg-view="${esc(x.id)}" data-i="${i}">
      <span class="todo-spin"></span>${x.agent ? I.agent : I.terminal}
      <span class="bgt-label"><span class="t">${esc(x.label)}</span><span class="d">${x.agent ? 'Agente' : x.tool === 'PowerShell' ? 'PowerShell' : 'Shell'} · ${x.stopping ? 'deteniendo' : elapsedText(x.startedAt)}</span></span>
      ${stopBtn(x)}</div>`).join('')}</div>`
    : '<p class="bgt-none">No queda nada en segundo plano.</p>';
  $('#bg-hint').innerHTML = tasks.length ? '<kbd>↑</kbd><kbd>↓</kbd> elegir · <kbd>Enter</kbd> ver la salida · <kbd>K</kbd> detener · <kbd>Esc</kbd> cerrar' : '<kbd>Esc</kbd> cerrar';
}
async function refreshBackground() {
  if (bgDlg.view) {
    const id = bgDlg.view;
    const o = await api.bgOutput(bgDlg.convId, id);
    if (bgDlg.view !== id) return;
    bgDlg.out = o;
  }
  renderBackground();
}
function viewBackground(id) {
  bgDlg.view = id;
  bgDlg.out = null;
  renderBackground();
  refreshBackground();
}
async function stopBackground(id) {
  const task = bgTasks().find((x) => x.id === id);
  if (!task || task.agent || task.stopping) return;
  task.stopping = true;
  renderBackground();
  if (!await api.bgStop(bgDlg.convId, id)) {
    task.stopping = false;
    renderBackground();
    toast('No he encontrado su proceso: puede que ya haya terminado');
  }
}
$('#bg-body').addEventListener('click', (e) => {
  const stop = e.target.closest('[data-bg-stop]');
  if (stop) { stopBackground(stop.dataset.bgStop); return; }
  if (e.target.closest('[data-bg-file]')) { const t = bgTasks().find((x) => x.id === bgDlg.view); if (t?.output) api.openPath(t.output); return; }
  const row = e.target.closest('[data-bg-view]');
  if (row) viewBackground(row.dataset.bgView);
});
$('#bg-body').addEventListener('mousemove', (e) => {
  const row = e.target.closest('.bgt-row');
  if (!row || +row.dataset.i === bgDlg.sel) return;
  bgDlg.sel = +row.dataset.i;
  renderBackground();
});
$('#bg-back').onclick = () => { bgDlg.view = null; bgDlg.out = null; renderBackground(); $('#bg-body').focus(); };
$('#bg-dialog').addEventListener('keydown', (e) => {
  const tasks = bgTasks();
  if (e.key === 'Escape' && bgDlg.view) { e.preventDefault(); $('#bg-back').click(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (!bgDlg.view && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && tasks.length) {
    e.preventDefault();
    bgDlg.sel = (bgDlg.sel + (e.key === 'ArrowDown' ? 1 : -1) + tasks.length) % tasks.length;
    renderBackground();
    $('#bg-body .bgt-row.sel')?.scrollIntoView({ block: 'nearest' });
  } else if (!bgDlg.view && e.key === 'Enter' && tasks[bgDlg.sel] && !e.target.closest('button')) {
    e.preventDefault();
    viewBackground(tasks[bgDlg.sel].id);
  } else if (e.key.toLowerCase() === 'k' || e.key.toLowerCase() === 'x') {
    const t = bgDlg.view ? tasks.find((x) => x.id === bgDlg.view) : tasks[bgDlg.sel];
    if (t) { e.preventDefault(); stopBackground(t.id); }
  }
});
$('#bg-dialog').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
$('#bg-dialog').addEventListener('close', () => { clearInterval(bgDlg.timer); bgDlg.timer = null; bgDlg.view = null; focusInput(); });

// ---------- Cola de mensajes ----------
function renderQueue() {
  const c = current();
  const q = c?.queue || [];
  $('#queue').innerHTML = q.map((m) => `<div class="queued">${I.clock}<span class="q-label-sm">En cola</span><span class="q-text-sm">${esc(m.text || '(imagen)')}</span><button class="icon-btn xs" data-send-now title="Enviar ya: interrumpe a Claude (${K('Ctrl+Enter')})">${I.bolt}</button><button class="icon-btn xs" data-unqueue="${esc(m.id)}" title="Quitar de la cola y editar">${I.x}</button></div>`).join('');
}

$('#queue').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-unqueue]');
  const c = current();
  if (e.target.closest('[data-send-now]') && c) { api.sendNow(c.id); return; }
  if (!b || !c) return;
  const text = await api.unqueue(c.id, b.dataset.unqueue);
  if (text != null) {
    input.value = [text, input.value].filter(Boolean).join('\n\n');
    autosize();
    focusInput();
  }
});

// ---------- Selectores del cuadro de texto ----------
// El modelo de la lista que corresponde al de la pestaña (puede venir como alias o como id completo)
function modelEntry(c) {
  const v = c?.model || '';
  return state.meta.models.find((x) => x.value === (v || 'default'))
    || state.meta.models.find((x) => x.value !== 'default' && x.resolvedModel === v || x.displayName.toLowerCase() === v.replace(/^claude-/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2').toLowerCase());
}
function modelLabel(c) {
  const v = c?.model || '';
  const m = modelEntry(c);
  if (!m) return v || 'Modelo';
  if (m.value === 'default') return (m.description.split(' · ')[0] || 'Por defecto');
  return m.displayName;
}

function renderChips() {
  const c = current();
  renderContext(c);
  if (!c) return;
  const mode = MODES[c.permissionMode || 'default'] || { short: c.permissionMode, title: c.permissionMode };
  $('#mode-chip').innerHTML = `<span class="dot${mode.hot ? ' hot' : ''} m-${esc(c.permissionMode || 'default')}"></span>${esc(mode.short)}${I.chevronDown}`;
  $('#model-chip').innerHTML = `${esc(modelLabel(c))}${I.chevronDown}`;
  renderEffortChip(c);
  const cwdChip = $('#cwd-chip');
  cwdChip.innerHTML = `${I.folder}<span>${esc(baseName(c.cwd))}</span>`;
  const fixed = cwdLocked(c);
  cwdChip.title = fixed ? `${c.cwd}\n(fijada: la sesión ya ha empezado)` : `${c.cwd}\nClic para cambiar la carpeta de esta pestaña`;
  cwdChip.classList.toggle('locked', fixed);
  $('#disclaimer').textContent = c.permissionMode === 'bypassPermissions'
    ? 'Acceso total: Claude actúa en tu equipo sin preguntar. Shift+Tab cambia el modo.'
    : `${mode.title}. Shift+Tab cambia el modo.`;
}

// La carpeta se puede cambiar hasta el primer mensaje (Claude Code se relanza en la nueva)
const cwdLocked = (c) => !!(c.busy || c.messages?.length);
$('#cwd-chip').addEventListener('click', async () => {
  const c = current();
  if (!c || cwdLocked(c)) return;
  await api.pickCwd(c.id);
});

async function chooseModel(anchor) {
  const c = current();
  if (!c) return;
  const cur = modelEntry(c)?.value;
  const items = state.meta.models.map((m) => ({ value: m.value, title: m.value === 'default' ? `Por defecto · ${modelLabel({ model: '' })}` : m.displayName, desc: m.value === 'default' ? 'Recomendado' : m.description, selected: m.value === cur }));
  if (!items.length) items.push({ value: '', title: 'Cargando modelos…' });
  items.push({ sep: true }, { value: '__default', title: 'Usar este modelo en las pestañas nuevas' });
  openPopover(anchor, 'Modelo de esta pestaña', items, (it) => {
    if (it.value === '__default') return patchConfig({ model: c.model || '' });
    setTabModel(c, it.value === 'default' ? '' : it.value);
  }, 'above');
}
function setTabModel(c, model) {
  api.setModel(c.id, model).then(() => termConfirmSwitch(c.id));
}
$('#model-chip').addEventListener('click', (e) => chooseModel(e.currentTarget));

// ---------- Esfuerzo de razonamiento (como /effort), por pestaña y en caliente ----------
const EFFORTS = [
  { value: '', title: 'Auto', desc: 'El que decida Claude Code para el modelo', bars: 0 },
  { value: 'low', title: 'Bajo', desc: 'Respuestas rápidas, razona poco', bars: 1 },
  { value: 'medium', title: 'Medio', desc: 'Equilibrio entre rapidez y calidad', bars: 2 },
  { value: 'high', title: 'Alto', desc: 'Razona más a fondo', bars: 3 },
  { value: 'xhigh', title: 'Muy alto', desc: 'Para tareas complejas', bars: 4 },
  { value: 'max', title: 'Máximo', desc: 'Todo el razonamiento posible; gasta más uso', bars: 5 },
];
const effortBars = (n) => `<svg class="effort-bars" viewBox="0 0 20 20">${[0, 1, 2, 3, 4].map((i) => {
  const h = 4 + i * 2.6;
  return `<rect x="${2 + i * 3.4}" y="${16.5 - h}" width="2.4" height="${h}" rx="1" class="${i < n ? 'on' : ''}${n === 5 ? ' max' : ''}"/>`;
}).join('')}</svg>`;

function currentModelInfo(c) {
  const v = c?.model || 'default';
  return state.meta.models.find((m) => m.value === v) || state.meta.models.find((m) => m.resolvedModel === v) || null;
}

function renderEffortChip(c) {
  const chip = $('#effort-chip');
  const info = currentModelInfo(c);
  const supported = info ? !!info.supportsEffort : true; // p. ej. Haiku no admite esfuerzo
  chip.hidden = !supported;
  if (!supported) return;
  const e = EFFORTS.find((x) => x.value === (c.effort || '')) || EFFORTS[0];
  chip.innerHTML = `${effortBars(e.bars)}<span>${esc(e.title)}</span>${I.chevronDown}`;
  chip.title = `Esfuerzo de razonamiento: ${e.title}`;
}

$('#effort-chip').addEventListener('click', (e) => openEffortMenu(e.currentTarget));
function openEffortMenu(anchor) {
  const c = current();
  if (!c) return;
  const levels = currentModelInfo(c)?.supportedEffortLevels;
  const items = EFFORTS
    .filter((x) => !x.value || !levels?.length || levels.includes(x.value))
    .map((x) => ({ value: x.value, title: x.title, desc: x.desc, selected: x.value === (c.effort || '') }));
  items.push({ sep: true }, { value: '__default', title: 'Usar este esfuerzo en las pestañas nuevas' });
  openPopover(anchor, 'Esfuerzo de esta pestaña · ↑↓ y Enter', items, (it) => {
    if (it.value === '__default') return patchConfig({ effort: c.effort || '' });
    c.effort = it.value;
    renderEffortChip(c);
    return api.setEffort(c.id, it.value);
  }, 'above');
}

$('#mode-chip').addEventListener('click', (e) => {
  const c = current();
  const items = MODE_CYCLE.map((value) => ({ value, title: MODES[value].title, desc: MODES[value].desc, selected: value === c.permissionMode }));
  openPopover(e.currentTarget, 'Modo de esta pestaña · Shift+Tab', items, (it) => termSetMode(c, it.value), 'above');
});

function cycleMode() {
  const c = current();
  if (c && !c.picker) termSetMode(c); // el ciclo de la terminal (incluye los modos que tenga activados)
}

// ---------- Adjuntos ----------
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
function canvasData(img, maxSide, type, quality) {
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(img.width * scale);
  cv.height = Math.round(img.height * scale);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  return cv.toDataURL(type, quality);
}

async function addImageFile(file) {
  if (!IMAGE_TYPES.includes(file.type)) return false;
  const url = await readAsDataURL(file);
  const img = await loadImage(url);
  let dataUrl = url;
  // Igual que la terminal: las imágenes grandes se reducen antes de enviarlas
  if (file.size > 3.5 * 1024 * 1024 || Math.max(img.width, img.height) > 2000) {
    dataUrl = canvasData(img, 1920, 'image/jpeg', 0.88);
  }
  const [, mediaType, data] = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  state.attachments.push({ mediaType, data, thumb: canvasData(img, 240, 'image/jpeg', 0.82), name: file.name || 'imagen' });
  renderAttachments();
  return true;
}

function renderAttachments() {
  $('#attachments').innerHTML = state.attachments.map((a, i) => `<div class="att"><img src="${a.thumb}" alt=""><button type="button" class="att-x" data-i="${i}" title="Quitar">${I.x}</button></div>`).join('');
  autosize();
}
$('#attachments').addEventListener('click', (e) => {
  const b = e.target.closest('.att-x');
  if (!b) return;
  state.attachments.splice(Number(b.dataset.i), 1);
  renderAttachments();
});
// Menú + (como el de claude.ai): imagen, archivos como @ruta, captura, y las skills y conectores de esta pestaña
$('#attach').addEventListener('click', (e) => openPlusMenu(e.currentTarget));
function openPlusMenu(anchor) {
  const c = current();
  const live = c && !c.picker;
  const items = [
    { value: 'image', title: 'Adjuntar imagen', desc: 'O pégala con Ctrl+V' },
    { value: 'files', title: 'Añadir archivos', desc: 'Como @ruta: Claude los lee de tu equipo' },
    { value: 'shot', title: 'Captura de pantalla', desc: 'Recorta una zona; un clic, entera' },
  ];
  if (live) items.push({ sep: true }, { value: 'skills', title: 'Skills ›' }, { value: 'mcp', title: 'Conectores ›' });
  openPopover(anchor, 'Añadir', items.map((it) => (it.desc ? { ...it, desc: K(it.desc) } : it)), async (it) => {
    if (it.value === 'image') $('#file-input').click();
    else if (it.value === 'files') {
      for (const p of await api.pickPaths(c?.cwd)) insertAtCursor(mentionFor(p));
      focusInput();
    } else if (it.value === 'shot') {
      const shot = await api.takeShot();
      if (shot) { state.attachments.push({ ...shot, name: 'captura' }); renderAttachments(); }
      focusInput();
    } else if (it.value === 'skills') openSkillsMenu(anchor, c);
    else if (it.value === 'mcp') openConnectorsMenu(anchor, c);
  }, 'above');
}
async function openSkillsMenu(anchor, c) {
  const [list, off] = await Promise.all([loadExt(), api.tabExtOff(c.id)]);
  const skills = list.skills.filter((s) => !off?.skills.includes(s.name));
  const items = skills.length
    ? skills.map((s) => ({ value: s.name, title: `/${s.name}`, desc: s.description.split('\n')[0].slice(0, 90) }))
    : [{ info: true, title: 'No hay skills activas en esta pestaña' }];
  items.push({ sep: true }, { value: '__manage', title: 'Gestionar skills…' });
  openPopover(anchor, 'Skills · se usan con /nombre', items, (it) => {
    if (it.value === '__manage') return openSettings('ext');
    // Como en Claude Code: /skill al principio y lo que ya hubiera escrito detrás
    input.value = `/${it.value} ${input.value.replace(new RegExp(`^/${it.value}\\s*`), '')}`;
    input.setSelectionRange(input.value.length, input.value.length);
    autosize();
    focusInput();
  }, 'above');
}
async function openConnectorsMenu(anchor, c) {
  const [list, off, accs] = await Promise.all([loadExt(), api.tabExtOff(c.id), state.config?.authMode === 'claude-code' ? api.accounts() : []]);
  const rank = (s) => ({ connected: 0, pending: 1, failed: 2, 'needs-auth': 3 }[s.status] ?? 4);
  // Los de claude.ai, los de la cuenta de esta ventana (la de la pestaña); los de las otras, aparte y sin usar
  const me = accs.find((a) => a.current);
  const mine = list.accounts?.find((a) => a.key === me?.key);
  const cloud = mine ? mine.mcp : list.mcp.filter((s) => s.source === 'claudeai');
  const servers = [...list.mcp.filter((s) => s.source !== 'claudeai'), ...cloud].filter((s) => s.status !== 'disabled').sort((x, y) => rank(x) - rank(y) || extName('mcp', x).localeCompare(extName('mcp', y)));
  const items = servers.length
    ? servers.map((s) => ({ value: s.name, title: extName('mcp', s), selected: !off?.mcp.includes(s.name), desc: (MCP_STATUS[s.status] || [s.status])[0] }))
    : [{ info: true, title: 'No hay conectores' }];
  const own = new Set(cloud.filter((s) => s.status === 'connected').map((s) => s.name));
  const elsewhere = (list.accounts || []).filter((a) => a.key !== me?.key).map((a) => [a, a.mcp.filter((s) => s.status === 'connected' && !own.has(s.name))]).filter(([, l]) => l.length);
  if (elsewhere.length) {
    items.push({ sep: true });
    for (const [a, l] of elsewhere) items.push({ info: true, title: `En ${a.email}: ${l.map((s) => extName('mcp', s)).join(', ')}`, color: a.color });
    items.push({ value: '__account', title: 'Cambiar la cuenta de esta ventana…' });
  }
  items.push({ sep: true }, { value: '__manage', title: 'Gestionar conectores…' }, { value: '__term', title: 'Reconectar o autenticar (/mcp)…', desc: 'La pantalla de Claude Code, en la terminal' });
  const head = off?.bare ? 'Conectores · en blanco van apagados' : me && accs.length > 1 ? `Conectores de esta pestaña · ${me.email}` : 'Conectores de esta pestaña';
  openPopover(anchor, head, items, async (it) => {
    if (it.value === '__account') return openAccountMenu(anchor, 'above');
    if (it.value === '__manage') return openSettings('ext');
    if (it.value === '__term') return runInTerminal(c, '/mcp');
    const on = !it.selected;
    await api.setTabExt(c.id, 'mcp', it.value, on);
    toast(`${it.title}: ${on ? 'activado' : 'desactivado'} en esta pestaña${c.started ? (c.busy ? ' (al terminar el turno se reinicia Claude Code)' : ' · se reinicia Claude Code con la conversación') : ''}`);
  }, 'above');
}
$('#file-input').addEventListener('change', async (e) => {
  for (const f of e.target.files) await addImageFile(f);
  e.target.value = '';
  focusInput();
});

input.addEventListener('paste', async (e) => {
  const files = [...(e.clipboardData?.files || [])].filter((f) => IMAGE_TYPES.includes(f.type));
  if (!files.length) return;
  e.preventDefault();
  for (const f of files) await addImageFile(f);
});

function mentionFor(p) {
  return /\s/.test(p) ? `@"${p}" ` : `@${p} `;
}
function insertAtCursor(text) {
  const s = input.selectionStart;
  const before = input.value.slice(0, s);
  const pad = before && !/\s$/.test(before) ? ' ' : '';
  input.setRangeText(pad + text, s, input.selectionEnd, 'end');
  autosize();
}

let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; dragDepth++; $('#drop-overlay').hidden = false; });
const endDrag = () => { dragDepth = 0; $('#drop-overlay').hidden = true; };
window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; if (--dragDepth <= 0 || !e.relatedTarget) endDrag(); });
// En captura: la terminal corta la propagación del drop y el recuadro se quedaba puesto
window.addEventListener('drop', endDrag, true);
window.addEventListener('dragend', endDrag, true);
window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('drop', async (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  for (const f of e.dataTransfer.files) {
    if (await addImageFile(f)) continue;
    const p = api.pathForFile(f);
    if (p) insertAtCursor(mentionFor(p));
  }
  focusInput();
});

// ---------- Autocompletado de / y @ ----------
const acEl = $('#ac');
const ac = { open: false, items: [], index: 0, kind: null, start: 0, end: 0 };
let acTimer = null;

function closeAc() {
  ac.open = false;
  acEl.hidden = true;
}

function allCommands() {
  const hidden = new Set(state.meta.terminal || []);
  const local = new Set(LOCAL_COMMANDS.map((c) => c.name));
  const list = [...LOCAL_COMMANDS];
  for (const c of state.meta.commands || []) {
    // Los que Claude Code marca «(removed)» ya no hacen nada
    if (!local.has(c.name) && !hidden.has(c.name) && !c.name.startsWith('__') && !/^\(removed\)/i.test(c.description || '')) list.push(c);
  }
  return list;
}

function renderAc() {
  if (!ac.items.length) return closeAc();
  ac.open = true;
  acEl.hidden = false;
  acEl.innerHTML = ac.items.map((it, i) => `<button type="button" class="ac-item${i === ac.index ? ' active' : ''}" data-i="${i}">
    <span class="ac-icon">${it.icon}</span><span class="ac-main">${esc(it.label)}${it.hint ? ` <span class="ac-hint">${esc(it.hint)}</span>` : ''}</span>
    <span class="ac-desc">${esc(it.desc || '')}</span></button>`).join('');
  acEl.querySelector('.ac-item.active')?.scrollIntoView({ block: 'nearest' });
}

function updateAc() {
  const v = input.value;
  const caret = input.selectionStart;
  // Comandos: "/" al principio y sin espacios todavía
  const slash = v.match(/^\/(\S*)$/);
  if (slash && caret <= v.length) {
    const needle = slash[1].toLowerCase();
    const list = allCommands()
      .map((c) => ({ c, score: c.name.toLowerCase().startsWith(needle) ? 2 : c.name.toLowerCase().includes(needle) || (c.description || '').toLowerCase().includes(needle) ? 1 : 0 }))
      .filter((x) => !needle || x.score)
      .sort((a, b) => b.score - a.score || a.c.name.localeCompare(b.c.name))
      .slice(0, 50);
    ac.kind = 'slash';
    ac.items = list.map(({ c }) => ({ icon: I.slash, label: `/${c.name}`, hint: c.argumentHint?.length > 36 ? c.argumentHint.slice(0, 35) + '…' : c.argumentHint, desc: c.description, value: c.name, hasArgs: !!c.argumentHint, optionalArgs: /^(\[|<optional)/i.test(c.argumentHint || '') }));
    ac.index = 0;
    return renderAc();
  }
  // Menciones: "@algo" justo antes del cursor
  const before = v.slice(0, caret);
  const at = before.match(/(^|\s)@("?)([^\s"]*)$/);
  if (at) {
    ac.kind = 'at';
    ac.start = caret - at[3].length - at[2].length - 1;
    ac.end = caret;
    clearTimeout(acTimer);
    acTimer = setTimeout(async () => {
      const c = current();
      if (!c) return;
      const res = await api.suggestFiles(c.id, at[3]);
      if (ac.kind !== 'at') return;
      ac.items = res.map((r) => ({ icon: r.dir ? I.folder : I.file, label: r.rel + (r.dir ? '/' : ''), desc: r.dir ? 'carpeta' : '', value: r.rel, dir: r.dir }));
      ac.index = 0;
      renderAc();
    }, 70);
    return undefined;
  }
  ac.kind = null;
  return closeAc();
}

function acceptAc(runIfComplete) {
  const it = ac.items[ac.index];
  if (!it) return;
  if (ac.kind === 'slash') {
    input.value = `/${it.value}${it.hasArgs ? ' ' : ''}`;
    closeAc();
    autosize();
    if (runIfComplete && (!it.hasArgs || it.optionalArgs)) submit(); // como en la terminal: Enter ejecuta si el argumento es opcional
    return;
  }
  const text = it.dir ? `@${/\s/.test(it.value) ? `"${it.value}/` : `${it.value}/`}` : mentionFor(it.value);
  input.setRangeText(text, ac.start, ac.end, 'end');
  autosize();
  if (it.dir) updateAc(); else closeAc();
}

acEl.addEventListener('mousedown', (e) => {
  const b = e.target.closest('.ac-item');
  if (!b) return;
  e.preventDefault();
  ac.index = Number(b.dataset.i);
  acceptAc(true);
  input.focus();
});

// ---------- Compositor ----------
function focusInput() {
  setTimeout(() => {
    if (current()?.picker) { $('#preset-grid .preset-card')?.focus({ preventScroll: true }); return; }
    if (current()?.terminal && termViewOf(current().id) === 'terminal') { focusTerm(); return; }
    if (!document.querySelector('dialog[open]') && !promptsEl.querySelector('.prompt-card:not(.answered)')) input.focus();
  }, 30);
}
function autosize() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 260) + 'px';
  input.style.overflowY = input.scrollHeight > 260 ? 'auto' : 'hidden';
  updateComposer();
}

function updateComposer() {
  const c = current();
  const busy = !!c?.busy;
  const hasContent = !!input.value.trim() || state.attachments.length > 0;
  $('#stop').hidden = !busy;
  $('#send').hidden = busy && !hasContent;
  $('#send').disabled = !hasContent;
  $('#send').title = busy ? 'Añadir a la cola (Enter)' : 'Enviar (Enter)';
  setHint(hintFlash ? [hintFlash.text] : busy ? (c.queue?.length ? [`${K('Ctrl+Enter')} para enviar ya`, 'Esc para interrumpir'] : ['Esc para interrumpir']) : ['Shift+Tab: modo', '/ comandos', '@ archivos']);
}

// Cada parte de la pista va en su span: si no cabe, se oculta entera (pasa a una segunda línea invisible) en vez de cortarse
function setHint(parts) {
  const el = $('#composer-hint');
  const key = parts.join('\n');
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  el.innerHTML = parts.map((p) => `<span>${esc(p)}</span>`).join('');
}

// Sugerencia del siguiente prompt de Claude Code (la lee del campo de la terminal al acabar el turno)
const suggestions = new Map();
const idleHint = (c) => (suggestions.get(c?.id) ? `${suggestions.get(c.id)}  (Tab)` : 'Responde a Claude…');
function watchSuggestion(id) {
  let n = 0;
  const tick = () => {
    const c = state.convs.get(id);
    if (!c?.terminal || c.busy) return suggestions.delete(id);
    const s = termSuggestion(id);
    if (s !== (suggestions.get(id) || '')) {
      if (s) suggestions.set(id, s); else suggestions.delete(id);
      if (id === state.activeId && c.messages.length) input.placeholder = idleHint(c);
    }
    if (++n < 20 && !s) setTimeout(tick, 500);
  };
  setTimeout(tick, 500);
}

input.addEventListener('input', () => { state.histIdx = -1; autosize(); updateAc(); });
input.addEventListener('click', updateAc);

input.addEventListener('keydown', (e) => {
  if (ac.open) {
    if (e.key === 'ArrowDown') { e.preventDefault(); ac.index = (ac.index + 1) % ac.items.length; return renderAc(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); ac.index = (ac.index - 1 + ac.items.length) % ac.items.length; return renderAc(); }
    if (e.key === 'Tab') { e.preventDefault(); return acceptAc(false); }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); return acceptAc(true); }
    if (e.key === 'Escape') { e.preventDefault(); return closeAc(); }
  }
  if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); return cycleMode(); }
  if (e.key === 'Tab' && !input.value && suggestions.get(state.activeId) && !current()?.busy) {
    e.preventDefault();
    input.value = suggestions.get(state.activeId);
    autosize();
    return undefined;
  }
  // Ctrl+Enter, o Enter con el cuadro vacío y algo en cola: enviar ya (como Claude Code)
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); return e.ctrlKey || e.metaKey ? sendNow() : submit(); }
  // Historial como en la terminal
  if (e.key === 'ArrowUp' && input.selectionStart === 0 && input.selectionEnd === 0 && state.history.length) {
    e.preventDefault();
    state.histIdx = Math.min(state.histIdx + 1, state.history.length - 1);
    input.value = state.history[state.history.length - 1 - state.histIdx];
    autosize();
    return undefined;
  }
  if (e.key === 'ArrowDown' && state.histIdx >= 0 && input.selectionStart === input.value.length) {
    e.preventDefault();
    state.histIdx -= 1;
    input.value = state.histIdx >= 0 ? state.history[state.history.length - 1 - state.histIdx] : '';
    autosize();
  }
  return undefined;
});

function remember(text) {
  if (!text || state.history.at(-1) === text) return;
  state.history.push(text);
  if (state.history.length > 200) state.history.shift();
  try { localStorage.setItem('history', JSON.stringify(state.history)); } catch {}
}
try { state.history = JSON.parse(localStorage.getItem('history') || '[]'); } catch {}

// Los comandos que la app hace mejor que la terminal (con sus selectores); el resto los ejecuta Claude Code
async function runLocalCommand(name, arg) {
  const c = current();
  switch (name) {
    case 'model':
      if (arg) {
        const m = state.meta.models.find((x) => [x.value, x.displayName.toLowerCase()].includes(arg.toLowerCase()));
        setTabModel(c, m ? (m.value === 'default' ? '' : m.value) : arg);
      } else chooseModel($('#model-chip'));
      return true;
    case 'effort': {
      if (!arg) { openEffortMenu($('#effort-chip').hidden ? $('#composer') : $('#effort-chip')); return true; }
      const v = arg.toLowerCase() === 'auto' ? '' : arg.toLowerCase();
      if (v && !EFFORTS.some((x) => x.value === v)) return false;
      c.effort = v;
      renderEffortChip(c);
      api.setEffort(c.id, v);
      return true;
    }
    case 'theme': {
      const cur = state.config.theme || 'system';
      openPopover($('#composer'), 'Tema · ↑↓ y Enter', [
        { value: 'system', title: 'Sistema', desc: 'Sigue el modo claro u oscuro del sistema', selected: cur === 'system' },
        { value: 'light', title: 'Claro', selected: cur === 'light' },
        { value: 'dark', title: 'Oscuro', selected: cur === 'dark' },
      ], (it) => patchConfig({ theme: it.value }), 'above');
      return true;
    }
    case 'login':
      await openAccountMenu($('#composer'), 'above');
      return true;
    case 'help':
      showHelp();
      return true;
    case 'rewind':
    case 'checkpoint':
      openRewind();
      return true;
    case 'resume':
      if (arg) return false; // con id, que la retome Claude Code en esta pestaña
      openHistory();
      return true;
    case 'tasks':
    case 'bashes':
      openBackground(c);
      return true;
    case 'export':
      exportConversation(c, arg);
      return true;
    case 'memory':
      if (arg) return false;
      openSettings('memory');
      return true;
    case 'config':
    case 'settings':
      openSettings();
      return true;
    case 'mcp':
      if (arg) return false;
      openConnectorsMenu($('#composer'), c);
      return true;
    case 'hooks':
    case 'permissions':
    case 'allowed-tools':
      if (arg) return false;
      openSettingsView(c, name === 'hooks' ? 'hooks' : 'permissions');
      return true;
    default:
      return false;
  }
}
// Lo que en Claude Code abre su pantalla en la terminal: aquí se manda allí y se cambia de vista
function runInTerminal(c, text) {
  api.send(c.id, { text });
  setTimeout(() => setTermView(c.id, 'terminal'), 300);
}
// /hooks y /permissions: lo configurado en cada ámbito, para leerlo; editar, en la pantalla de Claude Code o en el archivo
async function openSettingsView(c, what) {
  const scopes = await api.claudeSettings(c.cwd);
  const items = [];
  for (const s of scopes) {
    const rows = [];
    if (what === 'hooks') {
      for (const [event, groups] of Object.entries(s.hooks)) {
        for (const g of [].concat(groups || [])) {
          for (const h of g.hooks || []) {
            rows.push({ title: `${event}${g.matcher ? ` · ${g.matcher}` : ''}`, desc: h.type === 'command' ? h.command : h.url || h.prompt || h.type });
          }
        }
      }
    } else {
      for (const kind of ['allow', 'ask', 'deny']) {
        for (const r of s.permissions[kind] || []) rows.push({ title: r.length > 140 ? `${r.slice(0, 139)}…` : r, desc: { allow: 'Permitir', ask: 'Preguntar', deny: 'Denegar' }[kind] });
      }
      if (s.permissions.defaultMode) rows.push({ title: `Modo por defecto: ${MODES[s.permissions.defaultMode]?.title || s.permissions.defaultMode}` });
      for (const d of s.permissions.additionalDirectories || []) rows.push({ title: shortPath(d), desc: 'Carpeta adicional' });
    }
    if (!s.exists && !rows.length) continue;
    if (items.length) items.push({ sep: true });
    items.push({ value: s.file, title: `${s.scope} · ${shortPath(s.file)}`, desc: s.error ? `No se puede leer: ${s.error}` : 'Abrir el archivo' });
    items.push(...(rows.length ? rows.slice(0, 60).map((r) => ({ info: true, ...r, desc: r.desc && String(r.desc).slice(0, 160) }))
      : [{ info: true, title: what === 'hooks' ? 'Sin hooks' : 'Sin reglas' }]));
  }
  if (!items.length) items.push({ info: true, title: what === 'hooks' ? 'No hay hooks configurados' : 'No hay reglas de permisos' });
  items.push({ sep: true }, { value: '__term', title: `Editar en Claude Code (/${what})…`, desc: 'Abre su pantalla en la terminal de esta pestaña' });
  openPopover($('#composer'), what === 'hooks' ? 'Hooks de Claude Code' : 'Permisos de Claude Code', items, (it) => {
    if (it.value === '__term') runInTerminal(c, `/${what}`);
    else api.openPath(it.value);
  }, 'above');
}

// /export como en Claude Code: la conversación en Markdown, a un archivo o al portapapeles
function conversationMarkdown(c) {
  const toolLine = (b) => {
    const meta = TOOL_META[b.name];
    const what = b.input?.description || b.input?.command || (b.input?.file_path && shortPath(b.input.file_path)) || b.input?.pattern || b.input?.url || b.input?.query || '';
    return `> ${meta ? meta[1] : b.name}${what ? `: ${String(what).split('\n')[0]}` : ''}`;
  };
  const out = [`# ${c.title || 'Conversación'}`, '', `_${new Date().toLocaleString('es-ES')} · ${c.cwd || ''}_`];
  for (const m of c.messages) {
    if (m.role === 'user') {
      out.push('', '## Tú', '', m.text || '', ...(m.images?.length ? ['', `_(${m.images.length} imagen${m.images.length > 1 ? 'es' : ''})_`] : []));
      continue;
    }
    const parts = [];
    for (const b of m.blocks || []) {
      if (b.type === 'text' && b.text?.trim()) parts.push(b.text.trim());
      else if (b.type === 'tool') parts.push(toolLine(b));
      else if (b.type === 'note' || b.type === 'interrupted') parts.push(`_${b.text}_`);
      else if (b.type === 'error') parts.push(`> **Error:** ${b.text}`);
    }
    if (parts.length) out.push('', '## Claude', '', parts.join('\n\n'));
  }
  return out.join('\n') + '\n';
}
function exportConversation(c, file, toFile = false) {
  if (!c?.messages?.length) return toast('No hay nada que exportar todavía');
  const text = conversationMarkdown(c);
  const name = (file || `${(c.title || 'conversacion').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 60) || 'conversacion'}.md`);
  const save = async () => { const p = await api.exportChat({ name: /\.\w+$/.test(name) ? name : `${name}.md`, text, cwd: c.cwd }); if (p) toast(`Guardada en ${shortPath(p)}`); };
  if (file || toFile) return save();
  openPopover($('#composer'), 'Exportar la conversación', [
    { value: 'file', title: 'Guardar como archivo…', desc: 'Markdown (.md)' },
    { value: 'copy', title: 'Copiar al portapapeles', desc: 'Para pegarla en otro sitio' },
  ], (it) => {
    if (it.value === 'file') return save();
    navigator.clipboard.writeText(text).then(() => toast('Conversación copiada'));
  }, 'above');
}

const TERM_INTERACTIVE = new Set(['config', 'settings', 'mcp', 'permissions', 'allowed-tools', 'resume', 'continue', 'agents', 'hooks', 'memory', 'logout',
  'plugin', 'plugins', 'ide', 'status', 'usage', 'doctor', 'add-dir', 'rewind', 'checkpoint', 'statusline', 'output-style', 'tasks', 'bashes',
  'terminal-setup', 'install-github-app', 'privacy-settings', 'upgrade', 'extra-usage', 'feedback', 'bug', 'skills', 'sandbox', 'exit', 'quit']);

async function submit() {
  const c = current();
  if (!c) return;
  const text = input.value.trim();
  if (!text && !state.attachments.length) { if (c.queue?.length) api.sendNow(c.id); return; }
  closeAc();
  branchView.delete(c.id);
  remember(text);
  state.histIdx = -1;
  const cmd = text.match(/^\/(\S+)\s*(.*)$/s);
  const name = cmd?.[1].toLowerCase();
  if (cmd && !state.attachments.length && await runLocalCommand(name, cmd[2].trim())) {
    input.value = '';
    autosize();
    return;
  }
  // Comandos con menús propios de la terminal: se ven allí
  if (cmd && TERM_INTERACTIVE.has(name) && !(name === 'add-dir' && cmd[2].trim())) setTimeout(() => setTermView(c.id, 'terminal'), 300);
  const images = state.attachments.map(({ mediaType, data, thumb }) => ({ mediaType, data, thumb }));
  input.value = '';
  state.attachments = [];
  renderAttachments();
  autosize();
  await api.send(c.id, { text, images });
  scrollToBottom();
}
// Enviar ya: lo escrito se suma a la cola y Claude deja lo que hace para leerla
async function sendNow() {
  const c = current();
  if (!c) return;
  if (input.value.trim() || state.attachments.length) await submit();
  api.sendNow(c.id);
}
$('#composer').addEventListener('submit', (e) => { e.preventDefault(); submit(); });

// Dos pulsaciones seguidas de la misma tecla (menos de 0,8 s), como en la terminal
let lastPress = null;
function pressedTwice(key) {
  const twice = !!key && lastPress?.key === key && Date.now() - lastPress.at < 800;
  lastPress = key && !twice ? { key, at: Date.now() } : null;
  return twice;
}
// Aviso breve en el pie del cuadro de texto («Esc otra vez para borrar»)
let hintFlash = null;
function flashHint(text) {
  clearTimeout(hintFlash?.timer);
  hintFlash = { text, timer: setTimeout(() => { hintFlash = null; updateComposer(); }, 800) };
  updateComposer();
}
function clearInput() {
  remember(input.value.trim()); // con ↑ se recupera
  input.value = '';
  state.attachments = [];
  renderAttachments();
  closeAc();
  clearTimeout(hintFlash?.timer);
  hintFlash = null;
  autosize();
}
function ctrlC(e) {
  const c = current();
  const t = e.target;
  if (!c || c.picker || (c.terminal && termViewOf(c.id) === 'terminal') || document.querySelector('dialog[open]') || !pop.hidden) return false;
  // Con algo seleccionado copia, como siempre; en otros campos (buscar…), tampoco se toca
  if (t !== input && t.closest?.('input, textarea, select, [contenteditable]')) return false;
  if (t === input ? input.selectionStart !== input.selectionEnd : !getSelection().isCollapsed) return false;
  e.preventDefault();
  if (c.busy) { pressedTwice(null); interrupt(); return true; }
  if (input.value || state.attachments.length) { pressedTwice(null); clearInput(); return true; }
  // Cerrar es lo que hace Claude Code, pero aquí se pregunta antes: es fácil pulsarlo dos veces sin querer
  if (pressedTwice('c')) {
    confirmAsk('¿Cerrar esta pestaña?', 'La conversación no se pierde: puedes volver a ella con ' + K('Ctrl+H') + ' (conversaciones anteriores).', 'Cerrar pestaña')
      .then((ok) => { if (ok && state.tabs.includes(c.id)) closeTab(c.id); else focusInput(); });
  } else flashHint('Ctrl+C otra vez para cerrar la pestaña');
  return true;
}

async function interrupt() {
  const c = current();
  if (!c?.busy) return;
  $('#stop').disabled = true;
  const returned = await api.interrupt(c.id);
  $('#stop').disabled = false;
  // Lo que aún esperaba en la cola de la app (p. ej. un comando) vuelve al cuadro de texto
  if (returned) {
    input.value = [returned, input.value].filter(Boolean).join('\n\n');
    autosize();
  }
  focusInput();
}
$('#stop').addEventListener('click', interrupt);

// ---------- Eventos del proceso principal ----------
api.onConv(async ({ convId, conv, from }) => {
  if (!state.convs.has(convId) && !state.tabs.includes(convId)) return;
  const prev = state.convs.get(convId);
  // Llegan solo los mensajes desde «from»: se empalman con los que ya había
  if (from > 0) {
    if (!prev || prev.messages.length < from) {
      const full = await api.getTab(convId);
      if (!full || !(state.convs.has(convId) || state.tabs.includes(convId))) return;
      conv = full;
    } else conv.messages = prev.messages.slice(0, from).concat(conv.messages);
  }
  state.convs.set(convId, conv);
  const titleChanged = prev?.title !== conv.title || prev?.busy !== conv.busy || (prev?.prompts?.length || 0) !== conv.prompts.length;
  if (titleChanged) renderTabs();
  if (prev?.title !== conv.title) refreshSide(3000); // una conversación nueva o con título nuevo
  if (conv.files?.length) autoPreview(conv);
  if (convId !== state.activeId) return;
  if (prev?.files?.[0]?.at !== conv.files?.[0]?.at) renderDocsButton();
  const wasEmpty = $('#main').classList.contains('is-empty');
  const isEmpty = !conv.messages.length && !conv.busy;
  // (o al revés: un /clear en la vista de chat de una pestaña de terminal)
  if (wasEmpty ? !isEmpty : isEmpty && !$('#stage').hidden) return showView();
  scheduleRender();
  renderPrompts();
  renderQueue();
  renderTasks();
  renderChips();
  updateComposer();
  if (conv.busy) suggestions.delete(convId);
  input.placeholder = conv.busy ? 'Escribe para añadir instrucciones; se enviarán en cuanto Claude pueda…' : idleHint(conv);
});

api.onDone(({ convId }) => {
  watchSuggestion(convId);
  if (convId !== state.activeId && state.tabs.includes(convId)) state.unread.add(convId);
  renderTabs();
  refreshSide();
});

api.onPrompt(({ convId }) => {
  if (convId !== state.activeId) renderTabs();
});

api.onMeta((meta) => {
  state.meta = { ...state.meta, ...meta };
  renderChips();
});
api.onCommands(({ commands, terminal }) => {
  state.meta.commands = commands;
  state.meta.terminal = terminal;
});

// ---------- Popover ----------
const pop = $('#popover');
let popAnchor = null;
let popCancel = null; // se llama si el menú se cierra sin elegir
function openPopover(anchor, title, items, onPick, placement, onCancel) {
  if (popAnchor === anchor && !pop.hidden) return closePopover();
  if (!pop.hidden) closePopover();
  popAnchor = anchor;
  popCancel = onCancel || null;
  pop.innerHTML = `<div class="pop-title">${esc(title)}</div>` + items.map((it, i) => {
    if (it.sep) return '<div class="pop-sep"></div>';
    if (it.heading) return `<div class="pop-heading">${esc(it.heading)}</div>`;
    if (it.html) return it.html;
    const inner = `<span class="t">${it.color ? `<i class="pop-dot" style="--c:${it.color}"></i>` : ''}${esc(it.title)}</span>${it.selected ? I.check : ''}${it.desc ? `<span class="d">${esc(it.desc)}</span>` : ''}`;
    return it.info ? `<div class="pop-item info">${inner}</div>` : `<button class="pop-item" data-i="${i}">${inner}</button>`;
  }).join('');
  pop.hidden = false;
  pop.style.maxHeight = '';
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  let h = pop.offsetHeight;
  // Hacia arriba no pasa de la barra de título: si no cabe, se acorta y se desplaza por dentro
  const ceil = ($('#titlebar')?.getBoundingClientRect().bottom || 0) + 8;
  if (placement === 'above' && r.top - h - 6 < ceil && r.top - ceil - 6 >= 160) {
    h = r.top - ceil - 6;
    pop.style.maxHeight = h + 'px';
  }
  let left = placement === 'right' ? r.right - w : r.left;
  left = Math.max(8, Math.min(left, document.body.clientWidth - w - 8));
  let top = r.bottom + 6;
  if (placement === 'above' || top + h > innerHeight - 8) top = r.top - h - 6;
  if (top < 8 && placement !== 'above') top = Math.max(8, Math.min(r.bottom + 6, innerHeight - h - 8)); // no cabe ni arriba: lo más abajo posible
  pop.style.left = left + 'px';
  pop.style.top = Math.max(8, top) + 'px';
  pop.onclick = (e) => {
    const b = e.target.closest('button.pop-item');
    if (!b) return;
    popCancel = null;
    closePopover();
    onPick(items[b.dataset.i]);
  };
  // Como los selectores de la terminal: ↑/↓ para moverse, Enter para elegir, Esc para salir
  const buttons = [...pop.querySelectorAll('button.pop-item')];
  const start = Math.max(0, buttons.findIndex((b) => items[b.dataset.i]?.selected));
  buttons[start]?.focus({ preventScroll: true });
  buttons[start]?.scrollIntoView({ block: 'nearest' });
  pop.onkeydown = (e) => {
    const i = buttons.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = buttons[(i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length];
      next?.focus();
      next?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closePopover();
      input.focus();
    }
  };
  return undefined;
}
function closePopover() {
  pop.hidden = true;
  popAnchor = null;
  const cancel = popCancel;
  popCancel = null;
  cancel?.();
}
document.addEventListener('mousedown', (e) => {
  if (!pop.hidden && !pop.contains(e.target) && !popAnchor?.contains(e.target)) closePopover();
});

// Listado de atajos (F1, /help, menú o el botón del teclado de la barra de título)
function hotkeyLabel(acc) {
  const cmd = IS_MAC ? '⌘' : 'Ctrl';
  return String(acc || '').split('+').map((k) => ({ Control: 'Ctrl', CommandOrControl: cmd, CmdOrCtrl: cmd, Command: '⌘', Cmd: '⌘', Alt: IS_MAC ? '⌥' : 'Alt', Option: '⌥', Space: 'Espacio' }[k] || k)).join('+');
}
function keysHtml(combo) {
  // «Ctrl+T / Ctrl+W» → teclas sueltas; los separadores « / », « · » y « o » quedan como texto
  return combo.split(/( \/ | · | o )/).map((part, i) => i % 2
    ? `<span class="keys-sep">${esc(part.trim())}</span>`
    : part.split('+').map((k) => `<kbd>${esc(k)}</kbd>`).join('<span class="keys-plus">+</span>')).join('');
}
function showHelp() {
  closePopover();
  const cfg = state.config || {};
  const groups = [
    ['Mensajes', [
      ['Enter / Shift+Enter', 'Enviar / nueva línea (mientras trabaja, Enter lo deja en cola y Claude lo lee tras el paso en curso)'],
      ['Ctrl+Enter', 'Enviar ya lo que está en cola: interrumpe a Claude y se lo manda (también Enter con el cuadro vacío)'],
      ['Esc / Ctrl+C', 'Interrumpir a Claude (lo que estaba en cola se le manda)'],
      ['Esc Esc', 'Con texto, borrarlo; sin texto, volver a un mensaje anterior (/rewind)'],
      ['Ctrl+C', 'Sin nada seleccionado: borrar el texto; con el cuadro vacío, dos veces, cerrar la pestaña (pregunta antes)'],
      ['Shift+Tab', 'Cambiar de modo: preguntar → editar libre → plan → acceso total'],
      ['/ o @', 'Comandos de Claude Code y menciones de archivos (Tab o Enter para elegir)'],
      ['↑ / ↓', 'Recorrer los mensajes que has enviado'],
      [K('Ctrl+V'), 'Pegar imágenes; también puedes arrastrar archivos al cuadro'],
      [K('Ctrl+M'), 'Dictar por voz'],
      [K('Ctrl+F'), 'Buscar en la conversación (Enter / Shift+Enter: siguiente / anterior)'],
    ]],
    ['Pestañas', [
      [K('Ctrl+T o Ctrl+N'), 'Nueva pestaña'],
      ['1…9', 'En el selector de presets, abrir ese preset'],
      [K('Ctrl+W'), 'Cerrar la pestaña'],
      [IS_MAC ? 'Ctrl+Tab o ⌘+AvPág' : 'Ctrl+Tab o Ctrl+AvPág', 'Pestaña siguiente'],
      [IS_MAC ? 'Ctrl+Shift+Tab o ⌘+RePág' : 'Ctrl+Shift+Tab o Ctrl+RePág', 'Pestaña anterior'],
      [K('Ctrl+1…8 / Ctrl+9'), 'Ir a esa pestaña / a la última'],
      [K('Ctrl+H'), 'Conversaciones anteriores (también /resume)'],
      [K('Ctrl+Shift+D'), 'Dividir en dos: la misma ventana con la misma cuenta, otra ventana al lado con otra cuenta'],
      [K('Ctrl+Shift+E'), 'Mostrar u ocultar la barra lateral (conversaciones fijadas y recientes)'],
      [K('Ctrl+O'), 'Cambiar la vista de la conversación: normal, con el razonamiento o detallada'],
    ]],
    ['Modo terminal', [
      ['Ctrl+º', 'Cambiar entre la vista de chat y la terminal'],
      ...(IS_MAC ? [['⌘+C', 'Copiar lo seleccionado'], ['Ctrl+C', 'Interrumpir']] : [['Ctrl+C', 'Con texto seleccionado, copiar; si no, interrumpir']]),
      [K('Ctrl+V'), 'Pegar (también con clic derecho)'],
      [IS_WIN ? 'Alt+V' : 'Ctrl+V', 'Pegar la imagen del portapapeles'],
      ['Shift+Enter', 'Nueva línea en el mensaje'],
    ]],
    ['App', [
      [K('Ctrl+,'), 'Configuración'],
      [K('Ctrl++ / Ctrl+- / Ctrl+0'), IS_MAC ? 'Zoom de la interfaz (también pellizcando en el trackpad)' : 'Zoom de la interfaz (también Ctrl + rueda)'],
      ['F1', 'Esta lista de atajos'],
    ]],
    [IS_WIN ? 'En todo Windows' : 'En todo el sistema', [
      [hotkeyLabel(cfg.hotkey || 'Control+Shift+Space'), 'Mostrar u ocultar la app'],
      ...(cfg.voiceHotkey !== '' ? [[hotkeyLabel(cfg.voiceHotkey || 'Control+Alt+Space'), 'Asistente por voz']] : []),
      ...(cfg.shotHotkey !== '' ? [[hotkeyLabel(cfg.shotHotkey || 'Control+Alt+S'), 'Recortar la pantalla y adjuntar la captura']] : []),
    ]],
  ];
  $('#keys-body').innerHTML = groups.map(([title, rows]) => `<section><h3>${esc(title)}</h3>${rows.map(([k, d]) =>
    `<div class="keys-row"><span class="keys-combo">${keysHtml(k)}</span><span>${esc(d)}</span></div>`).join('')}</section>`).join('')
    + '<p class="keys-note">Los atajos globales se cambian en Configuración → General.</p>';
  const dlg = $('#keys-dialog');
  if (!dlg.open) dlg.showModal();
}
$('#keys-dialog').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });

async function patchConfig(patch) {
  const { config } = await api.setConfig(patch);
  applyConfigUi(config);
}

// ---------- Configuración ----------
const form = $('#settings-form');
const clears = {};

function applyConfigUi(cfg) {
  state.config = cfg;
  applyAppearance(cfg.appearance);
  applySidebar();
  renderAccountChip();
  if ($('#main').classList.contains('is-empty')) $('#greeting').textContent = greeting();
}

function syncSecretRows() {
  const mode = form.authMode.value;
  form.querySelectorAll('.secret').forEach((r) => (r.hidden = r.dataset.for !== mode));
}
function showSettingsTab(tab) {
  form.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  form.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('active', p.dataset.panel === tab));
  if (tab === 'ext') renderSettingsExt();
  if (tab === 'sched') { schedEditing = null; renderSched(); }
  if (tab === 'memory') renderMemory();
}
form.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => showSettingsTab(b.dataset.tab)));
function setStatus(el, on, text) {
  el.textContent = on ? `● ${text}` : 'sin configurar';
  el.className = 'status' + (on ? ' ok' : '');
}

async function openSettings(tab = 'general') {
  closePopover();
  const cfg = await api.getConfig();
  // Modelo: los de Claude Code, como en /model (y el guardado, aunque ya no esté en la lista)
  const models = state.meta.models.filter((m) => m.value !== 'default');
  $('#cfg-model').innerHTML = `<option value="">El de Claude Code</option>${models.map((m) => `<option value="${esc(m.value)}">${esc(m.displayName)}</option>`).join('')}`
    + (cfg.model && !models.some((m) => m.value === cfg.model) ? `<option value="${esc(cfg.model)}">${esc(cfg.model.replace(/^claude-([a-z]+)-(\d+)-(\d+)$/, (_, n, a, b) => `${n[0].toUpperCase() + n.slice(1)} ${a}.${b} (${cfg.model})`))}</option>` : '');
  for (const k of ['userName', 'model', 'compactWindow', 'systemPrompt', 'cwd', 'claudePath', 'hotkey']) form[k].value = cfg[k] ?? '';
  if (!cfg.compactWindow) form.compactWindow.value = ''; // vacío: el máximo del modelo
  for (const k of ['theme', 'effort', 'permissionMode', 'authMode']) form[k].value = cfg[k] ?? '';
  form.autoStart.checked = !!cfg.autoStart;
  const nt = { done: true, ask: true, scheduled: true, sound: true, ...cfg.notify };
  form.notifyDone.checked = nt.done;
  form.notifyAsk.checked = nt.ask;
  form.notifyScheduled.checked = nt.scheduled;
  form.notifySound.checked = nt.sound;
  form.voiceHotkey.value = cfg.voiceHotkey ?? '';
  form.shotHotkey.value = cfg.shotHotkey ?? '';
  form.voiceModel.value = cfg.voiceModel ?? '';
  form.voiceEffort.value = cfg.voiceEffort ?? '';
  form.whatsappView.value = cfg.whatsappView || 'hidden';
  fillLook(cfg.appearance);
  form.voicePreset.innerHTML = '<option value="">En blanco</option>' + (cfg.presets || []).map((p) => `<option value="${esc(p.id)}">${esc(`${p.emoji || ''} ${p.name}`.trim())}</option>`).join('');
  form.voicePreset.value = cfg.presets?.some((p) => p.id === cfg.voicePreset) ? cfg.voicePreset : '';
  form.apiKey.value = '';
  form.oauthToken.value = '';
  setStatus($('#apikey-status'), cfg.hasApiKey, 'guardada');
  setStatus($('#oauth-status'), cfg.hasOauthToken, 'guardado');
  for (const k in clears) delete clears[k];
  settingsExt = structuredClone(cfg.ext || {});
  form.blankBare.checked = cfg.blankBare !== false;
  form.autoPreview.checked = cfg.autoPreview !== false;
  $('#ext-q').value = toolsQuery.global = '';
  $('#settings-msg').textContent = '';
  syncSecretRows();
  renderAccounts();
  renderPresetList();
  showSettingsTab(typeof tab === 'string' ? tab : 'general');
  $('#settings').showModal();
  document.activeElement?.blur();
}

form.addEventListener('change', (e) => { if (e.target.name === 'authMode') syncSecretRows(); });
form.querySelectorAll('[data-clear]').forEach((b) => b.addEventListener('click', () => {
  clears[b.dataset.clear] = true;
  const status = b.closest('.field').querySelector('.status');
  status.textContent = 'se borrará al guardar';
  status.className = 'status';
}));
$('#show-whatsapp').onclick = () => api.showWhatsApp();

// ---------- Cuentas de Claude (/login) ----------
const PLAN_NAMES = { pro: 'Pro', max: 'Max', team: 'Team', enterprise: 'Enterprise', free: 'Free' };
// Los mismos que ACCOUNT_COLORS en main.mjs
const ACCOUNT_COLORS = ['#d97757', '#4f7fd9', '#3f9d6b', '#8a63d2', '#c9971c', '#cf5f8f', '#2b9aa0', '#7a7f8c'];
const accountInitial = (a) => (a.name || a.email).trim()[0]?.toUpperCase() || '?';
const accountDesc = (a) => [a.plan && `Plan ${PLAN_NAMES[a.plan] || a.plan}`, a.org && !a.org.includes(a.email) && a.org, a.current && 'en esta ventana', a.active && 'principal (la de Claude Code en la terminal)', a.locked && 'hay que volver a iniciar sesión'].filter(Boolean).join(' · ');

async function renderAccounts() {
  const list = await api.accounts();
  const el = $('#account-list');
  el.innerHTML = list.length ? '' : '<span class="field-help">No hay ninguna sesión iniciada en Claude Code.</span>';
  for (const a of list) {
    const row = document.createElement('div');
    row.className = 'account' + (a.current ? ' active' : '');
    row.innerHTML = `<span class="acc-avatar big" style="--acc:${a.color}">${esc(accountInitial(a))}</span><span class="account-main"><b>${esc(a.email)}</b><small>${esc(accountDesc(a))}</small></span>`;
    // Color con el que se marcan sus ventanas (solo tiene sentido con varias cuentas)
    if (list.length > 1) {
      const sw = document.createElement('span');
      sw.className = 'acc-swatches';
      for (const c of ACCOUNT_COLORS) {
        const b = Object.assign(document.createElement('button'), { type: 'button', className: 'acc-swatch' + (c === a.color ? ' on' : ''), title: 'Color de las ventanas con esta cuenta' });
        b.style.setProperty('--c', c);
        b.setAttribute('aria-label', `Color ${c} para ${a.email}`);
        b.onclick = () => api.setAccountColor(a.key, c);
        sw.append(b);
      }
      row.querySelector('.account-main').append(sw);
    }
    if (!a.current) {
      const use = Object.assign(document.createElement('button'), { type: 'button', className: 'btn', textContent: a.locked ? 'Iniciar sesión' : 'Usar aquí', title: 'Pasa esta ventana y sus pestañas a esta cuenta' });
      use.onclick = async () => { if (a.locked) return startLogin(); await switchAccount(a.key); renderAccounts(); };
      const del = Object.assign(document.createElement('button'), { type: 'button', className: 'btn ghost', textContent: 'Quitar', title: 'La app la olvida; puedes volver a añadirla iniciando sesión' });
      del.onclick = async () => {
        try { await api.removeAccount(a.key); } catch (err) { toast(errText(err), 'err'); }
        renderAccounts();
      };
      del.hidden = a.active; // la de la terminal no se puede quitar
      row.append(use, del);
    }
    if (!a.active && !a.locked) {
      const main = Object.assign(document.createElement('button'), { type: 'button', className: 'btn ghost', textContent: 'Hacer principal', title: 'La de Claude Code en la terminal y la de las ventanas nuevas. Las ventanas que iban con la principal pasan a esta' });
      main.onclick = async () => {
        try {
          const r = await api.makeMainAccount(a.key);
          toast(`${r.email} es ahora la principal. Las pestañas que iban con la anterior se vuelven a abrir con ella.`);
        } catch (err) { toast(errText(err), 'err'); }
        renderAccounts();
        renderAccountChip();
      };
      row.append(main);
    }
    el.append(row);
  }
}

const errText = (err) => String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

async function switchAccount(key) {
  try {
    const a = await api.useAccount(key);
    toast(`Esta ventana usa ahora ${a.email}. Sus pestañas se vuelven a abrir con ella (las que trabajan, al terminar).`);
  } catch (err) {
    toast(errText(err), 'err');
  }
  applyConfigUi(await api.getConfig()); // usar una cuenta pasa a «Sesión de Claude Code»
}

// Selector de cuenta: el de la barra de título y /login
async function openAccountMenu(anchor, placement) {
  const list = await api.accounts();
  openPopover(anchor, 'Cuenta de esta ventana · ↑↓ y Enter', [
    ...list.map((a) => ({ value: a.key, title: a.email, desc: accountDesc(a), selected: a.current, locked: a.locked, color: list.length > 1 && a.color })),
    { sep: true },
    ...(list.length > 1 ? [{ value: 'window', title: 'Nueva ventana con otra cuenta…', desc: 'Cada ventana lleva el color de su cuenta' }] : []),
    { value: 'login', title: 'Iniciar sesión con otra cuenta…', desc: 'Se abre el navegador; luego queda guardada' },
    { value: 'manage', title: 'Gestionar cuentas…', desc: 'Configuración › Cuenta' },
  ], (it) => (it.value === 'login' || it.locked ? startLogin() : it.value === 'manage' ? openSettings('account') : it.value === 'window' ? openAccountWindowMenu(anchor) : switchAccount(it.value)), placement);
}

const accountEl = $('#account');
async function renderAccountChip() {
  const list = state.config?.authMode === 'claude-code' ? await api.accounts() : [];
  const a = list.find((x) => x.current);
  state.accountCount = list.length;
  markWindow(list.length > 1 ? a : null);
  accountEl.hidden = !a;
  if (!a) return;
  accountEl.title = `${a.email}${a.plan ? ` · Plan ${PLAN_NAMES[a.plan] || a.plan}` : ''}\nCuenta de esta ventana · clic para cambiarla`;
  accountEl.innerHTML = `<span class="acc-avatar">${esc(accountInitial(a))}</span>`; // solo la inicial en el color de la cuenta: más sitio para las pestañas
  accountEl.setAttribute('aria-label', `Cuenta: ${a.email}`);
}
accountEl.addEventListener('click', () => openAccountMenu(accountEl, 'right'));
api.onAccountsChanged(() => { extList = null; renderAccountChip(); if ($('#settings').open) renderAccounts(); });
// Guardada desde otra ventana (apariencia, tema…) o presets cambiados por Claude (MCP presets)
api.onConfigChanged((cfg) => {
  applyConfigUi(cfg);
  if (current()?.picker) renderPicker();
  renderPresetList();
});

// Con varias cuentas, cada ventana se marca con el color de la suya, como los perfiles de Chrome: barra de
// título teñida, el correo en el título de la ventana y el icono de Claude en su color, con botón propio en
// la barra de tareas
let markKey = null;
function markWindow(a) {
  document.body.classList.toggle('acc-marked', !!a);
  if (a) document.body.style.setProperty('--acc', a.color); else document.body.style.removeProperty('--acc');
  state.markEmail = a?.email || '';
  renderTabs();
  const key = a ? `${a.key}|${a.color}` : '';
  if (key === markKey) return;
  markKey = key;
  api.markWindow(a ? { color: a.color, email: a.email, group: a.key, icons: sparkIcons(a.color) } : null);
}
// El símbolo de Claude en un color, en los tamaños del .ico de la app (PNG en base64)
function sparkIcons(color) {
  const path = new Path2D(SPARK_PATH);
  return [16, 20, 24, 32, 40, 48, 64, 256].map((size) => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const k = size <= 24 ? 1 : 0.94; // con menos margen en tamaños pequeños, como make-icon.cjs
    g.translate(size / 2, size / 2); g.scale((size / 24) * k, (size / 24) * k); g.translate(-12, -12);
    g.fillStyle = color;
    g.fill(path);
    return { size, data: c.toDataURL('image/png').split(',')[1] };
  });
}
// Ventana nueva con la cuenta que se elija (menú ⌄ o el de la cuenta)
async function openAccountWindowMenu(anchor = $('#tb-menu')) {
  const list = await api.accounts();
  openPopover(anchor, 'Nueva ventana · ¿con qué cuenta?', list.map((a) => ({
    value: a.key, title: a.email, color: a.color, locked: a.locked,
    desc: [a.plan && `Plan ${PLAN_NAMES[a.plan] || a.plan}`, a.current && 'la de esta ventana', a.locked && 'hay que volver a iniciar sesión'].filter(Boolean).join(' · '),
  })), async (it) => {
    if (it.locked) return startLogin();
    try { await api.newAccountWindow(it.value); } catch (err) { toast(errText(err), 'err'); }
  }, anchor === accountEl ? 'right' : undefined);
}

// Preguntas del proceso principal (una pestaña que llega de una ventana con otra cuenta) y de la interfaz (confirmAsk)
const askDialog = $('#ask-dialog');
let askRid = null;
let askLocal = null; // la respuesta de confirmAsk
const answerAsk = (ok) => {
  if (askLocal) { const r = askLocal; askLocal = null; askDialog.close(); r(ok); return; }
  if (!askRid) return;
  api.answer(askRid, ok);
  askRid = null;
  askDialog.close();
};
// Sí o no con el diálogo de la app; con el foco en Cancelar, para que un Intro de más no lo acepte
function confirmAsk(title, text, yes = 'Continuar') {
  answerAsk(false);
  $('#ask-title').textContent = title;
  $('#ask-text').textContent = text;
  $('#ask-yes').textContent = yes;
  askDialog.showModal();
  $('#ask-no').focus();
  return new Promise((r) => { askLocal = r; });
}
api.onAsk(({ rid, kind, email, title }) => {
  answerAsk(false);
  askRid = rid;
  $('#ask-yes').textContent = 'Continuar';
  if (kind === 'account') {
    $('#ask-title').textContent = '¿Quieres continuar?';
    $('#ask-text').textContent = `Se cambiará tu sesión${title ? ` «${title}»` : ''} a la cuenta ${email}, la de esta ventana. La conversación sigue donde estaba.`;
  }
  askDialog.showModal();
});
$('#ask-yes').onclick = () => answerAsk(true);
$('#ask-no').onclick = () => answerAsk(false);
askDialog.addEventListener('close', () => answerAsk(false)); // Esc

const loginDialog = $('#login-dialog');
const loginForm = $('#login-form');
let loginUrl = '';
api.onLoginUrl((url) => {
  loginUrl = url;
  $('#login-copy').disabled = $('#login-open').disabled = false;
});
async function startLogin() {
  loginUrl = '';
  $('#login-copy').disabled = $('#login-open').disabled = true;
  loginForm.code.value = '';
  loginDialog.showModal();
  const r = await api.login();
  loginDialog.close();
  if (r.ok) {
    toast(`Sesión iniciada con ${r.account.email}. Esta ventana y sus pestañas pasan a usarla.`);
    if ($('#settings').open) renderAccounts();
    applyConfigUi(await api.getConfig());
  } else if (!r.cancelled) toast(r.error, 'err');
}
loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (loginForm.code.value.trim()) api.loginCode(loginForm.code.value);
  loginForm.code.value = '';
});
$('#login-cancel').onclick = () => api.cancelLogin();
loginDialog.addEventListener('cancel', (e) => { e.preventDefault(); api.cancelLogin(); });
$('#login-copy').onclick = () => { navigator.clipboard.writeText(loginUrl); toast('Enlace copiado.'); };
$('#login-open').onclick = () => window.open(loginUrl);
$('#add-account').onclick = () => startLogin();
$('#pick-cwd').onclick = async () => { const d = await api.pickDir(); if (d) form.cwd.value = d; };
$('#pick-claude').onclick = async () => { const f = await api.pickFile(); if (f) form.claudePath.value = f; };
$('#settings-cancel').onclick = () => $('#settings').close();

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const patch = {
    userName: form.userName.value.trim(),
    theme: form.theme.value || 'system',
    authMode: form.authMode.value,
    model: form.model.value.trim() === 'default' ? '' : form.model.value.trim(),
    effort: form.effort.value,
    compactWindow: form.compactWindow.value,
    systemPrompt: form.systemPrompt.value,
    permissionMode: form.permissionMode.value,
    cwd: form.cwd.value.trim(),
    claudePath: form.claudePath.value.trim(),
    hotkey: form.hotkey.value.trim(),
    autoStart: form.autoStart.checked,
    notify: { done: form.notifyDone.checked, ask: form.notifyAsk.checked, scheduled: form.notifyScheduled.checked, sound: form.notifySound.checked },
    voiceHotkey: form.voiceHotkey.value.trim(),
    voicePreset: form.voicePreset.value,
    shotHotkey: form.shotHotkey.value.trim(),
    voiceModel: form.voiceModel.value,
    voiceEffort: form.voiceEffort.value,
    whatsappView: form.whatsappView.value,
    appearance: readLook(),
    ext: settingsExt,
    blankBare: form.blankBare.checked,
    autoPreview: form.autoPreview.checked,
    ...clears,
  };
  if (form.apiKey.value) patch.apiKey = form.apiKey.value;
  if (form.oauthToken.value) patch.oauthToken = form.oauthToken.value;
  const { config, hotkeyOk, badKeys } = await api.setConfig(patch);
  applyConfigUi(config);
  if (!hotkeyOk) {
    showSettingsTab('general');
    $('#settings-msg').textContent = `No se pudo registrar ${badKeys.map((k) => `«${k}»`).join(' ni ')}: formato inválido o lo usa otro programa. Lo demás se ha guardado.`;
    return;
  }
  $('#settings').close();
  focusInput();
});

// ---------- Apariencia: colores, imagen de fondo, tamaño de letra, ancho, márgenes, tipografías y zoom ----------
// Se guarda en config.appearance; lo que coincide con el valor por defecto se deja al CSS (appearance.css).
const LOOK_DEFAULTS = { fontSize: 15, lineHeight: 1.7, width: 768, pad: 28, chatFont: 'sans', chatFontName: '', uiFont: '', monoFont: '', termSize: 14, zoom: 1,
  palette: 'claude', accent: '#d97757', bgImage: '', bgOpacity: 0.3, bgBlur: 12, code: 'claude', transcript: 'normal', reduceMotion: false };
const LOOK_FULL_WIDTH = 1648; // el máximo del control: todo el ancho de la ventana
const rootCss = getComputedStyle(document.documentElement);
const BASE_SANS = rootCss.getPropertyValue('--sans').trim();
const BASE_MONO = rootCss.getPropertyValue('--mono').trim();
const BASE_SERIF = rootCss.getPropertyValue('--serif').trim();
const LOOK_FONTS = ['Segoe UI Variable Text', 'Segoe UI', 'Aptos', 'Inter', 'Calibri', 'Arial', 'Verdana', 'Georgia', 'Cambria', 'Charter', 'Source Serif 4 Variable'];
const LOOK_MONO_FONTS = ['Cascadia Code', 'Cascadia Mono', 'Consolas', 'JetBrains Mono', 'Fira Code', 'Source Code Pro', 'Courier New'];
const cleanFont = (n) => String(n || '').replace(/["';{}\\]/g, '').trim();
const quoteFont = (n) => (cleanFont(n) ? `"${cleanFont(n)}"` : '');
// Ruta local → url() de CSS (con #, ? y espacios escapados)
// (C:\… → file:///C:/…; /home/… → file:///home/…)
const fileUrl = (p) => 'file://' + (/^[A-Za-z]:/.test(p) ? '/' : '') + encodeURI(p.replace(/\\/g, '/')).replace(/#/g, '%23').replace(/\?/g, '%3F');
const lookOf = (cfg) => ({ ...LOOK_DEFAULTS, ...cfg?.appearance });

function applyAppearance(look) {
  const a = { ...LOOK_DEFAULTS, ...look };
  const root = document.documentElement;
  const css = (name, value, isDefault) => (isDefault ? root.style.removeProperty(name) : root.style.setProperty(name, value));
  css('--chat-fs', `${a.fontSize}px`, a.fontSize === LOOK_DEFAULTS.fontSize);
  css('--chat-lh', String(a.lineHeight), a.lineHeight === LOOK_DEFAULTS.lineHeight);
  css('--chat-w', a.width >= LOOK_FULL_WIDTH ? '100vw' : `${a.width}px`, a.width === LOOK_DEFAULTS.width);
  css('--chat-pad', `${a.pad}px`, a.pad === LOOK_DEFAULTS.pad);
  root.classList.toggle('custom-pad', a.pad !== LOOK_DEFAULTS.pad);
  const chatFont = { serif: 'var(--serif)', mono: 'var(--mono)', custom: quoteFont(a.chatFontName) && `${quoteFont(a.chatFontName)}, var(--sans)` }[a.chatFont];
  css('--chat-font', chatFont, !chatFont);
  const mono = quoteFont(a.monoFont) ? `${quoteFont(a.monoFont)}, ${BASE_MONO}` : BASE_MONO;
  css('--mono', mono, !quoteFont(a.monoFont));
  // Sin tipografía propia, la interfaz y lo que escribes van con la de las respuestas
  const uiFont = quoteFont(a.uiFont) ? `${quoteFont(a.uiFont)}, ${BASE_SANS}`
    : { serif: BASE_SERIF, mono, custom: quoteFont(a.chatFontName) && `${quoteFont(a.chatFontName)}, ${BASE_SANS}` }[a.chatFont];
  css('--sans', uiFont, !uiFont);
  setTermLook(a.termSize, quoteFont(a.monoFont));
  api.setZoom(a.zoom);
  // Paleta (appearance.css): la de Claude es la de siempre; la personalizada toma el color elegido
  if (a.palette === 'claude') delete root.dataset.palette;
  else root.dataset.palette = a.palette;
  css('--tint', a.accent, a.palette !== 'custom');
  css('--accent-l', a.accent, a.palette !== 'custom');
  // Imagen de fondo, tenue y difuminada detrás del chat
  document.body.classList.toggle('has-bg', !!a.bgImage);
  css('--bg-image', a.bgImage && `url("${fileUrl(a.bgImage)}")`, !a.bgImage);
  css('--bg-opacity', String(a.bgOpacity), !a.bgImage);
  css('--bg-blur', `${a.bgBlur}px`, !a.bgImage);
  if (a.code === 'claude') delete root.dataset.code; else root.dataset.code = a.code;
  root.classList.toggle('reduce-motion', !!a.reduceMotion);
  // La vista por defecto de la conversación: se repinta si ha cambiado
  if (a.transcript !== state.lookView) { state.lookView = a.transcript; if (state.activeId) renderThread(); }
}

const lookFields = { fontSize: 'lookFontSize', lineHeight: 'lookLineHeight', width: 'lookWidth', pad: 'lookPad', termSize: 'lookTermSize', zoom: 'lookZoom', bgOpacity: 'lookBgOpacity', bgBlur: 'lookBgBlur' };
const lookShow = {
  lookFontSize: (v) => `${String(v).replace('.', ',')} px`,
  lookLineHeight: (v) => Number(v).toFixed(2).replace('.', ','),
  lookWidth: (v) => (v >= LOOK_FULL_WIDTH ? 'Completo' : `${v} px`),
  lookPad: (v) => `${v} px`,
  lookTermSize: (v) => `${v} px`,
  lookZoom: (v) => `${Math.round(v * 100)} %`,
  lookBgOpacity: (v) => `${Math.round(v * 100)} %`,
  lookBgBlur: (v) => `${v} px`,
};
let lookBg = ''; // imagen de fondo elegida en el formulario (aún sin guardar)
function syncLookOutputs() {
  form.querySelectorAll('output[data-for]').forEach((o) => (o.textContent = lookShow[o.dataset.for](Number(form[o.dataset.for].value))));
  form.lookChatFontName.hidden = form.lookChatFont.value !== 'custom';
  $('#bg-thumb').style.backgroundImage = lookBg ? `url("${fileUrl(lookBg)}")` : '';
  $('#bg-clear').hidden = form.querySelector('.bg-opts').hidden = !lookBg;
}
function fillLook(look) {
  const a = { ...LOOK_DEFAULTS, ...look };
  for (const [k, f] of Object.entries(lookFields)) form[f].value = a[k];
  form.lookChatFont.value = a.chatFont;
  form.lookChatFontName.value = a.chatFontName;
  form.lookUiFont.value = a.uiFont;
  form.lookMonoFont.value = a.monoFont;
  form.lookPalette.value = a.palette;
  form.lookAccent.value = a.accent;
  form.lookCode.value = a.code;
  form.lookTranscript.value = a.transcript;
  form.lookReduceMotion.checked = !!a.reduceMotion;
  lookBg = a.bgImage;
  syncLookOutputs();
}
function readLook() {
  const a = {};
  for (const [k, f] of Object.entries(lookFields)) a[k] = Number(form[f].value);
  a.chatFont = form.lookChatFont.value || 'sans';
  a.chatFontName = cleanFont(form.lookChatFontName.value);
  a.uiFont = cleanFont(form.lookUiFont.value);
  a.monoFont = cleanFont(form.lookMonoFont.value);
  if (a.chatFont === 'custom' && !a.chatFontName) a.chatFont = 'sans';
  a.palette = form.lookPalette.value || 'claude';
  a.accent = form.lookAccent.value;
  a.code = form.lookCode.value || 'claude';
  a.transcript = form.lookTranscript.value || 'normal';
  a.reduceMotion = form.lookReduceMotion.checked;
  a.bgImage = lookBg;
  return a;
}
$('#code-sample').innerHTML = codeBlock([
  '// Vista previa del tema',
  "async function saludar(nombre = 'mundo') {",
  '  const veces = 3; /* número */',
  '  return `Hola, ${nombre}`.repeat(veces);',
  '}',
].join('\n'), 'javascript');
$('#look-fonts').innerHTML = LOOK_FONTS.map((f) => `<option value="${esc(f)}">`).join('');
$('#look-mono-fonts').innerHTML = LOOK_MONO_FONTS.map((f) => `<option value="${esc(f)}">`).join('');
// Vista previa al momento; al cancelar se vuelve a lo guardado
const previewLook = () => { syncLookOutputs(); applyAppearance(readLook()); };
form.querySelector('[data-panel="look"]').addEventListener('input', previewLook);
form.lookAccent.addEventListener('input', () => { form.lookPalette.value = 'custom'; previewLook(); }); // elegir color = paleta personalizada
$('#bg-pick').onclick = async () => { const f = await api.pickBackground(); if (f) { lookBg = f; previewLook(); } };
$('#bg-clear').onclick = () => { lookBg = ''; previewLook(); };
$('#look-reset').onclick = () => { fillLook({}); applyAppearance(LOOK_DEFAULTS); };
$('#settings').addEventListener('close', () => applyAppearance(state.config?.appearance));

// Zoom de toda la interfaz: Ctrl + rueda, Ctrl++, Ctrl+- y Ctrl+0
let zoomSave = null;
function zoomBy(step) {
  const a = lookOf(state.config);
  const zoom = step ? Math.min(1.5, Math.max(0.75, Math.round((a.zoom + step * 0.05) * 100) / 100)) : 1;
  if (zoom === a.zoom) return;
  state.config.appearance = { ...a, zoom };
  applyAppearance(state.config.appearance);
  if ($('#settings').open) { form.lookZoom.value = zoom; syncLookOutputs(); }
  toast(`Zoom: ${Math.round(zoom * 100)} %`);
  clearTimeout(zoomSave);
  zoomSave = setTimeout(() => patchConfig({ appearance: state.config.appearance }), 500);
}
window.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1 : -1); } }, { passive: false, capture: true });

// ---------- Presets ----------
const PRESET_COLORS = ['#c96442', '#3b6fd4', '#2f8a5b', '#c58a1e', '#8a6fd1', '#d14d72', '#2d9bb0', '#6b6a64'];
const presets = () => state.config?.presets || [];
const shortPath = (p) => {
  const parts = String(p || '').split(/[\\/]+/).filter(Boolean);
  // En la carta caben unos 24 caracteres: si las dos últimas carpetas no caben, solo la última (lo que distingue)
  if (parts.length > 3) return `…${SEP}${(parts.slice(-2).join(SEP).length > 22 ? parts.slice(-1) : parts.slice(-2)).join(SEP)}`;
  return (IS_WIN ? '' : '/') + parts.join(SEP);
};

function renderPicker() {
  const list = presets();
  const name = state.config?.userName?.trim();
  $('#picker-title').textContent = name ? `¿Con qué empezamos, ${name}?` : '¿Con qué empezamos?';
  $('#preset-grid').innerHTML = list.map((p, i) => {
    const tags = [p.desktop && (IS_WIN || IS_MAC) ? `${I.terminal}Apps` : '', p.whatsapp ? `${I.terminal}WhatsApp` : '', p.chrome ? `${I.chrome}Chrome${p.chromeAsk ? ' · pregunta' : ''}` : '', p.startupPrompt?.trim() ? `${I.bolt}Arranque` : '', p.addDirs?.length ? `${I.folder}+${p.addDirs.length}` : ''].filter(Boolean);
    return `<div class="preset-card" tabindex="0" role="button" data-preset="${esc(p.id)}" style="--c:${esc(p.color)}">
      ${i < 9 ? `<kbd class="pc-num">${i + 1}</kbd>` : ''}
      <button type="button" class="pc-edit icon-btn sm" data-edit="${esc(p.id)}" title="Editar preset">${I.pencil}</button>
      ${presetAvatar(p, 'pc-avatar')}
      <span class="pc-name">${esc(p.name)}</span>
      <span class="pc-desc">${esc(p.description || '')}</span>
      <span class="pc-path" title="${esc(p.cwd)}">${I.folder}${esc(shortPath(p.cwd))}</span>
      ${tags.length ? `<span class="pc-tags">${tags.map((t) => `<span>${t}</span>`).join('')}</span>` : ''}
    </div>`;
  }).join('') + `
    <div class="preset-card blank" tabindex="0" role="button" data-preset="">
      <span class="pc-avatar blank-avatar">${sparkSvg()}</span>
      <span class="pc-name">En blanco</span>
      <span class="pc-desc">Configuración general, sin preset</span>
      <span class="pc-path">${I.folder}${esc(shortPath(state.config?.cwd))}</span>
    </div>
    <div class="preset-card add" tabindex="0" role="button" data-add>
      <span class="pc-avatar add-avatar">${I.plus}</span>
      <span class="pc-name">Añadir preset</span>
      <span class="pc-desc">Carpeta, modelo, permisos e instrucciones propios</span>
    </div>`;
}

function pickPreset(presetId) {
  const id = state.activeId;
  if (!current()?.picker) return;
  openSession({ presetId: presetId || null, replace: id });
}

$('#preset-grid').addEventListener('click', (e) => {
  const edit = e.target.closest('[data-edit]');
  if (edit) { e.stopPropagation(); return openPresetEditor(presets().find((p) => p.id === edit.dataset.edit)); }
  const card = e.target.closest('.preset-card');
  if (!card) return undefined;
  if (card.hasAttribute('data-add')) return openPresetEditor(null);
  return pickPreset(card.dataset.preset);
});
$('#preset-grid').addEventListener('keydown', (e) => {
  const card = e.target.closest('.preset-card');
  if (!card) return;
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); card.click(); }
  const cards = [...$('#preset-grid').querySelectorAll('.preset-card')];
  const i = cards.indexOf(card);
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); cards[(i + 1) % cards.length].focus(); }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); cards[(i - 1 + cards.length) % cards.length].focus(); }
});

// Editor de presets
const pform = $('#preset-form');
let editingPreset = null;

function updatePresetPreview() {
  const p = { name: pform.name.value || '?', emoji: pform.emoji.value.trim(), color: editingPreset.color };
  $('#pe-avatar').outerHTML = presetAvatar(p, 'pe-avatar').replace('class="pe-avatar"', 'class="pe-avatar" id="pe-avatar"');
  $('#pe-swatches').innerHTML = PRESET_COLORS.map((c) => `<button type="button" class="swatch${c === editingPreset.color ? ' on' : ''}" data-color="${c}" style="--c:${c}" title="${c}"></button>`).join('');
}

function openPresetEditor(preset) {
  closePopover();
  editingPreset = preset ? structuredClone(preset) : {
    id: '', name: '', emoji: '', color: PRESET_COLORS[presets().length % PRESET_COLORS.length], description: '',
    cwd: state.config?.cwd || '', addDirs: [], model: '', effort: '', permissionMode: '', chrome: false, chromeAsk: false, desktop: false, whatsapp: false, plugins: true, instructions: '', startupPrompt: '',
  };
  const p = editingPreset;
  $('#pe-title').textContent = preset ? `Editar «${preset.name}»` : 'Nuevo preset';
  for (const k of ['name', 'emoji', 'description', 'cwd', 'instructions', 'startupPrompt']) pform[k].value = p[k] || '';
  pform.addDirs.value = (p.addDirs || []).join('\n');
  pform.effort.value = p.effort || '';
  pform.permissionMode.value = p.permissionMode || '';
  const models = state.meta.models.filter((m) => m.value !== 'default');
  $('#pe-model').innerHTML = `<option value="">El general</option>${models.map((m) => `<option value="${esc(m.value)}">${esc(m.displayName)}</option>`).join('')}`
    + (p.model && !models.some((m) => m.value === p.model) ? `<option value="${esc(p.model)}">${esc(p.model)}</option>` : '');
  pform.model.value = p.model || '';
  renderPresetAccounts(p);
  $('#pe-delete').hidden = !preset;
  $('#pe-delete').textContent = 'Eliminar preset';
  $('#pe-delete').classList.remove('armed');
  $('#pe-msg').textContent = '';
  $('#pe-tools-q').value = toolsQuery.preset = '';
  toolsOpen.preset = new Set(['app']);
  renderPresetTools();
  updatePresetPreview();
  $('#preset-editor').showModal();
  pform.name.focus();
}

pform.addEventListener('input', (e) => { if (['name', 'emoji'].includes(e.target.name)) updatePresetPreview(); });
$('#pe-swatches').addEventListener('click', (e) => {
  const sw = e.target.closest('[data-color]');
  if (!sw) return;
  editingPreset.color = sw.dataset.color;
  updatePresetPreview();
});
$('#pe-pick-cwd').onclick = async () => { const d = await api.pickDir(pform.cwd.value); if (d) pform.cwd.value = d; };
$('#pe-add-dir').onclick = async () => {
  const d = await api.pickDir(pform.cwd.value);
  if (d) pform.addDirs.value = [pform.addDirs.value.trim(), d].filter(Boolean).join('\n');
};
$('#pe-cancel').onclick = () => $('#preset-editor').close();
$('#pe-delete').onclick = async () => {
  const b = $('#pe-delete');
  if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = '¿Seguro? Pulsa otra vez'; return; }
  state.config.presets = await api.deletePreset(editingPreset.id);
  $('#preset-editor').close();
  afterPresetsChange();
};
pform.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!pform.name.value.trim()) { $('#pe-msg').textContent = 'Ponle un nombre.'; return; }
  if (!pform.cwd.value.trim()) { $('#pe-msg').textContent = 'Elige una carpeta de trabajo.'; return; }
  const saved = {
    ...editingPreset,
    name: pform.name.value.trim(),
    emoji: pform.emoji.value.trim(),
    description: pform.description.value.trim(),
    cwd: pform.cwd.value.trim(),
    addDirs: pform.addDirs.value.split('\n').map((s) => s.trim()).filter(Boolean),
    model: pform.model.value,
    account: pform.account.value,
    permissionMode: pform.permissionMode.value,
    effort: pform.effort.value,
    instructions: pform.instructions.value,
    startupPrompt: pform.startupPrompt.value,
  };
  state.config.presets = await api.savePreset(saved);
  $('#preset-editor').close();
  afterPresetsChange();
});

// Cuenta del preset: solo si hay más de una; una que ya no está se conserva (y se avisa)
async function renderPresetAccounts(p) {
  const list = state.config?.authMode === 'claude-code' ? await api.accounts() : [];
  $('#pe-account-field').hidden = list.length < 2 && !p.account;
  $('#pe-account').innerHTML = '<option value="">La de la ventana desde la que se abre</option>'
    + list.map((a) => `<option value="${esc(a.key)}">${esc(a.email)}${a.locked ? ' (hay que volver a iniciar sesión)' : ''}</option>`).join('')
    + (p.account && !list.some((a) => a.key === p.account) ? `<option value="${esc(p.account)}">Una cuenta que ya no está (se abre con la de la ventana)</option>` : '');
  pform.account.value = p.account || '';
}

function afterPresetsChange() {
  if (current()?.picker) renderPicker();
  renderPresetList();
  focusInput();
}

// Lista de presets en Configuración (arrastrar para reordenar)
function renderPresetList() {
  $('#preset-list').innerHTML = presets().map((p) => `<div class="preset-row" draggable="true" data-id="${esc(p.id)}">
    <span class="pr-grip">${I.grip}</span>${presetAvatar(p, 'pr-avatar')}
    <span class="pr-text"><span class="pr-name">${esc(p.name)}</span><span class="pr-path">${esc(p.cwd)}</span></span>
    <button type="button" class="btn sm" data-edit="${esc(p.id)}">Editar</button></div>`).join('');
}
$('#preset-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-edit]');
  if (b) openPresetEditor(presets().find((p) => p.id === b.dataset.edit));
});
let dragPreset = null;
$('#preset-list').addEventListener('dragstart', (e) => { dragPreset = e.target.closest('.preset-row')?.dataset.id; });
$('#preset-list').addEventListener('dragover', (e) => {
  const row = e.target.closest('.preset-row');
  if (!dragPreset || !row || row.dataset.id === dragPreset) return;
  e.preventDefault();
  const list = presets();
  const from = list.findIndex((p) => p.id === dragPreset);
  const [moved] = list.splice(from, 1);
  const r = row.getBoundingClientRect();
  list.splice(list.findIndex((p) => p.id === row.dataset.id) + (e.clientY > r.top + r.height / 2 ? 1 : 0), 0, moved);
  renderPresetList();
});
$('#preset-list').addEventListener('dragend', async () => {
  if (!dragPreset) return;
  dragPreset = null;
  state.config.presets = await api.reorderPresets(presets().map((p) => p.id));
  afterPresetsChange();
});
$('#preset-add').onclick = () => openPresetEditor(null);

// ---------- Conectores, skills y plugins ----------
// Lo general (config.ext) y lo de cada preset (preset.ext): { mcp|skills|plugins: { nombre: bool } }.
// Solo se guarda lo que cambia respecto a lo de abajo (en el preset, lo que difiere de lo general).
let extList = null;
let settingsExt = null; // copia de config.ext mientras está abierta Configuración
const MCP_STATUS = { connected: ['conectado', 'ok'], failed: ['error', 'bad'], 'needs-auth': ['sin autorizar', 'warn'], pending: ['conectando', 'warn'], disabled: ['desactivado en claude.ai', 'off'] };
const extName = (kind, it) => kind === 'mcp' ? it.name.replace(/^claude\.ai /, '').replace(/^plugin:([^:]+):.*/, '$1') : it.name;
async function loadExt(fresh) {
  if (!extList || fresh) extList = await api.listExt(fresh);
  return extList;
}
// Lista por grupos plegables (Configuración › Conectores y el editor de presets), con buscador.
// base: lo que vale si no se toca (en un preset, lo general); own: lo propio de este ámbito.
// app (solo en presets): el propio preset, para sus herramientas de la app (Chrome, WhatsApp, control de apps) y plugins
const toolsOpen = { global: new Set(['local']), preset: new Set(['app']) };
const toolsSeen = new Set(); // grupos de cuenta ya vistos: el de la principal empieza abierto en Configuración
const toolsQuery = { global: '', preset: '' };
const hue = (s) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 17);
function toolsHtml(list, base, own, scope, app) {
  const q = foldText(toolsQuery[scope].trim());
  const hit = (...t) => !q || t.some((x) => foldText(x || '').includes(q));
  const on = (kind, key) => own[kind]?.[key] ?? base[kind]?.[key] ?? true;
  const loading = !list.loaded;
  const pluginsOff = app && app.plugins === false;
  const row = (o) => {
    const input = o.app ? `data-app="${o.app}"` : `data-kind="${o.kind}" data-key="${esc(o.key)}"`;
    const checked = o.app ? !!app[o.app] : on(o.kind, o.key) && !o.locked;
    const changed = scope === 'preset' && o.kind && own[o.kind]?.[o.key] !== undefined;
    return `<label class="tl-row${o.locked ? ' locked' : ''}${o.cls ? ` ${o.cls}` : ''}"${o.tip ? ` title="${esc(o.tip)}"` : ''}>`
      + `<span class="tl-ico"${o.icon ? '' : ` style="--h:${hue(o.label)}"`}>${o.icon || esc(o.label.replace(/^[^\p{L}\p{N}]+/u, '')[0]?.toUpperCase() || '?')}</span>`
      + `<span class="tl-text"><span class="tl-name"><span class="tl-label">${esc(o.label)}</span>${o.tag || ''}${changed ? '<span class="ext-own" title="Distinto de lo general">cambiado</span>' : ''}</span>`
      + `${o.meta ? `<span class="tl-meta">${o.meta}</span>` : ''}</span>${o.extra || ''}`
      + `<input type="checkbox" class="switch" ${input}${checked ? ' checked' : ''}${o.locked ? ' disabled' : ''}></label>`;
  };
  const groups = [];
  // n: activos; rows: los que pasan el filtro
  const group = (id, icon, title, items, { empty, bulk = true, head = '', tail = '', note = '', more = '' } = {}) => {
    const shown = items.filter((it) => hit(it.label, it.key, it.find));
    if (q && !shown.length) return;
    const usable = items.filter((it) => !it.locked && !it.sub);
    const n = usable.filter((it) => (it.app ? app[it.app] : on(it.kind, it.key))).length;
    const open = q || toolsOpen[scope].has(id);
    // Los de more (p. ej. sin autorizar) van plegados al final; se pintan igual para que Todos/Ninguno los cuente
    const rest = shown.filter((it) => it.more);
    const showRest = q || toolsOpen[scope].has(`${id}+`);
    const rowsHtml = shown.filter((it) => !it.more).map(row).join('') + (rest.length
      ? `<button type="button" class="tl-more" data-more="${id}">${I.chevron}${showRest ? 'Ocultar' : 'Mostrar'} ${rest.length} ${more}</button><div class="tl-more-rows"${showRest ? '' : ' hidden'}>${rest.map(row).join('')}</div>`
      : '');
    groups.push(`<details class="tl-group" data-g="${id}"${open ? ' open' : ''}>`
      + `<summary><span class="tl-chev">${I.chevron}</span><span class="tl-gico">${icon}</span><span class="tl-gtitle">${title}</span>`
      + `<span class="tl-count${usable.length && !n ? ' none' : ''}">${loading && !usable.length ? '…' : usable.length ? `${n} de ${usable.length}` : '0'}</span>`
      + `<span class="tl-gtools">${head}${bulk && usable.length ? '<button type="button" class="tl-bulk" data-bulk="1">Todos</button><button type="button" class="tl-bulk" data-bulk="0">Ninguno</button>' : ''}${tail}</span></summary>`
      + `${note}<div class="tl-rows">${shown.length ? rowsHtml : `<div class="ext-empty">${loading ? 'Consultando Claude Code…' : empty}</div>`}</div></details>`);
  };
  const mcpMeta = (s) => {
    const [txt, cls] = MCP_STATUS[s.status] || [s.status, 'off'];
    return `<span class="ext-dot ${cls}"></span>${esc(txt)}${s.tools ? ` · ${s.tools} herramienta${s.tools === 1 ? '' : 's'}` : ''}`;
  };
  const rank = (s) => ({ connected: 0, pending: 1, failed: 2, 'needs-auth': 3 }[s.status] ?? 4); // los que funcionan, primero
  const sorted = (a) => a.sort((x, y) => rank(x) - rank(y) || extName('mcp', x).localeCompare(extName('mcp', y)));
  const mcpItem = (s) => ({
    kind: 'mcp', key: s.name, label: extName('mcp', s), meta: mcpMeta(s), locked: s.status === 'disabled', more: s.status === 'needs-auth',
    tag: s.source === 'plugin' ? '<span class="ext-tag">plugin</span>' : s.scope && s.scope !== 'user' && s.source !== 'claudeai' ? `<span class="ext-tag">${esc(s.scope)}</span>` : '',
    extra: scope === 'global' && s.scope === 'user' && s.source === 'local' ? `<button type="button" class="ext-remove" data-remove="${esc(s.name)}" title="Quitar de Claude Code">${I.x}</button>` : '',
  });
  if (app) {
    const desktop = IS_MAC ? ['Control de apps del Mac', 'Finder, Mail, Keynote…'] : ['Control de aplicaciones de Windows', 'Explorador, Office…'];
    group('app', I.spark, 'De la app', [
      { app: 'chrome', label: 'Claude in Chrome', icon: I.chrome, meta: 'Tu Chrome real, con tus sesiones iniciadas, para webs y aplicaciones web.' },
      ...(app.chrome ? [{ app: 'chromeAsk', sub: true, cls: 'tl-sub', label: 'Preguntar antes de abrirlo', icon: I.question, meta: 'Si no le pides expresamente el navegador (Chrome, una web…), te pregunta antes.' }] : []),
      { app: 'whatsapp', label: 'WhatsApp en segundo plano', icon: I.chat, meta: 'Busca, lee y envía mensajes y archivos sin quitarte el foco. Gasta poco.' },
      ...(IS_WIN || IS_MAC ? [{ app: 'desktop', label: desktop[0], icon: I.terminal, meta: `Abre y maneja programas (${desktop[1]}): ve la pantalla, hace clic y escribe. Es lo que más gasta.` }] : []),
    ], { bulk: false });
  }
  // Los de claude.ai son de cada cuenta: un grupo por cuenta (se encienden y apagan por nombre, en todas)
  const link = (email) => `<a href="https://claude.ai/settings/connectors" target="_blank" class="ext-link" title="Abre claude.ai en el navegador: tiene que tener la sesión iniciada con ${esc(email || 'esta cuenta')}">Conectar más ↗</a>`;
  const clouds = list.accounts?.length ? list.accounts : [{ key: '', mcp: list.mcp.filter((s) => s.source === 'claudeai'), active: true }];
  for (const a of clouds) {
    const id = `cloud:${a.key}`;
    if (a.active && !toolsSeen.has(id)) { toolsSeen.add(id); toolsOpen.global.add(id); }
    const title = clouds.length > 1
      ? `<span title="Conectores de claude.ai de ${esc(a.email)}${a.active ? ' (la cuenta principal)' : ''}: solo los usan las pestañas de sus ventanas"><span class="tl-acc" style="--c:${esc(a.color || 'var(--muted)')}"></span>${esc(a.email)}</span>`
      : 'Conectores de claude.ai';
    group(id, I.plug, title, sorted(a.mcp.slice()).map((s) => ({ ...mcpItem(s), find: a.email })), {
      empty: a.error ? `No se pudo consultar: ${esc(a.error)}` : 'Ninguno conectado. Los que conectes en claude.ai con esta cuenta aparecen aquí.',
      more: 'sin autorizar en Claude Code', head: link(a.email),
    });
  }
  group('local', I.terminal, 'Servidores MCP', sorted(list.mcp.filter((s) => s.source !== 'claudeai')).map(mcpItem), {
    empty: scope === 'global' ? 'Ninguno. Añade uno abajo.' : 'Ninguno. Se añaden en Configuración › Conectores.', more: 'sin autorizar',
  });
  group('plugins', I.tool, 'Plugins', list.plugins.map((p) => ({
    kind: 'plugins', key: p.id, label: p.name, find: p.description, locked: !p.enabled || pluginsOff,
    meta: !p.enabled ? 'Desactivado en Claude Code (/plugin)' : esc(p.description.slice(0, 160)), tip: p.description,
    tag: p.version ? `<span class="ext-tag">${esc(p.version.length > 10 ? p.version.slice(0, 7) : p.version)}</span>` : '',
  })), {
    empty: 'Ninguno instalado. Se instalan con /plugin en una pestaña.',
    bulk: !pluginsOff,
    tail: app ? `<input type="checkbox" class="switch" data-master="plugins" title="${pluginsOff ? 'Este preset no carga plugins' : 'Este preset carga plugins'}"${pluginsOff ? '' : ' checked'}>` : '',
    note: pluginsOff ? '<p class="tl-note">Este preset no carga ningún plugin (ni sus skills ni sus servidores MCP): ahorra contexto en cada mensaje.</p>' : '',
  });
  group('skills', I.brain, 'Skills', list.skills.map((s) => ({ kind: 'skills', key: s.name, label: s.name, find: s.description, meta: esc(s.description.slice(0, 160)), tip: s.description })), { empty: 'Ninguna.' });
  return (list.error ? `<p class="ext-error">No se pudo consultar Claude Code: ${esc(list.error)}</p>` : '')
    + (groups.join('') || `<div class="ext-empty">Nada coincide con «${esc(toolsQuery[scope])}».</div>`);
}
// Lo que se guarda en own: solo si difiere de base
function setOwn(base, own, kind, key, v) {
  own[kind] ||= {};
  if (v === (base[kind]?.[key] ?? true)) delete own[kind][key];
  else own[kind][key] = v;
}
// Interruptores, «Todos/Ninguno», plegar grupos y buscar; ctx() da { base, own, app, render }
function toolsEvents(el, search, scope, ctx) {
  el.addEventListener('change', (e) => {
    const t = e.target;
    const { base, own, app, render } = ctx();
    if (t.dataset.kind) setOwn(base, own, t.dataset.kind, t.dataset.key, t.checked);
    else if (t.dataset.app) app[t.dataset.app] = t.checked;
    else if (t.dataset.master) app.plugins = t.checked;
    else return;
    render();
  });
  el.addEventListener('click', (e) => {
    const m = e.target.closest('[data-more]');
    if (m) {
      const k = `${m.dataset.more}+`;
      toolsOpen[scope].has(k) ? toolsOpen[scope].delete(k) : toolsOpen[scope].add(k);
      ctx().render();
      return;
    }
    const b = e.target.closest('[data-bulk]');
    if (!b) return;
    e.preventDefault();
    const { base, own, render } = ctx();
    for (const sw of b.closest('.tl-group').querySelectorAll('.tl-rows input[data-kind]:not(:disabled)')) setOwn(base, own, sw.dataset.kind, sw.dataset.key, b.dataset.bulk === '1');
    render();
  });
  // toggle no burbujea: se escucha en captura
  el.addEventListener('toggle', (e) => {
    const g = e.target.dataset?.g;
    if (!g || toolsQuery[scope].trim()) return;
    e.target.open ? toolsOpen[scope].add(g) : toolsOpen[scope].delete(g);
  }, true);
  search.addEventListener('input', () => { toolsQuery[scope] = search.value; ctx().render(); });
  search.addEventListener('keydown', (e) => { if (e.key === 'Escape' && search.value) { e.preventDefault(); e.stopPropagation(); search.value = ''; toolsQuery[scope] = ''; ctx().render(); } });
}
const noList = { mcp: [], skills: [], plugins: [], loaded: false };
async function renderSettingsExt(fresh) {
  const el = $('#ext-panel');
  const draw = (list) => { el.innerHTML = toolsHtml(list, {}, settingsExt, 'global'); };
  if (!extList || fresh) draw(noList);
  draw({ ...await loadExt(fresh), loaded: true });
}
toolsEvents($('#ext-panel'), $('#ext-q'), 'global', () => ({ base: {}, own: settingsExt, render: () => renderSettingsExt() }));
$('#ext-refresh').onclick = () => renderSettingsExt(true);
$('#ext-panel').addEventListener('click', async (e) => {
  const rm = e.target.closest('[data-remove]');
  if (!rm) return;
  e.preventDefault();
  if (!rm.classList.contains('armed')) { rm.classList.add('armed'); rm.title = 'Pulsa otra vez para quitarlo'; return; }
  const r = await api.removeMcp(rm.dataset.remove);
  if (!r.ok) { toast(r.error || 'No se pudo quitar'); return; }
  extList = r.list;
  renderSettingsExt();
});
$('#mcp-save').onclick = async () => {
  const msg = $('#mcp-msg');
  msg.textContent = 'Añadiendo…';
  const r = await api.addMcp($('#mcp-name').value, $('#mcp-json').value);
  if (!r.ok) { msg.textContent = r.error; return; }
  msg.textContent = '';
  $('#mcp-name').value = '';
  $('#mcp-json').value = '';
  $('#mcp-add').open = false;
  extList = r.list;
  renderSettingsExt();
};
// Tras «Conectar más ↗» en claude.ai, al volver a la app se vuelve a consultar (con sonda nueva)
let extStale = false;
document.addEventListener('click', (e) => { if (e.target.closest('.ext-link')) extStale = true; });
window.addEventListener('focus', async () => {
  if (!extStale) return;
  extStale = false;
  if ($('#settings').open && $('#ext-panel').closest('[data-panel]')?.classList.contains('active')) return renderSettingsExt(true);
  extList = await api.listExt(true);
  if ($('#preset-editor').open) renderPresetTools();
});
// En el editor de presets
async function renderPresetTools() {
  const p = editingPreset;
  const own = p.ext ||= {};
  const base = state.config?.ext || {};
  const draw = (list) => {
    $('#pe-tools').innerHTML = toolsHtml(list, base, own, 'preset', p);
    const changes = Object.values(own).reduce((a, m) => a + Object.keys(m || {}).length, 0);
    const live = (list.mcp.filter((s) => s.status !== 'disabled').length ? list.mcp.filter((s) => s.status !== 'disabled' && (own.mcp?.[s.name] ?? base.mcp?.[s.name] ?? true)).length : 0)
      + ['chrome', 'whatsapp', 'desktop'].filter((k) => p[k]).length;
    $('#pe-tools-sum').textContent = list.loaded
      ? `${live} conector${live === 1 ? '' : 'es'} activo${live === 1 ? '' : 's'}${p.plugins === false ? ' · sin plugins' : ''}${changes ? ` · ${changes} cambio${changes === 1 ? '' : 's'} respecto a lo general` : ''}`
      : '';
  };
  draw(extList ? { ...extList, loaded: true } : noList);
  if (!extList) draw({ ...await loadExt(), loaded: true });
}
toolsEvents($('#pe-tools'), $('#pe-tools-q'), 'preset', () => ({ base: state.config?.ext || {}, own: editingPreset.ext ||= {}, app: editingPreset, render: renderPresetTools }));

// ---------- Configuración › Programadas: tareas que abren una pestaña con un preset y un prompt (schedules.mjs) ----------
// Se guardan al momento (no con «Guardar»): así «Ejecutar ahora» usa lo que se ve
const SCHED_DAYS = [[1, 'L', 'lunes'], [2, 'M', 'martes'], [3, 'X', 'miércoles'], [4, 'J', 'jueves'], [5, 'V', 'viernes'], [6, 'S', 'sábado'], [0, 'D', 'domingo']];
let schedEditing = null; // id de la tarea en edición, 'new' o null
const schedList = () => state.config?.schedules || [];
function schedWhen(s) {
  if (s.every) return s.every % 60 ? `Cada ${s.every} min` : s.every === 60 ? 'Cada hora' : `Cada ${s.every / 60} h`;
  const d = [...s.days].sort().join('');
  const days = d === '0123456' ? 'Todos los días' : d === '12345' ? 'De lunes a viernes' : d === '06' ? 'Sábados y domingos'
    : SCHED_DAYS.filter(([n]) => s.days.includes(n)).map(([, , name]) => name).join(', ');
  return `${days} a las ${s.time}`;
}
const fmtWhen = (ms) => {
  if (!ms) return '';
  const d = new Date(ms);
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  return today ? `hoy a las ${time}` : `${d.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' })}, ${time}`;
};
function renderSched() {
  const list = schedList();
  const next = state.config?.schedNext || {};
  $('#sched-list').innerHTML = list.length ? list.map((s) => {
    const p = presets().find((x) => x.id === s.presetId);
    const meta = [schedWhen(s), p ? p.name : 'Sin preset', s.enabled && next[s.id] ? `próxima: ${fmtWhen(next[s.id])}` : '', s.lastRun ? `última: ${fmtWhen(s.lastRun)}` : ''].filter(Boolean);
    return `<div class="sched-item${s.enabled ? '' : ' off'}" data-id="${esc(s.id)}">
      <input type="checkbox" class="switch" data-act="toggle"${s.enabled ? ' checked' : ''} title="${s.enabled ? 'Activa' : 'Pausada'}">
      <div class="sched-info"><div class="sched-name">${esc(s.name)}</div><div class="sched-meta">${meta.map(esc).join(' · ')}</div></div>
      <button type="button" class="icon-btn sm" data-act="run" title="Ejecutar ahora">${I.play}</button>
      <button type="button" class="icon-btn sm" data-act="edit" title="Editar">${I.pencil}</button>
      <button type="button" class="icon-btn sm sched-del" data-act="delete" title="Eliminar">${I.x}</button>
    </div>`;
  }).join('') : schedEditing ? '' : '<div class="ext-empty">Todavía no hay tareas programadas.</div>';
  const ed = $('#sched-edit');
  ed.hidden = !schedEditing;
  $('#sched-add').hidden = !!schedEditing;
}
function openSchedEditor(s) {
  schedEditing = s?.id || 'new';
  s ||= { name: '', presetId: presets()[0]?.id || null, prompt: '', every: 0, days: [1, 2, 3, 4, 5], time: '09:00' };
  $('#sched-name').value = s.name;
  $('#sched-preset').innerHTML = '<option value="">Sin preset (configuración general)</option>'
    + presets().map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  $('#sched-preset').value = s.presetId || '';
  $('#sched-prompt').value = s.prompt;
  $('#sched-days').innerHTML = SCHED_DAYS.map(([n, short, name]) => `<label title="${name}"><input type="checkbox" value="${n}"${s.days.includes(n) ? ' checked' : ''}><span>${short}</span></label>`).join('');
  $('#sched-time').value = s.time;
  $('#sched-every').value = s.every || 60;
  form.schedMode.value = s.every ? 'every' : 'days';
  syncSchedMode();
  $('#sched-msg').textContent = '';
  renderSched();
  $('#sched-name').focus();
}
function syncSchedMode() {
  document.querySelectorAll('.sched-when').forEach((el) => { el.hidden = el.dataset.mode !== form.schedMode.value; });
}
async function saveSchedules(list) {
  await patchConfig({ schedules: list });
  renderSched();
}
$('#sched-add').onclick = () => openSchedEditor(null);
$('#sched-cancel').onclick = () => { schedEditing = null; renderSched(); };
form.querySelectorAll('[name=schedMode]').forEach((r) => r.addEventListener('change', syncSchedMode));
$('#sched-save').onclick = async () => {
  const msg = $('#sched-msg');
  const every = form.schedMode.value === 'every' ? Math.max(5, parseInt($('#sched-every').value, 10) || 0) : 0;
  const days = [...$('#sched-days').querySelectorAll('input:checked')].map((i) => Number(i.value));
  const prompt = $('#sched-prompt').value.trim();
  if (!prompt) { msg.textContent = 'Falta el prompt.'; return; }
  if (!every && !days.length) { msg.textContent = 'Elige al menos un día.'; return; }
  const old = schedList().find((x) => x.id === schedEditing);
  const s = {
    ...old,
    id: old?.id || crypto.randomUUID().slice(0, 8),
    name: $('#sched-name').value.trim() || prompt.split('\n')[0].slice(0, 40),
    presetId: $('#sched-preset').value || null,
    prompt, every, days, time: $('#sched-time').value || '09:00',
    enabled: old ? old.enabled : true,
    // Al cambiar cuándo, se cuenta desde ahora (si no, «cada hora» saldría enseguida)
    created: Date.now(), lastRun: old?.lastRun || 0,
  };
  schedEditing = null;
  await saveSchedules(old ? schedList().map((x) => (x.id === s.id ? s : x)) : [...schedList(), s]);
};
$('#sched-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  const id = btn?.closest('.sched-item')?.dataset.id;
  const s = schedList().find((x) => x.id === id);
  if (!s || btn.dataset.act === 'toggle') return;
  if (btn.dataset.act === 'edit') openSchedEditor(s);
  else if (btn.dataset.act === 'run') {
    const convId = await api.runSchedule(id);
    if (!convId) { toast('No se pudo lanzar la tarea.'); return; }
    $('#settings').close();
    // La pestaña llega por su cuenta (ui:adopt-tab) a la ventana principal
    for (let i = 0; i < 20 && !state.convs.has(convId); i++) await new Promise((r) => setTimeout(r, 100));
    activateTab(convId);
  } else if (btn.dataset.act === 'delete') {
    if (!btn.classList.contains('armed')) { btn.classList.add('armed'); btn.title = 'Pulsa otra vez para eliminarla'; return; }
    if (schedEditing === id) schedEditing = null;
    await saveSchedules(schedList().filter((x) => x.id !== id));
  }
});
$('#sched-list').addEventListener('change', (e) => {
  if (e.target.dataset.act !== 'toggle') return;
  const id = e.target.closest('.sched-item').dataset.id;
  saveSchedules(schedList().map((x) => (x.id === id ? { ...x, enabled: e.target.checked, created: e.target.checked ? Date.now() : x.created } : x)));
});

// ---------- Configuración › Memoria: memoria automática de Claude Code por carpeta y ~/.claude/CLAUDE.md ----------
// Se guarda al momento, con su propio botón (no con el «Guardar» de Configuración)
const mem = { list: [], dir: null, file: null, saved: '' };
const memDirty = () => mem.file && $('#mem-text').value !== mem.saved;
const fmtSize = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);
async function renderMemory() {
  mem.list = await api.memoryList();
  if (!mem.list.some((p) => p.dir === mem.dir)) {
    // Por defecto, la carpeta de la pestaña actual si tiene memoria
    const cwd = (current()?.cwd || '').toLowerCase();
    mem.dir = (mem.list.find((p) => p.dir !== '~' && p.label.toLowerCase() === cwd) || mem.list[1] || mem.list[0])?.dir || null;
    mem.file = null;
  }
  $('#mem-project').innerHTML = mem.list.map((p) => `<option value="${esc(p.dir)}">${esc(p.label)}</option>`).join('');
  $('#mem-project').value = mem.dir || '';
  renderMemFiles();
}
function renderMemFiles() {
  const p = mem.list.find((x) => x.dir === mem.dir);
  const files = p?.files || [];
  if (!files.some((f) => f.name === mem.file)) { openMemFile(files[0]?.name || null); return; }
  $('#mem-files').innerHTML = files.map((f) => `<button type="button" class="mem-file${f.name === mem.file ? ' active' : ''}" data-name="${esc(f.name)}">
      <span class="mem-name">${esc(f.name.replace(/\.md$/, ''))}</span>
      <span class="mem-meta">${f.mtime ? `${esc(fmtWhen(f.mtime))} · ${fmtSize(f.size)}` : 'sin crear'}</span>
    </button>`).join('');
}
async function openMemFile(name) {
  mem.file = name;
  const text = name ? await api.memoryRead(mem.dir, name) : null;
  mem.saved = text ?? '';
  const ta = $('#mem-text');
  ta.value = mem.saved;
  ta.disabled = !name || text === null;
  $('#mem-save').disabled = ta.disabled;
  // El índice y las instrucciones globales no se borran desde aquí
  const del = $('#mem-del');
  del.hidden = !name || mem.dir === '~' || name === 'MEMORY.md';
  del.classList.remove('armed');
  del.textContent = 'Eliminar';
  $('#mem-msg').textContent = '';
  if (name) renderMemFiles();
  else $('#mem-files').innerHTML = '<div class="ext-empty">Sin ficheros de memoria.</div>';
}
// Cambios sin guardar: se avisa una vez; el segundo intento descarta
function memLeave() {
  if (!memDirty() || $('#mem-msg').dataset.warned) { delete $('#mem-msg').dataset.warned; return true; }
  $('#mem-msg').textContent = 'Hay cambios sin guardar: guárdalos o vuelve a pulsar para descartarlos.';
  $('#mem-msg').dataset.warned = '1';
  return false;
}
$('#mem-project').addEventListener('change', (e) => {
  if (!memLeave()) { e.target.value = mem.dir; return; }
  mem.dir = e.target.value;
  mem.file = null;
  renderMemFiles();
});
$('#mem-files').addEventListener('click', (e) => {
  const b = e.target.closest('.mem-file');
  if (!b || b.dataset.name === mem.file || !memLeave()) return;
  openMemFile(b.dataset.name);
});
$('#mem-text').addEventListener('input', () => { delete $('#mem-msg').dataset.warned; $('#mem-msg').textContent = memDirty() ? 'Sin guardar' : ''; });
$('#mem-text').addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); $('#mem-save').click(); }
});
$('#mem-save').onclick = async () => {
  const text = $('#mem-text').value;
  if (!await api.memoryWrite(mem.dir, mem.file, text)) { $('#mem-msg').textContent = 'No se pudo guardar.'; return; }
  mem.saved = text;
  await renderMemory();
  $('#mem-msg').textContent = 'Guardado';
};
$('#mem-del').onclick = async () => {
  const del = $('#mem-del');
  if (!del.classList.contains('armed')) { del.classList.add('armed'); del.textContent = 'Pulsa otra vez para eliminar'; return; }
  if (!await api.memoryDelete(mem.dir, mem.file)) { $('#mem-msg').textContent = 'No se pudo eliminar.'; return; }
  mem.file = null;
  mem.saved = '';
  await renderMemory();
  toast('Recuerdo enviado a la papelera.');
};

// ---------- Uso del plan: batería de la sesión (5 h), semana y cuenta atrás ----------
const usageEl = $('#usage');
const left = (w) => (w ? Math.max(0, Math.round(100 - w.used)) : null);

function fmtCountdown(iso) {
  if (!iso) return '—';
  const ms = new Date(iso) - Date.now();
  if (ms <= 0) return 'ahora';
  const min = Math.ceil(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ${String(min % 60).padStart(2, '0')} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}
function fmtResetAt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const time = d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return `hoy a las ${time}`;
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return `mañana a las ${time}`;
  return `el ${d.toLocaleDateString('es', { weekday: 'long', day: 'numeric' })} a las ${time}`;
}
const level = (pct) => (pct <= 10 ? 'crit' : pct <= 30 ? 'low' : 'ok');

function renderUsage() {
  const u = state.usage;
  if (!u?.available || !u.session) { usageEl.hidden = true; return; }
  usageEl.hidden = false;
  const s = left(u.session);
  const w = left(u.week);
  usageEl.className = `usage no-drag lvl-${level(s)}`;
  usageEl.title = `Sesión: queda un ${s} %${w != null ? ` · Semana: queda un ${w} %` : ''}\nClic para ver el detalle`;
  usageEl.innerHTML = `
    <span class="bat"><span class="bat-body"><span class="bat-fill" style="width:${s}%"></span></span><span class="bat-tip"></span></span>
    <span class="u-pct">${s}%</span>
    ${w != null ? `<span class="u-sep"></span><span class="wk lvl-${level(w)}"><span class="wk-label">Sem.</span><span class="wk-bar"><span style="width:${w}%"></span></span><span class="u-pct sm">${w}%</span></span>` : ''}
    <span class="u-sep"></span><span class="u-reset">${I.clock}<span id="u-countdown">${fmtCountdown(u.session.resetsAt)}</span></span>`;
}

// La cuenta atrás corre sola; al llegar al reinicio se vuelve a consultar el uso
setInterval(() => {
  const u = state.usage;
  const el = $('#u-countdown');
  if (!u?.session || !el) return;
  el.textContent = fmtCountdown(u.session.resetsAt);
  if (new Date(u.session.resetsAt) < Date.now() && !state.usageRefreshing) {
    state.usageRefreshing = true;
    api.refreshUsage().finally(() => { state.usageRefreshing = false; });
  }
}, 20000);

usageEl.addEventListener('click', () => {
  const u = state.usage;
  if (!u) return;
  const ago = u.updatedAt ? Math.round((Date.now() - u.updatedAt) / 60000) : null;
  const items = [
    { value: 'x', title: `Sesión (5 h) · queda un ${left(u.session)} %`, desc: `Usado ${Math.round(u.session.used)} % · se reinicia ${fmtResetAt(u.session.resetsAt)} (en ${fmtCountdown(u.session.resetsAt)})` },
  ];
  if (u.week) items.push({ value: 'x', title: `Semana · queda un ${left(u.week)} %`, desc: `Usado ${Math.round(u.week.used)} % · se reinicia ${fmtResetAt(u.week.resetsAt)}` });
  for (const m of u.models || []) items.push({ value: 'x', title: `${m.name} (semana) · queda un ${left(m)} %`, desc: `Se reinicia ${fmtResetAt(m.resetsAt)}` });
  items.push({ sep: true }, { value: 'refresh', title: 'Actualizar ahora', desc: `Plan ${u.plan ? u.plan[0].toUpperCase() + u.plan.slice(1) : ''}${ago != null ? ` · actualizado hace ${ago < 1 ? 'menos de 1' : ago} min` : ''}` });
  openPopover(usageEl, 'Uso de tu plan', items, async (it) => {
    if (it.value === 'refresh') { state.usage = await api.refreshUsage(); renderUsage(); }
  }, 'right');
});

api.onUsage((u) => { state.usage = u; renderUsage(); });

// ---------- Contexto de la pestaña (como /context) ----------
const ctxEl = $('#context');
const fmtTokens = (n) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
const CTX_NAMES = {
  'System prompt': 'Instrucciones del sistema', 'System tools': 'Herramientas', 'MCP tools': 'Herramientas MCP',
  'MCP server instructions': 'Instrucciones de los MCP', 'Custom agents': 'Agentes', 'Memory files': 'Memoria (CLAUDE.md)',
  Skills: 'Skills', Messages: 'Mensajes', 'Autocompact buffer': 'Reserva para compactar', 'Free space': 'Libre',
};
const ctxName = (n) => CTX_NAMES[n] || CTX_NAMES[n.replace(/ \(deferred\)$/, '')] || n.replace(/ \(deferred\)$/, '');

function renderContext(c) {
  const ctxEl = $('#context');
  const x = c?.context;
  ctxEl.hidden = !x;
  if (!x) return;
  const pct = x.pct;
  const near = x.used / (x.compactAt || x.max); // cerca de compactarse: ámbar y luego rojo
  const lvl = near >= 0.9 ? 'crit' : near >= 0.7 ? 'low' : 'ok';
  const r = 7, len = 2 * Math.PI * r;
  ctxEl.className = `ctx-chip no-drag lvl-${lvl}`;
  ctxEl.title = `Contexto: ${fmtTokens(x.used)} de ${fmtTokens(x.max)} tokens${x.compactAt ? `\nSe compacta solo al llegar a ${fmtTokens(x.compactAt)} (queda un ${Math.max(0, Math.round(100 - near * 100))} %)` : ''}\nClic para ver el desglose`;
  ctxEl.innerHTML = `<svg viewBox="0 0 18 18" class="ctx-ring"><circle cx="9" cy="9" r="${r}"/><circle cx="9" cy="9" r="${r}" class="on" stroke-dasharray="${(len * Math.max(pct, 2)) / 100} ${len}"/></svg><span class="ctx-label">Contexto</span><span class="u-pct">${pct}%</span>`;
}

ctxEl.addEventListener('click', async () => {
  const c = current();
  if (!c) return;
  if (popAnchor === ctxEl && !pop.hidden) return closePopover();
  const x = await api.context(c.id);
  const share = (t) => (t / x.max) * 100;
  const pctTxt = (t) => { const p = share(t); return p < 0.1 ? '<0,1 %' : p < 1 ? `${p.toFixed(1).replace('.', ',')} %` : `${Math.round(p)} %`; };
  const used = x.categories.filter((k) => k.kind === 'used');
  const free = x.categories.find((k) => k.kind === 'free')?.tokens || 0;
  const buffer = x.categories.find((k) => k.kind === 'buffer')?.tokens || 0;
  const deferred = x.categories.filter((k) => k.kind === 'deferred').reduce((s, k) => s + k.tokens, 0);
  // Barra apilada: cada categoría con su color, la reserva para compactar rayada al final
  const seg = (k, i) => `<span class="cx-seg cx-c${i % 7}" style="width:${Math.max(share(k.tokens), 0.6)}%" title="${esc(ctxName(k.name))} · ${fmtTokens(k.tokens)}"></span>`;
  const row = (cls, name, tokens, note = '') => `<div class="cx-row"><span class="cx-dot ${cls}"></span><span class="cx-name">${esc(name)}${note ? `<small>${esc(note)}</small>` : ''}</span><span class="cx-tok">${fmtTokens(tokens)}</span><span class="cx-pct">${pctTxt(tokens)}</span></div>`;
  const html = `<div class="cx">
    <div class="cx-head"><b>${fmtTokens(x.used)}</b> de ${fmtTokens(x.max)} tokens <span>· ${x.pct} %</span></div>
    <div class="cx-bar">${used.map(seg).join('')}<span class="cx-fill"></span>${buffer ? `<span class="cx-seg cx-buf" style="width:${share(buffer)}%" title="Reserva para compactar"></span>` : ''}</div>
    <div class="cx-rows">
      ${used.map((k, i) => row(`cx-c${i % 7}`, ctxName(k.name), k.tokens)).join('')}
      ${buffer ? row('cx-buf', 'Reserva para compactar', buffer) : ''}
      ${row('cx-free', 'Libre', free)}
    </div>
    <div class="cx-foot">${x.compactAt ? `Se compacta solo al llegar a ${fmtTokens(x.compactAt)}.` : 'Compactado automático desactivado.'}${deferred ? ` Hay ${fmtTokens(deferred)} de herramientas en reserva que no ocupan hasta que Claude las usa.` : ''}${x.live ? '' : ' Pestaña sin empezar: es la base de la configuración general.'}</div>
  </div>`;
  const items = [{ html }];
  if (x.live && !c.busy) items.push({ sep: true }, { value: 'compact', title: 'Compactar ahora', desc: 'Resume la conversación para liberar contexto (/compact)' });
  openPopover(ctxEl, `Contexto · ${modelLabel(c)}`, items, (it) => { if (it.value === 'compact') api.send(c.id, { text: '/compact' }); }, 'right');
});

// ---------- Dictado por voz (Whisper en local) ----------
// Pulsar el micro (o Ctrl+M) empieza a grabar. Al callarte un momento (o al volver a pulsar)
// transcribe y envía el mensaje solo, como si hubieras pulsado Enter. Esc cancela.
const MIC_SILENCE_MS = 1600; // silencio tras haber hablado que da el dictado por terminado
const MIC_VOICE_LVL = 0.08;  // nivel a partir del cual se considera voz
const MIC_VOICE_MS = 350;    // voz acumulada necesaria (un golpe o un clic no cuentan)
const micBtn = $('#mic');
const mic = { state: 'idle', rec: null, stream: null, ctx: null, raf: 0, cancel: false };
const MIC_TITLES = { idle: K('Dictar por voz (Ctrl+M)'), rec: K('Escuchando… se envía al callarte (Ctrl+M para ya · Esc cancela)'), busy: 'Transcribiendo…' };
// Frases que Whisper se inventa con silencio o ruido
const WHISPER_JUNK = /^\W*(subtítulos (realizados|por)\b.*|gracias por ver.*|.*amara\.org.*|música)\W*$/i;

function setMic(s) {
  mic.state = s;
  micBtn.classList.toggle('rec', s === 'rec');
  micBtn.classList.toggle('busy', s === 'busy');
  micBtn.title = MIC_TITLES[s];
  if (s !== 'rec') micBtn.style.removeProperty('--lvl');
}

async function startDictation() {
  try {
    if (IS_MAC) await api.macPermission('microphone'); // la primera vez, macOS pregunta
    mic.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  } catch {
    toast(IS_MAC ? 'No se puede usar el micrófono. Actívalo en Ajustes del Sistema › Privacidad y seguridad › Micrófono.' : IS_WIN ? 'No se puede usar el micrófono. Revisa Configuración de Windows › Privacidad › Micrófono.' : 'No se puede usar el micrófono. Revisa que haya uno conectado y que el escritorio le dé permiso.', 'err');
    return;
  }
  api.voicePrepare().catch(() => {}); // carga el modelo mientras hablas
  const chunks = [];
  mic.cancel = false;
  mic.rec = new MediaRecorder(mic.stream);
  mic.rec.ondataavailable = (e) => chunks.push(e.data);
  mic.rec.onstop = () => finishDictation(new Blob(chunks, { type: mic.rec.mimeType }));
  mic.rec.start();
  // Nivel de voz para animar el botón
  mic.ctx = new AudioContext();
  const an = mic.ctx.createAnalyser();
  an.fftSize = 512;
  mic.ctx.createMediaStreamSource(mic.stream).connect(an);
  const buf = new Float32Array(an.fftSize);
  let voiced = 0, lastVoice = 0, prev = performance.now();
  const tick = () => {
    an.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    const lvl = Math.min(1, Math.sqrt(sum / buf.length) * 6);
    micBtn.style.setProperty('--lvl', lvl.toFixed(2));
    const now = performance.now();
    if (lvl > MIC_VOICE_LVL) { voiced += now - prev; lastVoice = now; }
    prev = now;
    if (voiced > MIC_VOICE_MS && now - lastVoice > MIC_SILENCE_MS) return stopDictation();
    mic.raf = requestAnimationFrame(tick);
  };
  tick();
  setMic('rec');
}

function stopDictation(cancel = false) {
  if (mic.state !== 'rec') return;
  mic.cancel = cancel;
  cancelAnimationFrame(mic.raf);
  mic.ctx?.close();
  mic.stream.getTracks().forEach((t) => t.stop());
  setMic(cancel ? 'idle' : 'busy');
  mic.rec.stop();
}

async function finishDictation(blob) {
  if (mic.cancel) return;
  try {
    const ctx = new AudioContext({ sampleRate: 16000 }); // Whisper espera 16 kHz mono
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer()).finally(() => ctx.close());
    const audio = decoded.getChannelData(0);
    let peak = 0;
    for (const v of audio) peak = Math.max(peak, Math.abs(v));
    if (decoded.duration < 0.4 || peak < 0.02) { toast('No se ha oído nada.'); return; }
    const text = await api.transcribe(audio);
    if (text.replace(/[^\p{L}\p{N}]/gu, '').length < 2 || WHISPER_JUNK.test(text)) { toast('No se ha entendido nada.'); return; }
    if (current()?.picker) await openSession({ presetId: null, replace: state.activeId });
    insertAtCursor(text);
    await submit();
  } catch (e) {
    toast(`No se ha podido transcribir: ${e.message || e}`, 'err');
  } finally {
    setMic('idle');
  }
}

function toggleDictation() {
  if (mic.state === 'idle') startDictation();
  else if (mic.state === 'rec') stopDictation();
}
micBtn.addEventListener('click', toggleDictation);
api.onVoiceProgress(({ loaded, total }) => {
  const pct = Math.floor((loaded / total) * 100);
  micBtn.title = pct < 100 ? `Descargando el modelo de voz (solo la primera vez)… ${pct}%` : MIC_TITLES[mic.state];
  if (pct < 100) toast(`Descargando el modelo de voz (solo la primera vez)… ${pct}%`);
});

// ---------- Atajos ----------
api.onSettings(() => openSettings());
api.onNewConv(() => newTab());
api.onFocusInput(focusInput);
api.onOpenTab(({ convId }) => activateTab(convId));
// Pestaña creada por el asistente por voz: se añade al final, sin cambiar la que estás viendo
api.onAdoptTab(({ conv }) => {
  if (state.convs.has(conv.id)) return;
  state.convs.set(conv.id, conv);
  state.tabs.push(conv.id);
  renderTabs();
});

// Con el foco en la página (no en un campo) y nada seleccionado, lo que se teclee va al campo del chat
function typeToInput(e) {
  // Alt sí vale cuando escribe un carácter: Option en macOS y AltGr en Windows y Linux (@, #, €…)
  if (e.defaultPrevented || e.metaKey || e.isComposing) return false;
  const altChar = IS_MAC ? e.altKey && !e.ctrlKey : e.getModifierState('AltGraph');
  if ((e.ctrlKey || e.altKey) && !altChar) return false;
  if (e.key.length !== 1 && e.key !== 'Dead') return false; // solo caracteres (Dead: tildes)
  if (e.key === ' ' && e.target.closest?.('button, summary, [role="button"], [role="tab"]')) return false;
  const t = e.target;
  if (t.closest?.('input, textarea, select, [contenteditable], .xterm, .prompt-card, dialog, #find')) return false;
  const c = current();
  if (!c || c.picker || (c.terminal && termViewOf(c.id) === 'terminal')) return false;
  if (document.querySelector('dialog[open]') || !pop.hidden || input.disabled || input.offsetParent === null) return false;
  if (promptsEl.querySelector('.prompt-card:not(.answered)')) return false;
  if (!getSelection().isCollapsed) return false;
  input.focus(); // sin preventDefault: la tecla se escribe en el campo, al final de lo que ya hubiera
  input.setSelectionRange(input.value.length, input.value.length);
  return true;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (e.defaultPrevented) return; // ya lo ha usado un menú o el autocompletado
    if (mic.state === 'rec') { e.preventDefault(); stopDictation(true); return; }
    if (!pop.hidden) { closePopover(); return; }
    if (ac.open || document.querySelector('dialog[open]')) return;
    const c = current();
    // En la vista de terminal, Esc ya lo recibe Claude Code
    if (!c || c.picker || (c.terminal && termViewOf(c.id) === 'terminal')) return;
    // Como en Claude Code: trabajando, interrumpe; parado, dos veces seguidas borra el texto o, sin texto, abre /rewind
    if (c.busy) { e.preventDefault(); pressedTwice(null); interrupt(); return; }
    if (promptsEl.querySelector('.prompt-card:not(.answered)')) return;
    e.preventDefault();
    const typed = !!input.value.trim() || state.attachments.length > 0;
    if (!pressedTwice('Escape')) { if (typed) flashHint('Esc otra vez para borrar'); return; }
    if (typed) clearInput(); else openRewind();
    return;
  }
  // Ctrl+C (sin nada seleccionado), como en Claude Code: interrumpe, borra el texto o, dos veces, cierra la pestaña
  if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'c' && ctrlC(e)) return;
  if ((e.ctrlKey || (IS_MAC && e.metaKey)) && isToggleKey(e) && current()?.terminal) { e.preventDefault(); toggleTermView(); return; }
  // En los Mac, las F se pulsan con fn: también ⌘/ (atajos) y ⌘G / ⌘⇧G (siguiente / anterior al buscar)
  if ((e.key === 'F1' && !e.ctrlKey && !e.altKey) || (IS_MAC && e.metaKey && (e.key === '/' || e.key === '?'))) { e.preventDefault(); showHelp(); return; }
  // En el selector de presets, 1–9 elige directamente
  if (current()?.picker && !e.ctrlKey && !e.metaKey && !e.altKey && /^[1-9]$/.test(e.key) && !document.querySelector('dialog[open]')) {
    const p = presets()[Number(e.key) - 1];
    if (p) { e.preventDefault(); pickPreset(p.id); }
    return;
  }
  if ((e.key === 'F3' || (IS_MAC && e.metaKey && e.key.toLowerCase() === 'g')) && !findBar.hidden) { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1); return; }
  if (typeToInput(e)) return;
  // En macOS, con Cmd; Ctrl+Tab también, como en los navegadores
  const mod = IS_MAC ? e.metaKey || (e.ctrlKey && e.key === 'Tab') : e.ctrlKey;
  if (!mod || $('#settings').open) return;
  const k = e.key.toLowerCase();
  const inTerm = current()?.terminal && termViewOf(current().id) === 'terminal';
  // (en macOS van con ⌘, que no llega a Claude Code: valen también en la terminal)
  const termOwns = inTerm && !IS_MAC;
  if (k === 'd' && e.shiftKey && !e.altKey) { e.preventDefault(); splitWindow($('#tb-menu')); return; }
  if (k === 'e' && e.shiftKey && !e.altKey) { e.preventDefault(); toggleSidebar(); return; }
  if (k === 'o' && !e.shiftKey && !e.altKey && !inTerm) { e.preventDefault(); cycleView(); return; }
  // En la vista de terminal, Ctrl+F y Ctrl+H (retroceso) son de Claude Code
  if (k === 'f' && !e.shiftKey && !e.altKey && !termOwns && !document.querySelector('dialog[open]')) { e.preventDefault(); openFind(); return; }
  if (k === 'h' && !e.shiftKey && !e.altKey && !termOwns) { e.preventDefault(); openHistory(); return; }
  if (k === 't' || k === 'n') { e.preventDefault(); newTab(); }
  else if (k === 'w') { e.preventDefault(); if (state.activeId) closeTab(state.activeId); }
  else if (k === 'tab') { e.preventDefault(); cycleTab(e.shiftKey ? -1 : 1); }
  else if (k === 'pagedown') { e.preventDefault(); cycleTab(1); }
  else if (k === 'pageup') { e.preventDefault(); cycleTab(-1); }
  else if (/^[1-9]$/.test(k)) {
    e.preventDefault();
    const id = k === '9' ? state.tabs.at(-1) : state.tabs[Number(k) - 1];
    if (id) activateTab(id);
  }
  else if (k === ',') { e.preventDefault(); openSettings(); }
  else if (k === '+' || k === '=') { e.preventDefault(); zoomBy(1); }
  else if (k === '-') { e.preventDefault(); zoomBy(-1); }
  else if (k === '0') { e.preventDefault(); zoomBy(0); }
  // En la vista de terminal, Ctrl+M es Enter para Claude Code (y el dictado escribe en el chat)
  else if (k === 'm' && !inTerm) { e.preventDefault(); toggleDictation(); }
});

// ---------- Buscar en la conversación (Ctrl+F) ----------
// Se resalta con la API CSS Custom Highlight, sin tocar el DOM: así aguanta los repintados mientras
// Claude escribe. Sin distinguir mayúsculas ni tildes. Al ir a un resultado dentro de una ficha
// plegada, se despliega.
const findBar = $('#find');
const findInput = $('#find-input');
const findCount = $('#find-count');
const find = { ranges: [], index: -1, timer: null };
const hlAll = new Highlight();
const hlCur = new Highlight();
CSS.highlights.set('find', hlAll);
CSS.highlights.set('find-current', hlCur);

// Misma longitud que el original (carácter a carácter) para que las posiciones sigan valiendo
function foldText(t) {
  let out = '';
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    out += ch.charCodeAt(0) < 128 ? ch.toLowerCase() : (ch.normalize('NFD')[0] || ch).toLowerCase()[0] || ch;
  }
  return out;
}

// Dónde está un resultado en pantalla; si está en una ficha cerrada, la ficha más externa que se ve
function findRect(range) {
  const r = range.getBoundingClientRect();
  if (r.height) return r;
  let el = range.startContainer.parentElement;
  let shown = el;
  for (; el && el !== thread; el = el.parentElement) if (el.tagName === 'DETAILS' && !el.open) shown = el;
  return shown.getBoundingClientRect();
}

function runFind(keep) {
  const q = foldText(findInput.value);
  const prev = find.index;
  find.ranges = [];
  if (q) {
    const walker = document.createTreeWalker(thread, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = foldText(node.nodeValue);
      for (let at = text.indexOf(q); at >= 0; at = text.indexOf(q, at + q.length)) {
        const r = new Range();
        r.setStart(node, at);
        r.setEnd(node, at + q.length);
        find.ranges.push(r);
      }
    }
  }
  hlAll.clear();
  for (const r of find.ranges) hlAll.add(r);
  if (!find.ranges.length) find.index = -1;
  else if (keep && prev >= 0) find.index = Math.min(prev, find.ranges.length - 1);
  else {
    // El primero que se ve en pantalla (o el último por encima)
    const top = scroller.getBoundingClientRect().top;
    const i = find.ranges.findIndex((r) => findRect(r).bottom >= top);
    find.index = i >= 0 ? i : find.ranges.length - 1;
  }
  showFindCurrent(!keep);
}

function showFindCurrent(scroll) {
  hlCur.clear();
  const n = find.ranges.length;
  findCount.textContent = !findInput.value ? '' : n ? `${find.index + 1} de ${n}` : 'Sin resultados';
  findBar.classList.toggle('none', !!findInput.value && !n);
  const r = find.ranges[find.index];
  if (!r) return;
  hlCur.add(r);
  if (!scroll) return;
  for (let el = r.startContainer.parentElement; el && el !== thread; el = el.parentElement) if (el.tagName === 'DETAILS') el.open = true;
  const rect = r.getBoundingClientRect();
  const box = scroller.getBoundingClientRect();
  if (rect.top < box.top + 40 || rect.bottom > box.bottom - 40) scroller.scrollTop += rect.top - box.top - scroller.clientHeight / 3;
}

function stepFind(dir) {
  if (!find.ranges.length) return;
  find.index = (find.index + dir + find.ranges.length) % find.ranges.length;
  showFindCurrent(true);
}

function openFind() {
  const c = current();
  if (!c || c.picker || (c.terminal && termViewOf(c.id) === 'terminal')) return;
  findBar.hidden = false;
  const sel = String(getSelection()).trim();
  if (sel && !sel.includes('\n') && thread.contains(getSelection().anchorNode)) findInput.value = sel;
  findInput.focus();
  findInput.select();
  runFind(false);
}

function closeFind() {
  findBar.hidden = true;
  hlAll.clear();
  hlCur.clear();
  find.ranges = [];
  find.index = -1;
  focusInput();
}

findInput.addEventListener('input', () => {
  clearTimeout(find.timer);
  find.timer = setTimeout(() => runFind(false), 90);
});
findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === 'F3') { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind(); }
});
$('#find-prev').addEventListener('click', () => stepFind(-1));
$('#find-next').addEventListener('click', () => stepFind(1));
$('#find-close').addEventListener('click', closeFind);
// Al repintarse el chat (Claude escribiendo, otra pestaña…) se vuelve a buscar sin mover la vista
new MutationObserver(() => {
  if (findBar.hidden || !findInput.value) return;
  clearTimeout(find.timer);
  find.timer = setTimeout(() => runFind(true), 150);
}).observe(thread, { childList: true, subtree: true, characterData: true });

// ---------- Historial de conversaciones (Ctrl+H o /resume) ----------
// Solo aparece cuando se pide. Abre la conversación en una pestaña nueva retomándola (--resume),
// con el preset de su carpeta si lo hay.
const histDialog = $('#history-dialog');
const histInput = $('#hist-input');
const histList = $('#hist-list');
const hist = { items: [], shown: [], index: 0, all: false, cwd: '' };
const samePath = (a, b) => {
  const norm = (p) => String(p || '').replace(/[\\/]+$/, '');
  return !!a && !!b && (IS_WIN || IS_MAC ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b));
};

function agoText(ms) {
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  if (d === 1) return 'ayer';
  if (d < 7) return `hace ${d} días`;
  return new Date(ms).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: d > 300 ? 'numeric' : undefined });
}

function renderHistory() {
  const words = foldText(histInput.value.trim()).split(/\s+/).filter(Boolean);
  const scopeBtn = $('#hist-scope');
  scopeBtn.hidden = !hist.cwd;
  scopeBtn.textContent = hist.all ? 'Todas las carpetas' : `Solo ${baseName(hist.cwd)}`;
  scopeBtn.classList.toggle('on', !hist.all);
  hist.shown = hist.items.filter((it) => {
    if (!hist.all && hist.cwd && !samePath(it.cwd, hist.cwd)) return false;
    const hay = foldText(`${it.title} ${it.prompt} ${it.cwd}`);
    return words.every((w) => hay.includes(w));
  }).slice(0, 200);
  hist.index = Math.min(hist.index, Math.max(0, hist.shown.length - 1));
  if (!hist.shown.length) {
    histList.innerHTML = `<div class="hist-empty">${hist.loading ? 'Cargando…' : words.length ? 'Ninguna conversación coincide.' : 'No hay conversaciones en esta carpeta. Pulsa Tab para ver todas.'}</div>`;
    return;
  }
  histList.innerHTML = hist.shown.map((it, i) => {
    const open = it.openIn && state.convs.has(it.openIn) ? 'abierta aquí' : it.openIn ? 'abierta en otra ventana' : '';
    const preset = presets().find((p) => samePath(p.cwd, it.cwd));
    return `<div class="hist-item${i === hist.index ? ' sel' : ''}" role="option" id="hist-${i}" aria-selected="${i === hist.index}" data-i="${i}">
      ${preset ? presetAvatar(preset, 'hist-avatar') : `<span class="hist-avatar plain">${sparkSvg()}</span>`}
      <div class="hist-main">
        <div class="hist-title">${esc(it.title)}</div>
        ${it.prompt && it.prompt !== it.title ? `<div class="hist-prompt">${esc(it.prompt)}</div>` : ''}
      </div>
      <div class="hist-meta"><span>${esc(agoText(it.mtime))}</span><span title="${esc(it.cwd)}">${esc(baseName(it.cwd) || '')}</span>${open ? `<span class="hist-open">${open}</span>` : ''}</div>
    </div>`;
  }).join('');
  histList.setAttribute('aria-activedescendant', `hist-${hist.index}`);
  histList.querySelector('.hist-item.sel')?.scrollIntoView({ block: 'nearest' });
}

function selectHistory(i) {
  hist.index = i;
  histList.querySelectorAll('.hist-item').forEach((el) => {
    const on = Number(el.dataset.i) === i;
    el.classList.toggle('sel', on);
    el.setAttribute('aria-selected', on);
    if (on) el.scrollIntoView({ block: 'nearest' });
  });
  histList.setAttribute('aria-activedescendant', `hist-${i}`);
}

async function openHistory() {
  if (document.querySelector('dialog[open]')) return;
  closePopover();
  const c = current();
  hist.cwd = c && !c.picker ? c.cwd : '';
  hist.all = !hist.cwd;
  hist.index = 0;
  hist.loading = true;
  histInput.value = '';
  renderHistory();
  histDialog.showModal();
  histInput.focus();
  try { hist.items = await api.history(); } catch { hist.items = []; }
  hist.loading = false;
  // Sin nada en esta carpeta: todas
  if (!hist.all && !hist.items.some((it) => samePath(it.cwd, hist.cwd))) hist.all = true;
  renderHistory();
}

// ¿Sigue abierta en otra ventana? La lista puede ser de antes de que se cerrase su pestaña
async function openElsewhere(it) {
  if (!it.openIn || state.convs.has(it.openIn)) return false;
  try { it.openIn = (await api.history()).find((x) => x.id === it.id)?.openIn || null; } catch {}
  return !!it.openIn && !state.convs.has(it.openIn);
}

async function openHistoryItem(it) {
  histDialog.close();
  if (it.openIn && state.convs.has(it.openIn)) return activateTab(it.openIn);
  if (await openElsewhere(it)) return toast('Esa conversación ya está abierta en otra ventana.');
  const preset = presets().find((p) => samePath(p.cwd, it.cwd));
  // Si la pestaña actual está sin usar, la conversación ocupa su sitio
  const c = current();
  const unused = c && !c.busy && !c.messages.length && !state.drafts.get(c.id)?.text && !input.value.trim() ? c.id : null;
  await openSession({ presetId: preset?.id || null, cwd: it.cwd, resume: it.id, title: it.title, replace: unused && isPicker(unused) ? unused : null });
  if (unused && !isPicker(unused)) closeTab(unused);
  toast(`Retomando «${it.title.length > 60 ? it.title.slice(0, 60) + '…' : it.title}»`);
}

histInput.addEventListener('input', () => { hist.index = 0; renderHistory(); });
histInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (hist.shown.length) selectHistory((hist.index + (e.key === 'ArrowDown' ? 1 : -1) + hist.shown.length) % hist.shown.length);
  } else if (e.key === 'PageDown' || e.key === 'PageUp') {
    e.preventDefault();
    if (hist.shown.length) selectHistory(Math.max(0, Math.min(hist.shown.length - 1, hist.index + (e.key === 'PageDown' ? 8 : -8))));
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (hist.shown[hist.index]) openHistoryItem(hist.shown[hist.index]);
  } else if (e.key === 'Tab' && hist.cwd) {
    e.preventDefault();
    hist.all = !hist.all;
    hist.index = 0;
    renderHistory();
  }
});
$('#hist-scope').addEventListener('click', () => { hist.all = !hist.all; hist.index = 0; renderHistory(); histInput.focus(); });
$('#hist-close').addEventListener('click', () => histDialog.close());
histList.addEventListener('click', (e) => {
  const el = e.target.closest('.hist-item');
  if (el) openHistoryItem(hist.shown[el.dataset.i]);
});
histList.addEventListener('mousemove', (e) => {
  const el = e.target.closest('.hist-item');
  if (el && Number(el.dataset.i) !== hist.index) selectHistory(Number(el.dataset.i));
});
histDialog.addEventListener('click', (e) => { if (e.target === histDialog) histDialog.close(); });
histDialog.addEventListener('close', () => focusInput());

// ---------- Barra lateral (Ctrl+Shift+E): conversaciones fijadas y recientes, por preset ----------
// Las de ~/.claude/projects (como el historial). Cada una con su estado si está abierta en una pestaña.
// config.sidebar: { open, pinned: [id], titles: {id: nombre}, groups: {id: presetId|''}, closed: [grupo plegado] }
const sideEl = $('#sidebar');
const sideList = $('#side-list');
const side = { items: [], loaded: false, timer: null, more: new Set(), sig: '' };
const SIDE_PER_GROUP = 6;
const sideCfg = () => ({ open: true, pinned: [], titles: {}, groups: {}, closed: [], ...(state.config?.sidebar || {}) });
async function saveSide(patch) {
  const next = { ...sideCfg(), ...patch };
  state.config.sidebar = next;
  await api.setConfig({ sidebar: next });
}
const sideShown = () => !sideEl.hidden;
function applySidebar() {
  const open = sideCfg().open && !new URLSearchParams(location.search).has('pane');
  sideEl.hidden = !open;
  $('#side-toggle').classList.toggle('on', open);
  if (open && !side.loaded) refreshSide(0);
}
function toggleSidebar() {
  saveSide({ open: !sideCfg().open });
  applySidebar();
}
// Releer la lista (con espera: varias señales seguidas se juntan)
function refreshSide(delay = 1200) {
  if (!sideShown()) { side.loaded = false; return; }
  clearTimeout(side.timer);
  side.timer = setTimeout(async () => {
    try { side.items = await api.history(); } catch { side.items = []; }
    side.loaded = true;
    side.sig = '';
    renderSide();
  }, delay);
}
// Pestaña abierta con esa sesión (en esta ventana)
function sideConvOf(sid) {
  for (const id of state.tabs) {
    const c = state.convs.get(id);
    if (c && !c.picker && (c.sessionId || c.id) === sid) return c;
  }
  return null;
}
function sideStatus(c) {
  if (!c) return '';
  if (c.prompts?.length) return 'attn';
  if (c.busy) return 'busy';
  if (state.unread.has(c.id)) return 'done';
  return 'open';
}
const SIDE_STATUS_TITLE = { attn: 'Te necesita', busy: 'Trabajando', done: 'Ha terminado', open: 'Abierta en una pestaña' };
function sideGroupOf(it, cfg) {
  if (it.id in cfg.groups) return cfg.groups[it.id];
  return presets().find((p) => samePath(p.cwd, it.cwd))?.id || '';
}
function sideTitle(it, cfg, c) {
  return cfg.titles[it.id] || (c && c.title !== 'Nueva conversación' ? c.title : '') || it.title;
}
function renderSide() {
  if (!sideShown()) return;
  const cfg = sideCfg();
  const rows = side.items.map((it) => {
    const c = sideConvOf(it.id);
    return { it, c, title: sideTitle(it, cfg, c), status: sideStatus(c), active: c && c.id === state.activeId };
  });
  const sig = JSON.stringify([rows.map((r) => [r.it.id, r.title, r.status, r.active]), cfg.pinned, cfg.groups, cfg.closed, [...side.more], presets().map((p) => p.id + p.name + p.color + p.emoji)]);
  if (sig === side.sig) return;
  side.sig = sig;
  const rowHtml = (r) => `<div class="side-item${r.active ? ' active' : ''}" data-sid="${esc(r.it.id)}" title="${esc(r.title)}\n${esc(r.it.cwd)} · ${esc(agoText(r.it.mtime))}">
    <span class="side-title">${esc(r.title)}</span>${r.status ? `<span class="side-st ${r.status}" title="${SIDE_STATUS_TITLE[r.status]}"></span>` : ''}
    <button type="button" class="side-more" data-menu title="Opciones">${I.dots}</button></div>`;
  const pinned = cfg.pinned.map((id) => rows.find((r) => r.it.id === id)).filter(Boolean);
  const rest = rows.filter((r) => !cfg.pinned.includes(r.it.id));
  const groups = [...presets().map((p) => ({ key: p.id, p })), { key: '', p: null }]
    .map((g) => ({ ...g, rows: rest.filter((r) => sideGroupOf(r.it, cfg) === g.key || (g.key === '' && !presets().some((p) => p.id === sideGroupOf(r.it, cfg)))) }))
    .filter((g) => g.rows.length);
  let html = '';
  if (pinned.length) html += `<div class="side-sec"><div class="side-head static">Fijadas</div>${pinned.map(rowHtml).join('')}</div>`;
  for (const g of groups) {
    const closed = cfg.closed.includes(g.key || '_');
    const all = side.more.has(g.key || '_');
    const shown = all ? g.rows : g.rows.slice(0, SIDE_PER_GROUP);
    const live = g.rows.filter((r) => r.status && r.status !== 'open').length;
    html += `<div class="side-sec${closed ? ' closed' : ''}"><button type="button" class="side-head" data-group="${esc(g.key || '_')}">
      ${g.p ? presetAvatar(g.p, 'side-avatar') : `<span class="side-avatar plain">${sparkSvg()}</span>`}<span class="side-gname">${esc(g.p ? g.p.name : 'Sin preset')}</span>
      ${closed && live ? `<span class="side-count">${live}</span>` : ''}<span class="side-chev">${I.chevronDown}</span></button>
      ${closed ? '' : shown.map(rowHtml).join('') + (g.rows.length > SIDE_PER_GROUP ? `<button type="button" class="side-showall" data-all="${esc(g.key || '_')}">${all ? 'Ver menos' : `Ver ${g.rows.length - SIDE_PER_GROUP} más`}</button>` : '')}</div>`;
  }
  sideList.innerHTML = html || `<div class="side-empty">${side.loaded ? 'Aún no hay conversaciones.' : 'Cargando…'}</div>`;
}
async function sideOpen(sid) {
  const r = side.items.find((it) => it.id === sid);
  if (!r) return;
  const c = sideConvOf(sid);
  if (c) return activateTab(c.id);
  const cfg = sideCfg();
  const g = sid in cfg.groups ? cfg.groups[sid] : undefined;
  const it = { ...r, title: sideTitle(r, cfg, null), openIn: r.openIn && !state.convs.has(r.openIn) ? r.openIn : null };
  // Movida a otro grupo: se abre con ese preset (y su carpeta si la conversación no tiene)
  if (g !== undefined) {
    const p = presets().find((x) => x.id === g);
    if (await openElsewhere(it)) return toast('Esa conversación ya está abierta en otra ventana.');
    const cur = current();
    const unused = cur && !cur.busy && !cur.messages.length && isPicker(cur.id) ? cur.id : null;
    await openSession({ presetId: p?.id || null, cwd: it.cwd || p?.cwd, resume: it.id, title: it.title, replace: unused });
    return;
  }
  openHistoryItem(it);
}
function sideRename(sid) {
  const el = sideList.querySelector(`.side-item[data-sid="${CSS.escape(sid)}"]`);
  if (!el) return;
  const titleEl = el.querySelector('.side-title');
  const inputEl = document.createElement('input');
  inputEl.className = 'side-rename';
  inputEl.value = titleEl.textContent;
  titleEl.replaceWith(inputEl);
  inputEl.focus();
  inputEl.select();
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const title = inputEl.value.trim().slice(0, 120);
    if (save && title) {
      const c = sideConvOf(sid);
      if (c) { c.title = title; api.renameTab(c.id, title); renderTabs(); }
      await saveSide({ titles: { ...sideCfg().titles, [sid]: title } });
    }
    side.sig = '';
    renderSide();
  };
  inputEl.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  inputEl.addEventListener('blur', () => finish(true));
}
function sideMenu(sid, anchor) {
  const cfg = sideCfg();
  const pinned = cfg.pinned.includes(sid);
  const c = sideConvOf(sid);
  const r = side.items.find((it) => it.id === sid);
  const group = r ? sideGroupOf(r, cfg) : '';
  const items = [
    { value: 'pin', title: pinned ? 'Dejar de fijar' : 'Fijar arriba' },
    { value: 'rename', title: 'Cambiar nombre' },
    { sep: true }, { heading: 'Mover al grupo' },
    ...presets().map((p) => ({ value: 'move', to: p.id, title: `${p.emoji ? p.emoji + ' ' : ''}${p.name}`, color: p.color, selected: group === p.id })),
    { value: 'move', to: '', title: 'Sin preset', selected: !presets().some((p) => p.id === group) },
    { sep: true },
    c ? { info: true, title: 'Eliminar', desc: 'Cierra antes su pestaña' } : { value: 'trash', title: 'Eliminar', desc: 'Va a la papelera del sistema' },
  ];
  openPopover(anchor, 'Conversación', items, async (it) => {
    if (it.value === 'pin') await saveSide({ pinned: pinned ? cfg.pinned.filter((x) => x !== sid) : [sid, ...cfg.pinned] });
    else if (it.value === 'rename') return sideRename(sid);
    else if (it.value === 'move') {
      const auto = presets().find((p) => samePath(p.cwd, r?.cwd))?.id || '';
      const groups = { ...cfg.groups };
      if (it.to === auto) delete groups[sid]; else groups[sid] = it.to;
      await saveSide({ groups });
    } else if (it.value === 'trash') {
      if (!await api.trashHistory(sid)) return toast('No se pudo eliminar.', 'err');
      side.items = side.items.filter((x) => x.id !== sid);
      toast('Conversación enviada a la papelera.');
    }
    side.sig = '';
    renderSide();
  });
}
sideList.addEventListener('click', (e) => {
  if (e.target.closest('input')) return;
  const head = e.target.closest('[data-group]');
  if (head) {
    const cfg = sideCfg();
    const k = head.dataset.group;
    saveSide({ closed: cfg.closed.includes(k) ? cfg.closed.filter((x) => x !== k) : [...cfg.closed, k] }).then(() => { side.sig = ''; renderSide(); });
    return;
  }
  const all = e.target.closest('[data-all]');
  if (all) { const k = all.dataset.all; side.more.has(k) ? side.more.delete(k) : side.more.add(k); renderSide(); return; }
  const item = e.target.closest('.side-item');
  if (!item) return;
  if (e.target.closest('[data-menu]')) return sideMenu(item.dataset.sid, e.target.closest('[data-menu]'));
  sideOpen(item.dataset.sid);
});
sideList.addEventListener('contextmenu', (e) => {
  const item = e.target.closest('.side-item');
  if (!item) return;
  e.preventDefault();
  const at = { getBoundingClientRect: () => ({ left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY }), contains: () => false };
  sideMenu(item.dataset.sid, at);
});
$('#side-toggle').onclick = toggleSidebar;
$('#side-new').onclick = () => newTab();
$('#side-search').onclick = () => openHistory();

// ---------- Dividir en dos ventanas (Ctrl+Shift+D) ----------
// Ventanas de verdad, lado a lado, para que cada una pueda llevar su cuenta de Claude.
// id: pestaña que se pasa a la ventana nueva; sin él, la nueva empieza con el selector de presets.
async function splitWindow(anchor, id = null) {
  const moving = id && !isPicker(id) ? id : null;
  const go = async (account) => {
    try {
      if (await api.splitWindow({ id: moving, account }) === 'moved') closeTab(moving, { moved: true });
    } catch (err) {
      toast(errText(err), 'err');
    }
  };
  const list = state.config?.authMode === 'claude-code' ? await api.accounts() : [];
  if (list.length < 2) return go(undefined);
  const title = moving ? `«${tabTitle(moving)}» en una ventana al lado · ¿con qué cuenta?` : 'Ventana nueva al lado · ¿con qué cuenta?';
  openPopover(anchor, title, list.map((a) => ({
    value: a.key, title: a.email, selected: a.current, locked: a.locked, color: a.color,
    desc: [a.plan && `Plan ${PLAN_NAMES[a.plan] || a.plan}`, a.current && 'la de esta ventana', a.locked && 'hay que volver a iniciar sesión'].filter(Boolean).join(' · '),
  })), (it) => (it.locked ? startLogin() : go(it.value)));
  return undefined;
}

// Ventana partida en dos con la misma cuenta: esta interfaz se queda con la izquierda (main.mjs pone la
// otra mitad encima, a la derecha, con sus botones de Windows); la de la derecha lleva ?pane
document.body.classList.toggle('is-pane', new URLSearchParams(location.search).has('pane'));
api.onSplit(({ fraction }) => {
  document.body.classList.toggle('split-left', !!fraction);
  document.documentElement.style.setProperty('--split', fraction || 1);
});

async function tileWindows() {
  if (await api.tileWindows() < 2) toast(`Solo hay una ventana. Usa «Dividir en dos» (${K('Ctrl+Shift+D')}) con otra cuenta para abrir otra al lado.`);
}

// ---------- Reinicio para aplicar cambios ----------
const updDialog = $('#update-dialog');
api.onUpdateReady(({ busy }) => {
  $('#upd-busy').hidden = !busy;
  $('#upd-busy').textContent = busy === 1
    ? 'Hay una pestaña trabajando: si reinicias ahora, se interrumpe.'
    : `Hay ${busy} pestañas trabajando: si reinicias ahora, se interrumpen.`;
  $('#upd-idle').hidden = !busy;
  if (!updDialog.open) updDialog.showModal();
  $(busy ? '#upd-idle' : '#upd-now').focus();
});
$('#upd-later').onclick = () => updDialog.close();
$('#upd-now').onclick = () => { updDialog.close(); api.restartApp(); };
$('#upd-idle').onclick = () => {
  updDialog.close();
  api.restartApp({ whenIdle: true });
  toast('Se reiniciará cuando terminen las pestañas.');
};

let toastTimer = null;
function toast(text, kind = '') {
  const el = $('#toast');
  el.textContent = text;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 6000);
}

// ---------- Primer arranque: comprueba y pide lo necesario ----------
const setupDialog = $('#setup');
const setupForm = $('#setup-form');
let setupVoice = null; // progreso de la descarga del modelo de voz

// Fila: estado (ok, warn, todo, info), título, explicación, comando para copiar y botones
function setupRow({ state: st, title, desc = '', cmd = '', actions = [] }) {
  const mark = { ok: '✓', warn: '!', todo: '✕', info: 'i' }[st];
  return `<div class="setup-row ${st}">
    <span class="setup-mark">${mark}</span>
    <div class="setup-main"><b>${esc(title)}</b>${desc ? `<small>${desc}</small>` : ''}${cmd ? `<code class="setup-cmd" title="Clic para copiar">${esc(cmd)}</code>` : ''}</div>
    ${actions.map((a) => `<button type="button" class="btn${a.primary ? ' primary' : ''}" data-act="${a.id}">${esc(a.label)}</button>`).join('')}
  </div>`;
}

// «Control+Shift+Space» → «bind = CTRL SHIFT, SPACE, exec,» (Hyprland) o «bindsym Ctrl+Shift+space exec» (Sway)
function wmBind(accel, hypr) {
  const parts = accel.split('+').map((p) => p.trim()).filter(Boolean);
  const key = parts.pop() || '';
  const mod = (m) => { m = m.toLowerCase(); const k = /ctrl|control/.test(m) ? 0 : /alt|option/.test(m) ? 1 : m === 'shift' ? 2 : 3; return hypr ? ['CTRL', 'ALT', 'SHIFT', 'SUPER'][k] : ['Ctrl', 'Mod1', 'Shift', 'Mod4'][k]; };
  const k = { space: 'space', enter: 'Return', return: 'Return', esc: 'Escape', escape: 'Escape', tab: 'Tab' }[key.toLowerCase()] || (key.length === 1 ? key.toLowerCase() : key);
  return hypr ? `bind = ${parts.map(mod).join(' ')}, ${k.toUpperCase()}, exec,` : `bindsym ${[...parts.map(mod), k].join('+')} exec`;
}

async function renderSetup() {
  const s = await api.setupCheck();
  const cfg = state.config;
  const linux = s.platform === 'linux';
  // Linux: el gestor de paquetes de la distribución (Fedora, Debian/Ubuntu, Arch, openSUSE)
  // names: el nombre del paquete en cada gestor, si cambia (p. ej. gh es github-cli en Arch)
  const dnf = (pkg, names = {}) => (linux ? `${{ apt: 'sudo apt install', pacman: 'sudo pacman -S', zypper: 'sudo zypper install' }[s.pkg] || 'sudo dnf install'} ${names[s.pkg] || pkg}` : s.platform === 'darwin' ? `brew install ${pkg}` : '');
  const req = [];
  if (!s.claude.version) req.push({ state: 'todo', title: 'Claude Code', desc: 'No se encuentra. Instálalo con el comando oficial y pulsa «Volver a comprobar», o elige el ejecutable.', cmd: IS_WIN ? 'irm https://claude.ai/install.ps1 | iex' : 'curl -fsSL https://claude.ai/install.sh | bash', actions: [{ id: 'claude-pick', label: 'Elegir…' }] });
  else if (s.claude.bundled) req.push({ state: 'warn', title: `Claude Code ${s.claude.version}`, desc: 'Se usa el que trae la app. Para tener siempre la última versión (se actualiza sola), instala el oficial:', cmd: IS_WIN ? 'irm https://claude.ai/install.ps1 | iex' : 'curl -fsSL https://claude.ai/install.sh | bash' });
  else req.push({ state: 'ok', title: `Claude Code ${s.claude.version}`, desc: esc(s.claude.path) });
  if (s.authMode === 'claude-code' && s.account) req.push({ state: 'ok', title: 'Cuenta de Claude', desc: esc(s.account), actions: [{ id: 'login', label: 'Añadir otra' }] });
  else if (s.authMode !== 'claude-code' && s.hasKey) req.push({ state: 'ok', title: 'Cuenta de Claude', desc: s.authMode === 'api-key' ? 'API key de la consola' : 'Token de larga duración', actions: [{ id: 'account', label: 'Cambiar' }] });
  else req.push({ state: 'todo', title: 'Cuenta de Claude', desc: 'Inicia sesión con tu suscripción (Pro, Max, Team) o usa una API key.', actions: [{ id: 'account', label: 'API key' }, { id: 'login', label: 'Iniciar sesión', primary: true }] });
  req.push({ state: 'ok', title: 'Carpeta de trabajo', desc: `Donde se abren las pestañas nuevas: ${esc(cfg.cwd || '')}`, actions: [{ id: 'cwd', label: 'Cambiar…' }] });
  // Claude Code pide aceptar el acceso total una vez por equipo; hasta entonces, esas pestañas no arrancan
  if (s.bypass?.used) req.push(s.bypass.accepted
    ? { state: 'ok', title: 'Acceso total', desc: 'Aceptado: en este modo Claude ejecuta y modifica sin preguntar (el modo se cambia en Configuración y con ⇧Tab).' }
    : { state: 'todo', title: 'Acceso total', desc: 'Las pestañas se abren en acceso total: Claude ejecuta comandos y modifica archivos sin preguntar. Claude Code pide aceptarlo una vez; si prefieres que pregunte, cambia el modo en Configuración.', actions: [{ id: 'bypass', label: 'Aceptar', primary: true }] });

  const opt = [];
  opt.push({ state: cfg.autoStart ? 'ok' : 'info', title: 'Iniciar con el sistema', desc: `Arranca minimizada en la ${IS_MAC ? 'barra de menús' : 'bandeja'}, lista para el atajo.`, actions: [{ id: 'autostart', label: cfg.autoStart ? 'Desactivar' : 'Activar' }] });
  opt.push(s.whisper ? { state: 'ok', title: 'Dictado por voz', desc: 'Modelo de voz descargado (funciona sin conexión).' }
    : { state: 'info', title: 'Dictado por voz', desc: setupVoice ?? 'Whisper en local: se descarga una vez (unos 550 MB). Si no, se descargará la primera vez que dictes.', actions: setupVoice ? [] : [{ id: 'voice', label: 'Descargar' }] });
  if (linux) {
    opt.push({ state: s.clipboard ? 'ok' : 'warn', title: 'Pegar imágenes', desc: s.clipboard ? 'Ctrl+V pega capturas en Claude Code.' : 'Claude Code necesita wl-clipboard (o xclip) para leer imágenes del portapapeles.', cmd: s.clipboard ? '' : dnf('wl-clipboard') });
    if (s.portal === false) opt.push({ state: 'warn', title: 'Recorte de pantalla', desc: 'Con Wayland, el recorte usa el del escritorio y para pedirlo hace falta PyGObject. Sin él, la app pide elegir la pantalla cada vez.', cmd: dnf('python3-gobject', { apt: 'python3-gi', pacman: 'python-gobject' }) });
    if (/gnome/i.test(s.desktop)) opt.push({ state: 'info', title: 'Icono en la bandeja', desc: 'GNOME no muestra la bandeja sin la extensión AppIndicator (después, actívala en Extensiones y cierra sesión).', cmd: dnf('gnome-shell-extension-appindicator') });
    // En GNOME con Wayland la app los da de alta como atajos del sistema (Configuración › Teclado › Atajos personalizados)
    if (s.wayland && /gnome/i.test(s.desktop)) opt.push({ state: 'info', title: 'Atajos globales', desc: `${esc(hotkeyLabel(cfg.hotkey || 'Control+Shift+Space'))} y los demás se añaden a los atajos personalizados de GNOME (Configuración › Teclado). Si uno no funciona, otro atajo del sistema lo tiene ocupado: cámbialo en Configuración › General.` });
    // Hyprland y Sway: ni atajos de otras apps ni ~/.config/autostart; se ponen en su archivo de configuración
    else if (s.wayland && /hyprland|sway/i.test(s.desktop)) {
      const hypr = /hyprland/i.test(s.desktop);
      const keys = [['hotkey', 'Control+Shift+Space', '--toggle'], ['voiceHotkey', 'Control+Alt+Space', '--voice'], ['shotHotkey', 'Control+Alt+S', '--snip']]
        .map(([k, def, flag]) => [cfg[k] === '' ? '' : cfg[k] || def, flag]).filter(([acc]) => acc)
        .map(([acc, flag]) => `${hypr ? wmBind(acc, true) : wmBind(acc, false)} ${s.launch} ${flag}`);
      const auto = cfg.autoStart ? [`${hypr ? 'exec-once =' : 'exec'} ${s.launch} --hidden`] : [];
      opt.push({ state: 'info', title: 'Atajos globales', desc: `${hypr ? 'Hyprland' : 'Sway'} no deja a las aplicaciones registrar atajos ni lee el inicio automático de otros escritorios: añade estas líneas a ${hypr ? '<code>~/.config/hypr/hyprland.conf</code>' : '<code>~/.config/sway/config</code>'}. La bandeja necesita el módulo <code>tray</code> de Waybar.`, cmd: [...keys, ...auto].join('\n') });
    }
    else if (s.wayland) opt.push({ state: 'info', title: 'Atajos globales', desc: `Con Wayland, el escritorio te pedirá permiso para ${esc(hotkeyLabel(cfg.hotkey || 'Control+Shift+Space'))} y los demás la primera vez. Si no funcionan, asígnalos en la configuración de teclado del sistema para que lancen la app con --toggle, --voice o --snip.` });
  }
  if (s.macPerms) {
    const perm = (kind, title, what, after = '') => {
      const st = s.macPerms[kind];
      if (st === 'granted') return { state: 'ok', title, desc: `Permitido: ${what}.` };
      const asked = st !== 'not-determined';
      return { state: 'warn', title, desc: `Para ${what}. ${asked ? `Actívalo en Ajustes del Sistema › Privacidad y seguridad${after}.` : 'macOS te lo preguntará.'}`, actions: [{ id: `perm-${kind}`, label: asked ? 'Abrir Ajustes' : 'Permitir' }] };
    };
    opt.push(perm('microphone', 'Micrófono', 'el dictado y el asistente por voz'));
    opt.push(perm('screen', 'Grabación de pantalla', 'el recorte de pantalla', ' y vuelve a abrir la app'));
    // Solo si algún preset maneja las apps del Mac (macOS-MCP)
    if (s.desktopApps) opt.push(perm('accessibility', 'Accesibilidad', 'que los presets con control de aplicaciones manejen otras apps', ' (Accesibilidad) y vuelve a abrir la pestaña'));
  }
  // Windows-MCP y macOS-MCP se lanzan con uvx (de uv)
  if (s.desktopApps && !s.desktopApps.uv) opt.push({ state: 'warn', title: 'uv', desc: 'Los presets con control de aplicaciones lo necesitan para lanzarlo. Instálalo y abre de nuevo esas pestañas.', cmd: IS_WIN ? 'powershell -c "irm https://astral.sh/uv/install.ps1 | iex"' : 'curl -LsSf https://astral.sh/uv/install.sh | sh' });
  opt.push({ state: s.git ? 'ok' : 'warn', title: 'Git', desc: s.git ? esc(s.git) : 'Claude Code lo usa para trabajar con repositorios.', cmd: s.git ? '' : dnf('git') });
  opt.push({ state: s.gh ? 'ok' : 'info', title: 'GitHub CLI', desc: s.gh ? esc(s.gh) : 'Para que Claude cree PR e issues. Después: <code>gh auth login</code>.', cmd: s.gh ? '' : dnf('gh', { pacman: 'github-cli' }) });
  opt.push({ state: 'info', title: 'Claude in Chrome', desc: 'Para los presets con navegador: instala la extensión en Chrome y entra con tu cuenta.', actions: [{ id: 'chrome', label: 'Abrir' }] });
  opt.push({ state: s.whatsapp ? 'ok' : 'info', title: 'WhatsApp', desc: s.whatsapp ? 'Vinculado. Actívalo en los presets que quieras.' : 'Para los presets con WhatsApp: vincula tu cuenta escaneando el código QR.', actions: [{ id: 'whatsapp', label: s.whatsapp ? 'Abrir' : 'Vincular' }] });

  $('#setup-required').innerHTML = req.map(setupRow).join('');
  $('#setup-optional').innerHTML = opt.map(setupRow).join('');
}

async function openSetup() {
  closePopover();
  applyConfigUi(await api.getConfig());
  setupForm.userName.value = state.config.userName || '';
  if (!setupDialog.open) setupDialog.showModal();
  await renderSetup();
}

async function finishSetup() {
  const userName = setupForm.userName.value.trim();
  await patchConfig({ setupDone: true, ...(userName !== (state.config.userName || '') ? { userName } : {}) });
}

setupForm.addEventListener('click', async (e) => {
  const cmd = e.target.closest('.setup-cmd');
  if (cmd) { navigator.clipboard.writeText(cmd.textContent); toast(cmd.textContent.includes('\n') ? 'Copiado. Pégalo en ese archivo.' : 'Comando copiado. Pégalo en una terminal.'); return; }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  if (act === 'login') await startLogin();
  else if (act === 'account') { await finishSetup(); setupDialog.close(); return openSettings('account'); }
  else if (act === 'cwd') { const d = await api.pickDir(state.config.cwd); if (d) await patchConfig({ cwd: d }); }
  else if (act === 'claude-pick') { const f = await api.pickFile(); if (f) await patchConfig({ claudePath: f }); }
  else if (act === 'autostart') await patchConfig({ autoStart: !state.config.autoStart });
  else if (act === 'chrome') window.open('https://claude.ai/chrome');
  else if (act === 'whatsapp') api.showWhatsApp();
  else if (act.startsWith('perm-')) await api.macPermission(act.slice(5), true);
  else if (act === 'bypass') await api.acceptBypass();
  else if (act === 'voice') {
    setupVoice = 'Descargando…';
    renderSetup();
    try { await api.voicePrepare(); setupVoice = null; } catch (err) { setupVoice = `No se pudo descargar: ${esc(err.message)}`; }
  }
  renderSetup();
});
api.onVoiceProgress(({ loaded, total }) => {
  if (!setupVoice || !setupDialog.open) return;
  setupVoice = `Descargando… ${Math.floor((loaded / total) * 100)}%`;
  const row = [...setupDialog.querySelectorAll('.setup-row b')].find((b) => b.textContent === 'Dictado por voz');
  const small = row?.parentElement.querySelector('small');
  if (small) small.textContent = setupVoice;
});
$('#setup-recheck').onclick = () => renderSetup();
$('#setup-done').onclick = async () => { await finishSetup(); setupDialog.close(); focusInput(); };
$('#setup-preset').onclick = async () => { await finishSetup(); setupDialog.close(); openPresetEditor(null); };
setupDialog.addEventListener('cancel', () => finishSetup());

// ---------- Inicio: una pestaña limpia, salvo al reabrir tras un reinicio ----------
(async () => {
  applyConfigUi(await api.getConfig());
  $('#test-badge').hidden = !state.config?.profile;
  document.body.classList.toggle('is-test', !!state.config?.profile);
  state.usage = await api.getUsage();
  renderUsage();
  const meta = await api.getMeta();
  if (meta?.models?.length) Object.assign(state.meta, meta);
  const boot = await api.bootTabs();
  state.secondary = !!boot?.secondary;
  for (const c of boot?.convs || []) {
    state.convs.set(c.id, c);
    state.tabs.push(c.id);
  }
  if (state.tabs.length) activateTab(state.convs.has(boot.active) ? boot.active : state.tabs[0]);
  else await newTab();
  if (boot?.note?.rolledBack) toast('La versión nueva no llegó a arrancar y se ha vuelto a la anterior. Tus cambios siguen en la copia de pruebas.', 'err');
  else if (boot?.note?.applied) toast('App actualizada con los cambios.');
  if (!state.config.setupDone) openSetup();
})();
