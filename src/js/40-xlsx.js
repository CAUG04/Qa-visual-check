/* =========================================================================
   EXCEL SIN LIBRERÍAS
   Lectura: ZIP (DecompressionStream) + XML de SpreadsheetML.
   Escritura: ZIP con entradas STORED + CRC32 propio.
   ========================================================================= */

/* ---------- CRC32 ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++){
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(u8){
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/* ---------- lectura de ZIP ---------- */
async function inflateRaw(u8, maxOut){
  if (typeof DecompressionStream === 'undefined')
    throw new Error('Este navegador no puede descomprimir .xlsx. Guarda el archivo como CSV e impórtalo.');
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks = []; let total = 0;
  // Se lee por trozos con tope: un .xlsx diminuto no puede descomprimirse en
  // cientos de MB (defensa contra «zip bomb»).
  for (;;){
    const { value, done } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxOut){ reader.cancel().catch(()=>{}); throw new Error('El archivo se expande demasiado; parece corrupto o malicioso.'); }
    chunks.push(value);
  }
  const out = new Uint8Array(total); let at = 0;
  for (const c of chunks){ out.set(c, at); at += c.length; }
  return out;
}

async function unzip(buffer){
  const u8 = new Uint8Array(buffer);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  // Fin del directorio central
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--){
    if (dv.getUint32(i, true) === 0x06054b50){ eocd = i; break; }
  }
  if (eocd < 0) throw new Error('El archivo no parece un .xlsx válido.');
  const count = Math.min(dv.getUint16(eocd + 10, true), LIMITS.zipFiles);
  let off = dv.getUint32(eocd + 16, true);
  const files = {};
  const dec = new TextDecoder('utf-8');
  for (let n = 0; n < count; n++){
    if (off < 0 || off + 46 > u8.length || dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true);
    const compSize = dv.getUint32(off + 20, true);
    const uncompSize = dv.getUint32(off + 24, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const cmtLen = dv.getUint16(off + 32, true);
    const local = dv.getUint32(off + 42, true);
    const name = dec.decode(u8.subarray(off + 46, off + 46 + nameLen));
    const lnameLen = dv.getUint16(local + 26, true);
    const lextraLen = dv.getUint16(local + 28, true);
    const start = local + 30 + lnameLen + lextraLen;
    if (start >= 0 && start + compSize <= u8.length && uncompSize <= LIMITS.zipEntry)
      files[name] = { method, raw: u8.subarray(start, start + compSize), uncompSize };
    off += 46 + nameLen + extraLen + cmtLen;
  }
  const out = {};
  let total = 0;
  for (const [name, f] of Object.entries(files)){
    if (!/\.(xml|rels)$/i.test(name)) continue;                  // solo las partes que necesitamos
    const budget = Math.min(LIMITS.zipEntry, LIMITS.zipTotal - total);
    if (budget <= 0) throw new Error('El archivo contiene demasiados datos para procesarlo.');
    const bytes = f.method === 0 ? f.raw.slice(0, budget) : await inflateRaw(f.raw, budget);
    total += bytes.length;
    out[name] = dec.decode(bytes);
  }
  return out;
}

/* ---------- SpreadsheetML ---------- */
const colToIndex = ref => {
  const m = /^([A-Z]+)/.exec(ref); if (!m) return 0;
  let n = 0; for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};
const DATE_BUILTIN = new Set([14,15,16,17,22,27,30,36,45,46,47,50,57]);

function excelSerialToText(n){
  if (n < 1) return String(n);
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const d = new Date(ms);
  if (isNaN(d)) return String(n);
  const p = v => String(v).padStart(2,'0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth()+1)}/${d.getUTCFullYear()}`;
}

async function parseXlsx(buffer){
  const parts = await unzip(buffer);
  const P = new DOMParser();
  const xml = name => parts[name] ? P.parseFromString(parts[name], 'application/xml') : null;

  // cadenas compartidas
  const shared = [];
  const ss = xml('xl/sharedStrings.xml');
  if (ss) for (const si of ss.getElementsByTagName('si')){
    if (shared.length >= LIMITS.sharedStrings) break;
    shared.push(Array.from(si.getElementsByTagName('t')).map(t => t.textContent).join('').slice(0, LIMITS.str));
  }
  // estilos → detección de fechas
  const dateStyles = new Set();
  const st = xml('xl/styles.xml');
  if (st){
    const custom = new Map();
    for (const f of st.getElementsByTagName('numFmt')){
      const id = +f.getAttribute('numFmtId');
      const code = f.getAttribute('formatCode') || '';
      if (/[dmy]/i.test(code) && !/[#0]/.test(code.replace(/\[[^\]]*\]/g,''))) custom.set(id, true);
    }
    const xfs = st.getElementsByTagName('cellXfs')[0];
    if (xfs) Array.from(xfs.getElementsByTagName('xf')).forEach((xf, i) => {
      const id = +(xf.getAttribute('numFmtId') || 0);
      if (DATE_BUILTIN.has(id) || custom.has(id)) dateStyles.add(i);
    });
  }
  // hojas
  const rels = xml('xl/_rels/workbook.xml.rels');
  const relMap = {};
  if (rels) for (const r of rels.getElementsByTagName('Relationship')){
    let t = r.getAttribute('Target') || '';
    if (t.startsWith('/')) t = t.slice(1); else if (!t.startsWith('xl/')) t = 'xl/' + t.replace(/^\.\//,'');
    relMap[r.getAttribute('Id')] = t;
  }
  const wb = xml('xl/workbook.xml');
  const sheets = [];
  const sheetNodes = wb ? Array.from(wb.getElementsByTagName('sheet')) : [];
  let fallbackIdx = 1;
  for (const sh of sheetNodes){
    const name = sh.getAttribute('name') || ('Hoja' + fallbackIdx);
    const rid = sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id');
    let path = relMap[rid] || ('xl/worksheets/sheet' + (fallbackIdx) + '.xml');
    fallbackIdx++;
    const doc = xml(path);
    if (!doc) continue;
    const rows = [];
    for (const row of doc.getElementsByTagName('row')){
      if (rows.length >= LIMITS.rows) break;
      const arr = [];
      for (const c of row.getElementsByTagName('c')){
        const idx = colToIndex(c.getAttribute('r') || '');
        if (idx < 0 || idx >= LIMITS.cols) continue;
        const t = c.getAttribute('t');
        const sIdx = c.getAttribute('s') ? +c.getAttribute('s') : -1;
        let val = '';
        if (t === 'inlineStr'){
          val = Array.from(c.getElementsByTagName('t')).map(n => n.textContent).join('');
        } else {
          const v = c.getElementsByTagName('v')[0];
          const raw = v ? v.textContent : '';
          if (t === 's') val = shared[+raw] ?? '';
          else if (t === 'b') val = raw === '1' ? 'VERDADERO' : 'FALSO';
          else if (t === 'str' || t === 'e') val = raw;
          else if (raw !== '' && dateStyles.has(sIdx) && isFinite(+raw)) val = excelSerialToText(+raw);
          else val = raw;
        }
        arr[idx] = String(val ?? '').trim().slice(0, LIMITS.str);
      }
      for (let i = 0; i < arr.length; i++) if (arr[i] === undefined) arr[i] = '';
      rows.push(arr);
    }
    sheets.push({ name, rows });
  }
  if (!sheets.length) throw new Error('No se encontraron hojas en el archivo.');
  return sheets;
}

/* ---------- CSV ---------- */
function parseCsv(text){
  if (text.length > LIMITS.csvBytes) throw new Error('El CSV es demasiado grande para procesarlo en el navegador.');
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/)[0] || '';
  const counts = { ',':0, ';':0, '\t':0 };
  let q = false;
  for (const ch of firstLine){ if (ch === '"') q = !q; else if (!q && ch in counts) counts[ch]++; }
  const delim = Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][1] ? Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0] : ',';
  const rows = []; let row = [], cell = '', inQ = false;
  for (let i = 0; i < clean.length; i++){
    const ch = clean[i];
    if (inQ){
      if (ch === '"'){ if (clean[i+1] === '"'){ cell += '"'; i++; } else inQ = false; }
      else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim){ row.push(cell); cell = ''; }
    else if (ch === '\n'){ row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch === '\r'){ /* ignorar */ }
    else cell += ch;
  }
  if (cell !== '' || row.length){ row.push(cell); rows.push(row); }
  return [{ name:'CSV', rows: rows.slice(0, LIMITS.rows).map(r => r.slice(0, LIMITS.cols).map(c => c.trim().slice(0, LIMITS.str))) }];
}
/** Una celda que empieza por = + - @ o tabulador la interpreta Excel como
    fórmula: se antepone un apóstrofo para que quede como texto (CSV injection). */
function csvSafe(v){
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = "'" + s;
  return s;
}
function toCsv(rows){
  const q = v => {
    const s = csvSafe(v);
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
  };
  return rows.map(r => r.map(q).join(';')).join('\r\n');
}

/* ---------- escritura de XLSX ---------- */
const xesc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))
  .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
const colName = i => { let s = ''; i++; while (i > 0){ const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - 1 - m) / 26; } return s; };

function sheetXml(sheet){
  const rows = sheet.rows.map((cells, ri) => {
    const r = ri + 1;
    const cs = cells.map((cell, ci) => {
      const val = (cell && typeof cell === 'object') ? cell.v : cell;
      const style = (cell && typeof cell === 'object') ? cell.s : (ri === 0 && sheet.header ? 1 : 2);
      const ref = colName(ci) + r;
      if (val === '' || val === null || val === undefined) return `<c r="${ref}" s="${style}"/>`;
      if (typeof val === 'number' && isFinite(val)) return `<c r="${ref}" s="${style}"><v>${val}</v></c>`;
      return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xesc(val)}</t></is></c>`;
    }).join('');
    const h = (ri === 0 && sheet.header) ? ' ht="26" customHeight="1"' : '';
    return `<row r="${r}"${h}>${cs}</row>`;
  }).join('');

  const cols = (sheet.cols || []).map((w, i) =>
    `<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('');
  const nRows = Math.max(sheet.rows.length, 2);
  const nCols = Math.max(...sheet.rows.map(r => r.length), 1);
  const freeze = sheet.header
    ? `<sheetView showGridLines="0" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView>`
    : `<sheetView showGridLines="0" workbookViewId="0"/>`;
  const af = sheet.header ? `<autoFilter ref="A1:${colName(nCols-1)}${nRows}"/>` : '';
  const dv = (sheet.validations || []).length
    ? `<dataValidations count="${sheet.validations.length}">` + sheet.validations.map(v =>
        `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="${v.range}">` +
        `<formula1>"${v.values.join(',')}"</formula1></dataValidation>`).join('') + `</dataValidations>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:${colName(nCols-1)}${nRows}"/><sheetViews>${freeze}</sheetViews>
<sheetFormatPr defaultRowHeight="15"/>${cols ? `<cols>${cols}</cols>` : ''}
<sheetData>${rows}</sheetData>${af}${dv}
<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/></worksheet>`;
}

function stylesXml(){
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4">
  <font><sz val="11"/><color theme="1"/><name val="Calibri"/></font>
  <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
  <font><sz val="11"/><color rgb="FF595959"/><name val="Calibri"/></font>
  <font><b/><sz val="13"/><color theme="1"/><name val="Calibri"/></font>
</fonts>
<fills count="4">
  <fill><patternFill patternType="none"/></fill>
  <fill><patternFill patternType="gray125"/></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FF2F4A6E"/><bgColor indexed="64"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFF2F5FA"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
  <border><left/><right/><top/><bottom/><diagonal/></border>
  <border><left style="thin"><color rgb="FFD9DEE8"/></left><right style="thin"><color rgb="FFD9DEE8"/></right><top style="thin"><color rgb="FFD9DEE8"/></top><bottom style="thin"><color rgb="FFD9DEE8"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
  <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
  <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf>
  <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf>
  <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf>
  <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function buildXlsx(sheets){
  const enc = new TextEncoder();
  const wbSheets = sheets.map((s, i) =>
    `<sheet name="${xesc(s.name).slice(0,31)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('');
  const files = [
    { name:'[Content_Types].xml', text:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheets.map((s,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>` },
    { name:'_rels/.rels', text:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>` },
    { name:'xl/workbook.xml', text:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${wbSheets}</sheets></workbook>` },
    { name:'xl/_rels/workbook.xml.rels', text:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((s,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}
<Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>` },
    { name:'xl/styles.xml', text:stylesXml() },
    ...sheets.map((s, i) => ({ name:`xl/worksheets/sheet${i+1}.xml`, text:sheetXml(s) }))
  ].map(f => ({ name:f.name, data:enc.encode(f.text) }));

  return zipStore(files);
}

/** ZIP con entradas sin comprimir (Excel lo acepta y evita dependencias). */
function zipStore(files){
  const parts = [], central = [];
  let offset = 0;
  const now = new Date();
  const time = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF;
  const date = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;
  const enc = new TextEncoder();

  for (const f of files){
    const nb = enc.encode(f.name);
    const crc = crc32(f.data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0, true);
    lh.setUint16(8, 0, true); lh.setUint16(10, time, true); lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, f.data.length, true); lh.setUint32(22, f.data.length, true);
    lh.setUint16(26, nb.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), nb, f.data);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
    ch.setUint16(8, 0, true); ch.setUint16(10, 0, true); ch.setUint16(12, time, true); ch.setUint16(14, date, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, f.data.length, true); ch.setUint32(24, f.data.length, true);
    ch.setUint16(28, nb.length, true); ch.setUint16(30, 0, true); ch.setUint16(32, 0, true);
    ch.setUint16(34, 0, true); ch.setUint16(36, 0, true); ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nb);

    offset += 30 + nb.length + f.data.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const eo = new DataView(new ArrayBuffer(22));
  eo.setUint32(0, 0x06054b50, true); eo.setUint16(4, 0, true); eo.setUint16(6, 0, true);
  eo.setUint16(8, files.length, true); eo.setUint16(10, files.length, true);
  eo.setUint32(12, cdSize, true); eo.setUint32(16, offset, true); eo.setUint16(20, 0, true);

  return new Blob([...parts, ...central, new Uint8Array(eo.buffer)], {
    type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
}
