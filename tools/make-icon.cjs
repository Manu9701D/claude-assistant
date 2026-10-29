// Genera assets/icon.png (256 px) y assets/icon.ico (16–256 px) con la chispa de Claude, y para macOS
// assets/icon-mac.png (1024 px, sobre la baldosa redondeada de los iconos del Dock) y
// assets/trayTemplate.png (+ @2x: silueta para la barra de menús, que macOS pinta en blanco o negro).
// Uso: npx electron tools/make-icon.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

require(path.join(__dirname, '..', 'renderer', 'spark.js'));
const SPARK = globalThis.SPARK_PATH;
const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const OUT = path.join(__dirname, '..', 'assets');

// El símbolo de Claude tal cual, en su color y sin fondo; en tamaños pequeños con menos margen
function svg(size) {
  const fill = size <= 24 ? 1 : 0.94;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
    <path d="${SPARK}" fill="${globalThis.CLAUDE_COLOR}" transform="translate(12 12) scale(${fill}) translate(-12 -12)"/>
  </svg>`;
}

// macOS: baldosa de 824 px dentro de 1024 (la rejilla de Apple), esquinas redondeadas y la chispa encima
const MAC_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect x="100" y="100" width="824" height="824" rx="185" fill="#f0eee6"/>
  <g transform="translate(512 512) scale(23) translate(-12 -12)"><path d="${SPARK}" fill="${globalThis.CLAUDE_COLOR}"/></g>
</svg>`;
const traySvg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24"><path d="${SPARK}" fill="#000"/></svg>`;

function ico(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt8(0, e + 2);
    header.writeUInt8(0, e + 3);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.data)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL('data:text/html;charset=utf-8,<html><body></body></html>');
  // La página pinta el SVG en un canvas y devuelve el PNG (no depende de que la ventana se vea)
  const render = async (markup, size) => {
    const dataUrl = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = c.height = ${size};
        c.getContext('2d').drawImage(img, 0, 0, ${size}, ${size});
        resolve(c.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('svg'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(${JSON.stringify(markup)});
    })`);
    return Buffer.from(dataUrl.split(',')[1], 'base64');
  };
  const pngs = [];
  for (const size of SIZES) pngs.push({ size, data: await render(svg(size), size) });
  fs.writeFileSync(path.join(OUT, 'icon-mac.png'), await render(MAC_SVG, 1024));
  fs.writeFileSync(path.join(OUT, 'trayTemplate.png'), await render(traySvg(18), 18));
  fs.writeFileSync(path.join(OUT, 'trayTemplate@2x.png'), await render(traySvg(36), 36));
  fs.writeFileSync(path.join(OUT, 'icon.png'), pngs.find((p) => p.size === 256).data);
  fs.writeFileSync(path.join(OUT, 'icon-32.png'), pngs.find((p) => p.size === 32).data);
  fs.writeFileSync(path.join(OUT, 'icon.ico'), ico(pngs));
  console.log('iconos generados:', SIZES.join(', '));
  app.quit();
});
