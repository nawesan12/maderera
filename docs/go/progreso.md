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

- [ ] Esqueleto de `backend/`: `go.mod`, `cmd/mjbj`, `internal/plataforma`
- [ ] Sesión del correo (`correo_sesiones`, clave IMAP sellada)
- [ ] IMAP: carpetas, lista, lectura, adjuntos, acciones, búsqueda
- [ ] SMTP: redactar, responder, adjuntar, copia en Enviados
- [ ] SPA de Svelte embebida
- [ ] Dockerfile, compose, Caddy, `desplegar.sh`
- [ ] Probado contra docker-mailserver local
- [ ] Roundcube afuera

## Lo aprendido
