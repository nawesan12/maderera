import { NextResponse } from "next/server";
import { obtenerCarrito } from "@/lib/dal/carrito";
import { getSession } from "@/lib/dal/session";
import { apagarSenal } from "@/lib/senal-cliente";

/**
 * Lo que el encabezado necesita saber de quien está mirando.
 *
 * Existe porque las páginas del sitio se sirven del CDN: el HTML es igual para
 * todos, y el nombre de la persona y el contador del presupuesto se completan
 * desde el navegador. El navegador solo pide esto cuando la señal
 * (`lib/senal-cliente.ts`) dice que hay algo que traer.
 *
 * **Devuelve lo mínimo para dibujar el menú y nada más.** No el correo, no el
 * rol del panel, no los renglones del presupuesto: si mañana hace falta algo
 * más en el encabezado, se agrega acá con la misma pregunta de siempre —qué
 * pasa si esto se ve donde no debe—. La sesión se lee del lado del servidor,
 * de la cookie firmada, y nunca de lo que mande el cliente.
 */
export async function GET() {
  const [sesion, carrito] = await Promise.all([getSession(), obtenerCarrito()]);

  // La señal se corrige sola. Si quedó prendida y ya no hay nada que traer
  // —se cerró sesión, se venció el carrito, alguien la escribió a mano— se
  // apaga acá, y el navegador deja de preguntar en las visitas siguientes.
  // Sin esto, cerrar sesión dejaría un pedido inútil por carga para siempre.
  if (!sesion && carrito.cantidadItems === 0) await apagarSenal();

  return NextResponse.json(
    {
      sesion: sesion
        ? { nombre: sesion.name, esStaff: sesion.role === "staff" }
        : null,
      cantidadItems: carrito.cantidadItems,
    },
    // Es distinto para cada persona: que no lo guarde ningún intermediario.
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
