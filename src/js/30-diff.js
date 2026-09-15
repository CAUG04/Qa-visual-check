/* =========================================================================
   MOTOR DE DIFERENCIAS: capas rasterizadas, diff de píxeles, zonas y
   alineación automática.
   ========================================================================= */

/** Rasteriza diseño y web en un mismo lienzo (espacio de diseño, escala L.s). */
function buildLayers(p){
  const d = pairDesign(p), w = pairWeb(p);
  if (!d?.img || !w?.img){ p._L = { ok:false }; return p._L; }
  const area = d.w * d.h;
  const s = Math.min(1, Math.sqrt(MAX_LAYER_PX / area));
  const W = Math.max(1, Math.round(d.w * s)), H = Math.max(1, Math.round(d.h * s));

  const dcan = el('canvas'); dcan.width = W; dcan.height = H;
  const dctx = dcan.getContext('2d', { willReadFrequently:true });
  dctx.fillStyle = '#ffffff'; dctx.fillRect(0,0,W,H);
  dctx.imageSmoothingQuality = 'high';
  dctx.drawImage(d.img, 0, 0, W, H);

  const wcan = el('canvas'); wcan.width = W; wcan.height = H;
  const wctx = wcan.getContext('2d', { willReadFrequently:true });
  wctx.imageSmoothingQuality = 'high';
  const wr = webRect(p);
  wctx.drawImage(w.img, wr.x * s, wr.y * s, wr.w * s, wr.h * s);

  p._L = { ok:true, w:W, h:H, s, dcan, wcan,
           dData:dctx.getImageData(0,0,W,H), wData:wctx.getImageData(0,0,W,H) };
  return p._L;
}

/** Calcula la diferencia de píxeles del par y arma la imagen de diferencia. */
async function runDiff(p, { focus=false } = {}){
  if (!p) return null;
  const d = pairDesign(p), w = pairWeb(p);
  if (!d?.img || !w?.img){ toast('Par incompleto', 'Asigna un diseño y una captura.', 'warn'); return null; }

  const heavy = d.w * d.h > 2.4e6;
  let t = heavy ? toastHtml('Calculando diferencia', '<span class="spinner"></span> un momento…', '', 30000) : null;
  if (heavy) await new Promise(r => setTimeout(r, 30));

  const L = (p._L && p._L.ok) ? p._L : buildLayers(p);
  if (!L.ok){ t?.remove(); return null; }

  const { w:W, h:H, s } = L;
  const D = L.dData.data, Wd = L.wData.data;
  const thr = S.ui.threshold;
  const out = new ImageData(W, H);
  const O = out.data;

  // Máscaras en coordenadas de capa
  const masks = (p.masks || []).map(m => ({
    x0:Math.floor(m.x*s), y0:Math.floor(m.y*s), x1:Math.ceil((m.x+m.w)*s), y1:Math.ceil((m.y+m.h)*s)
  }));
  const isMasked = (x,y) => masks.some(m => x>=m.x0 && x<m.x1 && y>=m.y0 && y<m.y1);

  const CELL = Math.max(6, Math.round(14 * s));
  const gw = Math.ceil(W / CELL), gh = Math.ceil(H / CELL);
  const cells = new Uint32Array(gw * gh);

  let diffCount = 0, compared = 0, uncovered = 0, masked = 0;

  for (let y = 0; y < H; y++){
    for (let x = 0; x < W; x++){
      const i = (y * W + x) * 4;
      const wa = Wd[i+3];
      let r = D[i], g = D[i+1], b = D[i+2];
      // base: diseño atenuado para dar contexto
      const base = 236 - (255 - (r*0.299 + g*0.587 + b*0.114)) * 0.16;
      if (wa < 8){                                  // la web no cubre este píxel
        uncovered++;
        O[i] = 214; O[i+1] = 219; O[i+2] = 228; O[i+3] = 255;
        continue;
      }
      if (masks.length && isMasked(x,y)){
        masked++;
        O[i] = 196; O[i+1] = 214; O[i+2] = 240; O[i+3] = 255;
        continue;
      }
      compared++;
      const dr = Math.abs(r - Wd[i]), dg = Math.abs(g - Wd[i+1]), db = Math.abs(b - Wd[i+2]);
      const delta = Math.max(dr, dg, db);
      if (delta > thr){
        diffCount++;
        const k = clamp((delta - thr) / (90), 0, 1);
        O[i]   = 255;
        O[i+1] = Math.round(90 - 70 * k);
        O[i+2] = Math.round(150 - 90 * k);
        O[i+3] = 255;
        cells[(y / CELL | 0) * gw + (x / CELL | 0)]++;
      } else {
        O[i] = O[i+1] = O[i+2] = Math.round(base); O[i+3] = 255;
      }
    }
  }

  const dc = el('canvas'); dc.width = W; dc.height = H;
  dc.getContext('2d').putImageData(out, 0, 0);
  p.diffCanvas = dc;
  p.diffThumb = thumbOf(dc, 560);

  const boxes = cellsToBoxes(cells, gw, gh, CELL, s, Math.max(2, Math.round(CELL*CELL*0.02)));
  p.diff = {
    pct: compared ? diffCount / compared * 100 : 0,
    count: Math.round(diffCount / (s*s)),
    area: Math.round(compared / (s*s)),
    uncovered: Math.round(uncovered / (s*s)),
    masked: Math.round(masked / (s*s)),
    regions: boxes.length, boxes, threshold: thr, ts: Date.now()
  };
  t?.remove();
  renderDiffStats(p); renderRegions(p); renderPairs(); cmpDraw(); saveLocal();
  autoReviewScenariosForPair(p);
  if (focus && S.ui.mode !== 'diff') setMode('diff');
  return p.diff;
}

function thumbOf(canvas, maxW){
  const sc = Math.min(1, maxW / canvas.width);
  const c = el('canvas'); c.width = Math.round(canvas.width*sc); c.height = Math.round(canvas.height*sc);
  const x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
  x.fillStyle = '#fff'; x.fillRect(0,0,c.width,c.height);
  x.drawImage(canvas, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.78);
}

/** Agrupa celdas con diferencia en rectángulos (componentes conexas). */
function cellsToBoxes(cells, gw, gh, CELL, s, minHits){
  const seen = new Uint8Array(gw*gh);
  const boxes = [];
  const idx = (x,y) => y*gw + x;
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++){
    const i = idx(x,y);
    if (seen[i] || cells[i] < minHits) continue;
    let x0=x, y0=y, x1=x, y1=y, hits=0;
    const stack = [[x,y]]; seen[i] = 1;
    while (stack.length){
      const [cx, cy] = stack.pop();
      hits += cells[idx(cx,cy)];
      if (cx < x0) x0 = cx; if (cx > x1) x1 = cx;
      if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++){
        const nx = cx+dx, ny = cy+dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const ni = idx(nx,ny);
        if (!seen[ni] && cells[ni] >= minHits){ seen[ni] = 1; stack.push([nx,ny]); }
      }
    }
    boxes.push({
      x: Math.round(x0*CELL/s), y: Math.round(y0*CELL/s),
      w: Math.round((x1-x0+1)*CELL/s), h: Math.round((y1-y0+1)*CELL/s), hits
    });
  }
  boxes.sort((a,b) => b.hits - a.hits);
  return boxes.slice(0, 40);
}

/* ---------- panel de resultados ---------- */
function renderDiffStats(p){
  const d = p?.diff;
  const pctEl = $('#diff-pct'), bar = $('#diff-bar');
  if (!d){
    pctEl.textContent = '—'; pctEl.style.color = '';
    bar.style.width = '0%';
    $('#diff-count').textContent = '—'; $('#diff-area').textContent = '—'; $('#diff-regions').textContent = '—';
    return;
  }
  pctEl.textContent = fmtPct(d.pct);
  pctEl.style.color = d.pct < 0.5 ? 'var(--ok)' : d.pct < 3 ? 'var(--warn)' : 'var(--fail)';
  bar.style.width = clamp(d.pct * 8, d.pct > 0 ? 2 : 0, 100) + '%';
  $('#diff-count').textContent = fmtInt(d.count) + ' px';
  $('#diff-area').textContent = fmtInt(d.area) + ' px';
  $('#diff-regions').textContent = String(d.regions);
}

function renderRegions(p){
  const ul = $('#region-list'); ul.innerHTML = '';
  const boxes = p?.diff?.boxes || [];
  $('#regions-hint').textContent = boxes.length ? `(${boxes.length})` : '';
  if (!boxes.length){
    ul.append(el('li', { class:'muted' }, p?.diff ? 'Sin zonas por encima de la tolerancia.' : 'Sin cálculo todavía.'));
    return;
  }
  boxes.forEach((b, i) => ul.append(el('li', {},
    el('span', { class:'rg-n' }, String(i+1)),
    el('span', { class:'rg-dim' }, `${b.w}×${b.h} @ ${b.x},${b.y}`),
    el('button', { class:'btn xs ghost', title:'Ir a la zona', onclick:()=>zoomToBox(b) }, '⤢'),
    el('button', { class:'btn xs', title:'Crear hallazgo',
      onclick:()=>openFindingDialog({ pair:p, rect:b, prefill:{ title:`Diferencia visual en zona ${i+1}` } }) }, '⬚'))));
}

function zoomToBox(b){
  const pad = 40;
  const zx = (canvas._cssW - pad*2) / Math.max(20, b.w), zy = (canvas._cssH - pad*2) / Math.max(20, b.h);
  V.zoom = clamp(Math.min(zx, zy), 0.05, 8);
  V.panX = canvas._cssW/2 - (b.x + b.w/2) * V.zoom;
  V.panY = canvas._cssH/2 - (b.y + b.h/2) * V.zoom;
  cmpDraw();
}

/* =========================================================================
   ALINEACIÓN AUTOMÁTICA
   Compara mapas de bordes a baja resolución: robusto ante diferencias de
   color o antialias, y suficiente para encontrar escala y desplazamiento.
   ========================================================================= */
function edgeMap(img, W, H){
  const c = el('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d', { willReadFrequently:true });
  x.fillStyle = '#fff'; x.fillRect(0,0,W,H);
  x.imageSmoothingQuality = 'high';
  x.drawImage(img, 0, 0, W, H);
  const px = x.getImageData(0,0,W,H).data;
  const lum = new Float32Array(W*H);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) lum[j] = px[i]*0.299 + px[i+1]*0.587 + px[i+2]*0.114;
  const g = new Float32Array(W*H);
  for (let y = 1; y < H-1; y++) for (let xx = 1; xx < W-1; xx++){
    const i = y*W + xx;
    g[i] = Math.abs(lum[i+1] - lum[i-1]) + Math.abs(lum[i+W] - lum[i-W]);
  }
  return g;
}

/** Correlación cruzada normalizada entre mapas de bordes (1 = calce perfecto).
    Se normaliza por la energía de cada mapa para que estirar la imagen —que
    difumina los bordes— no parezca un mejor calce, y se pondera por el área
    solapada para no premiar coincidencias sobre un pedacito de pantalla. */
function matchScore(Gd, dW, dH, Gw, wW, wH, sx, sy){
  const y0 = Math.max(0, sy), y1 = Math.min(dH, sy + wH);
  const x0 = Math.max(0, sx), x1 = Math.min(dW, sx + wW);
  if (x1 - x0 < dW*0.35 || y1 - y0 < dH*0.25) return -1;
  let dot = 0, ed = 0, ew = 0, n = 0;
  for (let y = y0; y < y1; y += 2){
    const rd = y*dW, rw = (y - sy)*wW;
    for (let x = x0; x < x1; x += 2){
      const a = Gd[rd + x], b = Gw[rw + (x - sx)];
      dot += a*b; ed += a*a; ew += b*b; n++;
    }
  }
  if (!n || ed <= 0 || ew <= 0) return -1;
  const coverage = ((x1 - x0) * (y1 - y0)) / (dW * dH);
  return (dot / Math.sqrt(ed * ew)) * Math.pow(Math.min(1, coverage), 0.3);
}

async function autoAlign(){
  const p = getPair(); if (!p) return;
  const d = pairDesign(p), w = pairWeb(p);
  if (!d?.img || !w?.img){ toast('Par incompleto', 'Asigna un diseño y una captura.', 'warn'); return; }
  const t = toastHtml('Alineando', '<span class="spinner"></span> buscando la mejor coincidencia…', '', 40000);
  await new Promise(r => setTimeout(r, 20));

  // Las escalas plausibles en QA de UI son pocas: 1:1, «igualar ancho» y los
  // factores Retina 2× y 0,5×. Buscar escalas arbitrarias solo añade ruido.
  const baseScale = p.scale || 100;
  const fitScale = d.w / w.w * 100;
  const cands = [...new Set([fitScale, 100, baseScale, fitScale*2, fitScale/2]
    .map(v => +(+v).toFixed(2)))].filter(v => v >= 5 && v <= 400);

  // --- nivel 1: desplazamiento grueso para cada escala candidata ---
  const level1 = [];
  {
    const SW = Math.min(200, d.w), k = SW / d.w, SH = Math.max(1, Math.round(d.h * k));
    const Gd = edgeMap(d.img, SW, SH);
    const rx = Math.round(d.w * 0.10), ry = Math.round(d.h * 0.14);
    const stepX = Math.max(1, Math.round(d.w * 0.010)), stepY = Math.max(1, Math.round(d.h * 0.010));
    for (const sc of cands){
      const ww = Math.max(2, Math.round(w.w * sc/100 * k)), wh = Math.max(2, Math.round(w.h * sc/100 * k));
      if (ww > SW * 4 || wh > SH * 8) continue;
      const Gw = edgeMap(w.img, ww, wh);
      let bestFor = { scale:sc, offx:0, offy:0, score:-Infinity };
      for (let oy = -ry; oy <= ry; oy += stepY){
        for (let ox = -rx; ox <= rx; ox += stepX){
          const s2 = matchScore(Gd, SW, SH, Gw, ww, wh, Math.round(ox*k), Math.round(oy*k));
          if (s2 > bestFor.score) bestFor = { scale:sc, offx:ox, offy:oy, score:s2 };
        }
      }
      if (bestFor.score > -Infinity) level1.push(bestFor);
    }
  }
  if (!level1.length){ t.remove(); toast('No se pudo alinear', 'Ajusta la escala a mano.', 'warn'); return; }
  level1.sort((a,b) => b.score - a.score);
  await new Promise(r => setTimeout(r, 10));

  // --- nivel 2: refina en alta resolución las dos mejores escalas ---
  let best = level1[0];
  {
    const SW = Math.min(560, d.w), k = SW / d.w, SH = Math.max(1, Math.round(d.h * k));
    const Gd = edgeMap(d.img, SW, SH);
    const r = Math.max(8, Math.round(d.w * 0.014));
    const step = Math.max(1, Math.round(1/k));
    let winner = { ...best, score:-Infinity };
    for (const cand of level1.slice(0, 2)){
      const sc = cand.scale;
      const ww = Math.max(2, Math.round(w.w * sc/100 * k)), wh = Math.max(2, Math.round(w.h * sc/100 * k));
      const Gw = edgeMap(w.img, ww, wh);
      for (let oy = cand.offy - r; oy <= cand.offy + r; oy += step){
        for (let ox = cand.offx - r; ox <= cand.offx + r; ox += step){
          const s2 = matchScore(Gd, SW, SH, Gw, ww, wh, Math.round(ox*k), Math.round(oy*k));
          if (s2 > winner.score) winner = { scale:sc, offx:ox, offy:oy, score:s2 };
        }
      }
    }
    best = winner;
  }

  t.remove();
  setAlign({ scale:+best.scale.toFixed(2), offx:Math.round(best.offx), offy:Math.round(best.offy) });
  await runDiff(p);
  toast('Alineación aplicada', `Escala ${best.scale.toFixed(1)}% · offset ${Math.round(best.offx)},${Math.round(best.offy)}. ` +
        'Afina con las flechas si hace falta.', 'ok', 5000);
}

/* ---------- recortes de evidencia ---------- */
/** Compone una imagen de evidencia: diseño | web (| diferencia) de la zona marcada. */
function buildEvidence(p, rect, { includeDiff=true, maxW=460 } = {}){
  const L = (p._L && p._L.ok) ? p._L : buildLayers(p);
  if (!L.ok) return null;
  const s = L.s;
  const pad = Math.round(Math.max(8, Math.min(rect.w, rect.h) * 0.12));
  const r = {
    x: clamp(Math.round((rect.x - pad) * s), 0, L.w - 2),
    y: clamp(Math.round((rect.y - pad) * s), 0, L.h - 2),
    w: 0, h: 0
  };
  r.w = clamp(Math.round((rect.w + pad*2) * s), 2, L.w - r.x);
  r.h = clamp(Math.round((rect.h + pad*2) * s), 2, L.h - r.y);

  const useDiff = includeDiff && p.diffCanvas;
  const panels = useDiff ? 3 : 2;
  const scale = Math.min(2.2, Math.max(0.4, maxW / r.w));
  const pw = Math.round(r.w * scale), ph = Math.round(r.h * scale);
  const HEAD = 20, GAPX = 8;
  const c = el('canvas');
  c.width = pw * panels + GAPX * (panels - 1); c.height = ph + HEAD;
  const x = c.getContext('2d');
  x.fillStyle = '#eef1f6'; x.fillRect(0, 0, c.width, c.height);   // claro: legible en el reporte impreso
  x.imageSmoothingQuality = 'high';

  const titles = useDiff ? ['DISEÑO','WEB','DIFERENCIA'] : ['DISEÑO','WEB'];
  const sources = useDiff ? [L.dcan, L.wcan, p.diffCanvas] : [L.dcan, L.wcan];
  sources.forEach((src, i) => {
    const ox = i * (pw + GAPX);
    x.fillStyle = '#ffffff'; x.fillRect(ox, HEAD, pw, ph);
    x.drawImage(src, r.x, r.y, r.w, r.h, ox, HEAD, pw, ph);
    x.fillStyle = ['#7a3fd1','#0f8f86','#c8102e'][i];
    x.font = '700 11px -apple-system,Segoe UI,Roboto,sans-serif';
    x.fillText(titles[i], ox + 1, 13);
    x.strokeStyle = 'rgba(22,27,36,.20)'; x.lineWidth = 1;
    x.strokeRect(ox + .5, HEAD + .5, pw - 1, ph - 1);
  });
  return c.toDataURL('image/jpeg', 0.86);
}
