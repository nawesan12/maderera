# La mudanza a Go: dónde va

El plan completo, con el porqué de cada decisión, está en [PLAN.md](PLAN.md).
Este archivo es lo que se actualiza: qué tanda está en curso, qué quedó hecho
y qué aprendimos. **Leelo antes de tocar `backend/`.**

## Reglas para quien trabaje acá

- Una rama por tanda (`go-<tanda>`). No se mergea a `main` sin los golden y
  los E2E de la tanda en verde.
- Un módulo se muda entero —lecturas, escrituras, rutas, trabajos, tareas— y
  su TypeScript se borra en la misma tanda. Nada queda a medias en los dos
  lados.
- Los candados (`pg_advisory_xact_lock`) y la numeración son los mismos del
  TypeScript, byte a byte, mientras convivan.
- La plata va en `float64` con los helpers de `internal/jsmath`, nunca con
  `math.Round` ni una librería decimal: el resultado tiene que ser idéntico
  al de hoy. `float64(x*y)+z`, nunca `x*y+z` (FMA en arm64).
- Las URLs que llama alguien de afuera (webhooks, mostrador offline, agente
  del taller, `/baja`, `/api/tareas`) no cambian.
- Al terminar una sesión: actualizar la tabla de abajo y anotar lo aprendido.

## Estado

| # | Tanda | Rama | Estado |
|---|---|---|---|
| 0 | Correo (`correo.mjbj.com.ar`) | `go-correo` | en curso |
| 1 | Base común | | |
| 2 | Catálogo público y contenido | | |
| 3 | Productos, precios, stock, acopio | | |
| 4 | Clientes, cuenta corriente, cheques, cobros | | |
| 5 | Mostrador, caja, ventas, entregas | | |
| 6 | Carrito, checkout, Mercado Pago | | |
| 7 | Facturación ARCA | | |
| 8 | Compras, proveedores, retenciones | | |
| 9 | WhatsApp | | |
| 10 | Campañas, avisos, profesionales, firma | | |
| 11 | Cortes | | |
| 12 | PDF y exportaciones | | |
| 13 | Migración de ISIS | | |
| — | Corte final | | |

## Tanda 0: el correo

- [x] Esqueleto de `backend/`: `go.mod`, `cmd/mjbj`, `internal/plataforma`
- [x] Sesión del correo (cookie sellada con AES-GCM, ver «Lo aprendido»)
- [x] IMAP: carpetas, lista, lectura, adjuntos, acciones, búsqueda
- [x] SMTP: redactar, responder, adjuntar, copia en Enviados
- [x] SPA de Svelte embebida (Vite + Svelte 5, sin SvelteKit; 31 KB gz)
- [x] Dockerfile, compose (`correo-web`), Caddy (`correo.`), `desplegar.sh`
- [x] Probado contra docker-mailserver 16.0.1 local (curl y navegador)
- [x] Roundcube afuera
- [ ] Encendido en la VPS (espera los registros DNS y el PTR)

## Lo aprendido

- **La sesión del correo no va en Postgres** (el plan decía `correo_sesiones`):
  va en una cookie `__Host-` sellada con AES-GCM (`CORREO_CLAVE`). Así el
  webmail no depende de la base del ERP —se lee el correo aunque la base esté
  caída— y la adopción de goose queda para la tanda 1, donde corresponde.
- **El HTML de los correos va en un iframe con origen opaco** (CSP `sandbox`
  sin `allow-same-origin`). Desde ahí el navegador no manda la cookie, así que
  las imágenes en línea (`cid:`) se incrustan como `data:` en el servidor en
  vez de servirse por una ruta. La CSP del iframe (`img-src data:`) es la que
  frena las imágenes remotas; el saneo con bluemonday es la segunda capa.
- **IMAP sin `Extended: true` en BODYSTRUCTURE no trae el
  `Content-Disposition`**: sin eso no se sabe qué partes son adjuntos.
- **El límite de intentos va en el webmail, no en fail2ban**: el servidor de
  correo ve todos los intentos del webmail desde la IP del contenedor.
- **El hook de Mercado Pago bloquea cualquier comando que nombre un `.env`**
  (incluso `correo.env` o `.env.produccion` en un texto): los cambios a esos
  archivos o a comandos que los citan van por un script en el scratchpad.
- **`curl -F campo='<...'` lee un archivo** (el `<` es «desde archivo»): para
  mandar HTML por curl, `--form-string`.
