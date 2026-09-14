# Publicación en un dominio

La herramienta es un archivo estático: cualquier hosting de archivos sirve.
Estas configuraciones añaden, sobre la CSP que ya viaja dentro del HTML, las cabeceras que
**solo** pueden enviarse por HTTP:

* `frame-ancestors 'none'` y `X-Frame-Options: DENY` — nadie puede incrustar la herramienta en
  otro sitio para engañar a quien la usa (*clickjacking*).
* `Strict-Transport-Security` — el navegador exige HTTPS en adelante.
* `Referrer-Policy: no-referrer` y `Permissions-Policy` — sin fugas por cabecera y sin acceso a
  cámara, micrófono o ubicación. `display-capture=(self)` se deja habilitado porque la función
  «Capturar pantalla» lo necesita.

| Archivo | Dónde va | Para |
|---|---|---|
| `netlify.toml` | ya está en la raíz del repo | Netlify conectado a GitHub |
| `vercel.json` | ya está en la raíz del repo | Vercel conectado a GitHub |
| `dist/_headers` | ya está junto al HTML publicado | Netlify y Cloudflare Pages |
| `hosting/_headers` | copia de referencia | para pegar en otro hosting |
| `hosting/nginx.conf.example` | — | servidor propio |

Con el repositorio conectado a Netlify o a Vercel no hay que configurar nada: publican
`dist/`, sirven `QA-Visual-Check.html` en la raíz y aplican las cabeceras.

### Sin repositorio, desde el navegador

Netlify (app.netlify.com/drop) y Cloudflare Pages (Direct Upload) aceptan un zip con
`index.html` y `_headers` en la raíz. Es la vía cuando no hay terminal a mano.

**GitHub Pages no permite cabeceras personalizadas.** Sirve igual y la CSP incrustada sigue
aplicando, pero no tendrás `frame-ancestors` ni HSTS: para un dominio propio, prefiere
Cloudflare Pages o Netlify.

## Visibilidad en buscadores

Mientras la herramienta sea de uso interno va con `noindex`: `dist/robots.txt` con
`Disallow: /` y la cabecera `X-Robots-Tag: noindex, nofollow`. Ninguna de las dos impide
que alguien con el enlace la use; solo evitan que aparezca en los buscadores.

Para hacerla pública y rastreable: borra `dist/robots.txt` y la línea `X-Robots-Tag` de
`_headers`. Hazlo solo cuando quieras que cualquiera pueda encontrarla.
