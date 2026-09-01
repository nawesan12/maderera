/**
 * Cimientos de SEO: la URL canónica del sitio y los datos estructurados.
 *
 * Los datos estructurados no son adorno para una maderera de barrio: son lo
 * que hace que Google muestre la dirección, el horario y el teléfono de cada
 * sucursal en el costado de la búsqueda, y lo que pone el precio y la
 * disponibilidad debajo del resultado de un producto. Alguien que busca
 * "fenólico Mar del Plata" decide con eso, antes de entrar.
 *
 * Todo lo de acá se arma con datos de la base y no con constantes: una
 * dirección o un horario equivocado en el marcado se indexa igual, y después
 * llega gente al local a una hora en que está cerrado.
 */

import type { StockLevel } from "@/lib/stock-level";

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
  return "https://mjbj.ar";
}

export function urlAbsoluta(ruta: string): string {
  return `${urlSitio()}${ruta.startsWith("/") ? ruta : `/${ruta}`}`;
}

/**
 * Si este despliegue puede ser indexado.
 *
 * Es la línea que evita el desastre clásico: cada vista previa de cada rama
 * queda publicada en una URL real, Google las encuentra, y el sitio termina
 * compitiendo consigo mismo con seis copias del catálogo. Solo producción se
 * indexa.
 */
export function sitioIndexable(): boolean {
  const entorno = process.env.VERCEL_ENV;
  if (entorno && entorno !== "production") return false;
  return process.env.SEO_INDEXAR !== "no";
}

/* -------------------------------------------------------------------------- */
/* Datos estructurados                                                         */
/* -------------------------------------------------------------------------- */

/** Un objeto JSON-LD cualquiera. */
export type JsonLd = Record<string, unknown>;

const NOMBRE = "Maderera Juan B. Justo";
const FUNDACION = "1981";

/** Identificador estable de la empresa, para que todo apunte al mismo nodo. */
export function idOrganizacion(): string {
  return `${urlSitio()}/#organizacion`;
}

export function organizacionJsonLd(opciones: {
  descripcion?: string;
  telefono?: string | null;
  email?: string | null;
  redes?: string[];
}): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": idOrganizacion(),
    name: NOMBRE,
    url: urlSitio(),
    logo: urlAbsoluta("/cropped-icon-180x180.png"),
    foundingDate: FUNDACION,
    description: opciones.descripcion,
    areaServed: { "@type": "City", name: "Mar del Plata" },
    ...(opciones.telefono ? { telephone: opciones.telefono } : {}),
    ...(opciones.email ? { email: opciones.email } : {}),
    ...(opciones.redes?.length ? { sameAs: opciones.redes } : {}),
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
    .replace(/[\u0300-\u036f]/g, "");

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

export function sucursalJsonLd(sucursal: SucursalSeo): JsonLd {
  // La dirección viene como una línea sola desde el panel. Se parte por la
  // última coma: lo de antes es la calle, lo de después la localidad.
  const corte = sucursal.address.lastIndexOf(",");
  const calle =
    corte > 0 ? sucursal.address.slice(0, corte).trim() : sucursal.address;
  const localidad =
    corte > 0 ? sucursal.address.slice(corte + 1).trim() : "Mar del Plata";

  const horarios = horariosJsonLd(sucursal.hours);

  return {
    "@context": "https://schema.org",
    "@type": "HardwareStore",
    "@id": `${urlSitio()}/sucursales#${sucursal.slug}`,
    name: `${NOMBRE} — ${sucursal.name}`,
    parentOrganization: { "@id": idOrganizacion() },
    url: urlAbsoluta("/sucursales"),
    image: urlAbsoluta("/cropped-icon-180x180.png"),
    address: {
      "@type": "PostalAddress",
      streetAddress: calle,
      addressLocality: localidad,
      addressRegion: "Buenos Aires",
      addressCountry: "AR",
    },
    ...(sucursal.phone ? { telephone: sucursal.phone } : {}),
    ...(sucursal.email ? { email: sucursal.email } : {}),
    ...(horarios.length ? { openingHoursSpecification: horarios } : {}),
    currenciesAccepted: "ARS",
  };
}

/**
 * Disponibilidad de schema.org a partir del nivel de stock.
 *
 * "bajo" y "medio" son `InStock` igual: son cantidades chicas, no falta de
 * mercadería, y declararlas como `LimitedAvailability` hace que el resultado
 * se muestre con menos prioridad sin ninguna razón real.
 */
export function disponibilidadJsonLd(nivel: StockLevel): string {
  return nivel === "sin-stock"
    ? "https://schema.org/OutOfStock"
    : "https://schema.org/InStock";
}

export interface ProductoSeo {
  slug: string;
  name: string;
  description: string;
  brand: string | null;
  categoryName: string;
  imagenes: string[];
  variantes: {
    sku: string;
    label: string;
    precio: string | null;
    disponibilidad: StockLevel;
  }[];
}

/**
 * Marcado de un producto con sus medidas como ofertas.
 *
 * Cada medida es un `Offer` propio y no un precio único porque es lo que
 * realmente se vende: una placa de 18 mm y una de 5,5 mm no comparten ni
 * precio ni stock. El `AggregateOffer` de arriba da el rango, que es lo que
 * Google muestra cuando hay varias.
 *
 * Las medidas sin precio cargado quedan afuera: publicar una oferta sin precio
 * es una advertencia en Search Console y no le sirve a nadie.
 */
export function productoJsonLd(producto: ProductoSeo): JsonLd {
  const conPrecio = producto.variantes.filter(
    (v) => v.precio !== null && Number(v.precio) > 0,
  );

  const precios = conPrecio.map((v) => Number(v.precio));

  const ofertas = conPrecio.map((variante) => ({
    "@type": "Offer",
    sku: variante.sku,
    name: variante.label,
    price: Number(variante.precio).toFixed(2),
    priceCurrency: "ARS",
    availability: disponibilidadJsonLd(variante.disponibilidad),
    url: urlAbsoluta(`/catalogo/${producto.slug}`),
    seller: { "@id": idOrganizacion() },
  }));

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${urlSitio()}/catalogo/${producto.slug}#producto`,
    name: producto.name,
    description: producto.description,
    category: producto.categoryName,
    url: urlAbsoluta(`/catalogo/${producto.slug}`),
    ...(producto.brand ? { brand: { "@type": "Brand", name: producto.brand } } : {}),
    ...(producto.imagenes.length
      ? { image: producto.imagenes.map((i) => (i.startsWith("http") ? i : urlAbsoluta(i))) }
      : {}),
    ...(ofertas.length === 0
      ? {}
      : ofertas.length === 1
        ? { offers: ofertas[0] }
        : {
            offers: {
              "@type": "AggregateOffer",
              priceCurrency: "ARS",
              lowPrice: Math.min(...precios).toFixed(2),
              highPrice: Math.max(...precios).toFixed(2),
              offerCount: ofertas.length,
              offers: ofertas,
            },
          }),
  };
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
 * El `SearchAction` es lo que habilita el cuadro de búsqueda dentro del
 * resultado de Google. Apunta al catálogo porque es el único buscador real que
 * tiene el sitio.
 */
export function sitioWebJsonLd(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${urlSitio()}/#sitio`,
    name: NOMBRE,
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
