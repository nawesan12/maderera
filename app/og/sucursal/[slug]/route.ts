import { sucursalPublicada } from "@/lib/sucursales";
import { fotoParaTarjeta, tarjeta } from "../../plantilla";

/**
 * La tarjeta para compartir una sucursal: el nombre, la dirección y el
 * horario, que es lo que se pregunta por WhatsApp antes de ir.
 */
export async function GET(
  _pedido: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const sucursal = sucursalPublicada(slug);
  if (!sucursal) return new Response("No existe", { status: 404 });

  return tarjeta({
    antetitulo: `Sucursal ${sucursal.nombre}`,
    titulo: sucursal.direccion,
    detalle: sucursal.horario,
    pie: sucursal.telefono,
    foto: await fotoParaTarjeta(sucursal.foto?.ruta),
  });
}
