// Monaco (el editor de VS Code) para el panel de documentos. Pesa: se carga la primera vez que hace falta.
// Tema con los colores de la app (claro u oscuro, como ella) y workers desde archivo (ver monaco-worker.js).
// eslint-disable-next-line no-unused-vars
const Code = (() => {
  const BASE = '../node_modules/monaco-editor/min/vs';
  let loading = null;
  const addScript = (src) => new Promise((ok, ko) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = ok;
    s.onerror = () => ko(new Error(`no se pudo cargar ${src}`));
    document.head.append(s);
  });
  function load() {
    loading ||= (async () => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `${BASE}/editor/editor.main.css`;
      document.head.append(link);
      const workers = await api.monacoWorkers().catch(() => ({}));
      await addScript(`${BASE}/nls/lang/es.js`); // los textos en español (no es un módulo: deja sus globales)
      await addScript(`${BASE}/loader.js`);
      window.require.config({ paths: { vs: BASE } });
      const monaco = await new Promise((ok, ko) => window.require(['vs/editor/editor.main'], ok, ko));
      window.monaco = monaco;
      const KIND = { json: 'json', css: 'css', scss: 'css', less: 'css', html: 'html', handlebars: 'html', razor: 'html', typescript: 'ts', javascript: 'ts' };
      self.MonacoEnvironment = {
        getWorker(_id, label) {
          const file = workers[KIND[label] || 'editor'] || workers.editor;
          const url = new URL(`${BASE}/assets/${file}`, document.baseURI).href;
          return new Worker(`monaco-worker.js?${encodeURIComponent(url)}`);
        },
      };
      // Sin proyecto detrás, los errores de tipos o de módulos que no encuentra serían ruido: solo los de sintaxis
      const ts = monaco.typescript || monaco.languages.typescript;
      for (const d of [ts?.typescriptDefaults, ts?.javascriptDefaults]) d?.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
      (monaco.json || monaco.languages.json)?.jsonDefaults?.setDiagnosticsOptions({ validate: true, allowComments: true, trailingCommas: 'ignore', enableSchemaRequest: false });
      applyTheme();
      darkMq.addEventListener('change', () => setTimeout(applyTheme, 50));
      return monaco;
    })();
    loading.catch(() => { loading = null; });
    return loading;
  }
  // Colores de las variables CSS en #rrggbbaa (lo único que admite Monaco)
  const probe = document.createElement('i');
  function hex(cssVar, alpha) {
    if (!probe.isConnected) { probe.style.display = 'none'; document.body.append(probe); }
    probe.style.color = `var(${cssVar})`;
    const m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(probe).color) || /color\(srgb ([^)]+)\)/.exec(getComputedStyle(probe).color);
    if (!m) return undefined;
    let parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (m[0].startsWith('color(')) parts = parts.map((n, i) => (i < 3 ? n * 255 : n));
    const [r, g, b, a = 1] = parts;
    const h = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}${h((alpha ?? 1) * a * 255)}`;
  }
  function applyTheme() {
    const monaco = window.monaco;
    if (!monaco) return;
    const dark = darkMq.matches;
    const fg = (v) => hex(v)?.slice(1, 7);
    const ok = dark ? '#7cc495' : '#3d7a52';
    const err = dark ? '#f2867c' : '#b3261e';
    monaco.editor.defineTheme('claude', {
      base: dark ? 'vs-dark' : 'vs',
      inherit: true,
      rules: [
        { token: 'comment', foreground: fg('--hl-comment'), fontStyle: 'italic' },
        { token: 'keyword', foreground: fg('--hl-keyword') },
        { token: 'string', foreground: fg('--hl-string') },
        { token: 'number', foreground: fg('--hl-number') },
        { token: 'regexp', foreground: fg('--hl-string') },
        { token: 'type', foreground: fg('--hl-builtin') },
        { token: 'tag', foreground: fg('--hl-keyword') },
        { token: 'attribute.name', foreground: fg('--hl-attr') },
        { token: 'attribute.value', foreground: fg('--hl-string') },
        { token: 'key', foreground: fg('--hl-title') },
        { token: 'string.key.json', foreground: fg('--hl-title') },
        { token: 'string.value.json', foreground: fg('--hl-string') },
        { token: 'variable', foreground: fg('--hl-attr') },
        { token: 'keyword.md', foreground: fg('--hl-keyword') },
        { token: 'strong', fontStyle: 'bold' },
        { token: 'emphasis', fontStyle: 'italic' },
      ],
      colors: {
        'editor.background': hex('--code-bg'),
        'editor.foreground': hex('--text'),
        'editorLineNumber.foreground': hex('--faint'),
        'editorLineNumber.activeForeground': hex('--muted'),
        'editorCursor.foreground': hex('--accent'),
        'editor.selectionBackground': hex('--accent', 0.28),
        'editor.inactiveSelectionBackground': hex('--accent', 0.14),
        'editor.selectionHighlightBackground': hex('--accent', 0.12),
        'editor.wordHighlightBackground': hex('--accent', 0.1),
        'editor.findMatchBackground': hex('--accent', 0.45),
        'editor.findMatchHighlightBackground': hex('--accent', 0.2),
        'editor.lineHighlightBackground': hex('--text', 0.035),
        'editor.lineHighlightBorder': '#00000000',
        'editorIndentGuide.background1': hex('--text', 0.07),
        'editorIndentGuide.activeBackground1': hex('--text', 0.16),
        'editorWhitespace.foreground': hex('--text', 0.15),
        'editorGutter.background': hex('--code-bg'),
        'editorWidget.background': hex('--surface'),
        'editorWidget.border': hex('--border'),
        'editorSuggestWidget.background': hex('--surface'),
        'editorSuggestWidget.selectedBackground': hex('--raised'),
        'editorHoverWidget.background': hex('--surface'),
        'menu.background': hex('--surface'),
        'menu.selectionBackground': hex('--raised'),
        'menu.selectionForeground': hex('--text'),
        'input.background': hex('--bg'),
        'input.border': hex('--border'),
        focusBorder: hex('--accent', 0.6),
        'minimap.background': hex('--code-bg'),
        'scrollbar.shadow': '#00000000',
        'scrollbarSlider.background': hex('--text', 0.12),
        'scrollbarSlider.hoverBackground': hex('--text', 0.2),
        'scrollbarSlider.activeBackground': hex('--text', 0.28),
        'editorOverviewRuler.border': '#00000000',
        'diffEditor.insertedTextBackground': `${ok}33`,
        'diffEditor.removedTextBackground': `${err}33`,
        'diffEditor.insertedLineBackground': `${ok}1c`,
        'diffEditor.removedLineBackground': `${err}1c`,
        'diffEditorGutter.insertedLineBackground': `${ok}2a`,
        'diffEditorGutter.removedLineBackground': `${err}2a`,
        'diffEditor.diagonalFill': hex('--text', 0.06),
        'diffEditor.unchangedRegionBackground': hex('--raised'),
        'diffEditor.unchangedRegionForeground': hex('--muted'),
        'editorGutter.addedBackground': ok,
        'editorGutter.modifiedBackground': hex('--accent'),
        'editorGutter.deletedBackground': err,
      },
    });
    monaco.editor.setTheme('claude');
  }
  const font = () => getComputedStyle(document.documentElement).getPropertyValue('--mono').trim() || 'monospace';
  const common = () => ({
    theme: 'claude',
    automaticLayout: true,
    fontFamily: font(),
    fontSize: 13,
    lineHeight: 20,
    fontLigatures: false,
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    cursorBlinking: 'smooth',
    renderLineHighlight: 'all',
    padding: { top: 10, bottom: 10 },
    scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
    stickyScroll: { enabled: true },
    bracketPairColorization: { enabled: false },
    guides: { indentation: true },
    fixedOverflowWidgets: true,
    unicodeHighlight: { ambiguousCharacters: false },
  });
  // Modelo con el lenguaje que toca por la extensión (como en VS Code)
  function model(text, file) {
    const monaco = window.monaco;
    const uri = file ? monaco.Uri.file(file).with({ query: `m${Math.random().toString(36).slice(2)}` }) : undefined;
    return monaco.editor.createModel(text, undefined, uri);
  }
  function editor(el, opts = {}) {
    return window.monaco.editor.create(el, { ...common(), minimap: { enabled: false, renderCharacters: false, showSlider: 'mouseover' }, ...opts });
  }
  function diff(el, opts = {}) {
    return window.monaco.editor.createDiffEditor(el, {
      ...common(),
      readOnly: true,
      originalEditable: false,
      renderSideBySide: true,
      useInlineViewWhenSpaceIsLimited: true,
      renderSideBySideInlineBreakpoint: 760,
      hideUnchangedRegions: { enabled: true, contextLineCount: 3, minimumLineCount: 4, revealLineCount: 20 },
      renderOverviewRuler: false,
      renderIndicators: true,
      diffWordWrap: 'on',
      wordWrap: 'on',
      minimap: { enabled: false },
      ...opts,
    });
  }
  return { load, editor, diff, model, applyTheme, get ready() { return !!window.monaco; } };
})();
