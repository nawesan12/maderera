/**
 * El feed de productos para Google Merchant Center.
 *
 * Es lo que pone los productos de la maderera en la pestaña «Shopping» de
 * Google y en los listados gratuitos, con foto y precio, sin pagar anuncios.
 * Google lee este archivo una vez por día desde `/feeds/google-merchant.xml`;
 * cómo darlo de alta está en `docs/SEO-MUDANZA.md`.
 *
 * **Una entrada por medida, agrupadas por producto** (`item_group_id`): una
 * placa de 18 mm y una de 5,5 mm tienen precio y stock distintos, y Google
 * pide que cada combinación que se vende tenga su línea. Es lo mismo que dice
 * el marcado de la ficha (`productoJsonLd`), y Google los compara: si el feed
 * y la página no coinciden, rechaza el producto.
 *
 * **El precio es el final, con IVA**, que es lo que se muestra al público (Ley
 * 27.743) y lo que Google exige: el precio del feed tiene que ser el que paga
 * quien entra a la página.
 *
 * Lo que queda afuera, a propósito: las medidas sin precio cargado, y los
 * productos sin foto (Google los rechaza; mejor que no estén a que el feed
 * entero aparezca con errores). Lo que se dejó afuera se cuenta en el
 * comentario del principio del archivo, para verlo sin entrar al panel.
 */

import type { StockLevel } from "./stock-level";
import { queVaria } from "./seo";

export interface ProductoParaFeed {
  slug: string;
  nombre: string;
  descripcion: string;
  marca: string | null;
  categoria: string;
  rubro: string | null;
  imagenes: string[];
  aPedido: boolean;
  variantes: {
    sku: string;
    medida: string;
    precio: string | null;
    disponibilidad: StockLevel;
    color?: string | null;
    conMedidas?: boolean;
  }[];
}

/** Lo que hace falta del sitio para armar enlaces absolutos. */
export interface OrigenDelFeed {
  urlSitio: string;
  nombreTienda: string;
}

/** Escapa texto para meterlo en XML. */
export function escaparXml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // Los caracteres de control rompen el XML entero, no solo la línea.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

/** El estado de stock en el vocabulario de Merchant. */
export function disponibilidadMerchant(nivel: StockLevel, aPedido: boolean): string {
  if (nivel !== "sin-stock") return "in_stock";
  return aPedido ? "backorder" : "out_of_stock";
}

function absoluta(origen: OrigenDelFeed, ruta: string): string {
  if (/^https?:\/\//.test(ruta)) return ruta;
  return `${origen.urlSitio}${ruta.startsWith("/") ? ruta : `/${ruta}`}`;
}

/** Título de una medida: «Placa de melamina blanca 18 mm». Tope de Google: 150. */
function tituloDeVariante(producto: ProductoParaFeed, medida: string, varias: boolean): string {
  const base = varias && medida && !producto.nombre.includes(medida)
    ? `${producto.nombre} ${medida}`
    : producto.nombre;
  return base.length > 150 ? `${base.slice(0, 149)}…` : base;
}

export function armarFeedMerchant(
  productos: ProductoParaFeed[],
  origen: OrigenDelFeed,
  hoy: Date = new Date(),
): string {
  const items: string[] = [];
  let sinFoto = 0;
  let sinPrecio = 0;

  for (const producto of productos) {
    const conPrecio = producto.variantes.filter(
      (v) => v.precio !== null && Number(v.precio) > 0,
    );
    sinPrecio += producto.variantes.length - conPrecio.length;

    if (producto.imagenes.length === 0) {
      sinFoto += conPrecio.length;
      continue;
    }

    const varias = conPrecio.length > 1;
    const link = absoluta(origen, `/catalogo/${producto.slug}`);
    const tipo = [producto.categoria, producto.rubro].filter(Boolean).join(" > ");
    const descripcion =
      producto.descripcion.trim() ||
      `${producto.nombre} en ${origen.nombreTienda}, Mar del Plata.`;

    for (const v of conPrecio) {
      const campos = [
        ["g:id", v.sku],
        ["g:title", tituloDeVariante(producto, v.medida, varias)],
        ["g:description", descripcion.slice(0, 5000)],
        ["g:link", link],
        ["g:image_link", absoluta(origen, producto.imagenes[0])],
        ...producto.imagenes
          .slice(1, 11)
          .map((i) => ["g:additional_image_link", absoluta(origen, i)]),
        ["g:availability", disponibilidadMerchant(v.disponibilidad, producto.aPedido)],
        ["g:price", `${Number(v.precio).toFixed(2)} ARS`],
        ["g:condition", "new"],
        ...(varias
          ? [
              ["g:item_group_id", producto.slug],
              // Lo mismo que dice el marcado de la ficha (`queVaria`).
              queVaria(v) === "color"
                ? ["g:color", v.color ?? v.medida]
                : ["g:size", v.medida],
            ]
          : []),
        // La marca solo si está cargada. Poner el nombre de la maderera en
        // las que no la tienen sería decir que la fabrica ella, y eso solo
        // vale para lo que sale del aserradero: Google lo marca como
        // advertencia y la solución es cargar la marca en el panel.
        ...(producto.marca ? [["g:brand", producto.marca]] : []),
        // Madera cortada, placas y molduras propias no tienen código de
        // barras de fabricante. Sin esto Google pide un GTIN que no existe.
        ["g:identifier_exists", "no"],
        ["g:product_type", tipo],
      ];

      items.push(
        [
          "    <item>",
          ...campos.map(([k, val]) => `      <${k}>${escaparXml(val)}</${k}>`),
          "    </item>",
        ].join("\n"),
      );
    }
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<!-- ${items.length} artículos. Afuera: ${sinFoto} sin foto, ${sinPrecio} medidas sin precio. Generado ${hoy.toISOString()}. -->`,
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">',
    "  <channel>",
    `    <title>${escaparXml(origen.nombreTienda)}</title>`,
    `    <link>${escaparXml(origen.urlSitio)}</link>`,
    `    <description>${escaparXml(`Catálogo de ${origen.nombreTienda}, Mar del Plata. Precios finales con IVA.`)}</description>`,
    ...items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}
