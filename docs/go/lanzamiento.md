# El lanzamiento: pasar producción al backend en Go

Lo que hay que hacer el día que se despliega la mudanza entera (todas las
tandas de `docs/go/progreso.md`). El despliegue mismo es el de siempre
(`scripts/desplegar.sh`, ver `docs/SERVIDOR-PROPIO.md`); esto es lo que cambia
alrededor. Va en orden: no saltear el ensayo.

## 1. Antes: lo que tiene que estar en el servidor

En `.env.produccion` (lo leen `app`, `api` y `worker`):

| Variable | Quién | Nota |
|---|---|---|
| `BETTER_AUTH_SECRET` | api, worker | el **mismo** de siempre: con él siguen valiendo las sesiones abiertas, y el worker firma los enlaces de baja de las campañas |
| `API_SECRETO_INTERNO`, `REVALIDAR_SECRETO` | app, api, worker | los genera `desplegar.sh` si faltan |
| `EMAIL_PROVIDER=smtp`, `SMTP_USUARIO`, `SMTP_CLAVE` | api, worker | sin esto Go cae en el proveedor de demostración y no sale ningún correo |
| `WHATSAPP_*` | api, worker | sin `WHATSAPP_PHONE_NUMBER_ID`, WhatsApp queda en modo demostración |
| `VAPID_*` | api, worker | los avisos al teléfono del panel |
| `ARCA_CUIT`, `ARCA_AMBIENTE` | api | y el certificado en `secretos/arca/` (abajo) |
| las de Mercado Pago | api | ver la sección «Tanda 6» de progreso.md |

- **El certificado de ARCA** (`secretos/arca/arca.crt` y `arca.key`) tiene que
  poder leerlo el usuario **65532** (la imagen de Go es distroless, no corre
  como root): `sudo chown 65532 secretos/arca/*` o `chmod 0644` el `.crt` y
  dar la clave a ese usuario.
- **Homologar ARCA antes**, con el certificado real (pasos en la sección
  «Tanda 7» de progreso.md). En producción: el certificado de producción y el
  número inicial de cada punto de venta.

## 2. El ensayo, contra una copia de producción

Ya se hizo una vez con la base de desarrollo (sección «Corte final» de
progreso.md). El día anterior, con el último respaldo de producción:

```sh
dc exec -T db createdb -U "$POSTGRES_USER" ensayo
dc exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d ensayo --no-owner --no-acl' < respaldos/mjbj-<fecha>.dump
dc run --rm -e DATABASE_URL=…/ensayo migrar        # adopta las 79 de drizzle y aplica 00080 en adelante
```

y levantar una API contra `ensayo` en otro puerto para recorrer el panel con
cada rol y la cookie de una sesión real (las claves y las sesiones de
better-auth entran por Go tal cual). Al terminar, `dropdb ensayo`.

## 3. El despliegue

```sh
./scripts/desplegar.sh
```

En este orden, ya resuelto en el script: respaldo → `migrar` (goose adopta
drizzle la primera vez) → API y worker nuevos con su chequeo de salud → build
de la app (que necesita la API levantada: lo público en caché se arma en el
build) → app → Caddy. Si la migración o el build fallan, la versión anterior
sigue sirviendo.

**Las migraciones nuevas** son todas de agregar (índices, un trigger, tablas):
la versión anterior de la app convive con ellas.

## 4. Comprobar

**Un 200 no prueba nada** (el error boundary también contesta 200): mirar el
contenido. Con cada rol (admin, vendedor, depósito, aserradero) y como
cliente:

- Panel: clientes, una ficha con su historial, stock, precios, cheques,
  facturación, caja, compras, cortes, la bitácora, el buscador.
- Mostrador: una venta en efectivo (con la caja abierta) y su anulación; una
  venta sin conexión que se sube después.
- Sitio: el catálogo, una ficha, el carrito hasta el pago de prueba de
  Mercado Pago, Mi cuenta.
- Los avisos: un recibo que llegue por correo con el PDF; un WhatsApp.
- El worker: `dc logs worker` sin errores, y la cola vaciándose
  (`select tipo, estado, count(*) from trabajos group by 1, 2`).
- La carga: `bench/corte/carga.k6.js` contra el sitio, fuera de horario.

## 5. Volver atrás

- **La app**: como siempre (`mjbj-app:anterior`, ver SERVIDOR-PROPIO.md).
- **La API y el worker**: las imágenes llevan el commit en la etiqueta
  (`mjbj-go:<commit>`), así que la anterior sigue en el servidor:
  `GIT_SHA=<commit anterior> dc up -d --no-deps --no-build api worker`.
- **La base**: las migraciones nuevas solo agregan, así que la versión
  anterior anda contra el esquema nuevo. Si igual hay que volverla atrás, el
  respaldo de antes de migrar está en `respaldos/antes-de-migrar-<fecha>.dump`
  (se pierde lo escrito desde ese momento).

## 6. Después

- ~~El contenedor `cron`~~: se sacó con la mudanza de los avisos (rama
  `go-avisos`). `desplegar.sh` borra el que haya quedado andando.
- ~~La lista de `eslint.config.mjs`~~: vacía desde el 30/10, sin imports de
  tipo tampoco (los tipos salen de `lib/api/tipos`). `app` ya no tiene
  `DATABASE_URL`. Lo que queda de `lib/db`, drizzle y `pg` son las semillas
  de la base de desarrollo y los scripts golden: herramientas, no la app (el
  `standalone` no los empaqueta).
- Repetir la prueba de carga en la VPS, con el mostrador.
