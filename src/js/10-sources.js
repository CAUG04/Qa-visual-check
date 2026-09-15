/* =========================================================================
   FUENTES: carga de diseños (imagen / PDF / portapapeles / captura) y pares
   ========================================================================= */

/* ---------- PDF.js embebido: worker desde un Blob (funciona sin internet) ----------
   El código del worker viaja como texto dentro del HTML. Se arma un Worker
   clásico con un Blob y se entrega a pdf.js como «workerPort»; si el navegador
   no permite crear workers desde file://, se ejecuta en el hilo principal. */
let pdfMode = 'none';                       // 'worker' | 'main' | 'none'
const pdfWorkerSource = () => document.getElementById('pdfjs-worker-src')?.textContent || '';

function initPdfWorker(){
  if (pdfMode !== 'none' || typeof pdfjsLib === 'undefined') return pdfMode !== 'none';
  const src = pdfWorkerSource(); if (!src) return false;
  try {
    const url = URL.createObjectURL(new Blob([src], { type:'text/javascript' }));
    const worker = new Worker(url);
    worker.addEventListener('error', e => console.warn('worker pdf.js', e.message || e));
    pdfjsLib.GlobalWorkerOptions.workerPort = worker;
    pdfMode = 'worker';
  } catch (e){
    console.warn('No se pudo crear el worker; se usará el hilo principal.', e);
    usePdfMainThread();
  }
  return pdfMode !== 'none';
}

/** Plan B (p. ej. Safari abriendo un archivo local, donde los workers desde
    file:// pueden estar bloqueados): pdf.js corre en el hilo principal. */
function usePdfMainThread(){
  if (pdfMode === 'main') return true;
  try {
    const tag = document.createElement('script');   // script en línea: no requiere 'unsafe-eval'
    tag.textContent = pdfWorkerSource();
    document.head.appendChild(tag);
    if (!globalThis.pdfjsWorker) throw new Error('el motor de PDF no se registró');
    pdfjsLib.GlobalWorkerOptions.workerPort = null;
    pdfjsLib.GlobalWorkerOptions.workerSrc = '';
    pdfMode = 'main';
    return true;
  } catch (e){ console.error('pdf.js no disponible', e); return false; }
}

/** Abre el documento; si el worker falla, reintenta en el hilo principal. */
async function openPdfDocument(data){
  initPdfWorker();
  const opts = () => ({ data: new Uint8Array(data), isEvalSupported:false, useSystemFonts:true });
  try {
    return await pdfjsLib.getDocument(opts()).promise;
  } catch (e){
    if (pdfMode !== 'main' && usePdfMainThread()){
      console.warn('Reintentando el PDF sin worker:', e?.message || e);
      return await pdfjsLib.getDocument(opts()).promise;
    }
    throw e;
  }
}

/* ---------- alta de fuentes ---------- */
/** Convierte cualquier imagen a PNG de mapa de bits (los SVG nunca se guardan
    tal cual: así ningún marcado externo viaja dentro de la sesión). */
function rasterize(img){
  const c = el('canvas');
  c.width = Math.min(LIMITS.canvasSide, img.naturalWidth || 1);
  c.height = Math.min(LIMITS.canvasSide, img.naturalHeight || 1);
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height);
  x.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

async function addSource(kind, { name, src, img, origin='file', page=null, silent=false }){
  if (S[kind].length >= LIMITS.sources) throw new Error('Demasiadas fuentes cargadas; quita algunas antes de agregar más.');
  if (!img) img = await imgFromSrc(src);
  if (!img.naturalWidth || !img.naturalHeight) throw new Error('La imagen está vacía o dañada.');
  if (img.naturalWidth > LIMITS.imageSide || img.naturalHeight > LIMITS.imageSide ||
      img.naturalWidth * img.naturalHeight > LIMITS.imagePixels)
    throw new Error(`La imagen es demasiado grande (${img.naturalWidth}×${img.naturalHeight} px).`);
  if (/^data:image\/svg/i.test(src)){            // los SVG entran rasterizados
    src = rasterize(img);
    img = await imgFromSrc(src);
  }
  const item = {
    id: uid(kind), kind, name: name || 'sin nombre', origin, page,
    w: img.naturalWidth, h: img.naturalHeight,
    src: compactSrc(img, src), img, thumb: makeThumb(img, 200)
  };
  if (item.src !== src) item.img = await imgFromSrc(item.src);
  S[kind].push(item);
  if (!silent){ renderSources(); saveLocal(); }
  return item;
}

function removeSource(kind, id){
  const i = S[kind].findIndex(x => x.id === id);
  if (i < 0) return;
  S[kind].splice(i, 1);
  S.pairs.forEach(p => { if (p[kind + 'Id'] === id){ p[kind + 'Id'] = null; p.diff = null; p.diffCanvas = null; p.diffThumb = null; } });
  renderSources(); renderPairs(); refreshPairSelect();
  if (S.activePairId) cmpSetPair(S.activePairId, { keepView:true });
  saveLocal();
}

/* ---------- archivos ---------- */
async function handleFiles(kind, files){
  const list = Array.from(files || []);
  if (!list.length) return;
  const imgs = list.filter(f => /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(f.name));
  const pdfs = list.filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  const rest = list.filter(f => !imgs.includes(f) && !pdfs.includes(f));

  for (const f of imgs){
    try {
      const src = await readAsDataURL(f);
      await addSource(kind, { name: f.name.replace(/\.[a-z0-9]+$/i,''), src, origin:'file', silent:true });
    } catch (e){ toast('No se pudo cargar «' + f.name + '»', e?.message || 'Formato no soportado.', 'err', 6000); }
  }
  if (imgs.length){ renderSources(); maybeAutoPair(); saveLocal(); }
  for (const f of pdfs) await openPdfImport(kind, f);
  if (rest.length) toast('Archivos ignorados', rest.map(f => f.name).join(', '), 'warn');
}

/* ---------- importación de PDF ---------- */
async function renderPdfPage(page, scale){
  const probe = page.getViewport({ scale });      // ningún lienzo por encima del máximo del navegador
  const shrink = Math.min(1, LIMITS.canvasSide / Math.max(probe.width, probe.height));
  const viewport = shrink < 1 ? page.getViewport({ scale: scale * shrink }) : probe;
  const c = el('canvas'); c.width = Math.max(1, Math.ceil(viewport.width)); c.height = Math.max(1, Math.ceil(viewport.height));
  const ctx = c.getContext('2d', { alpha:false });
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport, background:'#ffffff' }).promise;
  return c;
}

async function openPdfImport(kind, file){
  if (typeof pdfjsLib === 'undefined'){ toast('PDF no disponible', 'No se pudo inicializar el lector de PDF.', 'err'); return; }
  const loading = toastHtml('Leyendo PDF', '<span class="spinner"></span> leyendo el archivo…', '', 60000);
  let doc;
  try {
    doc = await openPdfDocument(await readAsArrayBuffer(file));
  } catch (e){
    loading.remove(); console.warn('PDF rechazado:', e?.message);
    toast('PDF ilegible', 'No se pudo abrir «' + file.name + '». Si está protegido, exporta los frames como PNG.', 'err', 7000);
    return;
  }
  loading.remove();

  const total = Math.min(doc.numPages, LIMITS.pdfPages);
  if (doc.numPages > total)
    toast('PDF muy extenso', `Se mostrarán las primeras ${total} páginas de ${doc.numPages}.`, 'warn', 6000);
  const selected = new Set(Array.from({length: total}, (_, i) => i + 1));

  const grid = el('div', { class:'pdf-pages' });
  const info = el('p', { class:'muted small',
    text:`${file.name} · ${total} página${total>1?'s':''}. Haz clic para incluir o excluir páginas.` });
  const qual = el('select', { id:'pdf-scale' },
    el('option', { value:'1.5' }, '1.5× (rápido)'),
    el('option', { value:'2', selected:true }, '2× (recomendado)'),
    el('option', { value:'3' }, '3× (máximo detalle)'));
  const head = el('div', { class:'row-actions' },
    el('label', { class:'fld slim' }, el('span', {}, 'Calidad de render'), qual),
    el('button', { class:'btn sm ghost', onclick:()=>{ selected.clear(); $$('.pdf-page', grid).forEach(n=>n.classList.remove('sel')); updCount(); } }, 'Ninguna'),
    el('button', { class:'btn sm ghost', onclick:()=>{ for(let i=1;i<=total;i++) selected.add(i); $$('.pdf-page', grid).forEach(n=>n.classList.add('sel')); updCount(); } }, 'Todas'));
  const counter = el('span', { class:'muted small' });
  head.append(counter);
  const updCount = () => counter.textContent = `${selected.size} de ${total} seleccionadas`;

  const body = el('div', {}, info, head, grid);
  openModal({
    title:'Importar páginas del PDF', body, wide:true,
    foot:[ { label:'Cancelar' },
           { label:'Importar páginas', cls:'primary', onClick: async () => {
               const scale = parseFloat(qual.value);
               const pages = Array.from(selected).sort((a,b)=>a-b);
               closeModal();
               await importPdfPages(kind, doc, pages, scale, file.name);
             } } ]
  });
  updCount();

  // Miniaturas de previsualización (baja resolución para ir rápido)
  for (let n = 1; n <= total; n++){
    const cell = el('div', { class:'pdf-page sel', onclick:(e)=>{
      const on = cell.classList.toggle('sel');
      if (on) selected.add(n); else selected.delete(n); updCount();
    } }, el('div', { class:'ph', style:'height:78px;display:flex;align-items:center;justify-content:center' }, el('span', { class:'spinner' })), el('span', {}, 'p. ' + n));
    grid.append(cell);
  }
  for (let n = 1; n <= total; n++){
    if (!$('#modal-root') || $('#modal-root').hidden) return;      // el usuario cerró el modal
    try {
      const page = await doc.getPage(n);
      const c = await renderPdfPage(page, 0.28);
      const cell = grid.children[n-1];
      if (cell){ cell.firstChild.replaceWith(el('img', { src:c.toDataURL('image/jpeg', 0.7), alt:'p. '+n })); }
    } catch(e){ console.warn('preview p'+n, e); }
  }
}

async function importPdfPages(kind, doc, pages, scale, fileName){
  if (!pages.length) return;
  const base = fileName.replace(/\.pdf$/i, '');
  const t = toastHtml('Importando PDF', '<span class="spinner"></span> 0/' + pages.length, '', 120000);
  let i = 0;
  for (const n of pages){
    try {
      const page = await doc.getPage(n);
      const c = await renderPdfPage(page, scale);
      const src = c.toDataURL('image/png');
      const img = await imgFromSrc(src);
      await addSource(kind, { name: `${base} · p${n}`, src, img, origin:'pdf', page:n, silent:true });
    } catch (e){ console.error('página ' + n, e); }
    i++; t.querySelector('span').innerHTML = '<span class="spinner"></span> ' + i + '/' + pages.length;
  }
  t.remove();
  renderSources(); maybeAutoPair(); saveLocal();
  toast('PDF importado', `${i} página${i>1?'s':''} agregada${i>1?'s':''} a ${kind === 'design' ? 'Diseño' : 'Web'}.`, 'ok');
}

/* ---------- portapapeles ---------- */
async function handlePaste(e){
  const items = Array.from(e.clipboardData?.items || []);
  const imgItem = items.find(it => it.type && it.type.startsWith('image/'));
  if (!imgItem) return;
  e.preventDefault();
  const file = imgItem.getAsFile();
  if (!file) return;
  const kind = pasteTarget;
  const src = await readAsDataURL(file);
  const n = S[kind].length + 1;
  await addSource(kind, { name:(kind === 'design' ? 'Diseño pegado ' : 'Captura pegada ') + n, src, origin:'clipboard' });
  maybeAutoPair();
  toast('Imagen pegada', `Agregada a ${kind === 'design' ? 'Diseño' : 'Web'}. Pasa el cursor por la otra zona para cambiar el destino.`, 'ok');
}
let pasteTarget = 'web';   // zona que recibe el pegado (la última enfocada)

/* ---------- captura de pantalla ---------- */
async function captureScreen(){
  if (!navigator.mediaDevices?.getDisplayMedia){ toast('No disponible', 'Este navegador no permite capturar pantalla.', 'warn'); return; }
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video:{ frameRate:1 }, audio:false });
  } catch (e){
    toast('Captura cancelada', 'Si el navegador la bloquea, usa la captura del sistema y pega con ⌘/Ctrl+V.', 'warn', 6000);
    return;
  }
  const video = el('video', { autoplay:true, muted:true, playsinline:true });
  video.srcObject = stream;
  await new Promise(r => video.onloadedmetadata = r);
  await video.play().catch(()=>{});
  await new Promise(r => setTimeout(r, 360));
  const c = el('canvas'); c.width = video.videoWidth; c.height = video.videoHeight;
  c.getContext('2d').drawImage(video, 0, 0);
  stream.getTracks().forEach(t => t.stop());
  const src = c.toDataURL('image/png');
  await addSource('web', { name:'Captura ' + new Date().toLocaleTimeString('es-CO'), src, origin:'capture' });
  maybeAutoPair();
  toast('Captura agregada', 'Recórtala si incluye barras del navegador.', 'ok');
}

/* ---------- render de listas ---------- */
function renderSources(){
  for (const kind of ['design','web']){
    const ul = $('#list-' + kind); ul.innerHTML = '';
    if (!S[kind].length){
      ul.append(el('li', { class:'muted small', style:'padding:6px 2px' },
        kind === 'design' ? 'Sin diseños cargados.' : 'Sin capturas cargadas.'));
      continue;
    }
    S[kind].forEach((it, idx) => {
      const used = S.pairs.some(p => p[kind + 'Id'] === it.id);
      ul.append(el('li', { class:'thumb-item' + (used ? ' sel' : ''), dataset:{ id:it.id } },
        it.thumb ? el('img', { src:it.thumb, alt:'' }) : el('div', { class:'thumb-ph' }),
        el('div', { class:'thumb-meta' },
          el('input', { class:'thumb-name', value:it.name, title:'Editar nombre',
            onchange:(e)=>{ it.name = e.target.value.trim() || it.name; renderPairs(); refreshPairSelect(); saveLocal(); } }),
          el('div', { class:'thumb-dim' }, `${it.w}×${it.h} px · ${originLabel(it.origin)}` + (it.missing ? ' · imagen no cargada' : ''))),
        el('div', { class:'thumb-actions' },
          el('button', { class:'btn xs ghost', title:'Ver en grande', onclick:()=>viewImage(it.src || it.thumb, it.name) }, '⤢'),
          el('button', { class:'btn xs danger', title:'Quitar', onclick:()=>removeSource(kind, it.id) }, '✕'))));
    });
  }
}
const originLabel = o => ({ file:'archivo', pdf:'PDF', clipboard:'portapapeles', capture:'captura' }[o] || o);

function viewImage(src, title){
  openModal({ title: title || 'Vista', wide:true,
    body: el('img', { class:'evidence-preview', src, alt:title || '' }),
    foot:[{ label:'Cerrar' }] });
}

/* ---------- pares ---------- */
function pairName(p){
  if (p.name) return p.name;
  const d = S.design.find(x => x.id === p.designId);
  const w = S.web.find(x => x.id === p.webId);
  return d?.name || w?.name || 'Par sin nombre';
}
/** Iguala el ancho de la web al del diseño (mismo cálculo que «Ajustar ancho»),
    para que un par recién armado ya nazca alineado en escala. */
function autoFitScale(p){
  const d = pairDesign(p), w = pairWeb(p);
  if (!d || !w || !w.w) return;
  p.scale = +(d.w / w.w * 100).toFixed(2);
  p.offx = 0; p.offy = 0;
}
function addPair(designId=null, webId=null, name=''){
  const p = { id: uid('pair'), name, designId, webId, scale:100, offx:0, offy:0,
              masks:[], diff:null, diffCanvas:null, diffThumb:null };
  if (designId && webId) autoFitScale(p);
  S.pairs.push(p);
  return p;
}
function deletePair(id){
  const i = S.pairs.findIndex(p => p.id === id); if (i < 0) return;
  S.pairs.splice(i, 1);
  if (S.activePairId === id) S.activePairId = S.pairs[0]?.id || null;
  renderSources(); renderPairs(); refreshPairSelect(); cmpSetPair(S.activePairId, { keepView:false }); saveLocal();
}

/** Similitud simple entre nombres (0..1) para emparejar automáticamente. */
function nameScore(a, b){
  const ta = new Set(slug(a).split('-').filter(x => x.length > 1));
  const tb = new Set(slug(b).split('-').filter(x => x.length > 1));
  if (!ta.size || !tb.size) return 0;
  let hit = 0; ta.forEach(t => { if (tb.has(t)) hit++; });
  return hit / Math.max(ta.size, tb.size);
}
function autoPair({ silent=false } = {}){
  const usedD = new Set(S.pairs.map(p => p.designId).filter(Boolean));
  const usedW = new Set(S.pairs.map(p => p.webId).filter(Boolean));
  const freeD = S.design.filter(d => !usedD.has(d.id));
  const freeW = S.web.filter(w => !usedW.has(w.id));
  let made = 0;
  const takenW = new Set();
  for (const d of freeD){
    let best = null, bestScore = 0;
    for (const w of freeW){
      if (takenW.has(w.id)) continue;
      const s = nameScore(d.name, w.name);
      if (s > bestScore){ bestScore = s; best = w; }
    }
    if (!best || bestScore < 0.34){                       // sin coincidencia de nombre → por orden
      best = freeW.find(w => !takenW.has(w.id)) || null;
    }
    if (!best) break;
    takenW.add(best.id);
    addPair(d.id, best.id, d.name);
    made++;
  }
  if (!S.activePairId && S.pairs.length) S.activePairId = S.pairs[0].id;
  renderSources(); renderPairs(); refreshPairSelect();
  if (S.activePairId) cmpSetPair(S.activePairId, { keepView:false });
  saveLocal();
  if (!silent) toast(made ? 'Pares creados' : 'Sin cambios',
    made ? `${made} par${made>1?'es':''} nuevo${made>1?'s':''}.` : 'No quedaban fuentes libres para emparejar.', made ? 'ok' : 'warn');
  return made;
}
/** Empareja lo que quede suelto en ambos lados. Se difiere unos milisegundos
    porque diseños y capturas pueden estar cargándose a la vez: si se emparejara
    en mitad de la carga quedarían pares incompletos. */
function maybeAutoPair(){
  renderPairs(); refreshPairSelect();
  scheduleAutoPair();
}
const scheduleAutoPair = debounce(() => {
  const usedD = new Set(S.pairs.map(p => p.designId).filter(Boolean));
  const usedW = new Set(S.pairs.map(p => p.webId).filter(Boolean));
  const freeD = S.design.some(d => !usedD.has(d.id));
  const freeW = S.web.some(w => !usedW.has(w.id));
  if (freeD && freeW) autoPair({ silent:true });
}, 280);

function sourceSelect(kind, pair){
  const sel = el('select', { onchange:(e)=>{
    pair[kind + 'Id'] = e.target.value || null;
    pair.diff = null; pair.diffCanvas = null; pair.diffThumb = null;
    autoFitScale(pair);
    renderPairs(); renderSources(); refreshPairSelect();
    if (S.activePairId === pair.id) cmpSetPair(pair.id, { keepView:true });
    saveLocal();
  } }, el('option', { value:'' }, '— sin asignar —'));
  S[kind].forEach(it => sel.append(el('option', { value:it.id, selected: pair[kind+'Id'] === it.id },
    `${it.name} (${it.w}×${it.h})`)));
  return sel;
}

function renderPairs(){
  const tb = $('#table-pairs tbody'); tb.innerHTML = '';
  $('#pairs-empty').hidden = S.pairs.length > 0;
  S.pairs.forEach((p, i) => {
    const d = p.diff;
    const pctCell = d ? el('span', { class:'pill ' + (d.pct < 0.5 ? 'ok' : d.pct < 3 ? 'warn' : 'fail') }, fmtPct(d.pct))
                      : el('span', { class:'muted' }, '—');
    tb.append(el('tr', { dataset:{ id:p.id } },
      el('td', { class:'muted' }, String(i + 1)),
      el('td', {}, el('input', { type:'text', value:p.name || pairName(p),
        onchange:(e)=>{ p.name = e.target.value.trim(); renderPairs(); refreshPairSelect(); saveLocal(); } })),
      el('td', {}, sourceSelect('design', p)),
      el('td', {}, sourceSelect('web', p)),
      el('td', {}, pctCell),
      el('td', {}, el('div', { class:'row-actions', style:'margin:0' },
        el('button', { class:'btn xs', onclick:()=>{ cmpSetPair(p.id, { keepView:false }); switchView('comparar'); } }, 'Comparar'),
        el('button', { class:'btn xs danger', onclick:()=>deletePair(p.id) }, 'Eliminar')))));
  });
}

function refreshPairSelect(){
  const sel = $('#cmp-pair'); const cur = S.activePairId;
  sel.innerHTML = '';
  if (!S.pairs.length){ sel.append(el('option', { value:'' }, 'sin pares')); return; }
  S.pairs.forEach((p, i) => sel.append(el('option', { value:p.id, selected: p.id === cur }, `${i+1}. ${pairName(p)}`)));
}
