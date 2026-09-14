# Avisos de terceros

## pdf.js

`dist/QA-Visual-Check.html` incrusta **pdf.js 5.7.284** (compilación *legacy*) para leer los PDF
exportados desde Figma sin depender de internet.

* Proyecto: https://github.com/mozilla/pdf.js
* Copyright 2012-2024 Mozilla Foundation
* Licencia: Apache License 2.0 — texto completo en
  [`licenses/pdf.js-LICENSE-Apache-2.0.txt`](licenses/pdf.js-LICENSE-Apache-2.0.txt)

`build.py` lo transforma de módulos ES a scripts clásicos (sustituye la lista de exportaciones
por una asignación global y `import.meta.url`, usado solo en rutas de Node y WASM, por una URL
inerte). No se modifica ninguna otra parte de su lógica. El aviso de licencia original viaja
dentro del archivo generado.

El resto del proyecto no usa dependencias de terceros en tiempo de ejecución: la lectura y
escritura de Excel, la descompresión ZIP, el CRC32, la comparación de imágenes y el generador
de reportes son código propio de este repositorio.
