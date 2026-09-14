#!/usr/bin/env python3
"""
Empaqueta QA Visual Check en un único archivo HTML autónomo.

- Convierte pdf.js (ESM) en scripts clásicos para que funcione al abrir el
  archivo con doble clic (file://), sin módulos ni peticiones de red.
- Inserta el worker de pdf.js como texto: en tiempo de ejecución se convierte
  en un Blob y se usa como Worker clásico.
"""
import base64, hashlib, json, os, re, sys, pathlib, datetime

SRC   = pathlib.Path(__file__).parent / 'src'
DIST  = pathlib.Path(__file__).parent / 'dist'
def find_pdfjs() -> pathlib.Path:
    """Busca la compilación «legacy» de pdf.js (npm i, copia local o global)."""
    import subprocess
    candidates = []
    if os.environ.get('PDFJS_DIR'):
        candidates.append(pathlib.Path(os.environ['PDFJS_DIR']))
    here = pathlib.Path(__file__).parent
    candidates += [here / 'node_modules/pdfjs-dist/legacy/build',
                   here / 'vendor/pdfjs-dist/legacy/build']
    try:
        root = subprocess.run(['npm', 'root', '-g'], capture_output=True, text=True, timeout=20).stdout.strip()
        if root:
            candidates.append(pathlib.Path(root) / 'pdfjs-dist/legacy/build')
    except Exception:
        pass
    for c in candidates:
        if (c / 'pdf.min.mjs').exists() and (c / 'pdf.worker.min.mjs').exists():
            return c
    sys.exit('No se encontró pdfjs-dist. Ejecuta: npm install  (o define PDFJS_DIR)')


PDFJS = find_pdfjs()

JS_ORDER = ['00-core.js', '10-sources.js', '20-compare.js', '30-diff.js',
            '40-xlsx.js', '50-scenarios.js', '60-findings.js', '70-report.js', '90-boot.js']


def esm_to_classic_main(src: str) -> str:
    """Reemplaza el `export{...}` final por una asignación a globalThis.pdfjsLib."""
    m = list(re.finditer(r'export\s*\{([^{}]*)\}\s*;?\s*$', src))
    if not m:
        sys.exit('No se encontró la lista de exports en pdf.min.mjs')
    body = m[-1].group(1)
    pairs = []
    for part in body.split(','):
        part = part.strip()
        if not part:
            continue
        if ' as ' in part:
            local, exported = [x.strip() for x in part.split(' as ')]
        else:
            local = exported = part
        pairs.append(f'{exported}:{local}')
    src = src[:m[-1].start()] + 'globalThis.pdfjsLib={' + ','.join(pairs) + '};\n'
    return neutralize_module_syntax(src)


def esm_to_classic_worker(src: str) -> str:
    """El worker ya publica globalThis.pdfjsWorker; solo hay que quitar el export."""
    src = re.sub(r'export\s*\{[^{}]*\}\s*;?\s*$', '', src)
    return neutralize_module_syntax(src)


def neutralize_module_syntax(src: str) -> str:
    """`import.meta.url` solo se usa en rutas de Node/WASM: basta una URL válida."""
    return src.replace('import.meta.url', '"https://localhost/pdfjs/"')


def sha256_csp(text: str) -> str:
    """Hash de un script en línea, en el formato que espera la CSP."""
    digest = hashlib.sha256(text.encode('utf-8')).digest()
    return "'sha256-" + base64.b64encode(digest).decode('ascii') + "'"


def build_csp(script_hashes: list[str], *, frame_ancestors: bool) -> str:
    """La política se define UNA vez y de aquí sale tanto la etiqueta <meta>
    como las cabeceras de los cuatro hostings.

    `script-src` lista los hashes de los scripts incrustados en lugar de
    'unsafe-inline': un script inyectado no coincide con ningún hash y el
    navegador se niega a ejecutarlo. `frame-ancestors` solo tiene efecto como
    cabecera HTTP, así que en el <meta> se omite (si no, el navegador avisa)."""
    partes = [
        "default-src 'none'",
        "script-src " + " ".join(script_hashes) + " blob:",
        "style-src 'unsafe-inline'",
        "img-src data: blob:",
        "media-src blob: data: mediastream:",
        "font-src data:",
        "worker-src blob:",
        "child-src blob:",
        "frame-src 'self' data: blob:",
        "connect-src 'none'",
        "object-src 'none'",
        "form-action 'none'",
        "base-uri 'none'",
    ]
    if frame_ancestors:
        partes.append("frame-ancestors 'none'")
    return "; ".join(partes)


def propagate_csp(csp_header: str):
    """Escribe la misma política en los archivos de configuración del hosting.
    Los hashes cambian en cada compilación, así que se regeneran aquí."""
    root = pathlib.Path(__file__).parent
    destinos = []

    for rel in ('dist/_headers', 'hosting/_headers'):
        f = root / rel
        if f.exists():
            txt = f.read_text(encoding='utf-8')
            nuevo = re.sub(r'(?m)^(\s*Content-Security-Policy:).*$',
                           lambda m: m.group(1) + ' ' + csp_header, txt)
            if nuevo != txt:
                f.write_text(nuevo, encoding='utf-8'); destinos.append(rel)

    f = root / 'netlify.toml'
    if f.exists():
        txt = f.read_text(encoding='utf-8')
        nuevo = re.sub(r'(?m)^(\s*Content-Security-Policy\s*=\s*)".*"$',
                       lambda m: m.group(1) + '"' + csp_header + '"', txt)
        if nuevo != txt:
            f.write_text(nuevo, encoding='utf-8'); destinos.append('netlify.toml')

    f = root / 'vercel.json'
    if f.exists():
        data = json.loads(f.read_text(encoding='utf-8'))
        cambiado = False
        for bloque in data.get('headers', []):
            for h in bloque.get('headers', []):
                if h.get('key') == 'Content-Security-Policy' and h.get('value') != csp_header:
                    h['value'] = csp_header; cambiado = True
        if cambiado:
            f.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
            destinos.append('vercel.json')

    return destinos


def main():
    tpl = (SRC / 'index.html').read_text(encoding='utf-8')
    css = (SRC / 'styles.css').read_text(encoding='utf-8')

    js_parts = []
    for name in JS_ORDER:
        p = SRC / 'js' / name
        js_parts.append(f'/* ===== {name} ===== */\n' + p.read_text(encoding='utf-8'))
    app = ('(function(){\n' + '\n\n'.join(js_parts) + '\n})();')

    pdf_main   = esm_to_classic_main((PDFJS / 'pdf.min.mjs').read_text(encoding='utf-8'))
    pdf_worker = esm_to_classic_worker((PDFJS / 'pdf.worker.min.mjs').read_text(encoding='utf-8'))
    # Envuelto en una función: el plan B lo inyecta como <script> en el hilo
    # principal, donde pdf.js ya declaró esos mismos identificadores. Dentro de
    # la función no chocan, y el worker publica igual globalThis.pdfjsWorker.
    pdf_worker = '(function(){\n' + pdf_worker + '\n})();'

    for blob, label in ((pdf_main, 'pdf.min'), (pdf_worker, 'pdf.worker'), (app, 'app'), (css, 'css')):
        if '</script' in blob.lower():
            sys.exit(f'{label} contiene "</script": rompería el HTML')

    # Hashes de lo que el navegador llega a ejecutar como script en línea:
    # pdf.js, la aplicación, y el código del worker cuando el plan B lo inyecta
    # en el hilo principal (Safari sobre file://).
    hashes = [sha256_csp(pdf_main), sha256_csp(app), sha256_csp(pdf_worker)]
    csp_meta   = build_csp(hashes, frame_ancestors=False)
    csp_header = build_csp(hashes, frame_ancestors=True)

    out = tpl
    for token, value in (('__CSP__', csp_meta), ('__CSS__', css), ('__PDFJS__', pdf_main),
                         ('__PDFWORKER__', pdf_worker), ('__APP__', app)):
        if token not in out:
            sys.exit(f'Falta el marcador {token} en index.html')
        out = out.replace(token, value)   # replace literal: nada de escapes de regex

    DIST.mkdir(exist_ok=True)
    target = DIST / 'QA-Visual-Check.html'
    target.write_text(out, encoding='utf-8')
    tocados = propagate_csp(csp_header)

    print(f'{target}  {len(out)/1048576:.2f} MB  ({datetime.datetime.now():%H:%M:%S})')
    print(f'  css {len(css)/1024:.0f} KB · app {len(app)/1024:.0f} KB · '
          f'pdfjs {len(pdf_main)/1024:.0f} KB · worker {len(pdf_worker)/1024:.0f} KB')
    print('  script-src: ' + ' '.join(hashes))
    if tocados:
        print('  CSP propagada a: ' + ', '.join(tocados))


if __name__ == '__main__':
    main()
