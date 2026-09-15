/* =========================================================================
   HALLAZGOS: registro con evidencia recortada, edición y exportación
   ========================================================================= */

function nextFindingCode(){
  S.counters.finding = (S.counters.finding || 0) + 1;
  return 'H-' + String(S.counters.finding).padStart(3, '0');
}

function openFindingDialog({ pair=null, rect=null, prefill={}, finding=null } = {}){
  const isEdit = !!finding;
  const p = pair || (finding ? getPair(finding.pairId) : getPair());
  const f = finding || {
    id:uid('fd'), code:null, title:prefill.title || '', desc:prefill.desc || '',
    category:prefill.category || 'Otro', severity:prefill.severity || 'Media', state:'Abierto',
    pairId:p?.id || null, pairName:p ? pairName(p) : '', rect, evidence:null,
    scenarioCode:prefill.scenarioCode || '', createdAt:new Date().toISOString()
  };
  if (!isEdit && rect && p){
    try { f.evidence = buildEvidence(p, rect, { includeDiff: !!p.diffCanvas }); }
    catch(e){ console.warn('evidencia', e); }
  }

  const title = el('input', { type:'text', value:f.title, placeholder:'Qué está distinto respecto al diseño' });
  const cat = el('select', {}, CATEGORIES.map(c => el('option', { value:c, selected:f.category === c }, c)));
  const sev = el('select', {}, ['Bloqueante','Alta','Media','Baja','Cosmético']
    .map(c => el('option', { value:c, selected:f.severity === c }, c)));
  const state = el('select', {}, ['Abierto','Corregido','Descartado']
    .map(c => el('option', { value:c, selected:f.state === c }, c)));
  const scSel = el('select', {}, el('option', { value:'' }, '— ninguno —'),
    S.scenarios.map(s => el('option', { value:s.code, selected:f.scenarioCode === s.code },
      `${s.code} · ${String(s.name).slice(0,54)}`)));
  const desc = el('textarea', { rows:4, placeholder:'Detalle: valores esperados vs. obtenidos, cómo reproducirlo…' }, f.desc);
  const markFail = el('input', { type:'checkbox', checked:!isEdit });

  const evImg = el('img', { class:'evidence-preview', src:f.evidence || '', alt:'',
    style:f.evidence ? '' : 'display:none' });
  const evActions = el('div', { class:'row-actions' },
    p && f.rect ? el('button', { class:'btn sm ghost', onclick:()=>{
      f.evidence = buildEvidence(p, f.rect, { includeDiff:!!p.diffCanvas });
      evImg.src = f.evidence || ''; evImg.style.display = f.evidence ? '' : 'none';
    } }, 'Regenerar recorte') : null,
    el('button', { class:'btn sm ghost', onclick:()=>{
      const s = stageSnapshot();
      if (!s){ toast('Sin comparación activa', 'Abre un par en «Comparar».', 'warn'); return; }
      f.evidence = s; evImg.src = s; evImg.style.display = '';
    } }, 'Usar la vista actual'),
    el('button', { class:'btn sm ghost', onclick:()=>{
      const inp = $('#file-evidence');
      inp.onchange = async () => {
        const file = inp.files[0]; if (!file) return;
        const img = await imgFromSrc(await readAsDataURL(file));
        f.evidence = makeThumb(img, 1100, 0.85); evImg.src = f.evidence; evImg.style.display = '';
        inp.value = '';
      };
      inp.click();
    } }, 'Subir imagen'),
    f.evidence ? el('button', { class:'btn sm danger', onclick:()=>{ f.evidence = null; evImg.style.display = 'none'; } }, 'Quitar') : null);

  const body = el('div', {},
    el('div', { class:'form-grid' },
      el('label', { class:'fld wide' }, el('span', {}, 'Título del hallazgo'), title),
      el('label', { class:'fld' }, el('span', {}, 'Categoría'), cat),
      el('label', { class:'fld' }, el('span', {}, 'Severidad'), sev),
      el('label', { class:'fld' }, el('span', {}, 'Estado'), state),
      el('label', { class:'fld' }, el('span', {}, 'Escenario relacionado'), scSel),
      el('label', { class:'fld wide' }, el('span', {}, 'Descripción'), desc)),
    f.rect ? el('p', { class:'muted small' },
      `Pantalla: ${esc(f.pairName || '—')} · zona ${f.rect.w}×${f.rect.h} px en x ${f.rect.x}, y ${f.rect.y}`) : null,
    el('label', { class:'chk', style:'margin:4px 0 10px' }, markFail, 'Marcar el escenario relacionado como «Falla»'),
    el('h3', { class:'muted small', style:'margin:8px 0 6px' }, 'Evidencia'),
    evImg, evActions);

  openModal({ title: isEdit ? 'Editar hallazgo ' + f.code : 'Nuevo hallazgo', body, wide:true, foot:[
    { label:'Cancelar' },
    isEdit ? { label:'Eliminar', cls:'danger', onClick:()=>{ deleteFinding(f.id); closeModal(); } } : null,
    { label: isEdit ? 'Guardar' : 'Registrar hallazgo', cls:'primary', onClick:()=>{
        f.title = title.value.trim() || 'Hallazgo sin título';
        f.category = cat.value; f.severity = sev.value; f.state = state.value;
        f.scenarioCode = scSel.value; f.desc = desc.value.trim();
        if (!isEdit){ f.code = nextFindingCode(); S.findings.push(f); }
        if (markFail.checked && f.scenarioCode){
          const sc = S.scenarios.find(s => s.code === f.scenarioCode);
          if (sc){
            sc.status = 'Falla';
            if (!sc.severity) sc.severity = f.severity;
            if (!sc.note) sc.note = `${f.code}: ${f.title}`;
            if (!sc.evidence && f.evidence) sc.evidence = f.evidence;
          }
        }
        rebuildFilters(); renderFindings(); renderScenarios(); updateKpis(); saveLocal(); closeModal();
        toast(isEdit ? 'Hallazgo actualizado' : 'Hallazgo ' + f.code, f.title, 'ok');
      } }
  ]});
  setTimeout(()=>title.focus(), 60);
}

function deleteFinding(id){
  const i = S.findings.findIndex(f => f.id === id); if (i < 0) return;
  S.findings.splice(i, 1);
  rebuildFilters(); renderFindings(); updateKpis(); saveLocal();
}

function renderFindings(){
  const grid = $('#findings-grid'); grid.innerHTML = '';
  const sev = $('#fd-filter-sev').value, cat = $('#fd-filter-cat').value, st = $('#fd-filter-state').value;
  const order = { Bloqueante:0, Alta:1, Media:2, Baja:3, 'Cosmético':4 };
  const list = S.findings
    .filter(f => (!sev || f.severity === sev) && (!cat || f.category === cat) && (!st || f.state === st))
    .sort((a,b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9) || String(a.code).localeCompare(String(b.code)));

  $('#fd-empty').hidden = S.findings.length > 0;
  $('#fd-count').textContent = S.findings.length
    ? `${list.length} de ${S.findings.length} hallazgos` : '';

  for (const f of list){
    grid.append(el('article', { class:`finding-card sev-${slug(f.severity)} state-${f.state}` },
      f.evidence ? el('img', { class:'fc-ev', src:f.evidence, alt:'',
        onclick:()=>viewImage(f.evidence, `${f.code} · ${f.title}`) }) : null,
      el('div', { class:'fc-body' },
        el('div', { class:'fc-top' },
          el('span', { class:'fc-id' }, f.code),
          el('span', { class:'pill ' + sevPill(f.severity) }, f.severity),
          el('span', { class:'pill neutral' }, f.category),
          f.state !== 'Abierto' ? el('span', { class:'pill ' + (f.state === 'Corregido' ? 'ok' : 'neutral') }, f.state) : null),
        el('h3', { class:'fc-title' }, f.title),
        f.desc ? el('p', { class:'fc-desc' }, f.desc) : null,
        el('div', { class:'fc-meta' },
          f.pairName ? el('span', {}, '🖼 ' + f.pairName) : null,
          f.rect ? el('span', {}, `⬚ ${f.rect.w}×${f.rect.h} @ ${f.rect.x},${f.rect.y}`) : null,
          f.scenarioCode ? el('span', {}, '🔗 ' + f.scenarioCode) : null)),
      el('div', { class:'fc-actions' },
        el('button', { class:'btn xs ghost', onclick:()=>openFindingDialog({ finding:f }) }, 'Editar'),
        f.pairId && S.pairs.some(p => p.id === f.pairId) ? el('button', { class:'btn xs ghost', onclick:()=>{
          cmpSetPair(f.pairId, { keepView:false }); switchView('comparar');
          if (f.rect) setTimeout(()=>zoomToBox(f.rect), 80);
        } }, 'Ver en el comparador') : null,
        f.pairId && S.pairs.some(p => p.id === f.pairId) ? el('button', { class:'btn xs ghost', title:'Recalcular la diferencia y revisar si el problema sigue',
          onclick: async ()=>{
            cmpSetPair(f.pairId, { keepView:false }); switchView('comparar');
            const p = getPair(f.pairId);
            if (p) await runDiff(p, { focus:true });
            if (f.rect) setTimeout(()=>zoomToBox(f.rect), 80);
          } }, 'Ejecutar') : null,
        el('span', { style:'flex:1' }),
        el('button', { class:'btn xs ghost', title:'Cambiar estado', onclick:()=>{
          f.state = f.state === 'Abierto' ? 'Corregido' : f.state === 'Corregido' ? 'Descartado' : 'Abierto';
          renderFindings(); updateKpis(); saveLocal();
        } }, f.state === 'Abierto' ? 'Marcar corregido' : 'Reabrir'))));
  }
}
const sevPill = s => s === 'Bloqueante' ? 'fail' : s === 'Alta' ? 'fail' : s === 'Media' ? 'warn' : s === 'Baja' ? 'ac' : 'neutral';

function exportFindingsCsv(){
  if (!S.findings.length){ toast('Sin hallazgos', 'Todavía no hay nada para exportar.', 'warn'); return; }
  const rows = [['ID','Título','Severidad','Categoría','Estado','Pantalla','Zona','Descripción','Escenario','Creado']];
  S.findings.forEach(f => rows.push([f.code, f.title, f.severity, f.category, f.state, f.pairName,
    f.rect ? `${f.rect.x},${f.rect.y},${f.rect.w},${f.rect.h}` : '', f.desc, f.scenarioCode || '',
    (f.createdAt || '').slice(0,19).replace('T',' ')]));
  downloadText(`hallazgos-${slug(S.meta.project || 'proyecto')}-${todayISO()}.csv`, toCsv(rows), 'text/csv;charset=utf-8');
}
