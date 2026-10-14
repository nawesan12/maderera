import {
  listarCategorias,
  listarProductosPublicos,
  rubrosDeCategoria,
} from "@/lib/dal/catalog";
import { precioEnTexto } from "@/lib/seo";
import { TEXTOS_DE_CATEGORIA } from "@/lib/textos-categorias";
import { fotoParaTarjeta, tarjeta } from "../../plantilla";

/**
 * La tarjeta para compartir una categoría (o un rubro, con `?rubro=`).
 *
 * Las categorías viven en `/catalogo?cat=…`, una consulta y no una carpeta,
 * así que no pueden tener su `opengraph-image` al lado: la metadata de la
 * página apunta acá.
 */
export async function GET(
  pedido: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const categoria = (await listarCategorias()).find((c) => c.slug === slug);
  if (!categoria) return new Response("No existe", { status: 404 });

  const pedidoRubro = new URL(pedido.url).searchParams.get("rubro");
  const rubro = pedidoRubro
    ? (await rubrosDeCategoria(slug)).find((r) => r.slug === pedidoRubro)
    : undefined;

  const productos = await listarProductosPublicos({
    categoria: slug,
    subcategoria: rubro?.slug,
  });
  const precios = productos
    .map((p) => Number(p.precioDesde))
    .filter((n) => Number.isFinite(n) && n > 0);
  const desde = precios.length ? Math.min(...precios) : null;

  const titulo = rubro?.name ?? TEXTOS_DE_CATEGORIA[slug]?.titulo ?? categoria.name;
  const foto =
    categoria.image ?? productos.find((p) => p.image)?.image ?? null;

  return tarjeta({
    antetitulo: rubro ? categoria.name : "Catálogo",
    titulo,
    detalle:
      productos.length > 0
        ? `${productos.length} ${productos.length === 1 ? "producto" : "productos"}${desde ? ` · desde ${precioEnTexto(desde)}` : ""}`
        : null,
    pie: "Mar del Plata",
    foto: await fotoParaTarjeta(foto),
  });
}
