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

| Archivo | Para |
|---|---|
| `_headers` | Netlify, Cloudflare Pages |
| `netlify.toml` | Netlify (alternativa con configuración de build) |
| `vercel.json` | Vercel |
| `nginx.conf.example` | Servidor propio |

Copia el archivo correspondiente a la raíz del proyecto que publiques, junto con
`dist/QA-Visual-Check.html`.

**GitHub Pages no permite cabeceras personalizadas.** Sirve igual y la CSP incrustada sigue
aplicando, pero no tendrás `frame-ancestors` ni HSTS: para un dominio propio, prefiere
Cloudflare Pages o Netlify.
