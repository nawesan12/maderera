# SEO el día de la mudanza

Qué hacer para que Google pase de `mjbj.ar` (el WordPress viejo) a
`mjbj.com.ar` (la plataforma) sin perder lo que tiene indexado. Es la parte de
buscadores del paso 12 de `SERVIDOR-PROPIO.md`: aquella guía cambia el DNS y
despliega; esta dice qué hay que avisarle a Google y cómo comprobar que los
301 andan.

**Lo que no se recupera.** Si el día de la mudanza una dirección vieja da 404,
Google la saca del índice y con ella lo que había ganado. El WordPress ya no
va a existir para volver a mirarlo: por eso el relevamiento completo quedó en
`docs/sitio-viejo/relevamiento.json` (255 direcciones) y la mediateca entera
en `docs/sitio-viejo/mediateca/` (fotos de los dos locales, el catálogo PDF de
Moldava, las fotos de cada rubro).

## Antes (la semana previa)

1. **Pedir los accesos**, que los tiene la clienta o quien le hizo el sitio
   viejo:
   - **Cloudflare.** Los dos dominios están detrás de Cloudflare (los DNS
     responden con IPs suyas). **`mjbj.com.ar` hoy redirige todo a la portada
     de `mjbj.ar`** con una regla de Cloudflare: esa regla hay que borrarla, o
     el sitio nuevo nunca recibe una visita. Para que Caddy saque los
     certificados, los registros de los dos dominios van en «Solo DNS» (nube
     gris), al menos hasta ver `certificate obtained successfully`.
   - **Google Search Console** de `mjbj.ar`. Si nadie la tiene, se verifica de
     nuevo por DNS (un registro TXT en Cloudflare) antes de mudar: el *Cambio
     de dirección* se pide **desde la propiedad vieja** y exige que las dos
     estén verificadas por la misma cuenta.
   - **Perfil de Empresa de Google** de cada sucursal (Casa Central y
     Aserradero), con una cuenta que pueda editarlos.
2. **Comparar el Perfil de Empresa con el sitio.** Nombre, dirección, teléfono
   y horario tienen que decir lo mismo en los dos lados (`lib/sucursales.ts`).
   El sitio viejo publicaba otro teléfono (0223 474-3328) y otro horario
   (9 a 17); si el perfil todavía los tiene, corregirlos ahí.

## El día

Después de los pasos 1 a 5 del paso 12 de `SERVIDOR-PROPIO.md`:

1. **Probar los 301 del sitio viejo** desde cualquier máquina:

   ```sh
   for p in / /placas/ /techos/ /contactenos/ /quienes-somos/ /sucursales/ \
            /mdh/2023/12/casa-central.jpg /sitemap_index.xml; do
     curl -s -o /dev/null -w "%{http_code} $p -> %{redirect_url}\n" "https://mjbj.ar$p"
   done
   ```

   Cada uno tiene que dar `301` y **un solo salto** a su destino final:
   `/placas/` → `https://mjbj.com.ar/catalogo?cat=placas`, `/contactenos/` →
   `/contacto`, la foto del local → `/sucursales/casa-central`. La lista
   completa y por qué cada una va adonde va está en `lib/sitio-viejo.ts`.

2. **Probar que el sitio nuevo se deja indexar**:

   ```sh
   curl -s https://mjbj.com.ar/robots.txt | head -3   # «Allow: /», no «Disallow: /»
   curl -sI https://mjbj.com.ar/ | grep -i x-robots   # no tiene que aparecer
   ```

   Si `robots.txt` dice `Disallow: /`, el build salió con `APP_ENV` o
   `SEO_INDEXAR` mal: corregir `.env.produccion` y volver a desplegar (se
   hornean en el build).

3. **Search Console de `mjbj.com.ar`**: crear la propiedad *de dominio*
   (verificación por TXT en Cloudflare) y enviar el sitemap:
   `https://mjbj.com.ar/sitemap.xml`.

4. **Cambio de dirección**: en la propiedad de `mjbj.ar` → Configuración →
   *Cambio de dirección* → elegir `mjbj.com.ar`. Search Console revisa que los
   301 funcionen antes de aceptarlo: si algo falla, lo dice ahí.

5. **Perfil de Empresa de Google**, en cada sucursal: el sitio web pasa a
   `https://mjbj.com.ar/sucursales/casa-central` y
   `https://mjbj.com.ar/sucursales/aserradero` respectivamente —la ficha de
   cada local, no la portada—. Es la página con el mismo nombre, dirección,
   horario y teléfono que el perfil, y con el marcado de ese local.

6. **Redes**: actualizar el enlace de la biografía de Instagram
   (`@madererajuanbjusto`) y el sitio web de la página de Facebook.

## Google Merchant Center (listados gratuitos)

Pone los productos en la pestaña *Shopping* de Google, con foto y precio, sin
pagar anuncios.

1. Crear la cuenta en <https://merchants.google.com> con la misma cuenta de
   Google de Search Console, país Argentina, moneda ARS.
2. Verificar y reclamar `mjbj.com.ar` (si Search Console ya está verificado,
   lo toma de ahí).
3. *Productos* → *Agregar productos* → *Agregar desde un archivo* → *URL del
   archivo*: `https://mjbj.com.ar/feeds/google-merchant.xml`, con descarga
   diaria.
4. *Envío*: cargar una regla de envío para Argentina (Merchant la pide aunque
   sea «retiro en sucursal»). El costo real del envío se calcula en el carrito
   según la zona; lo más honesto es declarar el envío gratis con retiro y un
   costo fijo de referencia, o lo que la clienta defina.
5. Activar *Fichas gratuitas* (programa «Listados gratuitos»).

El feed lleva **una línea por medida**, con el precio final con IVA y el
stock al día, agrupadas por producto; deja afuera las medidas sin precio y los
productos sin foto (lo cuenta en el comentario del principio del archivo).
Las advertencias esperables al principio: «falta la marca» en los productos
que no la tienen cargada —se carga en el panel— y nada más.

## Las semanas siguientes

- Search Console → *Páginas*: las de `mjbj.ar` van pasando a «Página con
  redirección» y las de `mjbj.com.ar` a «Indexada». Tarda semanas.
- Search Console → *Mejoras*: *Fragmentos de productos*, *Fichas de
  comerciante* y *Rutas de exploración* tienen que aparecer sin errores.
- **Dejar `mjbj.ar` apuntando a la VPS para siempre**, o al menos un año: el
  301 tiene que seguir respondiendo mientras Google y los enlaces viejos
  sigan pidiendo esas direcciones.
