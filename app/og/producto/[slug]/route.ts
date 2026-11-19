import { obtenerProductoPublico } from "@/lib/dal/catalog";
import { precioEnTexto } from "@/lib/seo";
import { medidaPrincipal } from "@/lib/catalogo/medida";
import { fotoParaTarjeta, tarjeta } from "../../plantilla";

/**
 * La tarjeta para compartir una ficha: foto (o la placa del rubro), nombre y
 * desde cuánto sale (o la medida, si no hay precio).
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

  const foto = await fotoParaTarjeta(producto.imagenes[0]);
  return tarjeta({
    // Con foto, el rubro; sin foto el rubro ya va en la placa y arriba del
    // título queda la categoría madre (si es la misma, la plantilla lo saca).
    antetitulo: foto ? (producto.subcategoryName ?? producto.categoryName) : producto.categoryName,
    titulo: producto.name,
    // Sin precio, la medida: lo mismo que la tarjeta del catálogo (hallazgo 26).
    detalle: desde
      ? `${precios.length > 1 ? "Desde " : ""}${precioEnTexto(desde)}`
      : (medidaPrincipal(producto.variantes.map((v) => v.label))?.texto ?? null),
    pie: "Mar del Plata",
    foto,
    placa: {
      rubro: producto.subcategory ?? producto.categoryName,
      categoria: producto.categorySlug,
      marca: producto.brand,
    },
  });
}
