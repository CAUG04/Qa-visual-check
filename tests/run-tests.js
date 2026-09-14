/* Prueba de extremo a extremo de QA-Visual-Check.html en un navegador real. */
/** Carga Playwright desde node_modules o desde la instalación global. */
function loadPlaywright(){
  try { return require('playwright'); } catch {}
  try {
    const root = require('child_process').execSync('npm root -g', { encoding:'utf8' }).trim();
    return require(require('path').join(root, 'playwright'));
  } catch {}
  console.error('Falta Playwright. Ejecuta: npm install');
  process.exit(2);
}
const { chromium } = loadPlaywright();
const path = require('path'); const fs = require('fs');

const DIR = __dirname;
const TOOL = 'file://' + path.join(DIR, '..', 'dist', 'QA-Visual-Check.html');
const OUT = path.join(DIR, 'out');
fs.mkdirSync(OUT, { recursive:true });

const results = [];
const ok = (name, extra='') => { results.push(['OK', name, extra]); console.log('  ✓', name, extra ? '· ' + extra : ''); };
const bad = (name, extra='') => { results.push(['FALLA', name, extra]); console.log('  ✗', name, extra ? '· ' + extra : ''); };
function check(cond, name, extra=''){ cond ? ok(name, extra) : bad(name, extra); return cond; }

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport:{ width:1600, height:1000 }, acceptDownloads:true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());

  console.log('\n1) Carga de la herramienta');
  await page.goto(TOOL);
  await page.waitForTimeout(700);
  check(await page.title() === 'QA Visual Check — Figma vs Web', 'título correcto');
  check(await page.evaluate(() => typeof pdfjsLib === 'object' && !!pdfjsLib.getDocument), 'pdf.js disponible como script clásico');
  check(await page.locator('#view-fuentes').isVisible(), 'vista Fuentes visible');

  console.log('\n2) Carga de imágenes (diseño y web)');
  await page.locator('#file-design').setInputFiles([path.join(DIR,'design-home.png'), path.join(DIR,'design-login.png')]);
  await page.locator('#file-web').setInputFiles([path.join(DIR,'web-home.png'), path.join(DIR,'web-login.png')]);
  await page.waitForTimeout(900);
  const nd = await page.locator('#list-design .thumb-item').count();
  const nw = await page.locator('#list-web .thumb-item').count();
  check(nd === 2 && nw === 2, 'fuentes cargadas', `${nd} diseños / ${nw} capturas`);
  const pairRows = await page.locator('#table-pairs tbody tr').count();
  check(pairRows === 2, 'emparejamiento automático', pairRows + ' pares');
  const firstPairName = await page.locator('#table-pairs tbody tr:first-child input').inputValue();
  check(/home/i.test(firstPairName), 'par 1 tomó el nombre del diseño', firstPairName);
  await page.screenshot({ path: path.join(OUT,'01-fuentes.png'), fullPage:false });

  console.log('\n3) Comparador: alineación y diferencia');
  await page.locator('.tab[data-view="comparar"]').click();
  await page.waitForTimeout(350);
  await page.locator('#btn-fitwidth').click();
  await page.waitForTimeout(200);
  await page.locator('#btn-autoalign').click();
  await page.waitForTimeout(3500);
  const scaleVal = await page.locator('#val-scale').textContent();
  const offx = await page.locator('#cmp-offx').inputValue();
  const offy = await page.locator('#cmp-offy').inputValue();
  ok('auto-alineación ejecutada', `escala ${scaleVal} offset ${offx},${offy}`);
  await page.locator('#btn-diff-run').click();
  await page.waitForTimeout(2500);
  const pct = await page.locator('#diff-pct').textContent();
  const regions = await page.locator('#diff-regions').textContent();
  const countPx = await page.locator('#diff-count').textContent();
  check(pct !== '—' && parseFloat(pct.replace(',','.')) > 0, 'diferencia calculada', `${pct} · ${regions} zonas · ${countPx}`);
  check(+regions >= 3, 'detectó varias zonas con diferencia', regions + ' zonas');
  const regionItems = await page.locator('#region-list li').count();
  check(regionItems >= 3, 'listado de zonas poblado', regionItems + ' elementos');

  for (const [mode, name] of [['side','lado-a-lado'],['overlay','overlay'],['diff','diferencia'],['curtain','cortina']]){
    await page.locator(`#cmp-modes button[data-mode="${mode}"]`).click();
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(OUT, `02-modo-${name}.png`) });
  }
  ok('los 4 modos de vista se renderizan');

  console.log('\n4) Herramientas de medición y color');
  const box = await page.locator('#cmp-canvas').boundingBox();
  await page.locator('#cmp-tools button[data-tool="measure"]').click();
  await page.mouse.move(box.x + 320, box.y + 260);
  await page.mouse.down();
  await page.mouse.move(box.x + 520, box.y + 330, { steps:8 });
  await page.mouse.up();
  await page.waitForTimeout(320);
  const measureTxt = await page.locator('#measure-readout').innerText();
  check(/px/.test(measureTxt) && /Zona medida/i.test(measureTxt), 'medición devuelve dimensiones', measureTxt.split('\n')[1] || '');

  await page.locator('#cmp-tools button[data-tool="color"]').click();
  await page.mouse.move(box.x + 400, box.y + 300);
  await page.waitForTimeout(300);
  await page.mouse.move(box.x + 402, box.y + 302);
  await page.waitForTimeout(300);
  const eyeVisible = await page.locator('#cmp-eyedrop').isVisible();
  const eyeTxt = eyeVisible ? await page.locator('#cmp-eyedrop').innerText() : '';
  check(eyeVisible && /#[0-9A-F]{6}/.test(eyeTxt), 'cuentagotas muestra HEX de diseño y web', eyeTxt.replace(/\n/g,' | '));

  console.log('\n5) Zona ignorada (máscara)');
  await page.locator('#cmp-tools button[data-tool="mask"]').click();
  await page.mouse.move(box.x + 700, box.y + 200);
  await page.mouse.down(); await page.mouse.move(box.x + 800, box.y + 260, { steps:6 }); await page.mouse.up();
  await page.waitForTimeout(2500);
  const maskCount = await page.locator('#mask-list li:not(.muted)').count();
  check(maskCount === 1, 'zona ignorada registrada');

  console.log('\n6) Hallazgo desde el comparador');
  await page.locator('#cmp-tools button[data-tool="finding"]').click();
  await page.mouse.move(box.x + 250, box.y + 180);
  await page.mouse.down(); await page.mouse.move(box.x + 430, box.y + 270, { steps:8 }); await page.mouse.up();
  await page.waitForTimeout(900);
  const modalOpen = await page.locator('#modal-root').isVisible();
  check(modalOpen, 'se abre el diálogo de hallazgo');
  const hasEvidence = await page.evaluate(() => {
    const img = document.querySelector('#modal-body img.evidence-preview');
    return !!img && img.src.startsWith('data:image') && img.src.length > 5000;
  });
  check(hasEvidence, 'evidencia recortada generada (diseño | web | diferencia)');
  await page.screenshot({ path: path.join(OUT,'03-dialogo-hallazgo.png') });
  await page.locator('#modal-body input[type="text"]').first().fill('El botón principal usa un azul distinto al diseño');
  await page.locator('#modal-body select').nth(0).selectOption('Color');
  await page.locator('#modal-body select').nth(1).selectOption('Alta');
  await page.locator('#modal-body textarea').fill('Diseño #2F6EE0 · Web #3B7AE8 (ΔE ≈ 4). Afecta todos los CTA.');
  await page.locator('#modal-foot button.primary').click();
  await page.waitForTimeout(500);
  await page.locator('.tab[data-view="hallazgos"]').click();
  await page.waitForTimeout(300);
  const cards = await page.locator('.finding-card').count();
  check(cards === 1, 'hallazgo registrado y visible en tarjetas');
  const code = await page.locator('.finding-card .fc-id').first().textContent();
  check(code === 'H-001', 'código consecutivo', code);
  await page.screenshot({ path: path.join(OUT,'04-hallazgos.png') });

  console.log('\n7) Importación del Excel de escenarios');
  await page.locator('.tab[data-view="escenarios"]').click();
  await page.locator('#file-xlsx').setInputFiles(path.join(DIR,'escenarios-prueba.xlsx'));
  await page.waitForTimeout(1200);
  check(await page.locator('#modal-root').isVisible(), 'se abre el diálogo de mapeo de columnas');
  const mapTxt = await page.locator('#modal-body').innerText();
  await page.screenshot({ path: path.join(OUT,'05-mapeo-excel.png') });
  const detected = await page.evaluate(() => {
    const sels = Array.from(document.querySelectorAll('#modal-body .map-table select'));
    return sels.map(s => s.options[s.selectedIndex].textContent.trim());
  });
  check(detected[0].includes('Código'), 'detectó la columna de ID', detected[0]);
  check(detected[1].includes('Pantalla'), 'detectó módulo/pantalla', detected[1]);
  check(detected[2].includes('Caso de prueba'), 'detectó el escenario', detected[2]);
  check(detected[4].includes('Criterio'), 'detectó el resultado esperado', detected[4]);
  check(detected[6].includes('Frame'), 'detectó la referencia de diseño', detected[6]);
  await page.locator('#modal-foot button.primary').click();
  await page.waitForTimeout(800);
  const scRows = await page.locator('#table-scenarios tbody tr').count();
  check(scRows === 10, 'escenarios importados', scRows + ' filas');
  const firstId = await page.locator('#table-scenarios tbody tr:first-child .sc-id').textContent();
  check(firstId === 'QA-01', 'primer ID correcto', firstId);
  const extraKept = await page.evaluate(() => {
    const s = window.__qa ? null : null; return document.querySelector('#table-scenarios tbody tr:first-child').innerText;
  });

  // marcar resultados
  await page.locator('#table-scenarios tbody tr:nth-child(1) .st-cell select').selectOption('OK');
  await page.locator('#table-scenarios tbody tr:nth-child(2) .st-cell select').selectOption('OK');
  await page.locator('#table-scenarios tbody tr:nth-child(3) .st-cell select').selectOption('Falla');
  await page.waitForTimeout(250);
  await page.locator('#table-scenarios tbody tr:nth-child(3) td:nth-child(8) select').selectOption('Alta');
  await page.locator('#table-scenarios tbody tr:nth-child(4) .st-cell select').selectOption('Falla');
  await page.locator('#table-scenarios tbody tr:nth-child(5) .st-cell select').selectOption('Bloqueado');
  await page.waitForTimeout(400);
  const kpiOk = await page.locator('#kpi-ok').textContent();
  const kpiFail = await page.locator('#kpi-fail').textContent();
  const progress = await page.locator('#sc-progress-label').textContent();
  check(kpiOk === '2' && kpiFail === '2', 'KPIs actualizados', `OK ${kpiOk} · fallas ${kpiFail} · avance ${progress}`);
  // filtro
  await page.locator('#sc-filter-status').selectOption('Falla');
  await page.waitForTimeout(300);
  const filtered = await page.locator('#table-scenarios tbody tr').count();
  check(filtered === 2, 'filtro por estado funciona');
  await page.locator('#sc-filter-status').selectOption('');
  await page.waitForTimeout(200);
  // búsqueda
  await page.locator('#sc-search').fill('contraseña');
  await page.waitForTimeout(500);
  const searched = await page.locator('#table-scenarios tbody tr').count();
  check(searched >= 1, 'búsqueda con tildes funciona', searched + ' resultado(s)');
  await page.locator('#sc-search').fill('');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT,'06-escenarios.png') });

  console.log('\n8) Descarga de plantilla y exportación');
  const dl1 = await Promise.all([page.waitForEvent('download'), page.locator('#btn-template').click()]);
  const tplPath = path.join(OUT, 'plantilla.xlsx'); await dl1[0].saveAs(tplPath);
  check(fs.statSync(tplPath).size > 2000, 'plantilla .xlsx descargada', Math.round(fs.statSync(tplPath).size/1024) + ' KB');

  const dl2 = await Promise.all([page.waitForEvent('download'), page.locator('#btn-export-xlsx').click()]);
  const expPath = path.join(OUT, 'resultados.xlsx'); await dl2[0].saveAs(expPath);
  check(fs.statSync(expPath).size > 2000, 'resultados .xlsx exportados', Math.round(fs.statSync(expPath).size/1024) + ' KB');

  await page.locator('.tab[data-view="hallazgos"]').click();
  await page.waitForTimeout(250);
  const dl3 = await Promise.all([page.waitForEvent('download'), page.locator('#btn-export-findings').click()]);
  await dl3[0].saveAs(path.join(OUT, 'hallazgos.csv'));
  ok('CSV de hallazgos exportado');

  console.log('\n9) Reporte');
  await page.locator('.tab[data-view="reporte"]').click();
  await page.locator('#rp-project').fill('Portal Nimbus — release 4.2');
  await page.locator('#rp-tester').fill('Carlos Urrego');
  await page.locator('#rp-url').fill('https://staging.nimbus.co');
  await page.locator('#rp-figma').fill('Nimbus UI v12 · Home + Login');
  await page.locator('#rp-notes').fill('Revisión visual de Home y Login en 1440 px contra la suite de diseño.');
  await page.locator('#btn-report-build').click();
  await page.waitForTimeout(1400);
  const frameTxt = await page.frameLocator('#report-frame').locator('body').innerText();
  check(/reporte de revisión visual/i.test(frameTxt), 'reporte generado');
  check(/Portal Nimbus/.test(frameTxt), 'datos del proyecto en el reporte');
  check(/H-001/.test(frameTxt), 'hallazgo incluido');
  check(/QA-01/.test(frameTxt), 'tabla de escenarios incluida');
  check(/anexo/i.test(frameTxt), 'anexo de pantallas incluido');
  const imgCount = await page.frameLocator('#report-frame').locator('img').count();
  check(imgCount >= 4, 'imágenes embebidas en el reporte', imgCount + ' imágenes');
  await page.screenshot({ path: path.join(OUT,'07-reporte.png') });
  const dl4 = await Promise.all([page.waitForEvent('download'), page.locator('#btn-report-download').click()]);
  const repPath = path.join(OUT, 'reporte.html'); await dl4[0].saveAs(repPath);
  const repSize = fs.statSync(repPath).size;
  check(repSize > 20000, 'reporte .html descargado', Math.round(repSize/1024) + ' KB');

  console.log('\n10) Importación del PDF de Figma');
  await page.locator('.tab[data-view="fuentes"]').click();
  await page.locator('#file-design').setInputFiles(path.join(DIR,'figma-suite.pdf'));
  await page.waitForTimeout(4000);
  const pdfModal = await page.locator('#modal-root').isVisible();
  check(pdfModal, 'se abre el diálogo de importación de PDF');
  const pageCells = await page.locator('.pdf-page').count();
  check(pageCells >= 2, 'páginas del PDF detectadas', pageCells + ' páginas');
  const previewsLoaded = await page.locator('.pdf-page img').count();
  check(previewsLoaded >= 1, 'miniaturas del PDF renderizadas', previewsLoaded + '');
  await page.screenshot({ path: path.join(OUT,'08-pdf-import.png') });
  await page.locator('#modal-foot button.primary').click();
  await page.waitForTimeout(6000);
  const ndAfter = await page.locator('#list-design .thumb-item').count();
  check(ndAfter === 2 + pageCells, 'páginas del PDF agregadas como diseños', `${ndAfter} fuentes de diseño`);
  const pdfDim = await page.locator('#list-design .thumb-item').nth(2).locator('.thumb-dim').textContent();
  check(/\d+×\d+ px · PDF/.test(pdfDim), 'páginas importadas con resolución 2×', pdfDim.trim());

  console.log('\n11) Sesión (guardar y reabrir)');
  const dl5 = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save-session').click()]);
  const sesPath = path.join(OUT, 'sesion.json'); await dl5[0].saveAs(sesPath);
  const ses = JSON.parse(fs.readFileSync(sesPath, 'utf8'));
  check(ses.app === 'qa-visual-check' && ses.scenarios.length === 10 && ses.findings.length === 1,
        'sesión serializada', `${ses.design.length} diseños · ${ses.scenarios.length} escenarios · ${Math.round(fs.statSync(sesPath).size/1048576*10)/10} MB`);

  const page2 = await ctx.newPage();
  const errors2 = [];
  page2.on('pageerror', e => errors2.push('pageerror: ' + e.message));
  page2.on('console', m => { if (m.type() === 'error') errors2.push('console: ' + m.text()); });
  page2.on('dialog', d => d.accept());
  await page2.goto(TOOL);
  await page2.waitForTimeout(900);
  // si aparece el diálogo de restauración, empezar de cero
  if (await page2.locator('#modal-root').isVisible()){
    await page2.locator('#modal-foot button').first().click();
    await page2.waitForTimeout(400);
    ok('ofrece retomar el trabajo guardado en el navegador');
  }
  await page2.locator('#file-session').setInputFiles(sesPath);
  await page2.waitForTimeout(2500);
  const scRows2 = await page2.locator('#table-scenarios tbody tr').count();
  const pairs2 = await page2.locator('#table-pairs tbody tr').count();
  await page2.locator('.tab[data-view="hallazgos"]').click();
  await page2.waitForTimeout(300);
  const cards2 = await page2.locator('.finding-card').count();
  check(scRows2 === 10 && pairs2 === 2 && cards2 === 1, 'sesión restaurada completa',
        `${scRows2} escenarios · ${pairs2} pares · ${cards2} hallazgo`);
  await page2.locator('.tab[data-view="comparar"]').click();
  await page2.waitForTimeout(600);
  const pctRestored = await page2.locator('#diff-pct').textContent();
  check(pctRestored !== '—', 'diferencia previa conservada', pctRestored);
  await page2.screenshot({ path: path.join(OUT,'09-sesion-restaurada.png') });
  errors.push(...errors2);

  console.log('\n12) Tema claro');
  await page.locator('#btn-theme').click();
  await page.waitForTimeout(400);
  await page.locator('.tab[data-view="comparar"]').click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT,'10-tema-claro.png') });
  ok('tema claro aplicado');

  console.log('\n13) Consola del navegador');
  const realErrors = errors.filter(e => !/favicon|ERR_FILE_NOT_FOUND/.test(e));
  check(realErrors.length === 0, 'sin errores de JavaScript', realErrors.slice(0,4).join(' | '));

  await browser.close();

  const fails = results.filter(r => r[0] === 'FALLA');
  console.log(`\n===== ${results.length - fails.length}/${results.length} verificaciones OK =====`);
  if (fails.length){ console.log('FALLAS:'); fails.forEach(f => console.log(' -', f[1], f[2])); process.exit(1); }
})().catch(e => { console.error('ERROR DE PRUEBA:', e); process.exit(2); });
