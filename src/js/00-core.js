/* =========================================================================
   NÚCLEO: estado, utilidades, almacenamiento, modales, avisos, navegación
   ========================================================================= */

const VERSION = '1.0';
const LS_KEY = 'qa-visual-check.v1';

/* ---------- estado ---------- */
const S = {
  meta: { project:'', client:'', tester:'', date:'', url:'', browser:'', viewport:'', figma:'', notes:'' },
  design: [],          // fuentes de diseño
  web: [],             // fuentes de la web
  pairs: [],           // pares diseño↔web
  activePairId: null,
  scenarios: [],
  findings: [],
  counters: { finding:0, pair:0 },
  ui: { mode:'side', tool:'pan', theme:'dark', threshold:12, opacity:50, liveDiff:false,
        curtain:0.5, scPage:1, scPageSize:200 }
};

/* ---------- helpers DOM ---------- */
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
function el(tag, attrs={}, ...kids){
  const n = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs)){
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()){ if (k === null || k === undefined) continue;
    n.append(k instanceof Node ? k : document.createTextNode(String(k))); }
  return n;
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = (p='id') => p + '_' + Math.random().toString(36).slice(2,9) + Date.now().toString(36).slice(-3);
const clamp = (v,a,b) => Math.min(b, Math.max(a, v));
const fmtInt = n => (n===null||n===undefined||!isFinite(n)) ? '—' : Math.round(n).toLocaleString('es-CO');
const fmtPct = n => (n===null||n===undefined||!isFinite(n)) ? '—' : (n<0.01 && n>0 ? '<0,01' : n.toFixed(2).replace('.',',')) + '%';
const debounce = (fn, ms=450) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; };
const todayISO = () => new Date().toISOString().slice(0,10);

/* ---------- avisos ----------
   `toast` trata el mensaje como TEXTO: nada de lo que venga de un archivo,
   un nombre de archivo o una sesión puede inyectar marcado. Para los avisos
   internos con marcado fijo (el spinner) existe `toastHtml`. */
function makeToast(title, kind, ms, node){
  const t = el('div', { class:'toast ' + kind }, el('b', { text:title }), node);
  $('#toasts').append(t);
  setTimeout(()=>{ t.style.transition='opacity .3s,transform .3s'; t.style.opacity=0; t.style.transform='translateY(6px)';
                   setTimeout(()=>t.remove(), 320); }, ms);
  return t;
}
function toast(title, msg='', kind='', ms=3800){
  return makeToast(title, kind, ms, msg ? el('span', { text:String(msg) }) : null);
}
/** Solo para marcado propio y constante de la app (nunca datos de entrada). */
function toastHtml(title, html='', kind='', ms=3800){
  return makeToast(title, kind, ms, html ? el('span', { html }) : null);
}

/* ---------- modal ---------- */
let modalOnClose = null;
function openModal({ title, body, foot=[], wide=false, onClose=null }){
  $('#modal-title').textContent = title;
  const b = $('#modal-body'); b.innerHTML = '';
  if (typeof body === 'string') b.innerHTML = body; else if (body) b.append(body);
  const f = $('#modal-foot'); f.innerHTML = '';
  for (const btn of foot){
    if (!btn) continue;
    f.append(el('button', { class:'btn ' + (btn.cls||'ghost'), text:btn.label, id:btn.id||null,
                            onclick:(e)=>btn.onClick ? btn.onClick(e) : closeModal() }));
  }
  $('.modal').classList.toggle('wide', !!wide);
  $('#modal-root').hidden = false;
  modalOnClose = onClose;
  return b;
}
function closeModal(){
  $('#modal-root').hidden = true;
  $('#modal-body').innerHTML = '';
  if (modalOnClose) { const f = modalOnClose; modalOnClose = null; f(); }
}

/* ---------- descargas ---------- */
function downloadBlob(filename, blob){
  const url = URL.createObjectURL(blob);
  const a = el('a', { href:url, download:filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 4000);
}
const downloadText = (filename, text, mime='text/plain;charset=utf-8') =>
  downloadBlob(filename, new Blob([(mime.includes('csv') ? '﻿' : '') + text], {type:mime}));
const deaccent = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const slug = s => (deaccent(s || 'sin-nombre').toLowerCase()
  .replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60) || 'sin-nombre');

/* =========================================================================
   SANEAMIENTO DE DATOS EXTERNOS
   Todo lo que entra desde un archivo (sesión .json, Excel, CSV, PDF, imagen)
   se trata como hostil: se recorta, se acota y se reconstruye campo por campo.
   ========================================================================= */
const LIMITS = {
  sources:300, pairs:300, scenarios:20000, findings:3000, masks:500, extraCols:120,
  str:4000, longStr:20000, name:300,
  imageBytes:14e6, imagePixels:90e6, imageSide:20000,
  zipEntry:80e6, zipTotal:240e6, zipFiles:3000, sharedStrings:300000,
  csvBytes:40e6, rows:20000, cols:200, pdfPages:400, canvasSide:12000,
  sessionBytes:400e6
};
/** Texto plano acotado y sin caracteres de control. */
const sStr = (v, max = LIMITS.str) =>
  (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
    ? String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, max) : '';
const sNum = (v, min, max, def = 0) => { const n = Number(v); return Number.isFinite(n) ? clamp(n, min, max) : def; };
const sPick = (v, allowed, def) => allowed.includes(v) ? v : def;
const sId   = v => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v)) ? v : null;
const sBool = v => v === true;
/** Solo imágenes en base64 de formatos de mapa de bits: nada de SVG ni de URLs remotas. */
const DATA_IMG = /^data:image\/(png|jpeg|jpg|webp|gif|bmp);base64,[A-Za-z0-9+/]+={0,2}$/;
const sImg = (v, maxBytes = LIMITS.imageBytes) =>
  (typeof v === 'string' && v.length <= maxBytes * 1.4 && DATA_IMG.test(v)) ? v : null;
const sRect = r => (r && typeof r === 'object') ? {
  x:Math.round(sNum(r.x, -1e6, 1e6)), y:Math.round(sNum(r.y, -1e6, 1e6)),
  w:Math.round(sNum(r.w, 0, 1e6)),    h:Math.round(sNum(r.h, 0, 1e6))
} : null;

/* ---------- imágenes ---------- */
function imgFromSrc(src){
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('No se pudo leer la imagen'));
    i.decoding = 'sync';
    i.src = src;
  });
}
const readAsDataURL = file => new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file);
});
const readAsArrayBuffer = file => new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsArrayBuffer(file);
});
/** Miniatura JPEG para listas, evidencias y guardado local. */
function makeThumb(img, maxW=220, quality=0.72){
  const sc = Math.min(1, maxW / img.naturalWidth);
  const c = el('canvas'); c.width = Math.max(1, Math.round(img.naturalWidth*sc)); c.height = Math.max(1, Math.round(img.naturalHeight*sc));
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0,0,c.width,c.height);
  x.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}
/** Re-codifica imágenes muy grandes para que las sesiones y reportes no pesen de más. */
function compactSrc(img, src, maxBytes=1_800_000, maxSide=2600){
  const approx = src.length * 0.75;
  if (approx <= maxBytes && Math.max(img.naturalWidth, img.naturalHeight) <= maxSide) return src;
  const sc = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const c = el('canvas'); c.width = Math.round(img.naturalWidth*sc); c.height = Math.round(img.naturalHeight*sc);
  const x = c.getContext('2d'); x.fillStyle='#fff'; x.fillRect(0,0,c.width,c.height); x.drawImage(img,0,0,c.width,c.height);
  return c.toDataURL('image/jpeg', 0.88);
}

/* ---------- color ---------- */
const toHex = (r,g,b) => '#' + [r,g,b].map(v => clamp(Math.round(v),0,255).toString(16).padStart(2,'0')).join('').toUpperCase();
function srgbToLab(r,g,b){
  const f = v => { v/=255; return v<=0.04045 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); };
  const [R,G,B] = [f(r),f(g),f(b)];
  let X = (R*0.4124+G*0.3576+B*0.1805)/0.95047,
      Y = (R*0.2126+G*0.7152+B*0.0722),
      Z = (R*0.0193+G*0.1192+B*0.9505)/1.08883;
  const k = t => t>0.008856 ? Math.cbrt(t) : (7.787*t + 16/116);
  [X,Y,Z] = [k(X),k(Y),k(Z)];
  return [116*Y-16, 500*(X-Y), 200*(Y-Z)];
}
/** ΔE CIE76 — suficiente y predecible para revisión visual de UI. */
function deltaE(c1, c2){
  const a = srgbToLab(...c1), b = srgbToLab(...c2);
  return Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]);
}

/* ---------- navegación ---------- */
function switchView(name){
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  if (name === 'comparar') cmpResize();
  if (name === 'reporte')  reportSyncForm();
}
function setTheme(t){
  S.ui.theme = t;
  document.documentElement.dataset.theme = t;
  if (typeof cmpDraw === 'function' && S.activePairId) cmpDraw();
  saveLocal();
}

/* ---------- KPIs ---------- */
function updateKpis(){
  const total = S.scenarios.length;
  const exec  = S.scenarios.filter(s => s.status && s.status !== 'Pendiente').length;
  const ok    = S.scenarios.filter(s => s.status === 'OK').length;
  const fail  = S.scenarios.filter(s => s.status === 'Falla').length;
  const open  = S.findings.filter(f => f.state === 'Abierto').length;
  $('#kpi-exec').textContent = exec + '/' + total;
  $('#kpi-ok').textContent   = ok;
  $('#kpi-fail').textContent = fail;
  $('#kpi-find').textContent = open;
  const pct = total ? Math.round(exec/total*100) : 0;
  const bar = $('#sc-progress'); if (bar){ bar.style.width = pct + '%'; $('#sc-progress-label').textContent = pct + '%'; }
}

/* ---------- serialización ---------- */
function serializeSources(list, withImages){
  return list.map(it => ({
    id:it.id, name:it.name, w:it.w, h:it.h, origin:it.origin, page:it.page||null,
    thumb:it.thumb, src: withImages ? it.src : null
  }));
}
function serialize(withImages=true){
  return {
    app:'qa-visual-check', version:VERSION, savedAt:new Date().toISOString(),
    meta:S.meta, ui:S.ui, counters:S.counters, activePairId:S.activePairId,
    design:serializeSources(S.design, withImages),
    web:serializeSources(S.web, withImages),
    pairs:S.pairs.map(p => ({ id:p.id, name:p.name, designId:p.designId, webId:p.webId,
      scale:p.scale, offx:p.offx, offy:p.offy, masks:p.masks,
      diff:p.diff ? { pct:p.diff.pct, count:p.diff.count, area:p.diff.area, regions:p.diff.regions, ts:p.diff.ts } : null,
      diffThumb: withImages ? (p.diffThumb || null) : null })),
    scenarios:S.scenarios,
    findings:S.findings.map(f => withImages ? f : { ...f, evidence:null })
  };
}
/** Reconstruye una sesión campo por campo: el objeto del archivo nunca se
    mezcla con el estado (evita marcado inyectado y contaminación de
    prototipos), y las imágenes solo se aceptan como data URL de mapa de bits. */
function sanitizeSession(data){
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.app !== 'qa-visual-check')
    throw new Error('El archivo no es una sesión de QA Visual Check.');
  const arr = (v, max) => Array.isArray(v) ? v.slice(0, max) : [];
  const m = data.meta && typeof data.meta === 'object' ? data.meta : {};
  const u = data.ui && typeof data.ui === 'object' ? data.ui : {};
  const c = data.counters && typeof data.counters === 'object' ? data.counters : {};
  const ids = new Set();
  const freshId = pre => { let v; do { v = uid(pre); } while (ids.has(v)); ids.add(v); return v; };
  const keepId = (v, pre) => { const k = sId(v); if (k && !ids.has(k)){ ids.add(k); return k; } return freshId(pre); };

  const out = {
    meta: {
      project:sStr(m.project, LIMITS.name), client:sStr(m.client, LIMITS.name),
      tester:sStr(m.tester, LIMITS.name), date:sStr(m.date, 40), url:sStr(m.url, 600),
      browser:sStr(m.browser, 200), viewport:sStr(m.viewport, 60),
      figma:sStr(m.figma, 600), notes:sStr(m.notes, LIMITS.longStr)
    },
    ui: {
      mode:sPick(u.mode, ['side','overlay','diff','curtain','blink'], 'side'),
      tool:sPick(u.tool, ['pan','measure','color','finding','mask'], 'pan'),
      theme:sPick(u.theme, ['dark','light'], 'dark'),
      threshold:Math.round(sNum(u.threshold, 0, 80, 12)),
      opacity:Math.round(sNum(u.opacity, 0, 100, 50)),
      liveDiff:sBool(u.liveDiff), curtain:sNum(u.curtain, 0, 1, 0.5),
      scPage:Math.round(sNum(u.scPage, 1, 9999, 1)), scPageSize:Math.round(sNum(u.scPageSize, 20, 1000, 200))
    },
    counters: { finding:Math.round(sNum(c.finding, 0, 1e6, 0)), pair:Math.round(sNum(c.pair, 0, 1e6, 0)) },
    design:[], web:[], pairs:[], scenarios:[], findings:[], activePairId:null
  };

  const idMap = new Map();
  for (const kind of ['design','web']){
    for (const it of arr(data[kind], LIMITS.sources)){
      if (!it || typeof it !== 'object') continue;
      const id = keepId(it.id, kind);
      if (it.id) idMap.set(String(it.id), id);
      out[kind].push({
        id, kind, name:sStr(it.name, LIMITS.name) || 'sin nombre',
        w:Math.round(sNum(it.w, 0, 1e6)), h:Math.round(sNum(it.h, 0, 1e6)),
        origin:sPick(it.origin, ['file','pdf','clipboard','capture'], 'file'),
        page:it.page === null || it.page === undefined ? null : Math.round(sNum(it.page, 0, 1e6)),
        thumb:sImg(it.thumb, 3e6), src:sImg(it.src)
      });
    }
  }
  const has = (kind, id) => out[kind].some(x => x.id === id);
  for (const p of arr(data.pairs, LIMITS.pairs)){
    if (!p || typeof p !== 'object') continue;
    const d = p.diff && typeof p.diff === 'object' ? p.diff : null;
    const dId = idMap.get(String(p.designId)) || null, wId = idMap.get(String(p.webId)) || null;
    out.pairs.push({
      id:keepId(p.id, 'pair'), name:sStr(p.name, LIMITS.name),
      designId: dId && has('design', dId) ? dId : null,
      webId:    wId && has('web', wId)    ? wId : null,
      scale:sNum(p.scale, 5, 400, 100), offx:Math.round(sNum(p.offx, -1e6, 1e6)), offy:Math.round(sNum(p.offy, -1e6, 1e6)),
      masks:arr(p.masks, LIMITS.masks).map(sRect).filter(Boolean),
      diff: d ? { pct:sNum(d.pct, 0, 100, 0), count:Math.round(sNum(d.count, 0, 1e12)),
                  area:Math.round(sNum(d.area, 0, 1e12)), regions:Math.round(sNum(d.regions, 0, 1e5)),
                  threshold:Math.round(sNum(d.threshold, 0, 80, 12)), boxes:[], ts:Math.round(sNum(d.ts, 0, 1e15)) } : null,
      diffThumb:sImg(p.diffThumb, 4e6), diffCanvas:null, _L:null
    });
  }
  for (const s of arr(data.scenarios, LIMITS.scenarios)){
    if (!s || typeof s !== 'object') continue;
    const extra = {};
    if (s.extra && typeof s.extra === 'object' && !Array.isArray(s.extra)){
      for (const [k, v] of Object.entries(s.extra).slice(0, LIMITS.extraCols)){
        const key = sStr(k, 120); if (key && key !== '__proto__') extra[key] = sStr(v, 1000);
      }
    }
    out.scenarios.push({
      id:keepId(s.id, 'sc'), code:sStr(s.code, 80), module:sStr(s.module, 160),
      name:sStr(s.name, 1200) || '(sin descripción)', steps:sStr(s.steps, LIMITS.str),
      expected:sStr(s.expected, LIMITS.str), priority:sStr(s.priority, 60), ref:sStr(s.ref, 200),
      status:sPick(s.status, STATUSES, 'Pendiente'), severity:sPick(s.severity, SEVERITIES, ''),
      note:sStr(s.note, LIMITS.str), evidence:sImg(s.evidence, 6e6), extra
    });
  }
  for (const f of arr(data.findings, LIMITS.findings)){
    if (!f || typeof f !== 'object') continue;
    const pid = idMap.get(String(f.pairId)) || null;
    out.findings.push({
      id:keepId(f.id, 'fd'), code:sStr(f.code, 40) || 'H-000', title:sStr(f.title, 600) || 'Hallazgo sin título',
      desc:sStr(f.desc, LIMITS.longStr), category:sPick(f.category, CATEGORIES, 'Otro'),
      severity:sPick(f.severity, ['Bloqueante','Alta','Media','Baja','Cosmético'], 'Media'),
      state:sPick(f.state, ['Abierto','Corregido','Descartado'], 'Abierto'),
      pairId: pid && out.pairs.some(p => p.id === pid) ? pid : null,
      pairName:sStr(f.pairName, LIMITS.name), rect:sRect(f.rect), evidence:sImg(f.evidence, 8e6),
      scenarioCode:sStr(f.scenarioCode, 80), createdAt:sStr(f.createdAt, 40)
    });
  }
  const act = idMap.get(String(data.activePairId));
  out.activePairId = act && out.pairs.some(p => p.id === act) ? act : (out.pairs[0]?.id || null);
  out.counters.finding = Math.max(out.counters.finding,
    ...out.findings.map(f => parseInt(String(f.code).replace(/\D/g, ''), 10) || 0), 0);
  return out;
}

async function deserialize(raw){
  const data = sanitizeSession(raw);
  S.design = []; S.web = []; S.pairs = []; S.scenarios = []; S.findings = [];
  Object.assign(S.meta, data.meta);
  Object.assign(S.ui, data.ui);
  Object.assign(S.counters, data.counters);
  for (const kind of ['design','web']){
    for (const it of data[kind]){
      const item = { ...it, img:null, missing:!it.src };
      if (it.src){ try { item.img = await imgFromSrc(it.src); } catch { item.missing = true; item.src = null; } }
      S[kind].push(item);
    }
  }
  S.pairs = data.pairs; S.scenarios = data.scenarios; S.findings = data.findings;
  S.activePairId = data.activePairId;
  applyStateToUI();
}

/** Refleja el estado en todos los controles y vistas. */
function applyStateToUI(){
  document.documentElement.dataset.theme = S.ui.theme || 'dark';
  $('#meta-project').value = S.meta.project || '';
  $('#cmp-threshold').value = S.ui.threshold; $('#val-threshold').textContent = S.ui.threshold;
  $('#cmp-opacity').value = S.ui.opacity;     $('#val-opacity').textContent = S.ui.opacity + '%';
  $('#chk-diff-live').checked = !!S.ui.liveDiff;
  $$('#cmp-modes button').forEach(b => b.classList.toggle('active', b.dataset.mode === S.ui.mode));
  $$('#cmp-tools button').forEach(b => b.classList.toggle('active', b.dataset.tool === S.ui.tool));
  renderSources(); renderPairs(); refreshPairSelect();
  renderScenarios(); renderFindings(); updateKpis(); reportSyncForm();
  cmpSetPair(S.activePairId, { keepView:false });
}

/* ---------- almacenamiento local ---------- */
const saveLocal = debounce(() => {
  const hint = $('#autosave-hint');
  try {
    // 1er intento: con miniaturas. Si no cabe, se guarda sin ellas.
    let payload = serialize(false);
    let str = JSON.stringify(payload);
    if (str.length > 4_200_000){
      payload.design.forEach(d => d.thumb = null); payload.web.forEach(d => d.thumb = null);
      payload.findings.forEach(f => f.evidence = null); payload.pairs.forEach(p => p.diffThumb = null);
      payload.scenarios.forEach(s => s.evidence = null);
      str = JSON.stringify(payload);
    }
    localStorage.setItem(LS_KEY, str);
    if (hint){ hint.textContent = 'Guardado local ' + new Date().toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'}); }
  } catch (e){
    if (hint) hint.textContent = 'Sin guardado local (usa «Guardar sesión»)';
  }
}, 700);

/** Borra por completo lo guardado en este navegador (útil en un equipo
    compartido o antes de prestar la sesión). */
let skipUnloadWarning = false;
function wipeLocalData(){
  if (!confirm('Se borrará la revisión guardada en ESTE navegador: escenarios, hallazgos, pares y ajustes.\n\n' +
               'Los archivos .json, los Excel y los reportes que ya descargaste no se tocan.\n\n¿Continuar?')) return;
  try { localStorage.removeItem(LS_KEY); } catch {}
  try { sessionStorage.clear(); } catch {}
  skipUnloadWarning = true;
  location.reload();
}

function readLocal(){
  try { const raw = localStorage.getItem(LS_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
