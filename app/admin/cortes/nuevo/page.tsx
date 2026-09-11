import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Truck } from "lucide-react";
import { listarSucursalesPublicas } from "@/lib/dal/envios";
import { obtenerPedido } from "@/lib/dal/admin/ventas";
import { requireStaff } from "@/lib/dal/session";
import { FormularioCorte } from "./formulario";

export const metadata = { title: "Nuevo corte" };

/**
 * Alta de una orden de corte.
 *
 * El tablero sabía mover órdenes y exportarlas al optimizador, pero ninguna
 * parte del sistema podía crear una: las que había las puso el sembrado de
 * datos de prueba.
 *
 * Con `?pedido=`, el corte nace atado a ese pedido y con el cliente y la
 * sucursal ya puestos. Es el camino real: primero entra la venta, después se
 * manda a cortar. Cargarlo suelto y volver a tipear el nombre es lo que hacía
 * que en el pedido no quedara rastro de que había un corte esperando.
 */
export default async function NuevoCortePage({
  searchParams,
}: {
  searchParams: Promise<{ pedido?: string }>;
}) {
  await requireStaff();

  const { pedido: pedidoId } = await searchParams;
  const [sucursales, pedido] = await Promise.all([
    listarSucursalesPublicas(),
    pedidoId ? obtenerPedido(pedidoId) : Promise.resolve(null),
  ]);

  // Un id de pedido que no existe no es lo mismo que no haber pasado ninguno:
  // seguir de largo dejaría un corte suelto creyendo que quedó atado.
  if (pedidoId && !pedido) notFound();

  return (
    <div className="space-y-6">
      <Link
        href={pedido ? `/admin/pedidos/${pedido.id}` : "/admin/cortes"}
        className="inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-5 w-5" />
        {pedido ? `Volver al pedido ${pedido.numero}` : "Volver a cortes"}
      </Link>

      <div>
        <h1 className="text-3xl font-bold text-foreground">Nuevo corte</h1>
        <p className="mt-1 text-base text-muted-foreground">
          El despiece va en milímetros: son los números que después necesita el
          optimizador de la máquina.
        </p>
      </div>

      {pedido && (
        <p className="tarjeta-atencion flex items-center gap-2.5 px-4 py-3 text-base">
          <Truck className="h-5 w-5 shrink-0 text-brand-orange" aria-hidden="true" />
          <span>
            Este corte queda atado al pedido{" "}
            <strong className="tabular">{pedido.numero}</strong> de{" "}
            {pedido.cliente}. Va a figurar en la ficha del pedido y en la del
            corte.
          </span>
        </p>
      )}

      <FormularioCorte
        sucursales={sucursales.map((s) => ({ id: s.id, nombre: s.nombre }))}
        desdePedido={
          pedido
            ? {
                id: pedido.id,
                numero: pedido.numero,
                branchId: pedido.branchId,
                contactoNombre: pedido.cliente,
                cliente: pedido.customerId
                  ? {
                      id: pedido.customerId,
                      nombre: pedido.cliente,
                      razonSocial: pedido.empresa,
                    }
                  : null,
              }
            : undefined
        }
      />
    </div>
  );
}
