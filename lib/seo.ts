/**
 * Cimientos de SEO: la URL canónica del sitio, la metadata de cada página y
 * los datos estructurados.
 *
 * Los datos estructurados no son adorno para una maderera de barrio: son lo
 * que hace que Google muestre la dirección, el horario y el teléfono de cada
 * sucursal en el costado de la búsqueda, y lo que pone el precio y la
 * disponibilidad debajo del resultado de un producto. Alguien que busca
 * "fenólico Mar del Plata" decide con eso, antes de entrar.
 *
 * Todo lo de acá se arma con datos reales —la base, `lib/sucursales.ts`,
 * `lib/empresa.ts`— y no con constantes sueltas: una dirección o un horario
 * equivocado en el marcado se indexa igual, y después llega gente al local a
 * una hora en que está cerrado.
 *
 * **Imports relativos a propósito**: `next.config.ts` lee `sitioIndexable()`
 * para mandar `X-Robots-Tag` fuera de producción, y ahí los alias `@/` todavía
 * no existen.
 */

import type { Metadata } from "next";
import { entornoDeDespliegue } from "./entorno";
import type { StockLevel } from "./stock-level";

/**
 * Origen público del sitio.
 *
 * No puede salir de la request: los enlaces del sitemap y los `canonical`
 * tienen que ser absolutos y los mismos siempre, aunque la página se sirva
 * desde una URL de vista previa.
 */
export function urlSitio(): string {
  const explicita = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (explicita) return explicita.replace(/\/$/, "");
  return "https://mjbj.com.ar";
}

export function urlAbsoluta(ruta: string): string {
  if (/^https?:\/\//.test(ruta)) return ruta;
  return `${urlSitio()}${ruta.startsWith("/") ? ruta : `/${ruta}`}`;
}

/**
 * Una URL absoluta lista para meter en el XML del sitemap.
 *
 * **Next 16 no escapa lo que escribe en el sitemap** (lo arma concatenando
 * texto, ver `resolve-route-data.js`). Un `&` crudo —el de
 * `/catalogo?cat=placas&rubro=melaminas` o el de una foto de Unsplash con
 * `?w=800&q=80`— deja el XML mal formado, y Google rechaza el sitemap entero,
 * no esa línea. Si una versión futura de Next empieza a escapar, el sitemap
 * servido va a mostrar `&amp;amp;`: es lo primero que hay que mirar después
 * de actualizar Next.
 */
export function urlParaSitemap(ruta: string): string {
  return urlAbsoluta(ruta)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Si este despliegue puede ser indexado.
 *
 * Es la línea que evita el desastre clásico: cada vista previa de cada rama
 * queda publicada en una URL real, Google las encuentra, y el sitio termina
 * compitiendo consigo mismo con seis copias del catálogo. Solo producción se
 * indexa.
 *
 * El entorno sale de `VERCEL_ENV` en la plataforma y de `APP_ENV` en un
 * servidor propio (ver `lib/entorno.ts`). **Ojo con el servidor propio:** la
 * respuesta se hornea en el build —`robots.txt` es estático—, así que
 * `APP_ENV` y `SEO_INDEXAR` tienen que estar cuando se construye la imagen, no
 * solo cuando arranca. El compose los pasa como argumentos de build.
 *
 * **Una copia que se publica en `localhost`** —la imagen de Docker que se
 * prueba en una máquina, que lleva `APP_ENV=production` porque es la misma
 * que va al servidor— tampoco se indexa, salvo que `SEO_INDEXAR=si` lo pida
 * a propósito (se usa para medir con Lighthouse, que si no reprueba el
 * `noindex`).
 */
export function sitioIndexable(): boolean {
  const entorno = entornoDeDespliegue();
  if (entorno && entorno !== "production") return false;

  const pedido = process.env.SEO_INDEXAR?.trim().toLowerCase();
  if (pedido === "no") return false;
  if (pedido === "si" || pedido === "sí") return true;

  let host = "";
  try {
    host = new URL(urlSitio()).hostname;
  } catch {
    return false;
  }
  return !(host === "localhost" || host.endsWith(".localhost") || /^127\.|^0\.0\.0\.0$/.test(host));
}

/* -------------------------------------------------------------------------- */
/* Metadata de página                                                          */
/* -------------------------------------------------------------------------- */

export const NOMBRE = "Maderera Juan B. Justo";

/** La imagen para compartir de todo el sitio (`app/opengraph-image.tsx`). */
const IMAGEN_DEL_SITIO = "/opengraph-image";

/**
 * Título, descripción, canónica y tarjetas para compartir, de una vez.
 *
 * **Existe por un error que no se veía.** El layout raíz declaraba
 * `alternates.canonical: "/"`, y Next lo hereda en toda página que no declare
 * la suya: `/corte` y `/stock` le decían a Google «esta página es una copia de
 * la portada», que es la forma más directa de que nunca aparezcan. Y las
 * páginas que sí armaban su `openGraph` perdían la imagen —Next reemplaza el
 * objeto entero, no lo mezcla— y conservaban la `twitter` de la portada: la
 * ficha de un tirante se compartía con el título «Desde 1981 en Mar del
 * Plata».
 *
 * Con esto, cada página pública dice lo suyo en todos lados. `titulo` es el
 * de la página; la plantilla del layout le agrega « | Maderera Juan B. Justo».
 */
export function metadatosDePagina(opciones: {
  titulo: string;
  descripcion: string;
  /** La ruta canónica, con su consulta si la tiene (`/catalogo?cat=placas`). */
  ruta: string;
  /** Imagen para compartir; si falta, la del sitio. */
  imagen?: string | { url: string; ancho?: number; alto?: number; alt?: string } | null;
  tipo?: "website" | "article";
  /** `false` para lo que no tiene que aparecer en Google (búsquedas, filtros). */
  indexar?: boolean;
  /** Si el título ya trae la marca, no se le agrega la plantilla. */
  tituloAbsoluto?: boolean;
}): Metadata {
  const descripcion = recortar(opciones.descripcion, 160);
  const imagen =
    typeof opciones.imagen === "string"
      ? { url: opciones.imagen }
      : (opciones.imagen ?? { url: IMAGEN_DEL_SITIO, ancho: 1200, alto: 630 });

  const imagenes = [
    {
      url: imagen.url,
      ...(imagen.ancho ? { width: imagen.ancho } : {}),
      ...(imagen.alto ? { height: imagen.alto } : {}),
      alt: imagen.alt ?? opciones.titulo,
    },
  ];

  const tituloCompleto = opciones.tituloAbsoluto
    ? opciones.titulo
    : `${opciones.titulo} | ${NOMBRE}`;

  return {
    title: opciones.tituloAbsoluto ? { absolute: opciones.titulo } : opciones.titulo,
    description: descripcion,
    alternates: { canonical: opciones.ruta },
    ...(opciones.indexar === false
      ? { robots: { index: false, follow: true } }
      : {}),
    openGraph: {
      type: opciones.tipo ?? "website",
      locale: "es_AR",
      siteName: NOMBRE,
      url: urlAbsoluta(opciones.ruta),
      title: tituloCompleto,
      description: descripcion,
      images: imagenes,
    },
    twitter: {
      card: "summary_large_image",
      title: tituloCompleto,
      description: descripcion,
      images: imagenes.map((i) => i.url),
    },
  };
}

/**
 * Corta un texto en el último espacio antes del límite y le pone puntos
 * suspensivos. Google muestra unos 155 caracteres de descripción: cortar en
 * la mitad de una palabra se ve como un error.
 */
export function recortar(texto: string, limite: number): string {
  const limpio = texto.replace(/\s+/g, " ").trim();
  if (limpio.length <= limite) return limpio;
  const corte = limpio.lastIndexOf(" ", limite - 1);
  return `${limpio.slice(0, corte > limite * 0.6 ? corte : limite - 1).replace(/[\s,;:.·—-]+$/, "")}…`;
}

/** "$ 28.500" para un título o una descripción. */
export function precioEnTexto(precio: number): string {
  return `$${Math.round(precio).toLocaleString("es-AR")}`;
}

/* -------------------------------------------------------------------------- */
/* Datos estructurados                                                         */
/* -------------------------------------------------------------------------- */

/** Un objeto JSON-LD cualquiera. */
export type JsonLd = Record<string, unknown>;

const FUNDACION = "1981";

/** Identificador estable de la empresa, para que todo apunte al mismo nodo. */
export function idOrganizacion(): string {
  return `${urlSitio()}/#organizacion`;
}

/** Identificador del nodo de una sucursal: la ficha de esa sucursal. */
export function idSucursal(slug: string): string {
  return `${urlSitio()}/sucursales/${slug}#local`;
}

/**
 * "223 590-3118" → "+54 223 590-3118".
 *
 * Google pide el teléfono con el código de país; el número local solo, para
 * alguien que lo lee desde otro país —o para el propio Google—, es ambiguo.
 */
export function telefonoInternacional(telefono: string): string {
  const limpio = telefono.trim();
  if (limpio.startsWith("+")) return limpio;
  return `+54 ${limpio.replace(/^0/, "")}`;
}

export function organizacionJsonLd(opciones: {
  descripcion?: string;
  telefono?: string | null;
  email?: string | null;
  redes?: string[];
  /** Los slugs de las sucursales, para enlazar los nodos de cada local. */
  sucursales?: string[];
}): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": idOrganizacion(),
    name: NOMBRE,
    url: urlSitio(),
    logo: {
      "@type": "ImageObject",
      url: urlAbsoluta("/cropped-icon-180x180.png"),
      width: 180,
      height: 180,
    },
    image: urlAbsoluta("/marca/logo-maderera.png"),
    foundingDate: FUNDACION,
    description: opciones.descripcion,
    areaServed: { "@type": "City", name: "Mar del Plata" },
    ...(opciones.telefono ? { telephone: telefonoInternacional(opciones.telefono) } : {}),
    ...(opciones.email ? { email: opciones.email } : {}),
    ...(opciones.redes?.length ? { sameAs: opciones.redes } : {}),
    ...(opciones.sucursales?.length
      ? { subOrganization: opciones.sucursales.map((s) => ({ "@id": idSucursal(s) })) }
      : {}),
  };
}

export interface SucursalSeo {
  slug: string;
  name: string;
  address: string;
  phone: string | null;
  email: string | null;
  hours: string | null;
  whatsapp: string | null;
  /** Coordenadas, si se conocen. */
  geo?: { lat: number; lng: number } | null;
  /** Enlace a Google Maps. */
  mapa?: string | null;
  /** Foto del local (ruta del sitio o URL). */
  foto?: string | null;
  /** Redes de la empresa: los locales no tienen cuentas propias. */
  redes?: string[];
}

/**
 * Traduce "Lun a Vie 8:00-16:00 · Sáb 8:00-12:00" a `openingHoursSpecification`.
 *
 * El texto lo escribe el cliente desde el panel y va a cambiar; el marcado
 * tiene que seguirlo sin que nadie edite código. Si el texto no se puede
 * interpretar, se devuelve vacío: es preferible no declarar horarios a
 * declarar los de otro local.
 */
export function horariosJsonLd(texto: string | null): JsonLd[] {
  if (!texto) return [];

  const DIAS: Record<string, string> = {
    lun: "Monday",
    mar: "Tuesday",
    mie: "Wednesday",
    jue: "Thursday",
    vie: "Friday",
    sab: "Saturday",
    dom: "Sunday",
  };

  const ORDEN = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];

  const normalizado = texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

  const tramos: JsonLd[] = [];

  // "lun a vie 8:00-16:00" y "sab 8:00-12:00" son las dos formas que aparecen.
  const patron =
    /(lun|mar|mie|jue|vie|sab|dom)\s*(?:a|-|y)?\s*(lun|mar|mie|jue|vie|sab|dom)?[^\d]*(\d{1,2})[:.](\d{2})\s*(?:a|-|hasta)\s*(\d{1,2})[:.](\d{2})/g;

  for (const m of normalizado.matchAll(patron)) {
    const [, desde, hasta, h1, m1, h2, m2] = m;

    const iDesde = ORDEN.indexOf(desde);
    const iHasta = hasta ? ORDEN.indexOf(hasta) : iDesde;
    if (iDesde < 0 || iHasta < iDesde) continue;

    tramos.push({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: ORDEN.slice(iDesde, iHasta + 1).map((d) => DIAS[d]),
      opens: `${h1.padStart(2, "0")}:${m1}`,
      closes: `${h2.padStart(2, "0")}:${m2}`,
    });
  }

  return tramos;
}

/**
 * Una sucursal como comercio local.
 *
 * `HardwareStore` y no `LocalBusiness` a secas: es el tipo más preciso que
 * tiene schema.org para lo que es una maderera y corralón, y Google lo usa
 * para decidir en qué búsquedas mostrar la ficha («ferretería», «corralón»,
 * «materiales de construcción»). Cada local tiene su nodo propio —su `@id`
 * es su ficha— porque cada uno tiene su Perfil de Empresa en Google, con su
 * dirección y su teléfono, y mezclarlos en uno solo hace que Google no sepa a
 * cuál atribuir las reseñas.
 *
 * **El texto de la dirección, el teléfono y el horario es exactamente el que
 * se ve en la página** (NAP: nombre, dirección, teléfono). Google compara los
 * dos para decidir si confía en la ficha.
 */
export function sucursalJsonLd(sucursal: SucursalSeo): JsonLd {
  // La dirección viene como una línea sola. Se parte por la última coma: lo de
  // antes es la calle, lo de después la localidad.
  const corte = sucursal.address.lastIndexOf(",");
  const calle =
    corte > 0 ? sucursal.address.slice(0, corte).trim() : sucursal.address;
  const localidad =
    corte > 0 ? sucursal.address.slice(corte + 1).trim() : "Mar del Plata";

  const horarios = horariosJsonLd(sucursal.hours);
  const ficha = urlAbsoluta(`/sucursales/${sucursal.slug}`);

  return {
    "@context": "https://schema.org",
    "@type": "HardwareStore",
    "@id": idSucursal(sucursal.slug),
    name: `${NOMBRE} — ${sucursal.name}`,
    parentOrganization: { "@id": idOrganizacion() },
    url: ficha,
    image: urlAbsoluta(sucursal.foto ?? "/cropped-icon-180x180.png"),
    logo: urlAbsoluta("/cropped-icon-180x180.png"),
    address: {
      "@type": "PostalAddress",
      streetAddress: calle,
      addressLocality: localidad,
      addressRegion: "Buenos Aires",
      addressCountry: "AR",
    },
    ...(sucursal.geo
      ? {
          geo: {
            "@type": "GeoCoordinates",
            latitude: sucursal.geo.lat,
            longitude: sucursal.geo.lng,
          },
        }
      : {}),
    ...(sucursal.mapa ? { hasMap: sucursal.mapa } : {}),
    ...(sucursal.phone ? { telephone: telefonoInternacional(sucursal.phone) } : {}),
    ...(sucursal.email ? { email: sucursal.email } : {}),
    ...(horarios.length ? { openingHoursSpecification: horarios } : {}),
    ...(sucursal.redes?.length ? { sameAs: sucursal.redes } : {}),
    areaServed: { "@type": "City", name: "Mar del Plata" },
    currenciesAccepted: "ARS",
  };
}

/**
 * Disponibilidad de schema.org a partir del nivel de stock.
 *
 * "bajo" y "medio" son `InStock` igual: son cantidades chicas, no falta de
 * mercadería, y declararlas como `LimitedAvailability` hace que el resultado
 * se muestre con menos prioridad sin ninguna razón real.
 *
 * Lo que se fabrica a pedido no está «agotado» aunque no haya stock: es
 * `MadeToOrder`, que es lo que la ficha le dice a la persona.
 */
export function disponibilidadJsonLd(nivel: StockLevel, aPedido = false): string {
  if (nivel === "sin-stock") {
    return aPedido ? "https://schema.org/MadeToOrder" : "https://schema.org/OutOfStock";
  }
  return "https://schema.org/InStock";
}

/**
 * Hasta cuándo vale el precio publicado: una semana desde que se arma la
 * página.
 *
 * Los precios cambian seguido, y la ficha se rehace cada vez que alguien toca
 * uno (el panel invalida la caché del catálogo) o, como mucho, una vez por día.
 * Una semana cubre ese día con margen sin prometer un precio por un mes.
 */
export function precioValidoHasta(hoy: Date = new Date()): string {
  const hasta = new Date(hoy.getTime() + 7 * 86_400_000);
  return hasta.toISOString().slice(0, 10);
}

export interface ProductoSeo {
  slug: string;
  name: string;
  description: string;
  brand: string | null;
  categoryName: string;
  imagenes: string[];
  /** Se fabrica a pedido (ver `disponibilidadJsonLd`). */
  aPedido?: boolean;
  variantes: {
    sku: string;
    label: string;
    precio: string | null;
    disponibilidad: StockLevel;
    /** El color de la variante, si es lo que la distingue (chapas, melaminas). */
    color?: string | null;
    /** Si la variante tiene largo, ancho o espesor cargados. */
    conMedidas?: boolean;
  }[];
  /**
   * Promedio y cantidad de reseñas publicadas, si hay alguna.
   *
   * Va al marcado porque es lo que hace aparecer las estrellas en el resultado
   * de búsqueda. **Solo si existen de verdad**: declarar un `aggregateRating`
   * sin reseñas detrás es una penalización de Google y, antes que eso, una
   * afirmación falsa sobre lo que opina la gente.
   */
  resenas?: { promedio: number; cantidad: number } | null;
}

/**
 * Marcado de un producto.
 *
 * **Con una sola medida es un `Product` con su `Offer`.** Con varias es un
 * `ProductGroup` con una variante por medida (`hasVariant`), que es como
 * Google pide hoy los productos que se venden en tamaños: una placa de 18 mm y
 * una de 5,5 mm no comparten ni precio ni stock, y cada una tiene su SKU. Antes
 * iba un `AggregateOffer` con el rango, que sirve para el fragmento de precio
 * pero no para los listados de comercio (Merchant), que lo ignoran.
 *
 * Las medidas sin precio cargado quedan afuera: publicar una oferta sin precio
 * es una advertencia en Search Console y no le sirve a nadie.
 *
 * **Lo que no se declara, a propósito:** el GTIN (no existe para madera
 * cortada y la base no lo guarda), el costo de envío (se calcula al confirmar
 * según la zona) y la política de devoluciones (la página dice que se resuelve
 * caso por caso, y el marcado pide días y condiciones fijas).
 */
export function productoJsonLd(producto: ProductoSeo, hoy: Date = new Date()): JsonLd {
  const url = urlAbsoluta(`/catalogo/${producto.slug}`);
  const conPrecio = producto.variantes.filter(
    (v) => v.precio !== null && Number(v.precio) > 0,
  );
  const vigencia = precioValidoHasta(hoy);

  const oferta = (variante: (typeof conPrecio)[number]): JsonLd => ({
    "@type": "Offer",
    sku: variante.sku,
    price: Number(variante.precio).toFixed(2),
    priceCurrency: "ARS",
    priceValidUntil: vigencia,
    itemCondition: "https://schema.org/NewCondition",
    availability: disponibilidadJsonLd(variante.disponibilidad, producto.aPedido),
    url,
    seller: { "@id": idOrganizacion() },
  });

  const comun: JsonLd = {
    name: producto.name,
    description: producto.description || `${producto.name} en ${NOMBRE}, Mar del Plata.`,
    category: producto.categoryName,
    url,
    ...(producto.brand ? { brand: { "@type": "Brand", name: producto.brand } } : {}),
    ...(producto.imagenes.length
      ? { image: producto.imagenes.map((i) => urlAbsoluta(i)) }
      : {}),
    ...(producto.resenas && producto.resenas.cantidad > 0
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: producto.resenas.promedio.toFixed(1),
            reviewCount: producto.resenas.cantidad,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
  };

  if (conPrecio.length <= 1) {
    return {
      "@context": "https://schema.org",
      "@type": "Product",
      "@id": `${url}#producto`,
      ...comun,
      ...(conPrecio[0] ? { sku: conPrecio[0].sku, offers: oferta(conPrecio[0]) } : {}),
    };
  }

  return {
    "@context": "https://schema.org",
    "@type": "ProductGroup",
    "@id": `${url}#producto`,
    ...comun,
    productGroupID: producto.slug,
    variesBy: [...new Set(conPrecio.map((v) => `https://schema.org/${queVaria(v)}`))],
    hasVariant: conPrecio.map((variante) => ({
      "@type": "Product",
      sku: variante.sku,
      name: `${producto.name} ${variante.label}`,
      // La medida o el color, según qué distingue a esta variante: una chapa
      // «Rojo teja» no tiene talle.
      [queVaria(variante)]: queVaria(variante) === "color" ? variante.color : variante.label,
      ...(comun.image ? { image: comun.image } : {}),
      ...(comun.brand ? { brand: comun.brand } : {}),
      offers: oferta(variante),
    })),
  };
}

/**
 * Qué distingue a una variante de sus hermanas: la medida (lo normal en una
 * maderera) o el color, cuando la variante no tiene medidas cargadas pero sí
 * un color (las chapas, algunas melaminas).
 */
export function queVaria(variante: {
  color?: string | null;
  conMedidas?: boolean;
}): "size" | "color" {
  return !variante.conMedidas && variante.color ? "color" : "size";
}

/** Las migas de pan, que es lo que Google muestra en vez de la URL cruda. */
export function migasJsonLd(
  items: { nombre: string; ruta: string }[],
): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.nombre,
      item: urlAbsoluta(item.ruta),
    })),
  };
}

/**
 * El sitio como tal, con su buscador.
 *
 * El `SearchAction` apunta al catálogo porque es el único buscador real que
 * tiene el sitio. Google dejó de dibujar el cuadro de búsqueda en el resultado
 * (2024), pero el marcado sigue siendo válido y lo leen otros buscadores y los
 * asistentes que citan.
 */
export function sitioWebJsonLd(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${urlSitio()}/#sitio`,
    name: NOMBRE,
    alternateName: "MJBJ",
    url: urlSitio(),
    inLanguage: "es-AR",
    publisher: { "@id": idOrganizacion() },
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${urlSitio()}/catalogo?buscar={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

export interface EventoSeo {
  slug: string;
  titulo: string;
  resumen: string | null;
  descripcion: string | null;
  imagenUrl: string | null;
  lugar: string | null;
  inicia: Date;
  termina: Date | null;
  cupo: number;
  inscriptos: number;
  precio: string | number;
}

/**
 * Una capacitación o charla como `Event`.
 *
 * Es presencial, en un local de la maderera o en el lugar que diga el evento.
 * La disponibilidad sale del cupo: con cupo lleno, `SoldOut`. Un evento sin
 * cupo declarado (cupo 0) no tiene tope.
 */
export function eventoJsonLd(evento: EventoSeo): JsonLd {
  const url = urlAbsoluta(`/eventos/${evento.slug}`);
  const lleno = evento.cupo > 0 && evento.inscriptos >= evento.cupo;
  const precio = Number(evento.precio) || 0;

  return {
    "@context": "https://schema.org",
    "@type": "Event",
    "@id": `${url}#evento`,
    name: evento.titulo,
    description: evento.resumen ?? evento.descripcion ?? undefined,
    url,
    startDate: evento.inicia.toISOString(),
    ...(evento.termina ? { endDate: evento.termina.toISOString() } : {}),
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: {
      "@type": "Place",
      name: evento.lugar ?? NOMBRE,
      address: {
        "@type": "PostalAddress",
        ...(evento.lugar ? { streetAddress: evento.lugar } : {}),
        addressLocality: "Mar del Plata",
        addressRegion: "Buenos Aires",
        addressCountry: "AR",
      },
    },
    ...(evento.imagenUrl ? { image: [urlAbsoluta(evento.imagenUrl)] } : {}),
    organizer: { "@id": idOrganizacion(), "@type": "Organization", name: NOMBRE, url: urlSitio() },
    offers: {
      "@type": "Offer",
      url,
      price: precio.toFixed(2),
      priceCurrency: "ARS",
      availability: lleno ? "https://schema.org/SoldOut" : "https://schema.org/InStock",
    },
  };
}

/**
 * Una lista de productos, para la página de una categoría.
 *
 * Le dice al buscador qué fichas forman el listado —en orden— sin que tenga
 * que deducirlo de los enlaces. Solo URLs: el detalle de cada producto vive en
 * su ficha, y repetirlo acá sería marcado duplicado.
 */
export function listaDeProductosJsonLd(
  nombre: string,
  slugs: string[],
): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: nombre,
    numberOfItems: slugs.length,
    itemListElement: slugs.map((slug, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: urlAbsoluta(`/catalogo/${slug}`),
    })),
  };
}
