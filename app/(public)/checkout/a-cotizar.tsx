import Link from "next/link";
import { ArrowLeft, MessageCircle, Ruler } from "lucide-react";
import { Button } from "@/components/ui/button";
import { quitarLosQueSeCotizan } from "./actions";

export interface ItemACotizar {
  id: string;
  descripcion: string;
  unidad: string;
  cantidad: number;
}

/**
 * Los productos que no tienen precio cargado no son un error del visitante.
 *
 * Son las medidas que se cortan a pedido y lo que se trae por encargo: la
 * maderera los cotiza a mano, siempre. Hasta acá eso se descubría **después**
 * de completar nombre, teléfono, correo, entrega y medio de pago, porque la
 * comprobación vivía en la acción que confirma el pedido. Llenar cinco campos
 * para que la respuesta sea "esto no se puede pedir por acá" es el camino más
 * largo posible hacia un dato que se sabía desde el principio.
 *
 * Ahora se resuelve antes del formulario y con el camino servido: el mensaje de
 * WhatsApp sale armado con las medidas y las cantidades, así que del otro lado
 * llega un pedido de cotización completo y no un "hola, consulta".
 */
export function ACotizar({
  items,
  enlace,
  hayOtros,
}: {
  items: ItemACotizar[];
  /** Enlace de WhatsApp ya armado con el detalle de estos productos. */
  enlace: string;
  /** Si además hay productos con precio, se puede seguir con esos. */
  hayOtros: boolean;
}) {
  return (
    <section className="rounded-2xl border border-linea bg-card p-6 shadow-sm">
      <h2 className="flex items-center gap-2 text-lg font-bold tracking-[-0.02em]">
        <Ruler className="h-5 w-5 text-acento-texto" />
        {items.length === 1
          ? "Este producto se cotiza"
          : "Estos productos se cotizan"}
      </h2>
      <p className="mt-1.5 text-[15px] text-texto-2">
        Se cortan a medida o se traen por encargo, así que el precio lo pasamos a
        mano. Mandanos el detalle y te lo cotizamos hoy.
      </p>

      <ul className="mt-4 space-y-2">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-baseline justify-between gap-3 rounded-xl border border-linea-tenue px-4 py-3 text-sm"
          >
            <span className="font-medium">{item.descripcion}</span>
            <span className="tabular shrink-0 text-texto-3">
              {item.cantidad} {item.unidad.replace("_", " ")}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-5 space-y-2.5">
        <Button
          render={
            <a href={enlace} target="_blank" rel="noopener noreferrer" />
          }
          className="h-[52px] w-full rounded-[10px] bg-[#25D366] text-base font-semibold text-white hover:bg-[#1fb757]"
        >
          <MessageCircle className="h-4 w-4" />
          Pedir la cotización por WhatsApp
        </Button>

        {/* Con productos con precio en el mismo presupuesto, el pedido no tiene
            por qué esperar a la cotización: se sacan estos y sigue. */}
        {hayOtros && (
          <form action={quitarLosQueSeCotizan}>
            <Button
              type="submit"
              variant="outline"
              className="h-[46px] w-full rounded-[10px] border-linea text-[15px] font-semibold"
            >
              Quitarlos y seguir con el resto
            </Button>
          </form>
        )}

        <Button
          render={<Link href="/presupuesto" />}
          variant="ghost"
          className="h-[46px] w-full rounded-[10px] text-[15px] font-medium text-texto-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver al presupuesto
        </Button>
      </div>
    </section>
  );
}
