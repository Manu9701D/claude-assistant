// Pruebas de la edición de documentos de la vista previa (docedit.mjs): npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import { docxParagraphs, patchDocxXml, patchDocx, patchSheetXml, patchXlsx, patchCsv, sniffCsv, cellXml } from '../docedit.mjs';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const body = (inner) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${inner}</w:body></w:document>`;

test('Word: cambia solo el texto, en el trozo con su formato', () => {
  const xml = body('<w:p><w:r><w:t>Hola </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>mundo</w:t></w:r><w:r><w:t xml:space="preserve"> cruel</w:t></w:r></w:p><w:p><w:r><w:t>Otro</w:t></w:r></w:p>');
  assert.deepEqual(docxParagraphs(xml).map((p) => p.text), ['Hola mundo cruel', 'Otro']);
  // Dentro de la negrita
  let out = patchDocxXml(xml, [{ o: 'Hola mundo cruel', k: 0, t: 'Hola mundial cruel' }]);
  assert.match(out, /<w:b\/><\/w:rPr><w:t>mundial<\/w:t>/);
  assert.match(out, /<w:t>Hola <\/w:t>/);
  // Borrar a caballo entre trozos
  out = patchDocxXml(xml, [{ o: 'Hola mundo cruel', k: 0, t: 'Hola cruel' }]);
  assert.deepEqual(docxParagraphs(out).map((p) => p.text), ['Hola cruel', 'Otro']);
  // Espacios al borde: xml:space
  out = patchDocxXml(xml, [{ o: 'Otro', k: 0, t: 'Otro  más' }]);
  assert.match(out, /<w:t xml:space="preserve">Otro  más<\/w:t>/);
  // Escapes
  out = patchDocxXml(xml, [{ o: 'Otro', k: 0, t: 'a < b & c' }]);
  assert.match(out, /a &lt; b &amp; c/);
  assert.throws(() => patchDocxXml(xml, [{ o: 'No está', k: 0, t: 'x' }]), /No encuentro/);
});

test('Word: párrafos repetidos, por orden', () => {
  const xml = body('<w:p><w:r><w:t>Igual</w:t></w:r></w:p><w:p><w:r><w:t>Igual</w:t></w:r></w:p>');
  const out = patchDocxXml(xml, [{ o: 'Igual', k: 1, t: 'Segundo' }]);
  assert.deepEqual(docxParagraphs(out).map((p) => p.text), ['Igual', 'Segundo']);
});

test('Word: el .docx sigue abriéndose', async () => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', body('<w:p><w:r><w:t>Título</w:t></w:r></w:p><w:p><w:r><w:t>Texto de prueba</w:t></w:r><w:r><w:tab/><w:t>tras tab</w:t></w:r></w:p>'));
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  const out = await patchDocx(buf, [{ o: 'Texto de pruebatras tab', k: 0, t: 'Texto cambiadotras tab' }]);
  const { value } = await mammoth.extractRawText({ buffer: out });
  assert.match(value, /Texto cambiado\ttras tab/);
});

test('Excel: valores, filas nuevas, estilo y dimensión', () => {
  const xml = '<worksheet xmlns="x"><dimension ref="A1:B2"/><sheetData><row r="1" spans="1:2"><c r="A1" s="3" t="s"><v>0</v></c><c r="B1"><v>5</v></c></row><row r="2"><c r="A2"><f>B1*2</f><v>10</v></c></row></sheetData></worksheet>';
  const out = patchSheetXml(xml, { A1: 'Hola', C1: '3,5', A4: '=SUM(B1:B3)', B2: 'VERDADERO' });
  assert.match(out, /<c r="A1" s="3" t="inlineStr"><is><t xml:space="preserve">Hola<\/t><\/is><\/c><c r="B1"><v>5<\/v><\/c><c r="C1"><v>3.5<\/v><\/c>/);
  assert.match(out, /<row r="1">/); // sin spans
  assert.match(out, /<c r="A2"><f>B1\*2<\/f><v>10<\/v><\/c><c r="B2" t="b"><v>1<\/v><\/c>/);
  assert.match(out, /<\/row><row r="4"><c r="A4"><f>SUM\(B1:B3\)<\/f><\/c><\/row><\/sheetData>/);
  assert.match(out, /<dimension ref="A1:C4"\/>/);
  assert.equal(cellXml('A1', '007'), '<c r="A1" t="inlineStr"><is><t xml:space="preserve">007</t></is></c>');
  assert.equal(cellXml('A1', '', '2'), '<c r="A1" s="2"/>');
  assert.equal(cellXml('A1', '50%'), '<c r="A1"><v>0.5</v></c>');
});

test('Excel: fórmulas compartidas, matriciales y encabezados de tabla', () => {
  const xml = '<worksheet><sheetData><row r="1"><c r="A1"><f t="shared" ref="A1:A3" si="0">B1*2</f><v>2</v></c></row><row r="2"><c r="A2"><f t="shared" si="0"/><v>4</v></c></row><row r="3"><c r="A3"><f t="array" ref="A3:B3">X</f></c></row></sheetData></worksheet>';
  const out = patchSheetXml(xml, { A1: '7' }, { formulas: { A1: 'B1*2', A2: 'B2*2' } });
  assert.match(out, /<c r="A1"><v>7<\/v><\/c>/);
  assert.match(out, /<c r="A2"><f>B2\*2<\/f><v>4<\/v><\/c>/);
  assert.throws(() => patchSheetXml(xml, { B3: '1' }), /matricial/);
  assert.throws(() => patchSheetXml(xml, { B1: '1' }, { headers: ['A1:C1'] }), /encabezado/);
});

test('Excel: el .xlsx guardado se lee y recalcula al abrir', async () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['a', 1], ['b', 2], ['total', { t: 'n', f: 'SUM(B1:B2)' }]]), 'Datos');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['x']]), 'Otra hoja');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const out = await patchXlsx(buf, { Datos: { B1: '10', C5: 'nuevo' }, 'Otra hoja': { A1: 'y' } });
  const back = XLSX.read(out, { type: 'buffer', cellFormula: true });
  assert.equal(back.Sheets.Datos.B1.v, 10);
  assert.equal(back.Sheets.Datos.C5.v, 'nuevo');
  assert.equal(back.Sheets.Datos.B3.f, 'SUM(B1:B2)');
  assert.equal(back.Sheets['Otra hoja'].A1.v, 'y');
  const zip = await JSZip.loadAsync(out);
  assert.match(await zip.file('xl/workbook.xml').async('string'), /fullCalcOnLoad="1"/);
});

test('CSV: solo cambian las filas tocadas', () => {
  const csv = '﻿nombre;"precio"\r\n"Ana; B";3\r\nLuis;4\r\n';
  const out = patchCsv(csv, { B3: '4,5', C2: 'con "comillas"', A5: 'nuevo' }, ';');
  assert.equal(out, '﻿nombre;"precio"\r\nAna; B;3;"con ""comillas"""\r\nLuis;4,5\r\n\r\nnuevo\r\n'.replace('Ana; B', '"Ana; B"'));
  assert.equal(sniffCsv(csv), ';');
  assert.equal(sniffCsv('a,"b;c;d"\n1,2'), ',');
  assert.equal(sniffCsv('a\tb\n1\t2'), '\t');
});
