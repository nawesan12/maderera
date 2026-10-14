import { obtenerProductoPublico } from "@/lib/dal/catalog";
import { precioEnTexto } from "@/lib/seo";
import { fotoParaTarjeta, tarjeta } from "../../plantilla";

/**
 * La tarjeta para compartir una ficha: foto, nombre y desde cuánto sale.
 *
 * El precio es el de público, el mismo que muestra la ficha a quien no
 * entró: la tarjeta la ve cualquiera que reciba el enlace.
 */
export async function GET(
  _pedido: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const producto = await obtenerProductoPublico(slug);

  if (!producto) {
    return new Response("No existe", { status: 404 });
  }

  const precios = producto.variantes
    .map((v) => Number(v.precio))
    .filter((n) => Number.isFinite(n) && n > 0);
  const desde = precios.length ? Math.min(...precios) : null;

  return tarjeta({
    antetitulo: producto.subcategoryName ?? producto.categoryName,
    titulo: producto.name,
    detalle: desde
      ? `${precios.length > 1 ? "Desde " : ""}${precioEnTexto(desde)}`
      : null,
    pie: "Mar del Plata",
    foto: await fotoParaTarjeta(producto.imagenes[0]),
  });
}
