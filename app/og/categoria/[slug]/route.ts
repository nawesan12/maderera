import {
  listarCategorias,
  resumenPublico,
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

  const { cantidad, desde, imagen } = await resumenPublico({
    categoria: slug,
    subcategoria: rubro?.slug,
  });

  const titulo = rubro?.name ?? TEXTOS_DE_CATEGORIA[slug]?.titulo ?? categoria.name;
  const foto = categoria.image ?? imagen;

  return tarjeta({
    antetitulo: rubro ? categoria.name : "Catálogo",
    titulo,
    detalle:
      cantidad > 0
        ? `${cantidad} ${cantidad === 1 ? "producto" : "productos"}${desde ? ` · desde ${precioEnTexto(desde)}` : ""}`
        : null,
    pie: "Mar del Plata",
    foto: await fotoParaTarjeta(foto),
  });
}
