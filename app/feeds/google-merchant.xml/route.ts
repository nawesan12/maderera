import { cachearPublico, ETIQUETAS } from "@/lib/cache-publico";
import { listarProductosPublicos, obtenerProductoPublico } from "@/lib/dal/catalog";
import { armarFeedMerchant, type ProductoParaFeed } from "@/lib/merchant";
import { combinedStockLevel } from "@/lib/stock-level";
import { NOMBRE, urlSitio } from "@/lib/seo";

/**
 * El feed de productos para Google Merchant Center (ver `lib/merchant.ts`).
 *
 * Sale del mismo lugar que la ficha de cada producto —`obtenerProductoPublico`,
 * a precio de público— para que el precio y el stock del feed sean los que ve
 * quien entra: Google los compara y rechaza lo que no coincide.
 *
 * **Se arma una vez y queda en caché** con la etiqueta del catálogo: Google lo
 * pide una vez por día, pero cualquiera puede pedirlo, y armarlo recorre todas
 * las fichas. Un cambio de precio en el panel lo invalida como invalida las
 * fichas.
 */

/** De a cuántas fichas se piden a la vez: no ahogar el pool de la base. */
const EN_PARALELO = 6;

const feedCacheado = cachearPublico(
  async (): Promise<string> => {
    const listado = await listarProductosPublicos();
    const productos: ProductoParaFeed[] = [];

    for (let i = 0; i < listado.length; i += EN_PARALELO) {
      const tanda = await Promise.all(
        listado.slice(i, i + EN_PARALELO).map((p) => obtenerProductoPublico(p.slug)),
      );
      for (const p of tanda) {
        if (!p) continue;
        productos.push({
          slug: p.slug,
          nombre: p.name,
          descripcion: p.description,
          marca: p.brand,
          categoria: p.categoryName,
          rubro: p.subcategoryName,
          imagenes: p.imagenes,
          aPedido: p.aPedido,
          variantes: p.variantes.map((v) => ({
            sku: v.sku,
            medida: v.label,
            precio: v.precio,
            disponibilidad: combinedStockLevel([v.stockCentral, v.stockAserradero]),
            color: v.color,
            conMedidas: Boolean(v.largoMm || v.anchoMm || v.espesorMm),
          })),
        });
      }
    }

    return armarFeedMerchant(productos, { urlSitio: urlSitio(), nombreTienda: NOMBRE });
  },
  ["feed-merchant"],
  ETIQUETAS.catalogo,
);

export async function GET() {
  return new Response(await feedCacheado(), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
