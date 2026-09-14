# Seguridad

## Principio de diseño

QA Visual Check **no tiene servidor, no tiene cuentas y no hace peticiones de red**.
Todo ocurre dentro del navegador de quien la usa. Esto no es una promesa escrita: la página
declara una política de seguridad de contenido (CSP) que se lo impide técnicamente, incluso
si alguien lograra inyectar código en ella.

```
default-src 'none'; connect-src 'none'; img-src data: blob:;
script-src 'unsafe-inline' blob:; style-src 'unsafe-inline';
worker-src blob:; object-src 'none'; form-action 'none'; base-uri 'none';
```

`connect-src 'none'` bloquea `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` y
`sendBeacon`. `default-src 'none'` impide cargar cualquier recurso externo. Verificado con
pruebas automatizadas: `tests/run-security-tests.js`.

## Qué datos se manejan y dónde quedan

| Dato | Dónde vive | Sale del equipo |
|---|---|---|
| Diseños y capturas | Memoria del navegador | No |
| Escenarios importados | Memoria + `localStorage` (sin imágenes de alta resolución) | No |
| Hallazgos y evidencias | Memoria + `localStorage` si caben | No |
| Sesión `.json`, Excel, reporte | Solo cuando **tú** los descargas | Solo si los compartes |

`localStorage` es por navegador y por origen. En un equipo compartido, **Ayuda → Borrar datos
de este navegador** elimina todo lo guardado localmente.

> Ten en cuenta lo obvio: un reporte o una sesión `.json` contienen capturas de la aplicación
> revisada. Trátalos con el mismo cuidado que a cualquier evidencia de pruebas.

## Superficie de ataque considerada

La herramienta consume archivos que pueden venir de terceros. Todas las entradas se tratan
como hostiles:

| Entrada | Defensa |
|---|---|
| Sesión `.json` | Se reconstruye campo por campo con tipos, rangos y listas de valores permitidos. No se mezcla el objeto del archivo con el estado, lo que descarta la contaminación de prototipos (`__proto__`, `constructor`). |
| Imágenes de la sesión | Solo `data:` de mapa de bits (`png`, `jpeg`, `webp`, `gif`, `bmp`) en base64 y con tamaño acotado. Se rechazan `javascript:`, `data:text/html` y las URL remotas. |
| Archivos SVG | Se rasterizan a PNG al entrar: ningún marcado ajeno circula dentro de la sesión. |
| Imágenes muy grandes | Rechazo con aviso por encima de 20 000 px de lado o 90 Mpx. |
| `.xlsx` | Tope por entrada y total al descomprimir, con lectura por trozos: una «bomba zip» se corta antes de agotar la memoria. Tope de filas, columnas y longitud de celda. |
| `.csv` | Tope de tamaño, filas y columnas. |
| PDF | pdf.js con `isEvalSupported:false`, worker aislado, tope de páginas y de tamaño de lienzo. |
| Texto mostrado en pantalla | Se escribe con `textContent`; los avisos tratan el mensaje como texto por defecto. |
| Reporte generado | Todo texto pasa por escape HTML, los números se fuerzan a número y las imágenes se validan de nuevo. La vista previa corre en un `iframe` con `sandbox`. |
| Exportación a CSV | Las celdas que empiezan por `= + - @` se prefijan con apóstrofo para que Excel o Sheets no las ejecuten como fórmula. |

## Publicación en un dominio

El archivo es estático: sirve con cualquier hosting de archivos. Además de la CSP incrustada,
configura las cabeceras de `hosting/` — en particular `frame-ancestors 'none'`, que solo puede
enviarse como cabecera HTTP y evita que la página se embeba en un sitio ajeno.

Sirve siempre por HTTPS. La función «Capturar pantalla» requiere contexto seguro y el permiso
`display-capture=(self)` en `Permissions-Policy`.

## Reporte de vulnerabilidades

Si encuentras un fallo de seguridad, abre un *issue* describiendo el impacto y cómo reproducirlo,
sin publicar datos reales de ningún proyecto. Si prefieres un canal privado, usa el correo del
perfil del propietario del repositorio.

## Dependencias

Una sola, incrustada en el archivo publicado: [pdf.js](https://github.com/mozilla/pdf.js)
(Mozilla, Apache-2.0). No hay CDNs, ni analítica, ni fuentes externas, ni trazas.
