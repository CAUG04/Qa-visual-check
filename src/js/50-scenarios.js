/* =========================================================================
   ESCENARIOS: importación desde Excel/CSV, checklist de ejecución,
   plantilla descargable y exportación de resultados.
   ========================================================================= */

const STATUSES   = ['Pendiente','OK','Falla','Bloqueado','N/A'];
const SEVERITIES = ['','Bloqueante','Alta','Media','Baja','Cosmético'];
const CATEGORIES = ['Espaciado','Tipografía','Color','Tamaño / escala','Alineación','Contenido / copy',
                    'Estado / interacción','Responsive','Accesibilidad','Otro'];

const FIELD_DEFS = [
  { key:'code',     label:'ID del caso',        hints:['id','codigo','code','caso','case','tc','ticket','nro','n'] },
  { key:'module',   label:'Módulo / pantalla',  hints:['modulo','module','pantalla','screen','seccion','section','feature','epica','flujo'] },
  { key:'name',     label:'Escenario',          hints:['escenario','scenario','caso de prueba','titulo','title','prueba','test','descripcion','description','validacion'] },
  { key:'steps',    label:'Pasos',              hints:['pasos','steps','procedimiento','como probar'] },
  { key:'expected', label:'Resultado esperado', hints:['resultado esperado','esperado','expected','criterio','criterio de aceptacion','aceptacion','resultado'] },
  { key:'priority', label:'Prioridad',          hints:['prioridad','priority','importancia','peso'] },
  { key:'ref',      label:'Referencia de diseño', hints:['frame','ref','referencia','diseno','design','figma','pantalla figma','link'] },
  { key:'status',   label:'Estado (si ya viene)', hints:['estado','status'] },
  { key:'severity', label:'Severidad (si ya viene)', hints:['severidad','severity','gravedad'] },
  { key:'note',     label:'Observación',        hints:['observacion','observaciones','comentario','comentarios','nota','notas','hallazgo','comments'] }
];

const normHead = s => deaccent(String(s||'')).toLowerCase().replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim();

/* ---------- importación ---------- */
async function importScenariosFile(file){
  let sheets;
  try {
    if (/\.(csv|tsv|txt)$/i.test(file.name)) sheets = parseCsv(await file.text());
    else sheets = await parseXlsx(await readAsArrayBuffer(file));
  } catch (e){
    console.warn('Importación rechazada:', e?.message); toast('No se pudo leer', e.message || 'Archivo no reconocido', 'err', 7000); return;
  }
  sheets = sheets.filter(s => s.rows.some(r => r.some(c => String(c||'').trim())));
  if (!sheets.length){ toast('Archivo vacío', 'No se encontraron filas con datos.', 'warn'); return; }
  openMappingModal(sheets, file.name);
}

function openMappingModal(sheets, fileName){
  let sheetIdx = 0;
  const body = el('div');
  const sheetSel = el('select', { onchange:e => { sheetIdx = +e.target.value; render(); } },
    sheets.map((s, i) => el('option', { value:i }, `${s.name} (${s.rows.length} filas)`)));
  const keepChk = el('input', { type:'checkbox', checked:true });
  const table = el('table', { class:'map-table' });
  const preview = el('div', { style:'margin-top:12px;overflow:auto;max-height:200px' });
  let map = {};

  function detect(headers){
    const m = {};
    const used = new Set();
    for (const f of FIELD_DEFS){
      let found = -1, bestLen = -1;
      headers.forEach((h, i) => {
        if (used.has(i)) return;
        const n = normHead(h);
        if (!n) return;
        for (const hint of f.hints){
          if (n === hint || n.startsWith(hint + ' ') || n === hint + 's' || (hint.length > 4 && n.includes(hint))){
            if (hint.length > bestLen){ found = i; bestLen = hint.length; }
          }
        }
      });
      if (found >= 0){ m[f.key] = found; used.add(found); }
      else m[f.key] = -1;
    }
    if (m.name < 0){                                  // sin columna clara de escenario: la más ancha
      let bi = -1, bw = 0;
      headers.forEach((h, i) => { if (used.has(i)) return; const w = normHead(h).length; if (w > bw){ bw = w; bi = i; } });
      if (bi >= 0) m.name = bi;
    }
    return m;
  }

  function render(){
    const rows = sheets[sheetIdx].rows;
    const headerRow = rows.findIndex(r => r.filter(c => String(c||'').trim()).length >= 2);
    const headers = rows[headerRow < 0 ? 0 : headerRow] || [];
    map = detect(headers);
    table.innerHTML = '';
    for (const f of FIELD_DEFS){
      const sel = el('select', { onchange:e => map[f.key] = +e.target.value },
        el('option', { value:-1 }, '— no importar —'),
        headers.map((h, i) => el('option', { value:i, selected: map[f.key] === i }, `${colName(i)}: ${String(h||'(sin título)').slice(0,44)}`)));
      table.append(el('tr', {}, el('td', {}, f.label), el('td', {}, sel)));
    }
    // vista previa
    preview.innerHTML = '';
    const t = el('table', { class:'grid' });
    const thead = el('thead', {}, el('tr', {}, headers.slice(0, 9).map(h => el('th', {}, String(h||'').slice(0,26)))));
    const tb = el('tbody');
    rows.slice((headerRow < 0 ? 0 : headerRow) + 1, (headerRow < 0 ? 0 : headerRow) + 5).forEach(r =>
      tb.append(el('tr', {}, headers.slice(0, 9).map((_, i) => el('td', {}, String(r[i] ?? '').slice(0,40))))));
    t.append(thead, tb); preview.append(t);
    body._headerRow = headerRow < 0 ? 0 : headerRow;
  }

  body.append(
    el('p', { class:'muted small', text:`${fileName} — revisa a qué campo corresponde cada columna.` }),
    el('div', { class:'row-actions', style:'margin:0 0 10px' },
      el('label', { class:'fld slim' }, el('span', {}, 'Hoja'), sheetSel),
      el('label', { class:'chk' }, keepChk, 'Conservar los resultados ya registrados (por ID)')),
    table, el('h3', { class:'muted small', style:'margin-top:14px' }, 'Vista previa'), preview);
  render();

  openModal({ title:'Importar escenarios', body, wide:true, foot:[
    { label:'Cancelar' },
    { label:'Importar', cls:'primary', onClick:()=>{
        const rows = sheets[sheetIdx].rows;
        applyImport(rows, body._headerRow, map, keepChk.checked, sheets[sheetIdx].rows[body._headerRow] || []);
        closeModal();
      } }
  ]});
}

function applyImport(rows, headerRow, map, keepResults, headers){
  const prev = new Map(S.scenarios.map(s => [String(s.code || s.name).trim().toLowerCase(), s]));
  const mapped = new Set(Object.values(map).filter(i => i >= 0));
  const out = [];
  let auto = 1;
  for (let i = headerRow + 1; i < rows.length; i++){
    const r = rows[i] || [];
    if (!r.some(c => String(c||'').trim())) continue;
    const get = k => map[k] >= 0 ? String(r[map[k]] ?? '').trim() : '';
    const name = get('name');
    const code = get('code') || ('CP-' + String(auto).padStart(3,'0'));
    if (!name && !get('expected') && !get('steps')) continue;
    const extra = {};
    headers.forEach((h, ci) => {
      if (mapped.has(ci)) return;
      const v = String(r[ci] ?? '').trim();
      if (v && String(h||'').trim()) extra[String(h).trim()] = v;
    });
    const sc = {
      id: uid('sc'), code, module:get('module'), name: name || '(sin descripción)',
      steps:get('steps'), expected:get('expected'), priority:get('priority') || 'Media', ref:get('ref'),
      status: STATUSES.includes(get('status')) ? get('status') : 'Pendiente',
      severity: SEVERITIES.includes(get('severity')) ? get('severity') : '',
      note:get('note'), evidence:null, extra
    };
    if (keepResults){
      const old = prev.get(String(code).trim().toLowerCase());
      if (old){ sc.status = old.status; sc.severity = old.severity; sc.note = old.note || sc.note; sc.evidence = old.evidence; }
    }
    out.push(sc); auto++;
  }
  if (!out.length){ toast('Nada para importar', 'No se identificaron filas de escenarios.', 'warn'); return; }
  S.scenarios = out;
  S.ui.scPage = 1;
  rebuildFilters(); renderScenarios(); updateKpis(); saveLocal();
  toast('Escenarios importados', `${out.length} caso${out.length>1?'s':''} listo${out.length>1?'s':''} para ejecutar.`, 'ok');
  switchView('escenarios');
}

/* ---------- filtros ---------- */
function rebuildFilters(){
  const prios = [...new Set(S.scenarios.map(s => s.priority).filter(Boolean))];
  const mods  = [...new Set(S.scenarios.map(s => s.module).filter(Boolean))];
  const fill = (sel, values, all) => {
    const cur = sel.value;
    sel.innerHTML = '';
    sel.append(el('option', { value:'' }, all));
    values.forEach(v => sel.append(el('option', { value:v, selected:v === cur }, v)));
  };
  fill($('#sc-filter-prio'), prios, 'Todas');
  fill($('#sc-filter-mod'), mods, 'Todos');
  const cats = [...new Set(S.findings.map(f => f.category).filter(Boolean))];
  fill($('#fd-filter-cat'), cats, 'Todas');
}

function filteredScenarios(){
  const q = deaccent(($('#sc-search').value || '').toLowerCase()).trim();
  const st = $('#sc-filter-status').value, pr = $('#sc-filter-prio').value, md = $('#sc-filter-mod').value;
  return S.scenarios.filter(s => {
    if (st && s.status !== st) return false;
    if (pr && s.priority !== pr) return false;
    if (md && s.module !== md) return false;
    if (q){
      const hay = deaccent([s.code, s.module, s.name, s.expected, s.note, s.ref, s.steps].join(' ').toLowerCase());
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/* ---------- render ---------- */
function renderScenarios(){
  const tb = $('#table-scenarios tbody'); tb.innerHTML = '';
  const has = S.scenarios.length > 0;
  $('#sc-empty').hidden = has;
  $('#table-scenarios').hidden = !has;
  if (!has){ $('#sc-count').textContent = ''; $('#sc-pager').innerHTML = ''; updateKpis(); return; }

  const list = filteredScenarios();
  const size = S.ui.scPageSize;
  const pages = Math.max(1, Math.ceil(list.length / size));
  S.ui.scPage = clamp(S.ui.scPage, 1, pages);
  const slice = list.slice((S.ui.scPage - 1) * size, S.ui.scPage * size);

  for (const s of slice){
    const stSel = el('select', { onchange:e => {
      s.status = e.target.value;
      if (s.status !== 'Falla') s.severity = '';
      renderScenarios(); updateKpis(); saveLocal();
    } }, STATUSES.map(v => el('option', { value:v, selected:s.status === v }, v)));

    const sevSel = el('select', { disabled: s.status !== 'Falla', onchange:e => { s.severity = e.target.value; saveLocal(); } },
      SEVERITIES.map(v => el('option', { value:v, selected:s.severity === v }, v || '—')));

    const note = el('input', { type:'text', value:s.note || '', placeholder:'qué se observó…',
      onchange:e => { s.note = e.target.value; saveLocal(); } });

    const ev = el('div', { class:'row-actions', style:'margin:0;gap:4px' },
      s.evidence ? el('img', { class:'ev-thumb', src:s.evidence, alt:'evidencia',
        onclick:()=>viewImage(s.evidence, 'Evidencia · ' + (s.code || s.name)) }) : null,
      el('button', { class:'btn xs ghost', title:'Adjuntar evidencia', onclick:()=>evidenceMenu(s) }, s.evidence ? '↻' : '＋'));

    tb.append(el('tr', { dataset:{ status:s.status } },
      el('td', { class:'sc-id' }, s.code || '—'),
      el('td', {}, s.module || '—'),
      el('td', { class:'sc-txt' }, el('a', { href:'#', style:'color:inherit;text-decoration:none;border-bottom:1px dotted var(--line-2)',
        onclick:(e)=>{ e.preventDefault(); scenarioDetail(s); } }, s.name)),
      el('td', { class:'sc-txt muted' }, s.expected || '—'),
      el('td', {}, s.priority || '—'),
      el('td', { class:'muted' }, s.ref || '—'),
      el('td', { class:'st-cell' }, stSel),
      el('td', {}, sevSel),
      el('td', {}, note),
      el('td', {}, ev)));
  }

  $('#sc-count').textContent = `${list.length} de ${S.scenarios.length} escenarios` +
    (list.length !== S.scenarios.length ? ' (filtrados)' : '');
  const pager = $('#sc-pager'); pager.innerHTML = '';
  if (pages > 1){
    for (let i = 1; i <= pages; i++){
      pager.append(el('button', { class:i === S.ui.scPage ? 'active' : '',
        onclick:()=>{ S.ui.scPage = i; renderScenarios(); } }, String(i)));
    }
  }
  updateKpis();
}

function scenarioDetail(s){
  const rows = [
    ['ID', s.code], ['Módulo', s.module], ['Escenario', s.name], ['Pasos', s.steps],
    ['Resultado esperado', s.expected], ['Prioridad', s.priority], ['Referencia de diseño', s.ref],
    ['Estado', s.status], ['Severidad', s.severity], ['Observación', s.note]
  ].filter(r => r[1]);
  const extras = Object.entries(s.extra || {});
  const rel = S.findings.filter(f => f.scenarioCode && f.scenarioCode === s.code);
  openModal({ title:'Escenario ' + (s.code || ''), wide:true, foot:[{ label:'Cerrar', cls:'primary' }],
    body: el('div', {},
      el('table', { class:'map-table' }, rows.map(([k, v]) =>
        el('tr', {}, el('td', {}, k), el('td', { style:'white-space:pre-wrap' }, String(v))))),
      extras.length ? el('div', {}, el('h3', { class:'muted small', style:'margin:14px 0 6px' }, 'Otras columnas del Excel'),
        el('table', { class:'map-table' }, extras.map(([k, v]) => el('tr', {}, el('td', {}, k), el('td', {}, v))))) : null,
      rel.length ? el('div', {}, el('h3', { class:'muted small', style:'margin:14px 0 6px' }, 'Hallazgos relacionados'),
        el('ul', { style:'margin:0;padding-left:18px;color:var(--tx-2)' },
          rel.map(f => el('li', {}, `${f.code} · ${f.title} (${f.severity})`)))) : null,
      s.evidence ? el('div', {}, el('h3', { class:'muted small', style:'margin:14px 0 6px' }, 'Evidencia'),
        el('img', { class:'evidence-preview', src:s.evidence, alt:'' })) : null) });
}

/* ---------- evidencias ---------- */
function stageSnapshot(maxW=1000){
  if (!canvas || !S.activePairId) return null;
  const sc = Math.min(1, maxW / canvas.width);
  const c = el('canvas'); c.width = Math.round(canvas.width*sc); c.height = Math.round(canvas.height*sc);
  const x = c.getContext('2d');
  x.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--stage').trim() || '#12151c';
  x.fillRect(0,0,c.width,c.height);
  x.imageSmoothingQuality = 'high';
  x.drawImage(canvas, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}

function evidenceMenu(target){
  const setEv = src => { target.evidence = src; renderScenarios(); renderFindings(); saveLocal(); closeModal(); };
  openModal({ title:'Evidencia', foot:[{ label:'Cerrar' }], body: el('div', { class:'row-actions', style:'margin:0' },
    el('button', { class:'btn', onclick:()=>{
      const snap = stageSnapshot();
      if (!snap){ toast('Sin comparación activa', 'Abre un par en «Comparar» primero.', 'warn'); return; }
      setEv(snap);
      toast('Evidencia adjuntada', 'Se tomó la vista actual del comparador.', 'ok');
    } }, 'Tomar la vista del comparador'),
    el('button', { class:'btn ghost', onclick:()=>{
      const inp = $('#file-evidence');
      inp.onchange = async () => {
        const f = inp.files[0]; if (!f) return;
        const src = await readAsDataURL(f);
        const img = await imgFromSrc(src);
        setEv(makeThumb(img, 1100, 0.85));
        inp.value = '';
      };
      inp.click();
    } }, 'Subir una imagen'),
    target.evidence ? el('button', { class:'btn danger', onclick:()=>setEv(null) }, 'Quitar evidencia') : null) });
}

/* ---------- plantilla y exportación ---------- */
function downloadTemplate(){
  const headers = ['ID','Módulo','Escenario','Pasos','Resultado esperado','Prioridad','Referencia de diseño (frame)','Estado','Severidad','Observación'];
  const ejemplos = [
    ['CP-001','Home','El banner principal respeta el diseño del frame Home/Desktop',
     '1. Abrir la home en 1440px\n2. Comparar con el frame de Figma',
     'Imagen, títulos y botón coinciden en posición, tamaño y color','Alta','Home/Desktop','Pendiente','',''],
    ['CP-002','Home','Tipografía de títulos y cuerpo según la guía',
     'Inspeccionar H1, H2 y párrafo','Familia, peso, tamaño e interlineado iguales al diseño','Media','Home/Desktop','Pendiente','',''],
    ['CP-003','Login','Estados del campo de contraseña (foco, error)',
     '1. Enfocar el campo\n2. Enviar vacío','Bordes, colores y mensajes iguales al frame Login/Estados','Alta','Login/Estados','Pendiente','','']
  ];
  const sheets = [
    { name:'Escenarios', header:true, cols:[10,16,44,38,42,11,24,13,13,38],
      rows:[headers, ...ejemplos, ...Array.from({length:40}, () => headers.map(()=>''))],
      validations:[
        { range:'H2:H400', values:STATUSES },
        { range:'I2:I400', values:SEVERITIES.filter(Boolean) },
        { range:'F2:F400', values:['Crítica','Alta','Media','Baja'] }
      ] },
    { name:'Instrucciones', header:true, cols:[30,86], rows:[
      ['Campo','Cómo llenarlo'],
      ['ID','Identificador del caso. Si lo dejas vacío la herramienta genera CP-001, CP-002…'],
      ['Módulo','Pantalla, sección o épica. Se usa para filtrar en la herramienta.'],
      ['Escenario','Qué se valida, en una frase.'],
      ['Pasos','Opcional. Cómo reproducirlo (se ve en el detalle del escenario).'],
      ['Resultado esperado','Criterio de aceptación con el que se decide OK o Falla.'],
      ['Prioridad','Crítica / Alta / Media / Baja. Sirve para filtrar y priorizar el reporte.'],
      ['Referencia de diseño','Nombre del frame de Figma o página del PDF con el que se compara.'],
      ['Estado','Déjalo en Pendiente: se marca durante la revisión en la herramienta.'],
      ['Severidad','Solo si el caso falla: Bloqueante / Alta / Media / Baja / Cosmético.'],
      ['Observación','Notas libres. Se incluyen en el reporte final.'],
      ['', ''],
      ['Nota','Puedes agregar columnas propias: se conservan y aparecen en el detalle del escenario y en la exportación.']
    ] }
  ];
  downloadBlob('plantilla-escenarios-qa.xlsx', buildXlsx(sheets));
  toast('Plantilla descargada', 'Llénala y vuelve a importarla con «Importar Excel / CSV».', 'ok');
}

function exportResults(){
  if (!S.scenarios.length && !S.findings.length){ toast('Nada que exportar', 'Importa escenarios o registra hallazgos.', 'warn'); return; }
  const extraCols = [...new Set(S.scenarios.flatMap(s => Object.keys(s.extra || {})))];
  const scHeaders = ['ID','Módulo','Escenario','Resultado esperado','Prioridad','Referencia','Estado','Severidad','Observación', ...extraCols];
  const scRows = S.scenarios.map(s => [s.code, s.module, s.name, s.expected, s.priority, s.ref, s.status, s.severity, s.note,
    ...extraCols.map(c => (s.extra || {})[c] || '')]);

  const fdHeaders = ['ID','Título','Severidad','Categoría','Estado','Pantalla','Zona (x,y,w,h)','Descripción','Escenario relacionado'];
  const fdRows = S.findings.map(f => [f.code, f.title, f.severity, f.category, f.state, f.pairName,
    f.rect ? `${f.rect.x},${f.rect.y},${f.rect.w},${f.rect.h}` : '', f.desc, f.scenarioCode || '']);

  const total = S.scenarios.length, ok = S.scenarios.filter(s=>s.status==='OK').length;
  const fail = S.scenarios.filter(s=>s.status==='Falla').length;
  const blk  = S.scenarios.filter(s=>s.status==='Bloqueado').length;
  const pend = S.scenarios.filter(s=>!s.status || s.status==='Pendiente').length;
  const sumRows = [
    ['Concepto','Valor'],
    ['Proyecto', S.meta.project || ''], ['Responsable de QA', S.meta.tester || ''],
    ['Fecha', S.meta.date || todayISO()], ['Entorno / URL', S.meta.url || ''],
    ['Navegador y SO', S.meta.browser || ''],
    ['Escenarios totales', total], ['OK', ok], ['Fallas', fail], ['Bloqueados', blk], ['Pendientes', pend],
    ['Avance de ejecución', total ? Math.round((total - pend)/total*100) + '%' : '0%'],
    ['Hallazgos abiertos', S.findings.filter(f=>f.state==='Abierto').length],
    ['Hallazgos bloqueantes', S.findings.filter(f=>f.severity==='Bloqueante').length],
    ['Pantallas comparadas', S.pairs.filter(p=>p.diff).length + ' de ' + S.pairs.length]
  ];
  const diffRows = [['Pantalla','Diseño','Web','% diferencia','Zonas','Tolerancia','Escala web','Offset']]
    .concat(S.pairs.map(p => {
      const d = pairDesign(p), w = pairWeb(p);
      return [pairName(p), d?.name || '', w?.name || '',
        p.diff ? +p.diff.pct.toFixed(3) : '', p.diff ? p.diff.regions : '',
        p.diff ? p.diff.threshold : '', (p.scale||100) + '%', `${p.offx||0},${p.offy||0}`];
    }));

  const sheets = [
    { name:'Resumen', header:true, cols:[34,48], rows:sumRows },
    { name:'Escenarios', header:true, cols:[10,16,46,40,11,20,13,13,40, ...extraCols.map(()=>22)],
      rows:[scHeaders, ...scRows], validations:[{ range:`G2:G${scRows.length+1}`, values:STATUSES }] },
    { name:'Hallazgos', header:true, cols:[10,44,13,20,13,26,18,54,18], rows:[fdHeaders, ...fdRows] },
    { name:'Comparaciones', header:true, cols:[30,26,26,13,9,11,12,14], rows:diffRows }
  ];
  downloadBlob(`resultados-qa-${slug(S.meta.project || 'proyecto')}-${todayISO()}.xlsx`, buildXlsx(sheets));
  toast('Excel generado', 'Resumen, escenarios, hallazgos y comparaciones.', 'ok');
}

/* ---------- datos de ejemplo ---------- */
function loadDemoScenarios(){
  const demo = [
    ['CP-001','Home','El banner principal coincide con el frame Home/Desktop','Imagen, título y CTA en la misma posición y tamaño','Alta','Home/Desktop'],
    ['CP-002','Home','Tipografías de títulos y cuerpo según la guía','Familia, peso, tamaño e interlineado iguales al diseño','Media','Home/Desktop'],
    ['CP-003','Home','Paleta de colores de botones y enlaces','Colores exactos (ΔE < 2) respecto al diseño','Media','Home/Desktop'],
    ['CP-004','Home','Espaciados verticales entre secciones','Márgenes y paddings con tolerancia de ±2 px','Media','Home/Desktop'],
    ['CP-005','Login','Estados del formulario: foco, error y deshabilitado','Cada estado coincide con el frame Login/Estados','Alta','Login/Estados'],
    ['CP-006','Login','Mensajes de validación','Texto y color de error iguales al diseño','Alta','Login/Estados'],
    ['CP-007','Responsive','Home a 768 px','Se respeta el frame Home/Tablet','Alta','Home/Tablet'],
    ['CP-008','Responsive','Home a 390 px','Se respeta el frame Home/Mobile','Crítica','Home/Mobile']
  ];
  S.scenarios = demo.map(([code, module, name, expected, priority, ref]) =>
    ({ id:uid('sc'), code, module, name, steps:'', expected, priority, ref, status:'Pendiente', severity:'', note:'', evidence:null, extra:{} }));
  S.ui.scPage = 1;
  rebuildFilters(); renderScenarios(); updateKpis(); saveLocal();
  toast('Ejemplo cargado', '8 escenarios de muestra para probar el flujo.', 'ok');
}
