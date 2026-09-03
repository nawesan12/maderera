import Link from "next/link";
import { ChevronRight, Store, Truck } from "lucide-react";
import {
  AcentoEstado,
  EtiquetaEstado,
  estiloDeEstado,
} from "@/components/admin/etiqueta-estado";
import { ETAPAS_PEDIDO, ETAPAS_RETIRO, Pasos } from "@/components/admin/pasos";
import { fechaCorta, formatearMonto, haceCuanto, plural } from "@/lib/formato";
import type { PedidoPropio } from "@/lib/dal/cuenta";

/**
 * Un pedido en la lista del cliente.
 *
 * Lleva el recorrido adentro, no solo la etiqueta de estado: la pregunta que
 * trae a alguien a esta pantalla es "¿cuánto falta?", y eso no se contesta con
 * la palabra "Preparando" sola. Con la barra se ve de un vistazo cuánto del
 * camino ya pasó, sin abrir el detalle.
 *
 * La franja de color al costado es la misma que usa el panel para ese estado,
 * así el cliente y quien lo atiende por teléfono están mirando lo mismo.
 */
export function TarjetaPedido({ pedido }: { pedido: PedidoPropio }) {
  const etapas =
    pedido.tipoEntrega === "retiro" ? ETAPAS_RETIRO : ETAPAS_PEDIDO;
  const cancelado = pedido.estado === "cancelado";
  const { abierto } = estiloDeEstado(pedido.estado);

  return (
    <Link
      href={`/mi-cuenta/pedidos/${pedido.numero}`}
      className="group relative block overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-md"
    >
      <AcentoEstado estado={pedido.estado} />

      <div className="p-5 pl-6">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-semibold">
              <span className="tabular">{pedido.numero}</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted-foreground">
              <span>{fechaCorta.format(pedido.createdAt)}</span>
              <span aria-hidden>·</span>
              <span>{plural(pedido.items, "producto")}</span>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1">
                {pedido.tipoEntrega === "retiro" ? (
                  <>
                    <Store className="h-3.5 w-3.5" />
                    {pedido.sucursal ?? "Retiro"}
                  </>
                ) : (
                  <>
                    <Truck className="h-3.5 w-3.5" />
                    Envío
                  </>
                )}
              </span>
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="tabular text-xl font-semibold">
              {formatearMonto(pedido.total)}
            </span>
            <EtiquetaEstado estado={pedido.estado} />
          </div>
        </div>

        <div className="mt-4">
          <Pasos etapas={etapas} actual={pedido.estado} cancelado={cancelado} />
        </div>

        {!cancelado && abierto && (
          <p className="mt-3 text-sm text-muted-foreground">
            Actualizado {haceCuanto(pedido.createdAt)}
            {pedido.estadoPago === "pendiente" && (
              <span className="ml-2 text-brand-orange-dark">
                · Falta abonarlo
              </span>
            )}
          </p>
        )}
      </div>
    </Link>
  );
}
