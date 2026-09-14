/* Genera los insumos de prueba: PNG de diseño, PNG de la web y un PDF multipágina
   que imita la exportación de una suite de Figma. */
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
const path = require('path');

/** La «web implementada» es el mismo diseño con desviaciones deliberadas:
    tipografía menor, otro azul de botón, espaciados distintos, un icono que
    falta y un texto de error cambiado. Sirve para comprobar que el
    comparador encuentra exactamente esas diferencias. */
function buildWebFixture(dir){
  const fs = require('fs');
  let w = fs.readFileSync(path.join(dir, 'fixture-design.html'), 'utf8');
  const cambios = [
    ['h1{font-size:44px', 'h1{font-size:40px'],                                 // título más pequeño
    ['.cta{background:#2f6ee0', '.cta{background:#3b7ae8'],                      // otro azul
    ['nav{display:flex;gap:28px', 'nav{display:flex;gap:20px'],                  // menú más junto
    ['.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:22px',
     '.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:34px'],        // tarjetas más separadas
    ['.hero{padding:74px 64px 58px', '.hero{padding:66px 64px 58px'],            // hero 8 px arriba
    ['<i></i><h3>Reportes</h3>', '<h3>Reportes</h3>'],                           // icono faltante
    ['La contraseña debe tener al menos 8 caracteres', 'Contraseña inválida'],   // copy distinto
    ['input{width:100%;padding:11px 13px', 'input{width:100%;padding:13px 13px'] // campos más altos
  ];
  for (const [a, b] of cambios){
    if (!w.includes(a)) throw new Error('El fixture de diseño cambió: no se encontró ' + a.slice(0, 40));
    w = w.replace(a, b);
  }
  fs.writeFileSync(path.join(dir, 'fixture-web.html'), w);
}

(async () => {
  const dir = __dirname;
  buildWebFixture(dir);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport:{ width:1500, height:1000 }, deviceScaleFactor:1 });

  for (const [file, prefix] of [['fixture-design.html','design'], ['fixture-web.html','web']]){
    await page.goto('file://' + path.join(dir, file));
    await page.waitForTimeout(150);
    for (const id of ['home','login']){
      await page.locator('#' + id).screenshot({ path: path.join(dir, `${prefix}-${id}.png`) });
    }
  }

  // PDF "suite de diseño": una página por pantalla, tamaño del propio frame
  await page.goto('file://' + path.join(dir, 'fixture-design.html'));
  await page.addStyleTag({ content:'section{page-break-after:always;padding-bottom:0}' });
  await page.pdf({ path: path.join(dir, 'figma-suite.pdf'), width:'1440px', height:'900px',
                   printBackground:true, margin:{ top:'0', bottom:'0', left:'0', right:'0' } });

  await browser.close();
  console.log('fixtures OK');
})();
