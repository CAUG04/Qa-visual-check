/* =========================================================================
   REPORTE: HTML autocontenido (imprimible a PDF) con resumen, hallazgos,
   escenarios y anexo de pantallas comparadas.
   ========================================================================= */

function reportSyncForm(){
  const m = S.meta;
  if (!m.date) m.date = todayISO();
  if (!m.browser) m.browser = detectBrowser();
  if (!m.viewport) m.viewport = `${window.innerWidth}×${window.innerHeight}`;
  $('#rp-project').value = m.project || $('#meta-project').value || '';
  $('#rp-client').value = m.client || '';
  $('#rp-tester').value = m.tester || '';
  $('#rp-date').value = m.date;
  $('#rp-url').value = m.url || '';
  $('#rp-browser').value = m.browser || '';
  $('#rp-viewport').value = m.viewport || '';
  $('#rp-figma').value = m.figma || '';
  $('#rp-notes').value = m.notes || '';
}
function reportReadForm(){
  S.meta.project = $('#rp-project').value.trim();
  S.meta.client = $('#rp-client').value.trim();
  S.meta.tester = $('#rp-tester').value.trim();
  S.meta.date = $('#rp-date').value || todayISO();
  S.meta.url = $('#rp-url').value.trim();
  S.meta.browser = $('#rp-browser').value.trim();
  S.meta.viewport = $('#rp-viewport').value.trim();
  S.meta.figma = $('#rp-figma').value.trim();
  S.meta.notes = $('#rp-notes').value.trim();
  $('#meta-project').value = S.meta.project;
  saveLocal();
}
function detectBrowser(){
  const ua = navigator.userAgent;
  const os = /Mac/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : '';
  let b = 'Navegador';
  if (/Edg\//.test(ua)) b = 'Edge ' + (ua.match(/Edg\/([\d.]+)/)?.[1].split('.')[0] || '');
  else if (/OPR\//.test(ua)) b = 'Opera';
  else if (/Chrome\//.test(ua)) b = 'Chrome ' + (ua.match(/Chrome\/([\d.]+)/)?.[1].split('.')[0] || '');
  else if (/Safari\//.test(ua)) b = 'Safari ' + (ua.match(/Version\/([\d.]+)/)?.[1].split('.')[0] || '');
  else if (/Firefox\//.test(ua)) b = 'Firefox ' + (ua.match(/Firefox\/([\d.]+)/)?.[1].split('.')[0] || '');
  return (b + ' · ' + os).trim();
}

function annexThumb(item, maxW=560){
  if (!item) return null;
  if (!item.img) return item.thumb || null;
  try { return makeThumb(item.img, maxW, 0.78); } catch { return item.thumb || null; }
}

function reportStats(){
  const total = S.scenarios.length;
  const by = st => S.scenarios.filter(s => (s.status || 'Pendiente') === st).length;
  const stats = {
    total, ok:by('OK'), fail:by('Falla'), blocked:by('Bloqueado'), na:by('N/A'), pending:by('Pendiente'),
    findings:S.findings.length,
    open:S.findings.filter(f => f.state === 'Abierto').length,
    bySeverity:{}, byCategory:{},
    comparedPairs:S.pairs.filter(p => p.diff).length, pairs:S.pairs.length
  };
  stats.executed = total - stats.pending;
  stats.progress = total ? Math.round(stats.executed / total * 100) : 0;
  stats.passRate = stats.executed ? Math.round(stats.ok / stats.executed * 100) : 0;
  ['Bloqueante','Alta','Media','Baja','Cosmético'].forEach(s =>
    stats.bySeverity[s] = S.findings.filter(f => f.severity === s).length);
  S.findings.forEach(f => stats.byCategory[f.category] = (stats.byCategory[f.category] || 0) + 1);
  const diffs = S.pairs.filter(p => p.diff).map(p => p.diff.pct);
  stats.avgDiff = diffs.length ? diffs.reduce((a,b)=>a+b,0)/diffs.length : null;
  stats.maxDiff = diffs.length ? Math.max(...diffs) : null;
  return stats;
}

function buildReportHtml(){
  reportReadForm();
  const m = S.meta, st = reportStats();
  const incEv = $('#rp-inc-evidence').checked;
  const incSc = $('#rp-inc-scenarios').checked;
  const incOk = $('#rp-inc-ok').checked;
  const incPairs = $('#rp-inc-pairs').checked;
  const incDiff = $('#rp-inc-diff').checked;
  const fdate = (m.date || todayISO()).split('-').reverse().join('/');

  const sevColor = { Bloqueante:'#c8102e', Alta:'#e8590c', Media:'#b08900', Baja:'#1f6feb', 'Cosmético':'#6b7280' };
  const stColor = { OK:'#12a06a', Falla:'#d92c3c', Bloqueado:'#b97400', 'N/A':'#6b7280', Pendiente:'#9aa4b2' };

  // Defensa en profundidad: en el HTML del reporte, todo texto pasa por esc(),
  // todo número por n() y toda imagen por sImg() (solo data URL de mapa de bits).
  const n = v => { const x = Number(v); return Number.isFinite(x) ? String(Math.round(x * 100) / 100) : '0'; };
  const img = v => sImg(v, 20e6) || '';
  const plural = (n2, sing, plu) => n2 + ' ' + (n2 === 1 ? sing : plu);
  const kpi = (label, value, extra='', color='') =>
    `<div class="kpi"><span class="kpi-l">${esc(label)}</span><b class="kpi-v"${color?` style="color:${esc(color)}"`:''}>${esc(value)}</b>${extra?`<span class="kpi-e">${esc(extra)}</span>`:''}</div>`;

  const bar = (label, value, max, color) => {
    const w = max ? Math.max(value ? 2 : 0, Math.round(value / max * 100)) : 0;
    return `<div class="bar-row"><span class="bar-l">${esc(label)}</span>
      <span class="bar-t"><i style="width:${n(w)}%;background:${esc(color)}"></i></span>
      <b class="bar-v">${n(value)}</b></div>`;
  };

  const sevOrder = ['Bloqueante','Alta','Media','Baja','Cosmético'];
  const findings = [...S.findings].sort((a,b) =>
    sevOrder.indexOf(a.severity) - sevOrder.indexOf(b.severity) || String(a.code).localeCompare(String(b.code)));

  const findingsHtml = findings.length ? findings.map(f => `
    <article class="finding">
      <header>
        <span class="fcode">${esc(f.code)}</span>
        <span class="tag" style="background:${esc(sevColor[f.severity]||'#6b7280')}">${esc(f.severity)}</span>
        <span class="tag light">${esc(f.category)}</span>
        ${f.state !== 'Abierto' ? `<span class="tag light">${esc(f.state)}</span>` : ''}
        <h3>${esc(f.title)}</h3>
      </header>
      <div class="fmeta">
        ${f.pairName ? `<span><b>Pantalla:</b> ${esc(f.pairName)}</span>` : ''}
        ${f.rect ? `<span><b>Zona:</b> ${n(f.rect.w)}×${n(f.rect.h)} px en x ${n(f.rect.x)}, y ${n(f.rect.y)}</span>` : ''}
        ${f.scenarioCode ? `<span><b>Escenario:</b> ${esc(f.scenarioCode)}</span>` : ''}
      </div>
      ${f.desc ? `<p class="fdesc">${esc(f.desc).replace(/\n/g,'<br>')}</p>` : ''}
      ${incEv && f.evidence ? `<figure><img src="${img(f.evidence)}" alt="Evidencia ${esc(f.code)}"><figcaption>Diseño vs. web en la zona señalada</figcaption></figure>` : ''}
    </article>`).join('') : `<p class="empty">No se registraron hallazgos en esta revisión.</p>`;

  const scRows = (incOk ? S.scenarios : S.scenarios.filter(s => s.status !== 'OK')).map(s => `
    <tr>
      <td class="mono">${esc(s.code||'')}</td>
      <td>${esc(s.module||'')}</td>
      <td>${esc(s.name||'')}</td>
      <td class="dim">${esc(s.expected||'')}</td>
      <td>${esc(s.priority||'')}</td>
      <td><span class="st" style="color:${esc(stColor[s.status]||'#6b7280')}">${esc(s.status||'Pendiente')}</span></td>
      <td>${esc(s.severity||'')}</td>
      <td class="dim">${esc(s.note||'')}</td>
    </tr>`).join('');

  const pairsHtml = incPairs ? S.pairs.map((p, i) => {
    const d = pairDesign(p), w = pairWeb(p);
    const dT = annexThumb(d), wT = annexThumb(w);
    const pct = p.diff ? fmtPct(p.diff.pct) : '—';
    const col = !p.diff ? '#6b7280' : p.diff.pct < 0.5 ? '#12a06a' : p.diff.pct < 3 ? '#b97400' : '#d92c3c';
    return `<section class="pair">
      <h3>${n(i+1)}. ${esc(pairName(p))} <span class="pill" style="color:${esc(col)};border-color:${esc(col)}">${esc(pct)} de diferencia</span></h3>
      <div class="pair-meta">
        ${d ? `<span><b>Diseño:</b> ${esc(d.name)} (${n(d.w)}×${n(d.h)})</span>` : '<span>Sin diseño asignado</span>'}
        ${w ? `<span><b>Web:</b> ${esc(w.name)} (${n(w.w)}×${n(w.h)})</span>` : '<span>Sin captura asignada</span>'}
        <span><b>Escala aplicada:</b> ${n(p.scale||100)}% · offset ${n(p.offx||0)},${n(p.offy||0)}</span>
        ${p.diff ? `<span><b>Tolerancia:</b> ${n(p.diff.threshold)} · <b>zonas:</b> ${n(p.diff.regions)}${p.masks?.length?` · <b>zonas ignoradas:</b> ${n(p.masks.length)}`:''}</span>` : ''}
      </div>
      <div class="triple">
        ${dT ? `<figure><img src="${img(dT)}" alt="Diseño"><figcaption>Diseño</figcaption></figure>` : ''}
        ${wT ? `<figure><img src="${img(wT)}" alt="Web"><figcaption>Web</figcaption></figure>` : ''}
        ${incDiff && p.diffThumb ? `<figure><img src="${img(p.diffThumb)}" alt="Diferencia"><figcaption>Diferencia (rosa = distinto)</figcaption></figure>` : ''}
      </div>
    </section>`;
  }).join('') : '';

  const maxSev = Math.max(1, ...Object.values(st.bySeverity));
  const maxSt = Math.max(1, st.ok, st.fail, st.blocked, st.pending, st.na);
  const cats = Object.entries(st.byCategory).sort((a,b)=>b[1]-a[1]);

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reporte QA visual — ${esc(m.project || 'sin proyecto')}</title>
<style>
  :root{--tx:#161b24;--tx2:#4b5666;--tx3:#7c8798;--line:#e2e7ef;--bg:#f7f9fc;--ac:#2f6ee0}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--tx);
       font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  .page{max-width:1040px;margin:0 auto;padding:32px 26px 60px}
  h1{font-size:26px;letter-spacing:-.02em;margin:0 0 4px}
  h2{font-size:15px;text-transform:uppercase;letter-spacing:.09em;color:var(--tx3);margin:34px 0 12px;
     padding-bottom:7px;border-bottom:1px solid var(--line)}
  h3{font-size:15px;margin:0}
  .sub{color:var(--tx2);margin:0 0 18px}
  .card{background:#fff;border:1px solid var(--line);border-radius:10px;padding:16px 18px}
  .meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px 22px;margin-top:6px}
  .meta div{font-size:13px}.meta span{display:block;color:var(--tx3);font-size:11px;text-transform:uppercase;letter-spacing:.06em}
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:10px;margin:14px 0 0}
  .kpi{background:#fff;border:1px solid var(--line);border-radius:9px;padding:11px 13px}
  .kpi-l{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--tx3)}
  .kpi-v{font-size:24px;letter-spacing:-.02em;line-height:1.25;display:block}
  .kpi-e{font-size:11.5px;color:var(--tx3)}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:14px}
  .bar-row{display:grid;grid-template-columns:104px 1fr 34px;align-items:center;gap:9px;margin:6px 0;font-size:13px}
  .bar-t{background:#eef1f6;border-radius:4px;height:9px;overflow:hidden}
  .bar-t i{display:block;height:100%}
  .bar-v{text-align:right;font-variant-numeric:tabular-nums}
  .notes{white-space:pre-wrap;color:var(--tx2)}
  .finding{background:#fff;border:1px solid var(--line);border-radius:10px;padding:15px 17px;margin-bottom:13px;break-inside:avoid}
  .finding header{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:7px}
  .finding h3{flex:1 0 100%;margin-top:4px}
  .fcode{font:12px ui-monospace,Menlo,Consolas,monospace;color:var(--tx3)}
  .tag{color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;letter-spacing:.02em}
  .tag.light{background:#eef1f6;color:var(--tx2)}
  .fmeta{display:flex;gap:16px;flex-wrap:wrap;font-size:12.5px;color:var(--tx2);margin-bottom:7px}
  .fdesc{margin:0 0 10px;color:var(--tx)}
  figure{margin:0}
  .finding figure img{width:100%;border:1px solid var(--line);border-radius:7px;display:block}
  figcaption{font-size:11.5px;color:var(--tx3);margin-top:5px}
  table{width:100%;border-collapse:collapse;background:#fff;font-size:12.5px;border:1px solid var(--line);border-radius:8px;overflow:hidden}
  th{background:#f1f4f9;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--tx3);padding:8px 9px;border-bottom:1px solid var(--line)}
  td{padding:7px 9px;border-bottom:1px solid var(--line);vertical-align:top}
  tr:last-child td{border-bottom:0}
  .mono{font:12px ui-monospace,Menlo,Consolas,monospace;white-space:nowrap}
  .dim{color:var(--tx2)}
  .st{font-weight:700}
  .pair{background:#fff;border:1px solid var(--line);border-radius:10px;padding:15px 17px;margin-bottom:13px;break-inside:avoid}
  .pair h3{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px}
  .pill{font-size:11.5px;font-weight:700;border:1px solid;border-radius:999px;padding:1px 9px}
  .pair-meta{display:flex;gap:16px;flex-wrap:wrap;font-size:12.5px;color:var(--tx2);margin-bottom:11px}
  .triple{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:11px}
  .triple img{width:100%;border:1px solid var(--line);border-radius:7px;background:#fff;display:block}
  .empty{color:var(--tx3);background:#fff;border:1px dashed var(--line);border-radius:9px;padding:18px;text-align:center}
  footer{margin-top:38px;padding-top:12px;border-top:1px solid var(--line);color:var(--tx3);font-size:12px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
  @media print{
    body{background:#fff} .page{max-width:none;padding:0 6mm}
    h2{margin-top:20px} .card,.finding,.pair,table{box-shadow:none}
    .finding,.pair,tr{break-inside:avoid}
  }
  @media (max-width:720px){ .cols{grid-template-columns:1fr} }
</style></head><body><div class="page">

<h1>Reporte de revisión visual — diseño vs. web</h1>
<p class="sub">${esc(m.project || 'Proyecto sin nombre')}${m.client ? ' · ' + esc(m.client) : ''} · ${fdate}</p>

<div class="card">
  <div class="meta">
    <div><span>Responsable de QA</span>${esc(m.tester || '—')}</div>
    <div><span>Entorno / URL</span>${esc(m.url || '—')}</div>
    <div><span>Navegador y SO</span>${esc(m.browser || '—')}</div>
    <div><span>Resolución de prueba</span>${esc(m.viewport || '—')}</div>
    <div><span>Referencia de diseño</span>${esc(m.figma || '—')}</div>
    <div><span>Pantallas comparadas</span>${st.comparedPairs} de ${st.pairs}</div>
  </div>
  ${m.notes ? `<p class="notes" style="margin:14px 0 0">${esc(m.notes)}</p>` : ''}
</div>

<h2>Resumen ejecutivo</h2>
<div class="kpis">
  ${kpi('Escenarios', String(st.total), plural(st.executed, 'ejecutado', 'ejecutados'))}
  ${kpi('Avance', st.progress + '%', plural(st.pending, 'pendiente', 'pendientes'), st.progress === 100 ? '#12a06a' : '#2f6ee0')}
  ${kpi('En OK', String(st.ok), st.executed ? st.passRate + '% de lo ejecutado' : '', '#12a06a')}
  ${kpi('Fallas', String(st.fail), st.blocked ? plural(st.blocked, 'bloqueado', 'bloqueados') : '', st.fail ? '#d92c3c' : '')}
  ${kpi('Hallazgos', String(st.findings), plural(st.open, 'abierto', 'abiertos'), st.findings ? '#e8590c' : '')}
  ${kpi('Diferencia visual', st.avgDiff === null ? '—' : fmtPct(st.avgDiff), st.maxDiff === null ? 'sin cálculo' : 'máx. ' + fmtPct(st.maxDiff))}
</div>

<div class="cols">
  <div class="card">
    <h3 style="font-size:13px;margin-bottom:9px">Escenarios por estado</h3>
    ${bar('OK', st.ok, maxSt, '#12a06a')}
    ${bar('Falla', st.fail, maxSt, '#d92c3c')}
    ${bar('Bloqueado', st.blocked, maxSt, '#b97400')}
    ${bar('Pendiente', st.pending, maxSt, '#9aa4b2')}
    ${bar('N/A', st.na, maxSt, '#c3cddd')}
  </div>
  <div class="card">
    <h3 style="font-size:13px;margin-bottom:9px">Hallazgos por severidad</h3>
    ${sevOrder.map(s => bar(s, st.bySeverity[s] || 0, maxSev, sevColor[s])).join('')}
  </div>
</div>
${cats.length ? `<div class="card" style="margin-top:14px">
  <h3 style="font-size:13px;margin-bottom:9px">Hallazgos por categoría</h3>
  ${cats.map(([c, n]) => bar(c, n, Math.max(...cats.map(x=>x[1])), '#2f6ee0')).join('')}
</div>` : ''}

<h2>Hallazgos${findings.length ? ` (${findings.length})` : ''}</h2>
${findingsHtml}

${incSc && S.scenarios.length ? `<h2>Escenarios${incOk ? '' : ' con observaciones'}</h2>
<table><thead><tr><th>ID</th><th>Módulo</th><th>Escenario</th><th>Resultado esperado</th><th>Prior.</th><th>Estado</th><th>Sev.</th><th>Observación</th></tr></thead>
<tbody>${scRows || '<tr><td colspan="8" class="dim">Sin filas.</td></tr>'}</tbody></table>` : ''}

${incPairs && S.pairs.length ? `<h2>Anexo · pantallas comparadas</h2>${pairsHtml}` : ''}

<footer>
  <span>Generado con QA Visual Check · ${new Date().toLocaleString('es-CO')}</span>
  <span>${esc(m.project || '')}</span>
</footer>
</div></body></html>`;
}

let lastReportHtml = '';
function reportPreview(){
  lastReportHtml = buildReportHtml();
  const f = $('#report-frame');
  f.setAttribute('sandbox', '');       // sin scripts, sin formularios, sin navegación
  f.srcdoc = lastReportHtml;
  toast('Vista previa lista', 'Revisa el contenido antes de descargar.', 'ok', 2600);
}
function reportDownload(){
  lastReportHtml = buildReportHtml();
  $('#report-frame').setAttribute('sandbox', '');
  $('#report-frame').srcdoc = lastReportHtml;
  downloadText(`reporte-qa-visual-${slug(S.meta.project || 'proyecto')}-${todayISO()}.html`,
    lastReportHtml, 'text/html;charset=utf-8');
  toast('Reporte descargado', 'Ábrelo y usa ⌘/Ctrl+P → «Guardar como PDF» si lo necesitas en PDF.', 'ok', 6000);
}
function reportOpenTab(){
  if (!lastReportHtml) lastReportHtml = buildReportHtml();
  const url = URL.createObjectURL(new Blob([lastReportHtml], { type:'text/html' }));
  const w = window.open(url, '_blank', 'noopener,noreferrer');
  if (!w) toast('Ventana bloqueada', 'El navegador bloqueó la pestaña nueva; usa «Descargar reporte».', 'warn');
  setTimeout(()=>URL.revokeObjectURL(url), 20000);
}
