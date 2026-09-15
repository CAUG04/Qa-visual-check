/* =========================================================================
   ARRANQUE: conexión de todos los controles
   ========================================================================= */

function bindDropzones(){
  for (const dz of $$('.dropzone')){
    const kind = dz.dataset.kind;
    const input = $('#file-' + kind);
    dz.addEventListener('click', () => { pasteTarget = kind; input.click(); });
    dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); input.click(); } });
    dz.addEventListener('mouseenter', () => setPasteTarget(kind));
    dz.addEventListener('dragenter', e => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', async e => {
      e.preventDefault(); e.stopPropagation(); dz.classList.remove('over');
      await handleFiles(kind, e.dataTransfer.files);
    });
    input.addEventListener('change', async () => { await handleFiles(kind, input.files); input.value = ''; });
  }
  $$('[data-act="pick"]').forEach(b => b.addEventListener('click', () => {
    pasteTarget = b.dataset.kind; $('#file-' + b.dataset.kind).click();
  }));
  $$('[data-act="clear"]').forEach(b => b.addEventListener('click', () => {
    const kind = b.dataset.kind;
    if (!S[kind].length) return;
    if (!confirm(`¿Quitar las ${S[kind].length} fuentes de ${kind === 'design' ? 'diseño' : 'web'}?`)) return;
    S[kind] = [];
    S.pairs.forEach(p => { if (p[kind+'Id']){ p[kind+'Id'] = null; p.diff = null; p.diffCanvas = null; p._L = null; } });
    renderSources(); renderPairs(); refreshPairSelect(); cmpDraw(); saveLocal();
  }));
}
function setPasteTarget(kind){
  pasteTarget = kind;
  $$('.dropzone').forEach(d => d.classList.toggle('dz-active', d.dataset.kind === kind));
}

/** Arrastrar archivos sobre cualquier parte de la app. */
function bindGlobalDrop(){
  document.addEventListener('dragover', e => { e.preventDefault(); });
  document.addEventListener('drop', async e => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer?.files || []);
    if (!files.length) return;
    const sheetFiles = files.filter(f => /\.(xlsx|xlsm|csv|tsv)$/i.test(f.name));
    const jsonFiles  = files.filter(f => /\.json$/i.test(f.name));
    const media      = files.filter(f => !sheetFiles.includes(f) && !jsonFiles.includes(f));
    for (const f of sheetFiles) await importScenariosFile(f);
    for (const f of jsonFiles)  await loadSessionFile(f);
    if (media.length) await handleFiles(pasteTarget, media);
  });
}

/* ---------- sesión ---------- */
function saveSession(){
  reportReadForm();
  const data = serialize(true);
  const json = JSON.stringify(data);
  const mb = (json.length / 1048576).toFixed(1);
  downloadText(`sesion-qa-${slug(S.meta.project || 'proyecto')}-${todayISO()}.json`, json, 'application/json');
  toast('Sesión guardada', `Archivo de ${mb} MB con imágenes, escenarios y hallazgos. Ábrelo con «Abrir» para retomar.`, 'ok', 6000);
}
async function loadSessionFile(file){
  try {
    const data = JSON.parse(await file.text());
    await deserialize(data);
    toast('Sesión cargada', `${S.scenarios.length} escenarios · ${S.findings.length} hallazgos · ${S.pairs.length} pares.`, 'ok');
  } catch (e){
    console.warn('Sesión rechazada:', e?.message); toast('No se pudo abrir', e.message || 'Archivo inválido', 'err', 6000);
  }
}

/* ---------- restauración del guardado local ---------- */
async function offerRestore(){
  const data = readLocal();
  if (!data) return false;
  const n = (data.scenarios?.length || 0) + (data.findings?.length || 0) + (data.pairs?.length || 0);
  if (!n) return false;
  const when = data.savedAt ? new Date(data.savedAt).toLocaleString('es-CO') : 'una sesión anterior';
  return new Promise(res => {
    openModal({
      title:'Retomar la revisión anterior',
      body: el('div', {},
        el('p', {}, `Se encontró trabajo guardado en este navegador (${when}):`),
        el('ul', { style:'color:var(--tx-2);line-height:1.7' },
          el('li', {}, `${data.scenarios?.length || 0} escenarios con sus estados y observaciones`),
          el('li', {}, `${data.findings?.length || 0} hallazgos`),
          el('li', {}, `${data.pairs?.length || 0} pares de comparación`)),
        el('p', { class:'muted small' }, 'Las imágenes en alta resolución no se guardan en el navegador: vuelve a cargar los archivos ' +
          'de diseño y de la web, o abre el .json de la sesión si lo guardaste.')),
      foot:[
        { label:'Empezar de cero', onClick:()=>{ try{ localStorage.removeItem(LS_KEY); }catch{} closeModal(); res(false); } },
        { label:'Retomar', cls:'primary', onClick:async ()=>{ closeModal(); await deserialize(data); res(true); } }
      ],
      onClose:()=>res(false)
    });
  });
}

/* ---------- arranque ---------- */
async function boot(){
  document.documentElement.dataset.theme = S.ui.theme;

  // pestañas
  $$('.tab').forEach(t => t.addEventListener('click', () => switchView(t.dataset.view)));

  // barra superior
  $('#meta-project').addEventListener('input', e => { S.meta.project = e.target.value; $('#rp-project').value = e.target.value; saveLocal(); });
  $('#btn-theme').addEventListener('click', () => setTheme(S.ui.theme === 'dark' ? 'light' : 'dark'));
  $('#btn-help').addEventListener('click', showHelp);
  $('#btn-save-session').addEventListener('click', saveSession);
  $('#btn-open-session').addEventListener('click', () => $('#file-session').click());
  $('#file-session').addEventListener('change', async e => {
    const f = e.target.files[0]; if (f) await loadSessionFile(f); e.target.value = '';
  });

  // fuentes
  bindDropzones(); bindGlobalDrop();
  document.addEventListener('paste', handlePaste);
  if (navigator.mediaDevices?.getDisplayMedia) $('#btn-capture').hidden = false;
  $('#btn-capture').addEventListener('click', captureScreen);
  $('#btn-autopair').addEventListener('click', () => autoPair());
  $('#btn-addpair').addEventListener('click', () => {
    const p = addPair(S.design[0]?.id || null, S.web[0]?.id || null, '');
    S.activePairId = p.id; renderPairs(); refreshPairSelect(); cmpSetPair(p.id, { keepView:false }); saveLocal();
  });

  // comparador
  cmpInit(); cmpBindToolbar(); cmpBindKeys();
  setMode(S.ui.mode); setTool(S.ui.tool);

  // escenarios
  const openXlsx = () => $('#file-xlsx').click();
  $('#btn-import-xlsx').addEventListener('click', openXlsx);
  $('#btn-import-xlsx-2').addEventListener('click', openXlsx);
  $('#file-xlsx').addEventListener('change', async e => {
    const f = e.target.files[0]; if (f) await importScenariosFile(f); e.target.value = '';
  });
  $('#btn-template').addEventListener('click', downloadTemplate);
  $('#btn-template-2').addEventListener('click', downloadTemplate);
  $('#btn-demo-scenarios').addEventListener('click', loadDemoScenarios);
  $('#btn-export-xlsx').addEventListener('click', exportResults);
  $('#sc-search').addEventListener('input', debounce(() => { S.ui.scPage = 1; renderScenarios(); }, 220));
  ['#sc-filter-status','#sc-filter-prio','#sc-filter-mod'].forEach(sel =>
    $(sel).addEventListener('change', () => { S.ui.scPage = 1; renderScenarios(); }));

  // hallazgos
  $('#btn-new-finding').addEventListener('click', () => openFindingDialog({ pair:getPair() }));
  $('#btn-export-findings').addEventListener('click', exportFindingsCsv);
  ['#fd-filter-sev','#fd-filter-cat','#fd-filter-state'].forEach(sel =>
    $(sel).addEventListener('change', renderFindings));

  // reporte
  ['rp-project','rp-client','rp-tester','rp-date','rp-url','rp-browser','rp-viewport','rp-figma','rp-notes']
    .forEach(id => $('#' + id).addEventListener('change', reportReadForm));
  $('#btn-report-build').addEventListener('click', reportPreview);
  $('#btn-report-download').addEventListener('click', reportDownload);
  $('#btn-report-open').addEventListener('click', reportOpenTab);
  $('#btn-report-xlsx').addEventListener('click', exportResults);

  // modal
  $$('#modal-root [data-close]').forEach(n => n.addEventListener('click', closeModal));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal-root').hidden) closeModal(); });

  // avisar antes de cerrar con trabajo sin exportar
  window.addEventListener('beforeunload', e => {
    if (skipUnloadWarning) return;
    if (S.scenarios.length || S.findings.length || S.design.length || S.web.length){
      e.preventDefault(); e.returnValue = '';
    }
  });

  initPdfWorker();
  setPasteTarget('design');

  const restored = await offerRestore();
  if (!restored){
    S.meta.date = todayISO();
    S.meta.browser = detectBrowser();
    S.meta.viewport = `${window.innerWidth}×${window.innerHeight}`;
    applyStateToUI();
  }
  renderMasks();
  reportSyncForm();
  updateKpis();
}

document.addEventListener('DOMContentLoaded', () => {
  boot().catch(e => { console.error(e); toast('Error al iniciar', e.message || String(e), 'err', 9000); });
});
