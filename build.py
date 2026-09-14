#!/usr/bin/env python3
"""
Empaqueta QA Visual Check en un único archivo HTML autónomo.

- Convierte pdf.js (ESM) en scripts clásicos para que funcione al abrir el
  archivo con doble clic (file://), sin módulos ni peticiones de red.
- Inserta el worker de pdf.js como texto: en tiempo de ejecución se convierte
  en un Blob y se usa como Worker clásico.
"""
import os, re, sys, pathlib, datetime

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

    for blob, label in ((pdf_main, 'pdf.min'), (pdf_worker, 'pdf.worker'), (app, 'app'), (css, 'css')):
        if '</script' in blob.lower():
            sys.exit(f'{label} contiene "</script": rompería el HTML')

    out = tpl
    for token, value in (('__CSS__', css), ('__PDFJS__', pdf_main),
                         ('__PDFWORKER__', pdf_worker), ('__APP__', app)):
        if token not in out:
            sys.exit(f'Falta el marcador {token} en index.html')
        out = out.replace(token, value)   # replace literal: nada de escapes de regex

    DIST.mkdir(exist_ok=True)
    target = DIST / 'QA-Visual-Check.html'
    target.write_text(out, encoding='utf-8')
    print(f'{target}  {len(out)/1048576:.2f} MB  ({datetime.datetime.now():%H:%M:%S})')
    print(f'  css {len(css)/1024:.0f} KB · app {len(app)/1024:.0f} KB · '
          f'pdfjs {len(pdf_main)/1024:.0f} KB · worker {len(pdf_worker)/1024:.0f} KB')


if __name__ == '__main__':
    main()
