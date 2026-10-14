/**
 * Adónde va cada dirección del sitio viejo.
 *
 * Hasta la mudanza, `mjbj.ar` es un WordPress (tema Flatsome, WooCommerce sin
 * productos cargados) con una página por rubro: `/placas/`, `/techos/`,
 * `/molduras/`… Esas páginas son lo que Google tiene indexado de la maderera,
 * algunas desde 2023. El día de la mudanza `mjbj.ar` pasa a redirigir a
 * `mjbj.com.ar` conservando la ruta, y cada una de esas rutas tiene que caer en
 * su equivalente nuevo con un 301: así Google traslada lo ganado a la página
 * nueva en vez de encontrarse con un 404 y empezar de cero.
 *
 * **De dónde sale la lista.** Del relevamiento del 14/10/2026
 * (`docs/sitio-viejo/relevamiento.json`, lo arma
 * `scripts/relevar-sitio-viejo.ts`): sitemaps de Yoast, API de WordPress y
 * mediateca. `tests/sitio-viejo.test.ts` verifica que cada dirección relevada
 * tenga acá una decisión —un destino o un motivo para dejarla caer—, así que
 * no queda nada olvidado por omisión.
 *
 * **Las reglas que se siguieron:**
 *
 * - Cada página va a la que cumple la misma función: el rubro a su categoría
 *   del catálogo, «Contáctenos» a `/contacto`, «Quiénes somos» a `/nosotros`.
 *   **Nunca todo a la portada**: Google trata una redirección masiva a la
 *   portada como un 404 encubierto y no traslada nada.
 * - Las páginas de adjunto de WordPress (`/placas/melaminas/`, una por cada
 *   foto) y las fotos mismas (`/mdh/2023/12/melaminas.jpg`) van a donde va la
 *   página que las contenía: son la puerta de entrada de quien las encontró en
 *   Google Imágenes.
 * - Lo que era relleno del tema —imágenes de muestra, fondos, el ícono— se deja
 *   caer con un 404: no tiene equivalente y nadie lo buscó nunca.
 *
 * **Dónde se aplica.** En dos lugares, con esta misma lista:
 *
 * 1. En Caddy, para los pedidos que llegan a `mjbj.ar`
 *    (`servidor/caddy/sitio-viejo.caddy`, generado por
 *    `npx tsx scripts/generar-redirecciones-caddy.ts`). Es la que importa: el
 *    pedido viejo va **de un salto** a su destino final. Si el mapa viviera
 *    solo en la aplicación serían tres saltos —Caddy al dominio nuevo, Next a
 *    la ruta sin barra final, Next al destino— y cada salto es una
 *    oportunidad de que el rastreador se canse.
 * 2. En Next (`next.config.ts`), por si alguna de esas rutas llega directo a
 *    `mjbj.com.ar`: un enlace viejo pegado a mano, un marcador. Ahí cuesta un
 *    salto más y no importa.
 *
 * Este archivo no importa nada con `@/`: lo lee `next.config.ts`, que se
 * compila antes de que existan los alias.
 */

export interface RedireccionVieja {
  /** Ruta del sitio viejo, exacta, con la barra final que usa WordPress. */
  origen: string;
  /** Ruta del sitio nuevo. */
  destino: string;
}

/**
 * Las ocho categorías del sitio viejo y su categoría nueva.
 *
 * Los nombres coinciden uno a uno con los de `categories`, salvo la errata del
 * sitio viejo («costruccion»), que se resuelve acá.
 */
const RUBROS: Record<string, string> = {
  techos: "techos",
  placas: "placas",
  pisos: "pisos",
  molduras: "molduras",
  ferreteria: "ferreteria",
  "decks-y-escaleras": "decks-y-escaleras",
  "construccion-en-seco": "construccion-en-seco",
  "costruccion-en-seco": "construccion-en-seco",
  cubiertas: "cubiertas",
};

const categoria = (slug: string) => `/catalogo?cat=${RUBROS[slug]}`;

/**
 * Las páginas, una por una.
 *
 * Están todas las que publicaba el sitemap y las que devuelve la API aunque el
 * sitemap no las listara (WooCommerce crea `/cart/`, `/checkout/`…).
 */
export const PAGINAS_VIEJAS: Record<string, string> = {
  // Los rubros. Eran la columna del sitio viejo: una página por rubro, con
  // fotos y marcas. El equivalente es la categoría del catálogo, que además
  // tiene los productos con precio.
  "/techos/": categoria("techos"),
  "/placas/": categoria("placas"),
  "/pisos/": categoria("pisos"),
  "/molduras/": categoria("molduras"),
  "/ferreteria/": categoria("ferreteria"),
  "/decks-y-escaleras/": categoria("decks-y-escaleras"),
  "/construccion-en-seco/": categoria("construccion-en-seco"),
  "/cubiertas/": categoria("cubiertas"),

  // Las categorías de WooCommerce: nunca tuvieron productos, pero existen y
  // la API las publica.
  ...Object.fromEntries(
    Object.keys(RUBROS).map((slug) => [`/product-category/${slug}/`, categoria(slug)]),
  ),

  // Las institucionales.
  "/quienes-somos/": "/nosotros",
  // Una página de Yoast Local con la descripción, el horario y el teléfono de
  // la empresa: es «quiénes somos» con otro nombre.
  "/maderera-juan-b-justo/": "/nosotros",
  "/contactenos/": "/contacto",
  "/sucursales/": "/sucursales",
  // Las fotos de cada local tenían su página de adjunto con la misma ruta que
  // hoy tiene la ficha de la sucursal: coinciden de casualidad, y es justo
  // donde tienen que ir.
  "/sucursales/casa-central/": "/sucursales/casa-central",
  "/sucursales/aserradero/": "/sucursales/aserradero",
  "/profesionales-y-constructoras/": "/profesionales",
  // El sitio viejo invitaba a suscribirse; el nuevo no tiene suscripción
  // abierta, y lo más cercano es escribir.
  "/newsletter/": "/contacto",
  // El archivo de lugares que generaba Yoast Local para Google: lo que
  // describía eran las sucursales.
  "/locations.kml": "/sucursales",

  // La tienda de WooCommerce.
  "/catalogo/": "/catalogo",
  "/shop/": "/catalogo",
  "/tienda/": "/catalogo",
  "/cart/": "/carrito",
  "/checkout/": "/carrito/confirmar",
  "/my-account/": "/mi-cuenta",
  "/my-account/wishlist/": "/mi-cuenta",
  "/track-order/": "/mi-cuenta/pedidos",

  // El blog nunca tuvo entradas, y la única categoría estaba vacía.
  "/blog/": "/",
  "/categoria/general/": "/",
  "/inicio/": "/",

  // Los bloques de Flatsome se publicaban en el sitemap como si fueran
  // páginas (fragmentos del encabezado y el pie). Cada uno va a lo que
  // mostraba.
  "/blocks/footer-about-us/": "/nosotros",
  "/blocks/shop-header/": "/catalogo",
  "/blocks/menu-productos/": "/catalogo",
  "/blocks/blog-header/": "/",
  "/blocks/features-overview/": "/",

  // Los sitemaps viejos: Google los vuelve a pedir durante un tiempo, y
  // mandarlo al nuevo es avisarle dónde está todo.
  "/sitemap_index.xml": "/sitemap.xml",
  "/page-sitemap.xml": "/sitemap.xml",
  "/blocks-sitemap.xml": "/sitemap.xml",
  "/local-sitemap.xml": "/sitemap.xml",
  "/post-sitemap.xml": "/sitemap.xml",
  "/product-sitemap.xml": "/sitemap.xml",
  "/wp-sitemap.xml": "/sitemap.xml",
};

/**
 * Las páginas de adjunto que no cuelgan de una página: WordPress las crea en
 * la raíz cuando el archivo se subió suelto.
 */
const ADJUNTOS_SUELTOS: Record<string, string> = {
  "/moldava-catalogo-de-productos/": "/moldava",
  "/moldava-footer/": "/moldava",
  "/logo-maderera/": "/nosotros",
  "/logo/": "/nosotros",
  "/logo_gris/": "/nosotros",
};

/**
 * Lo que se deja caer a propósito, con el motivo. Responden 404.
 *
 * Son piezas del tema —imágenes de muestra de Flatsome, fondos, el ícono del
 * sitio, el botón de Facebook— que no tienen equivalente y que nadie buscó.
 * Mandarlas a la portada sería lo que Google llama un 404 encubierto.
 */
export const DESCARTADAS: Record<string, string> = {
  "/dummy-image-1/": "imagen de muestra del tema",
  "/dummy-image-2/": "imagen de muestra del tema",
  "/prod-dummy-image-1/": "imagen de muestra del tema",
  "/woocommerce-placeholder/": "imagen de relleno de WooCommerce",
  "/bg-header/": "fondo del tema",
  "/bg-veta-negro/": "fondo del tema",
  "/login-bg/": "fondo del tema",
  "/icon/": "ícono del sitio",
  "/cropped-icon-png/": "ícono del sitio",
  "/facebook-btn/": "botón de red social",
};

/**
 * La página de adjunto de una foto: `/placas/melaminas/` → la de `/placas/`.
 *
 * Las fotos de la portada vieja cuelgan de `/inicio/`, que era el nombre
 * interno de la portada.
 */
function destinoDeAdjunto(ruta: string): string | null {
  if (ADJUNTOS_SUELTOS[ruta]) return ADJUNTOS_SUELTOS[ruta];
  const m = ruta.match(/^\/([^/]+)\/[^/]+\/$/);
  if (!m) return null;
  if (m[1] === "inicio") return "/";
  // Prefijos que no eran páginas con fotos. `/catalogo/` es además la carpeta
  // de las fichas del sitio nuevo: tomarla por un adjunto mandaría cada
  // producto al listado.
  if (["blocks", "product-category", "my-account", "catalogo"].includes(m[1])) return null;
  return PAGINAS_VIEJAS[`/${m[1]}/`] ?? null;
}

/**
 * Los archivos de la mediateca (`/mdh/AAAA/MM/nombre.ext`) y la página de
 * adjunto de cada uno, sacados del relevamiento.
 *
 * Se guarda solo el nombre base: WordPress sirve además cada imagen en varios
 * tamaños (`melaminas-300x200.jpg`), y todos van al mismo lado.
 */
export const ARCHIVOS_VIEJOS: Record<string, string> = {
  "2026/05/home-decks-escaleras.jpeg": "/inicio/home-decks-escaleras-2/",
  "2025/10/logo-maderera.png": "/logo-maderera/",
  "2024/07/discounts.png": "/inicio/discounts/",
  "2024/07/provincia.jpeg": "/inicio/provincia/",
  "2024/07/cuotasimple.png": "/inicio/cuotasimple/",
  "2024/07/bbva.png": "/inicio/bbva/",
  "2023/12/logo_gris.png": "/logo_gris/",
  "2023/12/colonial.jpg": "/cubiertas/colonial/",
  "2023/12/tejado.jpg": "/cubiertas/tejado/",
  "2023/12/estilo.jpg": "/cubiertas/estilo/",
  "2023/12/eco.jpg": "/cubiertas/eco/",
  "2023/12/tejado5.jpg": "/cubiertas/tejado5/",
  "2023/12/condor.jpg": "/cubiertas/condor/",
  "2023/12/camel.jpg": "/cubiertas/camel/",
  "2023/12/ala.jpg": "/cubiertas/ala/",
  "2023/12/omega.jpg": "/cubiertas/omega/",
  "2023/12/marquesinas.jpg": "/cubiertas/marquesinas/",
  "2023/12/galpones.jpg": "/cubiertas/galpones/",
  "2023/12/cubre-cocheras.jpg": "/cubiertas/cubre-cocheras/",
  "2023/12/banner-cubiertas.jpg": "/cubiertas/banner-cubiertas/",
  "2023/12/eternit.png": "/construccion-en-seco/eternit/",
  "2023/12/superboard.png": "/construccion-en-seco/superboard/",
  "2023/12/novoplack.png": "/construccion-en-seco/novoplack/",
  "2023/12/banner-construccion-seco2.jpg": "/construccion-en-seco/banner-construccion-seco2/",
  "2023/12/escalera.png": "/decks-y-escaleras/escalera/",
  "2023/12/deck-pvc2.png": "/decks-y-escaleras/deck-pvc2/",
  "2023/12/deck-pvc.png": "/decks-y-escaleras/deck-pvc/",
  "2023/12/deck-image.jpg": "/decks-y-escaleras/deck-image/",
  "2023/12/deck-banner.png": "/decks-y-escaleras/deck-banner/",
  "2023/12/pinturas.jpg": "/ferreteria/pinturas/",
  "2023/12/marcas-ferreteria.jpg": "/ferreteria/marcas-ferreteria/",
  "2023/12/ferreteria.jpg": "/ferreteria/ferreteria-2/",
  "2023/12/camion-moldava.jpg": "/molduras/camion-moldava/",
  "2023/12/map.jpg": "/molduras/map/",
  "2023/12/moldava.png": "/molduras/moldava/",
  "2023/12/moldava-catalogo-de-productos.pdf": "/moldava-catalogo-de-productos/",
  "2023/12/banner-molduras.jpg": "/molduras/banner-molduras/",
  "2023/12/toronto.png": "/pisos/toronto/",
  "2023/12/ottawa.png": "/pisos/ottawa/",
  "2023/12/banner-piso-flotante.jpg": "/pisos/banner-piso-flotante/",
  "2023/12/pisos-productos-relacionados.jpg": "/pisos/pisos-productos-relacionados/",
  "2023/12/teka-oriental.png": "/pisos/teka-oriental/",
  "2023/12/roble-americano.png": "/pisos/roble-americano/",
  "2023/12/pinotea-natural.png": "/pisos/pinotea-natural/",
  "2023/12/nogal-dakar.png": "/pisos/nogal-dakar/",
  "2023/12/lapacho-blanco.png": "/pisos/lapacho-blanco/",
  "2023/12/haya-tarima.png": "/pisos/haya-tarima/",
  "2023/12/caoba-silvestre.png": "/pisos/caoba-silvestre/",
  "2023/12/banner-decno-flooring.png": "/pisos/banner-decno-flooring/",
  "2023/12/fingerjoint.jpg": "/placas/fingerjoint/",
  "2023/12/chapadur.jpg": "/placas/chapadur/",
  "2023/12/fenolicos.jpg": "/placas/fenolicos/",
  "2023/12/terciados.jpg": "/placas/terciados/",
  "2023/12/mdf.jpg": "/placas/mdf/",
  "2023/12/placas-productos-relacionados.jpg": "/placas/placas-productos-relacionados/",
  "2023/12/fibroplus.jpg": "/placas/fibroplus/",
  "2023/12/trupan.png": "/placas/trupan/",
  "2023/12/sadepan.png": "/placas/sadepan/",
  "2023/12/enchapadora-san-juan.png": "/placas/enchapadora-san-juan/",
  "2023/12/cortes.jpg": "/placas/cortes/",
  "2023/12/melaminas.jpg": "/placas/melaminas/",
  "2023/12/presupuestos.jpg": "/profesionales-y-constructoras/presupuestos/",
  "2023/12/obras-realizadas.jpg": "/profesionales-y-constructoras/obras-realizadas/",
  "2023/12/fenolico-film.jpg": "/profesionales-y-constructoras/fenolico-film/",
  "2023/12/banner-constructoras.jpg": "/profesionales-y-constructoras/banner-constructoras/",
  "2023/12/aserradero.jpg": "/sucursales/aserradero/",
  "2023/12/casa-central.jpg": "/sucursales/casa-central/",
  "2023/12/banner-sucursales-3.jpg": "/sucursales/banner-sucursales-3/",
  "2023/12/banner-sucursales-2.jpg": "/sucursales/banner-sucursales-2/",
  "2023/12/banner-sucursales-1.jpg": "/sucursales/banner-sucursales-1/",
  "2023/12/quienes-somos.jpg": "/quienes-somos/quienes-somos-2/",
  "2023/12/moldava-footer.png": "/moldava-footer/",
  "2023/12/banner-chapas-curvadas.jpg": "/techos/banner-chapas-curvadas/",
  "2023/12/tejado4.png": "/techos/tejado4/",
  "2023/12/tejado3.png": "/techos/tejado3/",
  "2023/12/tejado2.png": "/techos/tejado2/",
  "2023/12/tejado1.png": "/techos/tejado1/",
  "2023/12/banner-tejado-metalico.jpg": "/techos/banner-tejado-metalico/",
  "2023/12/marcas-techos.jpg": "/techos/marcas-techos/",
  "2023/12/techos-productos-relacionados.jpg": "/techos/techos-productos-relacionados/",
  "2023/12/tirantes.jpg": "/techos/tirantes/",
  "2023/12/maquinaria.jpg": "/techos/maquinaria/",
  "2023/12/banner-techos.jpg": "/techos/banner-techos/",
  "2023/12/home-decks-escaleras.jpg": "/inicio/home-decks-escaleras/",
  "2023/12/home-ferreteria.jpg": "/inicio/home-ferreteria/",
  "2023/12/home-molduras.jpg": "/inicio/home-molduras/",
  "2023/12/pisos.jpg": "/inicio/pisos/",
  "2023/12/placas.jpg": "/inicio/placas/",
  "2023/12/techos.jpg": "/inicio/techos/",
  "2023/12/banner-seco.jpg": "/inicio/banner-seco/",
  "2023/12/linea-life.png": "/inicio/linea-life/",
  "2023/12/portada-mpago.png": "/inicio/portada-mpago/",
  "2023/12/expresion-natural.jpeg": "/inicio/expresion-natural/",
  "2023/12/banner-watsapp.png": "/inicio/banner-watsapp/",
  "2023/12/logo.png": "/logo/",
};

/**
 * Las fotos de la portada vieja que eran rubros: van al rubro y no a la
 * portada, que es lo que buscaba quien las encontró.
 */
const FOTOS_DE_RUBRO_EN_PORTADA: Record<string, string> = {
  "/inicio/home-decks-escaleras/": categoria("decks-y-escaleras"),
  "/inicio/home-decks-escaleras-2/": categoria("decks-y-escaleras"),
  "/inicio/home-ferreteria/": categoria("ferreteria"),
  "/inicio/home-molduras/": categoria("molduras"),
  "/inicio/pisos/": categoria("pisos"),
  "/inicio/placas/": categoria("placas"),
  "/inicio/techos/": categoria("techos"),
  "/inicio/banner-seco/": categoria("construccion-en-seco"),
  // Las promociones bancarias y de Mercado Pago de la portada vieja.
  "/inicio/discounts/": "/",
  "/inicio/provincia/": "/",
  "/inicio/cuotasimple/": "/",
  "/inicio/bbva/": "/",
  "/inicio/portada-mpago/": "/",
  "/inicio/linea-life/": "/",
  "/inicio/expresion-natural/": "/",
  "/inicio/banner-watsapp/": "/contacto",
};

/** Una ruta vieja sin la barra final ni mayúsculas, para comparar. */
function normalizar(ruta: string): string {
  const sinConsulta = ruta.split("?")[0].split("#")[0];
  let r: string;
  try {
    r = decodeURIComponent(sinConsulta).toLowerCase();
  } catch {
    r = sinConsulta.toLowerCase();
  }
  if (!r.startsWith("/")) r = `/${r}`;
  // Lo que parece un archivo no lleva barra final; lo demás, sí, como en
  // WordPress.
  if (!/\.[a-z0-9]{2,5}$/.test(r) && !r.endsWith("/")) r += "/";
  return r;
}

/**
 * El destino de una ruta del sitio viejo, o `null` si no tiene uno (y debe
 * responder 404, o es una ruta que el sitio nuevo atiende por sí mismo).
 */
export function destinoDeRutaVieja(ruta: string): string | null {
  const r = normalizar(ruta);

  if (PAGINAS_VIEJAS[r]) return PAGINAS_VIEJAS[r];
  if (FOTOS_DE_RUBRO_EN_PORTADA[r]) return FOTOS_DE_RUBRO_EN_PORTADA[r];
  if (DESCARTADAS[r]) return null;

  // Un archivo de la mediateca, en cualquiera de sus tamaños.
  const archivo = r.match(/^\/mdh\/(\d{4}\/\d{2})\/(.+?)(?:-\d+x\d+)?(\.[a-z0-9]+)$/);
  if (archivo) {
    const clave = `${archivo[1]}/${archivo[2]}${archivo[3]}`;
    const adjunto = ARCHIVOS_VIEJOS[clave];
    // Las extensiones que convierte el optimizador del sitio viejo (`.webp`)
    // también caen acá: se busca por nombre sin extensión.
    const porNombre =
      adjunto ??
      Object.entries(ARCHIVOS_VIEJOS).find(
        ([k]) => k.replace(/\.[a-z0-9]+$/, "") === `${archivo[1]}/${archivo[2]}`,
      )?.[1];
    return porNombre ? destinoDeRutaVieja(porNombre) : null;
  }

  return destinoDeAdjunto(r);
}

/**
 * Todas las redirecciones exactas, para Caddy y para Next.
 *
 * Las de los archivos se dan sin tamaño; quien las use se encarga de aceptar
 * el sufijo `-300x200` (Caddy con una expresión regular, Next con un patrón).
 */
export function redireccionesDelSitioViejo(): RedireccionVieja[] {
  const salida = new Map<string, string>();

  const sumar = (origen: string) => {
    // Va aunque el destino sea la misma ruta sin la barra final
    // (`/sucursales/` → `/sucursales`): en Caddy eso ahorra el salto que
    // daría Next para sacarle la barra.
    const destino = destinoDeRutaVieja(origen);
    if (destino) salida.set(origen, destino);
  };

  Object.keys(PAGINAS_VIEJAS).forEach(sumar);
  Object.keys(ADJUNTOS_SUELTOS).forEach(sumar);
  Object.keys(FOTOS_DE_RUBRO_EN_PORTADA).forEach(sumar);
  Object.values(ARCHIVOS_VIEJOS).forEach(sumar);
  Object.keys(ARCHIVOS_VIEJOS).forEach((a) => sumar(`/mdh/${a}`));

  return [...salida].map(([origen, destino]) => ({ origen, destino }));
}

/** Escapa una ruta para meterla en una expresión regular. */
const escaparRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * El mapa para Caddy, listo para importar en el bloque de los dominios
 * redirigidos.
 *
 * `map` traduce la ruta pedida a su destino; lo que no está en el mapa sale
 * con la misma ruta y su consulta (`{uri}`), que es lo que hacía la regla
 * genérica de antes. La consulta de una ruta mapeada se descarta: era del
 * sitio viejo (`?fbclid=`, `?add-to-cart=`) y no significa nada en el nuevo.
 */
export function mapaParaCaddy(): string {
  const lineas: string[] = [];
  for (const { origen, destino } of redireccionesDelSitioViejo()) {
    if (origen.startsWith("/mdh/")) {
      // Los tamaños de WordPress y la conversión a WebP del sitio viejo.
      const base = origen.replace(/\.[a-z0-9]+$/, "");
      lineas.push(`\t~^${escaparRegex(base)}(-\\d+x\\d+)?\\.[a-z0-9]+$ "${destino}"`);
    } else if (origen.endsWith("/")) {
      // Con y sin la barra final: hay enlaces pegados de las dos formas.
      lineas.push(`\t~^${escaparRegex(origen.slice(0, -1))}/?$ "${destino}"`);
    } else {
      lineas.push(`\t${origen} "${destino}"`);
    }
  }

  return [
    "# GENERADO por `npx tsx scripts/generar-redirecciones-caddy.ts` a partir de",
    "# `lib/sitio-viejo.ts`. No editar a mano: el test `tests/sitio-viejo.test.ts`",
    "# falla si este archivo y la lista se desincronizan.",
    "#",
    "# Cada dirección del WordPress viejo (mjbj.ar) va a su equivalente de un",
    "# solo salto. Lo que no está en el mapa conserva su ruta.",
    "",
    "map {path} {destino_sitio_viejo} {",
    ...lineas,
    "\tdefault {uri}",
    "}",
    "redir https://{$DOMINIO}{destino_sitio_viejo} permanent",
    "",
  ].join("\n");
}

/**
 * Las mismas redirecciones en el formato de `next.config.ts`.
 *
 * Next saca la barra final antes de mirar estas reglas, así que las fuentes van
 * sin ella. Las que el sitio nuevo ya atiende (`/sucursales`, `/catalogo`) se
 * omiten: redirigirlas a sí mismas sería un bucle.
 */
export function redireccionesParaNext(): {
  source: string;
  destination: string;
  permanent: true;
}[] {
  const salida: { source: string; destination: string; permanent: true }[] = [];

  for (const { origen, destino } of redireccionesDelSitioViejo()) {
    if (origen.startsWith("/mdh/")) {
      const m = origen.match(/^\/mdh\/(\d{4})\/(\d{2})\/(.+)\.([a-z0-9]+)$/)!;
      // Los nombres son de WordPress: letras, números, guiones y guiones
      // bajos (lo verifica el test), así que no hay nada que escapar.
      const nombre = m[3];
      salida.push({
        source: `/mdh/${m[1]}/${m[2]}/:archivo(${nombre}(?:-\\d+x\\d+)?\\.[a-z0-9]+)`,
        destination: destino,
        permanent: true,
      });
      continue;
    }

    const source = origen.endsWith("/") ? origen.slice(0, -1) : origen;
    const [rutaDestino] = destino.split("?");
    if (source === rutaDestino) continue;
    salida.push({ source, destination: destino, permanent: true });
  }

  return salida;
}
