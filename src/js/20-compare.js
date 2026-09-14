/* =========================================================================
   COMPARADOR: lienzo, modos de vista, zoom/pan, medición y cuentagotas
   Sistema de coordenadas «espacio de diseño»: 1 unidad = 1 px del diseño.
   ========================================================================= */

const GAP = 40;                       // separación entre paneles en «lado a lado»
const MAX_LAYER_PX = 26e6;            // techo de píxeles por capa para no agotar memoria

const V = {
  zoom:1, panX:0, panY:0,
  dragging:false, dragMode:null, sx:0, sy:0, spanX:0, spanY:0,
  rect:null,                          // rectángulo en curso {x,y,w,h}
  measure:null,                       // última medición
  hover:null,                         // posición del cursor en espacio de diseño
  curtain:0.5, blinkShowWeb:false, blinkTimer:null,
  colorPick:null
};

let canvas, ctx;

/* ---------- utilidades de pares ---------- */
const getPair = id => S.pairs.find(p => p.id === (id ?? S.activePairId)) || null;
const pairDesign = p => p && S.design.find(x => x.id === p.designId) || null;
const pairWeb    = p => p && S.web.find(x => x.id === p.webId) || null;

function webRect(p){                                   // rect de la web en espacio de diseño
  const w = pairWeb(p); if (!w) return null;
  const s = (p.scale || 100) / 100;
  return { x:p.offx || 0, y:p.offy || 0, w:w.w * s, h:w.h * s };
}
function contentBounds(p){
  const d = pairDesign(p), wr = webRect(p);
  const boxes = [];
  if (d) boxes.push({ x:0, y:0, w:d.w, h:d.h });
  if (wr) boxes.push(S.ui.mode === 'side' ? { x:(d ? d.w + GAP : 0), y:0, w:wr.w, h:wr.h } : wr);
  if (!boxes.length) return { x:0, y:0, w:100, h:100 };
  const x0 = Math.min(...boxes.map(b=>b.x)), y0 = Math.min(...boxes.map(b=>b.y));
  const x1 = Math.max(...boxes.map(b=>b.x+b.w)), y1 = Math.max(...boxes.map(b=>b.y+b.h));
  return { x:x0, y:y0, w:x1-x0, h:y1-y0 };
}

/* ---------- inicialización ---------- */
function cmpInit(){
  canvas = $('#cmp-canvas'); ctx = canvas.getContext('2d');
  const stage = $('#cmp-stage');
  new ResizeObserver(() => cmpResize()).observe(stage);

  canvas.addEventListener('wheel', onWheel, { passive:false });
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointerleave', () => { V.hover = null; $('#cmp-eyedrop').hidden = true; cmpDraw(); });
  canvas.addEventListener('dblclick', () => { if (S.ui.tool === 'pan') cmpFit(); });
  cmpResize();
}

function cmpResize(){
  if (!canvas) return;
  const r = canvas.parentElement.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.round(r.width * dpr));
  canvas.height = Math.max(1, Math.round(r.height * dpr));
  canvas._dpr = dpr; canvas._cssW = r.width; canvas._cssH = r.height;
  // Al crear un par la vista puede estar oculta (tamaño 0): en ese caso el
  // encuadre se calcula cuando el lienzo ya tiene medidas reales.
  if (!V.fitted && r.width > 10 && getPair()) cmpFit();
  else cmpDraw();
}

function cmpSetPair(id, { keepView=true } = {}){
  S.activePairId = id || null;
  refreshPairSelect();
  const p = getPair();
  if (p){
    $('#cmp-scale').value = p.scale ?? 100; $('#val-scale').textContent = Math.round(p.scale ?? 100) + '%';
    $('#cmp-offx').value = p.offx || 0; $('#cmp-offy').value = p.offy || 0;
    renderMasks(); renderDiffStats(p);
  }
  if (!keepView){ V.fitted = false; cmpFit(); } else cmpDraw();
}

/* ---------- transformaciones ---------- */
const toScreen = (x, y) => ({ x: x * V.zoom + V.panX, y: y * V.zoom + V.panY });
const toDesign = (sx, sy) => ({ x: (sx - V.panX) / V.zoom, y: (sy - V.panY) / V.zoom });
function canvasPt(e){
  const r = canvas.getBoundingClientRect();
  return { x:e.clientX - r.left, y:e.clientY - r.top };
}

function cmpFit(){
  const p = getPair(); if (!p) { cmpDraw(); return; }
  const b = contentBounds(p);
  const pad = 28;
  if (canvas._cssW > 10) V.fitted = true;
  const zw = (canvas._cssW - pad*2) / b.w, zh = (canvas._cssH - pad*2) / b.h;
  V.zoom = clamp(Math.min(zw, zh), 0.02, 8);
  V.panX = (canvas._cssW - b.w * V.zoom)/2 - b.x * V.zoom;
  V.panY = (canvas._cssH - b.h * V.zoom)/2 - b.y * V.zoom;
  cmpDraw();
}
function cmpZoomAt(factor, cx, cy){
  const before = toDesign(cx, cy);
  V.zoom = clamp(V.zoom * factor, 0.02, 32);
  const after = toDesign(cx, cy);
  V.panX += (after.x - before.x) * V.zoom;
  V.panY += (after.y - before.y) * V.zoom;
  cmpDraw();
}
function cmpZoom100(){
  const cx = canvas._cssW/2, cy = canvas._cssH/2;
  cmpZoomAt(1/V.zoom, cx, cy);
}

/* ---------- dibujo ---------- */
function cmpDraw(){
  if (!ctx) return;
  const dpr = canvas._dpr || 1;
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,canvas.width,canvas.height);

  const p = getPair();
  const d = pairDesign(p), w = pairWeb(p);
  const ready = p && ((d && d.img) || (w && w.img));
  $('#stage-empty').hidden = !!ready;
  $('#stage-empty').innerHTML = !p
      ? '<p>Selecciona un par en <b>Fuentes</b> para empezar a comparar.</p>'
      : (!d?.img || !w?.img) ? '<p>Este par necesita un diseño y una captura asignados.</p>' : '';
  if (!ready){ $('#cmp-hud').innerHTML = ''; return; }

  ctx.scale(dpr, dpr);
  ctx.imageSmoothingEnabled = V.zoom < 1.4;
  ctx.imageSmoothingQuality = 'high';

  const mode = S.ui.mode;
  const wr = webRect(p);
  const opacity = (S.ui.opacity ?? 50) / 100;

  ctx.save();
  ctx.translate(V.panX, V.panY);
  ctx.scale(V.zoom, V.zoom);

  const drawDesign = (alpha=1) => { if (!d?.img) return; ctx.globalAlpha = alpha; paper(0,0,d.w,d.h); ctx.drawImage(d.img, 0, 0, d.w, d.h); ctx.globalAlpha = 1; };
  const drawWeb = (alpha=1, dx=0) => { if (!w?.img || !wr) return; ctx.globalAlpha = alpha; paper(wr.x+dx, wr.y, wr.w, wr.h); ctx.drawImage(w.img, wr.x+dx, wr.y, wr.w, wr.h); ctx.globalAlpha = 1; };
  function paper(x,y,ww,hh){ ctx.fillStyle = '#ffffff'; ctx.fillRect(x,y,ww,hh); }

  if (mode === 'side'){
    drawDesign();
    const dx = (d ? d.w + GAP : 0);
    drawWeb(1, dx);
    frame(0,0,d?.w||0,d?.h||0, cssVar('--design'));
    if (wr) frame(wr.x+dx, wr.y, wr.w, wr.h, cssVar('--web'));
  } else if (mode === 'overlay'){
    drawDesign();
    drawWeb(opacity);
    frame(0,0,d?.w||0,d?.h||0, cssVar('--design'));
    if (wr) frame(wr.x, wr.y, wr.w, wr.h, cssVar('--web'));
  } else if (mode === 'diff'){
    if (p.diffCanvas){
      const L = p._L;
      ctx.drawImage(p.diffCanvas, 0, 0, p.diffCanvas.width / L.s, p.diffCanvas.height / L.s);
    } else {
      drawDesign(); drawWeb(opacity);
      ctx.globalAlpha = 1;
    }
    frame(0,0,d?.w||0,d?.h||0, cssVar('--line-2'));
  } else if (mode === 'curtain'){
    drawDesign();
    const b = contentBounds(p);
    const splitX = b.x + b.w * V.curtain;
    ctx.save();
    ctx.beginPath(); ctx.rect(splitX, b.y - 10, b.x + b.w - splitX + 10, b.h + 20); ctx.clip();
    drawWeb(1);
    ctx.restore();
    ctx.strokeStyle = cssVar('--ac'); ctx.lineWidth = 1.5 / V.zoom;
    ctx.beginPath(); ctx.moveTo(splitX, b.y - 8); ctx.lineTo(splitX, b.y + b.h + 8); ctx.stroke();
  } else if (mode === 'blink'){
    if (V.blinkShowWeb) drawWeb(1); else drawDesign();
  }

  // Zonas ignoradas
  if (p.masks?.length && mode !== 'side'){
    p.masks.forEach((m, i) => {
      ctx.save();
      ctx.fillStyle = 'rgba(255,93,108,.14)';
      ctx.strokeStyle = 'rgba(255,93,108,.85)';
      ctx.lineWidth = 1 / V.zoom; ctx.setLineDash([6/V.zoom, 4/V.zoom]);
      ctx.fillRect(m.x, m.y, m.w, m.h); ctx.strokeRect(m.x, m.y, m.w, m.h);
      ctx.restore();
      label(m.x + 3/V.zoom, m.y + 3/V.zoom, 'ignorada ' + (i+1), 'rgba(255,93,108,.95)');
    });
  }

  // Zonas de diferencia resaltadas
  if (mode === 'diff' && p.diff?.boxes?.length){
    ctx.save();
    ctx.strokeStyle = cssVar('--ac'); ctx.lineWidth = 1.4 / V.zoom;
    p.diff.boxes.forEach((b, i) => {
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      label(b.x, Math.max(0, b.y - 14/V.zoom), String(i+1), cssVar('--ac'));
    });
    ctx.restore();
  }

  // Rectángulo en curso / última medición
  if (V.rect) drawRect(V.rect, S.ui.tool === 'mask' ? cssVar('--fail') : cssVar('--ac'), true);
  if (V.measure && S.ui.tool === 'measure') drawRect(V.measure, cssVar('--warn'), true);
  if (V.colorPick){
    const c = V.colorPick;
    ctx.save(); ctx.strokeStyle = cssVar('--ac'); ctx.lineWidth = 1/V.zoom;
    ctx.beginPath(); ctx.arc(c.x, c.y, 5/V.zoom, 0, Math.PI*2); ctx.stroke(); ctx.restore();
  }

  ctx.restore();
  drawHud(p, d, w, wr);

  function frame(x,y,ww,hh,color){
    if (!ww || !hh) return;
    ctx.save(); ctx.strokeStyle = color; ctx.globalAlpha = .55; ctx.lineWidth = 1/V.zoom;
    ctx.strokeRect(x, y, ww, hh); ctx.restore();
  }
  function label(x, y, text, color){
    ctx.save();
    const fs = 11 / V.zoom;
    ctx.font = `600 ${fs}px ${getComputedStyle(document.body).fontFamily}`;
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(0,0,0,.68)'; ctx.fillRect(x, y, tw + 8/V.zoom, fs + 6/V.zoom);
    ctx.fillStyle = color; ctx.fillText(text, x + 4/V.zoom, y + fs + 1/V.zoom);
    ctx.restore();
  }
  function drawRect(r, color, withDims){
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = 1.4/V.zoom;
    ctx.fillStyle = color.replace('rgb','rgba').includes('rgba') ? color : color;
    ctx.globalAlpha = .12; ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.globalAlpha = 1; ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.restore();
    if (withDims) label(r.x, Math.max(0, r.y - 15/V.zoom), `${Math.round(Math.abs(r.w))} × ${Math.round(Math.abs(r.h))} px`, color);
  }
}
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#4c8dff';

function drawHud(p, d, w, wr){
  const bits = [];
  bits.push(`zoom ${Math.round(V.zoom*100)}%`);
  if (d) bits.push(`diseño ${d.w}×${d.h}`);
  if (w) bits.push(`web ${w.w}×${w.h}${(p.scale||100) !== 100 ? ` → ${Math.round(wr.w)}×${Math.round(wr.h)}` : ''}`);
  if (V.hover) bits.push(`x ${Math.round(V.hover.x)} · y ${Math.round(V.hover.y)}`);
  if (S.ui.mode === 'blink') bits.push(V.blinkShowWeb ? 'mostrando WEB' : 'mostrando DISEÑO');
  if (S.ui.mode === 'curtain') bits.push('mueve el cursor para correr la cortina');
  $('#val-zoom').textContent = Math.round(V.zoom*100) + '%';
  $('#cmp-hud').innerHTML = bits.map(b => `<span>${esc(b)}</span>`).join('');
}

/* ---------- interacción ---------- */
function onWheel(e){
  e.preventDefault();
  const pt = canvasPt(e);
  if (e.ctrlKey || e.metaKey || !e.shiftKey){
    const f = Math.pow(0.999, e.deltaY * (e.deltaMode === 1 ? 18 : 1));
    cmpZoomAt(f, pt.x, pt.y);
  } else {
    V.panX -= e.deltaX; V.panY -= e.deltaY; cmpDraw();
  }
}
function onPointerDown(e){
  if (e.button !== 0) return;
  canvas.setPointerCapture(e.pointerId);
  const pt = canvasPt(e), dp = toDesign(pt.x, pt.y);
  V.sx = pt.x; V.sy = pt.y; V.spanX = V.panX; V.spanY = V.panY;
  V.dragging = true;
  const tool = S.ui.tool;
  if (tool === 'pan'){ V.dragMode = 'pan'; canvas.classList.add('dragging'); }
  else if (tool === 'color'){ V.dragMode = 'color'; pickColor(dp, pt, true); }
  else { V.dragMode = 'rect'; V.rect = { x:dp.x, y:dp.y, w:0, h:0 }; }
}
function onPointerMove(e){
  const pt = canvasPt(e), dp = toDesign(pt.x, pt.y);
  V.hover = dp;

  if (!V.dragging){
    if (S.ui.mode === 'curtain' && S.ui.tool === 'pan'){
      const b = contentBounds(getPair());
      V.curtain = clamp((dp.x - b.x) / b.w, 0, 1);
      cmpDraw(); return;
    }
    if (S.ui.tool === 'color'){ pickColor(dp, pt, false); return; }
    cmpDraw(); return;
  }

  if (V.dragMode === 'pan'){
    V.panX = V.spanX + (pt.x - V.sx); V.panY = V.spanY + (pt.y - V.sy); cmpDraw();
  } else if (V.dragMode === 'rect'){
    const a = toDesign(V.sx, V.sy);
    V.rect = { x:Math.min(a.x, dp.x), y:Math.min(a.y, dp.y), w:Math.abs(dp.x - a.x), h:Math.abs(dp.y - a.y) };
    cmpDraw();
  } else if (V.dragMode === 'color'){
    pickColor(dp, pt, true);
  }
}
async function onPointerUp(e){
  if (!V.dragging) return;
  V.dragging = false; canvas.classList.remove('dragging');
  const mode = V.dragMode; V.dragMode = null;
  const p = getPair();
  if (mode !== 'rect' || !V.rect || !p){ cmpDraw(); return; }

  const r = { x:Math.max(0, Math.round(V.rect.x)), y:Math.max(0, Math.round(V.rect.y)),
              w:Math.round(V.rect.w), h:Math.round(V.rect.h) };
  V.rect = null;
  if (r.w < 3 || r.h < 3){ cmpDraw(); return; }

  if (S.ui.tool === 'measure'){
    V.measure = r; renderMeasure(r, p); cmpDraw();
  } else if (S.ui.tool === 'mask'){
    p.masks.push(r); renderMasks(); saveLocal();
    if (p.diff) await runDiff(p);
    cmpDraw();
    toast('Zona ignorada', 'Se excluye del cálculo de diferencia.', 'ok', 2200);
  } else if (S.ui.tool === 'finding'){
    cmpDraw();
    openFindingDialog({ pair:p, rect:r });
  }
}

/* ---------- medición ---------- */
function renderMeasure(r, p){
  const ul = $('#measure-readout'); ul.innerHTML = '';
  const wr = webRect(p); const s = (p.scale || 100)/100;
  const rows = [
    ['Zona medida', `${r.w} × ${r.h} px`],
    ['Posición (diseño)', `x ${r.x} · y ${r.y}`],
  ];
  if (wr) rows.push(['Equivale en la web', `${Math.round(r.w/s)} × ${Math.round(r.h/s)} px`]);
  rows.forEach(([k, v]) => ul.append(el('li', {}, el('span', {}, k), el('b', {}, v))));
  ul.append(el('li', { style:'background:transparent;padding:6px 0' },
    el('button', { class:'btn xs ghost', onclick:()=>{ openFindingDialog({ pair:p, rect:r,
      prefill:{ title:`Diferencia de tamaño/espaciado (${r.w}×${r.h} px)`, category:'Espaciado' } }); } }, 'Crear hallazgo con esta zona')));
}

/* ---------- cuentagotas ---------- */
function pickColor(dp, screenPt, freeze){
  const p = getPair(); if (!p) return;
  const L = p._L && p._L.ok ? p._L : buildLayers(p);
  if (!L || !L.ok) return;
  const x = Math.floor(dp.x * L.s), y = Math.floor(dp.y * L.s);
  const box = $('#cmp-eyedrop');
  if (x < 0 || y < 0 || x >= L.w || y >= L.h){ box.hidden = true; return; }
  const i = (y * L.w + x) * 4;
  const dC = [L.dData.data[i], L.dData.data[i+1], L.dData.data[i+2]];
  const wC = [L.wData.data[i], L.wData.data[i+1], L.wData.data[i+2]];
  const wA = L.wData.data[i+3];
  const de = wA < 8 ? null : deltaE(dC, wC);
  const hexD = toHex(...dC), hexW = toHex(...wC);
  box.hidden = false;
  box.style.left = clamp(screenPt.x + 16, 4, canvas._cssW - 210) + 'px';
  box.style.top  = clamp(screenPt.y + 16, 4, canvas._cssH - 96) + 'px';
  box.innerHTML =
    `<div><span class="sw" style="background:${hexD}"></span>diseño <b>${hexD}</b></div>` +
    `<div><span class="sw" style="background:${hexW}"></span>web &nbsp;&nbsp;<b>${hexW}</b></div>` +
    (de === null ? '<div class="de">sin píxel de web aquí</div>'
                 : `<div class="de">ΔE ${de.toFixed(1)} · ${de < 1 ? 'idéntico' : de < 3 ? 'diferencia mínima' : de < 6 ? 'diferencia visible' : 'color distinto'}</div>`);
  if (freeze){
    V.colorPick = { x:dp.x, y:dp.y, hexD, hexW, de };
    const ul = $('#measure-readout'); ul.innerHTML = '';
    ul.append(el('li', {}, el('span', {}, 'Color diseño'), el('b', {}, hexD)));
    ul.append(el('li', {}, el('span', {}, 'Color web'), el('b', {}, hexW)));
    ul.append(el('li', {}, el('span', {}, 'ΔE'), el('b', {}, de === null ? '—' : de.toFixed(1))));
    ul.append(el('li', { style:'background:transparent;padding:6px 0' },
      el('button', { class:'btn xs ghost', onclick:()=>openFindingDialog({ pair:p,
        rect:{ x:Math.round(dp.x)-24, y:Math.round(dp.y)-24, w:48, h:48 },
        prefill:{ title:`Color distinto: diseño ${hexD} vs web ${hexW}`, category:'Color',
                  desc:`Diseño: ${hexD}\nWeb: ${hexW}\nΔE: ${de === null ? '—' : de.toFixed(1)}` } }) }, 'Crear hallazgo de color')));
    cmpDraw();
  }
}

/* ---------- zonas ignoradas ---------- */
function renderMasks(){
  const p = getPair(); const ul = $('#mask-list'); ul.innerHTML = '';
  if (!p || !p.masks?.length){
    ul.append(el('li', { class:'muted' }, 'Ninguna. Usa la herramienta ⊘ para excluir zonas.')); return;
  }
  p.masks.forEach((m, i) => ul.append(el('li', {},
    el('span', { class:'rg-n' }, String(i+1)),
    el('span', { class:'rg-dim' }, `${m.w}×${m.h} @ ${m.x},${m.y}`),
    el('button', { class:'btn xs danger', title:'Quitar',
      onclick:async ()=>{ p.masks.splice(i,1); renderMasks(); if (p.diff) await runDiff(p); cmpDraw(); saveLocal(); } }, '✕'))));
}

/* ---------- controles de la barra ---------- */
function cmpBindToolbar(){
  $('#cmp-pair').addEventListener('change', e => cmpSetPair(e.target.value, { keepView:false }));

  $$('#cmp-modes button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $$('#cmp-tools button').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));

  $('#cmp-opacity').addEventListener('input', e => {
    S.ui.opacity = +e.target.value; $('#val-opacity').textContent = S.ui.opacity + '%'; cmpDraw(); saveLocal();
  });
  $('#cmp-threshold').addEventListener('input', e => {
    S.ui.threshold = +e.target.value; $('#val-threshold').textContent = S.ui.threshold;
  });
  $('#cmp-threshold').addEventListener('change', async () => { const p = getPair(); if (p && p.diff) await runDiff(p); saveLocal(); });

  $('#cmp-scale').addEventListener('input', e => setAlign({ scale:+e.target.value }));
  $('#cmp-offx').addEventListener('input', e => setAlign({ offx:+e.target.value || 0 }));
  $('#cmp-offy').addEventListener('input', e => setAlign({ offy:+e.target.value || 0 }));
  $('#btn-fitwidth').addEventListener('click', () => {
    const p = getPair(), d = pairDesign(p), w = pairWeb(p);
    if (!d || !w) return;
    setAlign({ scale: +(d.w / w.w * 100).toFixed(2), offx:0, offy:0 });
    toast('Ancho igualado', `Escala de la web al ${(d.w / w.w * 100).toFixed(1)}%.`, 'ok', 2400);
  });
  $('#btn-resetalign').addEventListener('click', () => setAlign({ scale:100, offx:0, offy:0 }));
  $('#btn-autoalign').addEventListener('click', autoAlign);

  $('#btn-zoom-in').addEventListener('click', () => cmpZoomAt(1.25, canvas._cssW/2, canvas._cssH/2));
  $('#btn-zoom-out').addEventListener('click', () => cmpZoomAt(0.8, canvas._cssW/2, canvas._cssH/2));
  $('#btn-zoom-fit').addEventListener('click', cmpFit);
  $('#btn-zoom-100').addEventListener('click', cmpZoom100);

  $('#btn-diff-run').addEventListener('click', async () => { const p = getPair(); if (p) await runDiff(p, { focus:true }); });
  $('#chk-diff-live').addEventListener('change', e => { S.ui.liveDiff = e.target.checked; saveLocal(); });
}

function setMode(mode){
  S.ui.mode = mode;
  $$('#cmp-modes button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  $('#fld-opacity').hidden = !(mode === 'overlay' || mode === 'diff');
  $('#fld-threshold').hidden = mode !== 'diff';
  clearInterval(V.blinkTimer); V.blinkTimer = null;
  if (mode === 'blink'){
    V.blinkTimer = setInterval(() => { V.blinkShowWeb = !V.blinkShowWeb; cmpDraw(); }, 620);
  }
  const p = getPair();
  if (mode === 'diff' && p && !p.diffCanvas) runDiff(p);
  cmpDraw(); saveLocal();
}
function setTool(tool){
  S.ui.tool = tool;
  $$('#cmp-tools button').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
  canvas.className = 'tool-' + tool;
  if (tool !== 'color'){ $('#cmp-eyedrop').hidden = true; V.colorPick = null; }
  cmpDraw();
}
function setAlign(patch){
  const p = getPair(); if (!p) return;
  Object.assign(p, patch);
  p.scale = clamp(p.scale, 5, 400);
  $('#cmp-scale').value = p.scale; $('#val-scale').textContent = (Math.round(p.scale*10)/10) + '%';
  $('#cmp-offx').value = p.offx || 0; $('#cmp-offy').value = p.offy || 0;
  p._L = null; p.diffCanvas = null;
  cmpDraw();
  if (S.ui.liveDiff) scheduleLiveDiff();
  saveLocalSoon();
}
const saveLocalSoon = debounce(() => saveLocal(), 500);
const scheduleLiveDiff = debounce(() => { const p = getPair(); if (p) runDiff(p); }, 320);

/* ---------- atajos de teclado ---------- */
function cmpBindKeys(){
  document.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (['input','textarea','select'].includes(tag) || e.target.isContentEditable) return;
    if (e.key === '?' || (e.key === '/' && e.shiftKey)){ showHelp(); return; }
    if (!$('#view-comparar').classList.contains('active')) return;
    const p = getPair();
    const step = e.shiftKey ? 10 : 1;
    switch (e.key){
      case '1': setMode('side'); break;
      case '2': setMode('overlay'); break;
      case '3': setMode('diff'); break;
      case '4': setMode('curtain'); break;
      case '5': setMode('blink'); break;
      case 'v': case 'V': setTool('pan'); break;
      case 'm': case 'M': setTool('measure'); break;
      case 'c': case 'C': setTool('color'); break;
      case 'r': case 'R': setTool('finding'); break;
      case 'x': case 'X': setTool('mask'); break;
      case 'z': case 'Z': cmpZoom100(); break;
      case '0': cmpFit(); break;
      case '+': case '=': cmpZoomAt(1.25, canvas._cssW/2, canvas._cssH/2); break;
      case '-': cmpZoomAt(0.8, canvas._cssW/2, canvas._cssH/2); break;
      case 'd': case 'D': if (p) runDiff(p, { focus:true }); break;
      case '[': S.ui.opacity = clamp(S.ui.opacity - 5, 0, 100); $('#cmp-opacity').value = S.ui.opacity; $('#val-opacity').textContent = S.ui.opacity+'%'; cmpDraw(); break;
      case ']': S.ui.opacity = clamp(S.ui.opacity + 5, 0, 100); $('#cmp-opacity').value = S.ui.opacity; $('#val-opacity').textContent = S.ui.opacity+'%'; cmpDraw(); break;
      case 'ArrowLeft':  if (p){ setAlign({ offx:(p.offx||0) - step }); e.preventDefault(); } break;
      case 'ArrowRight': if (p){ setAlign({ offx:(p.offx||0) + step }); e.preventDefault(); } break;
      case 'ArrowUp':    if (p){ setAlign({ offy:(p.offy||0) - step }); e.preventDefault(); } break;
      case 'ArrowDown':  if (p){ setAlign({ offy:(p.offy||0) + step }); e.preventDefault(); } break;
      default: return;
    }
  });
}

/* ---------- ayuda ---------- */
function showHelp(){
  const rows = (title, items) => el('div', {}, el('h3', {}, title),
    el('ul', {}, items.map(([k,v]) => el('li', {}, el('span', {}, v), el('kbd', {}, k)))));
  openModal({ title:'Atajos y cómo usar la herramienta', wide:true,
    foot:[{ label:'Borrar datos de este navegador', cls:'danger', onClick:wipeLocalData },
          { label:'Entendido', cls:'primary' }],
    body: el('div', {},
      el('div', { class:'help-grid' },
        rows('Modos de vista', [['1','Lado a lado'],['2','Overlay con opacidad'],['3','Diferencia de píxeles'],['4','Cortina'],['5','Parpadeo diseño/web']]),
        rows('Herramientas', [['V','Mover y hacer zoom'],['M','Medir una zona'],['C','Cuentagotas de color'],['R','Marcar un hallazgo'],['X','Ignorar zona dinámica']]),
        rows('Alineación', [['← → ↑ ↓','Mover la capa web 1 px'],['⇧ + flechas','Mover 10 px'],['[ ]','Opacidad de la web'],['D','Recalcular la diferencia']]),
        rows('Vista', [['0','Ajustar a pantalla'],['Z','Tamaño real 1:1'],['+ / −','Zoom'],['Rueda','Zoom en el cursor'],['⇧ + rueda','Desplazar']])),
      el('hr', { style:'border:0;border-top:1px solid var(--line);margin:16px 0' }),
      el('div', { class:'help-grid' },
        el('div', {}, el('h3', {}, 'Flujo recomendado'), el('ol', { style:'margin:0;padding-left:18px;color:var(--tx-2);line-height:1.7' },
          el('li', {}, 'Carga los frames de Figma (PNG o el PDF de la suite) y las capturas de la web.'),
          el('li', {}, 'Revisa los pares y usa «Ajustar ancho» + «Auto-alinear».'),
          el('li', {}, 'Recorre los modos: overlay para posición, diferencia para lo que se movió, cuentagotas para color.'),
          el('li', {}, 'Marca hallazgos con R sobre la zona afectada.'),
          el('li', {}, 'Importa tu Excel de escenarios y marca Estado y Observación.'),
          el('li', {}, 'En «Reporte» descarga el HTML e imprímelo a PDF si lo necesitas.'))),
        el('div', {}, el('h3', {}, 'Buenas prácticas'), el('ul', { style:'margin:0;padding-left:18px;color:var(--tx-2);line-height:1.7' },
          el('li', {}, 'Captura la web al mismo ancho del frame de Figma (DevTools → tamaño responsive).'),
          el('li', {}, 'Con pantallas Retina, exporta el diseño a 1× o iguala la escala con «Ajustar ancho».'),
          el('li', {}, 'Ignora con ⊘ las zonas dinámicas: fechas, banners rotativos, datos de sesión.'),
          el('li', {}, 'Todo queda en tu navegador: la página no puede hacer peticiones de red.'),
          el('li', {}, 'En un equipo compartido, usa «Borrar datos de este navegador» al terminar.')))))
  });
}
