// Worker de Monaco desde un archivo: los suyos se crean desde blob:, que la CSP de la ventana no deja
importScripts(decodeURIComponent(location.search.slice(1)));
postMessage({ type: 'vscode-worker-ready' });
