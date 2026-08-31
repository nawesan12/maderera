import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin, Store, Truck } from "lucide-react";
import { EtiquetaEstado } from "@/components/admin/etiqueta-estado";
import {
  ETAPAS_PEDIDO,
  ETAPAS_RETIRO,
  Pasos,
} from "@/components/admin/pasos";
import { fechaHora, moneda } from "@/components/admin/formato";
import { obtenerPedido } from "@/lib/dal/admin/ventas";
import { AccionesPedido } from "../acciones";
import { pedidoParaFacturar } from "@/lib/dal/admin/facturacion";
import { BotonFacturar } from "./facturar";
import { Entregas } from "./entregas";
import { saldoDeAcopio } from "@/lib/entregas";
import { remitosDelPedido } from "@/lib/dal/admin/entregas";

const MEDIOS: Record<string, string> = {
  mercado_pago: "Mercado Pago",
  transferencia: "Transferencia",
  efectivo: "Efectivo",
  cuenta_corriente: "Cuenta corriente",
};

export default async function FichaPedidoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const pedido = await obtenerPedido(id);

  if (!pedido) notFound();

  // Si el pedido ya se facturó, el botón se reemplaza por el enlace al
  // comprobante: dos facturas del mismo pedido obligan a anular una.
  const datosFactura = await pedidoParaFacturar(id);
  const facturado = datosFactura?.yaFacturado ?? null;

  const [pendientes, remitos] = await Promise.all([
    saldoDeAcopio(id),
    remitosDelPedido(id),
  ]);

  const etapas =
    pedido.tipoEntrega === "retiro" ? ETAPAS_RETIRO : ETAPAS_PEDIDO;

  return (
    <div className="space-y-6">
      <Link
        href="/admin/pedidos"
        className="inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-5 w-5" />
        Volver a pedidos
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {pedido.cliente}
            </h1>
            <EtiquetaEstado estado={pedido.estado} />
            {pedido.estadoPago !== "pagado" && (
              <span className="estado-espera rounded-full bg-[var(--estado-fondo)] px-2.5 py-1 text-sm font-medium text-[var(--estado-tinta)]">
                Sin cobrar
              </span>
            )}
          </div>
          <p className="mt-0.5 text-base text-muted-foreground">
            <span className="tabular">{pedido.numero}</span>
            {pedido.empresa && ` · ${pedido.empresa}`}
            {` · ${fechaHora.format(pedido.createdAt)}`}
          </p>
        </div>

        <div className="flex flex-wrap items-start gap-2">
          <BotonFacturar
            orderId={pedido.id}
            comprobante={
              facturado
                ? {
                    id: facturado.id,
                    numero: facturado.numero,
                    tipo: facturado.tipo,
                  }
                : null
            }
          />
          <AccionesPedido
            id={pedido.id}
            estado={pedido.estado}
            estadoPago={pedido.estadoPago}
            tipoEntrega={pedido.tipoEntrega}
          />
        </div>
      </div>

      {/* Recorrido */}
      <section className="tarjeta p-5">
        <Pasos
          etapas={etapas}
          actual={pedido.estado}
          cancelado={pedido.estado === "cancelado"}
        />
      </section>

      {/* `items-start` para que la tarjeta del detalle no se estire hasta la
          altura de la columna lateral y deje un vacío abajo. */}
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_320px]">
        <section className="tarjeta overflow-hidden">
          <h2 className="px-5 py-4 text-base font-medium">Qué lleva</h2>
          <table className="w-full border-t">
            <thead>
              <tr className="border-b text-left">
                <th className="px-5 py-3 text-sm font-medium text-muted-foreground">
                  Producto
                </th>
                <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">
                  Cantidad
                </th>
                <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">
                  Unitario
                </th>
                <th className="px-5 py-3 text-right text-sm font-medium text-muted-foreground">
                  Subtotal
                </th>
              </tr>
            </thead>
            <tbody>
              {pedido.items.map((item) => (
                <tr key={item.id} className="border-b last:border-0">
                  <td className="px-5 py-3.5 text-base">{item.descripcion}</td>
                  <td className="tabular px-4 py-3.5 text-right text-base text-muted-foreground">
                    {Number(item.cantidad)} {item.unidad.replace("_", " ")}
                  </td>
                  <td className="tabular px-4 py-3.5 text-right text-base text-muted-foreground">
                    {moneda.format(Number(item.precioUnitario))}
                  </td>
                  <td className="tabular px-5 py-3.5 text-right text-base">
                    {moneda.format(Number(item.subtotal))}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t bg-muted/40">
              {Number(pedido.costoEnvio) > 0 && (
                <>
                  <tr>
                    <td colSpan={3} className="px-5 pt-4 text-base">
                      Subtotal
                    </td>
                    <td className="tabular px-5 pt-4 text-right text-base">
                      {moneda.format(Number(pedido.subtotal))}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={3} className="px-5 pb-2 pt-1 text-base">
                      Envío · {pedido.zonaEnvio}
                    </td>
                    <td className="tabular px-5 pb-2 pt-1 text-right text-base">
                      {moneda.format(Number(pedido.costoEnvio))}
                    </td>
                  </tr>
                </>
              )}
              <tr>
                <td colSpan={3} className="px-5 py-4 text-base font-medium">
                  Total
                </td>
                <td className="tabular px-5 py-4 text-right text-xl font-semibold">
                  {moneda.format(Number(pedido.total))}
                </td>
              </tr>
            </tfoot>
          </table>
        </section>

        <div className="lg:col-start-1">
          <Entregas
            orderId={pedido.id}
            tipoEntrega={pedido.tipoEntrega}
            pendientes={pendientes}
            remitos={remitos}
          />
        </div>

        <aside className="space-y-4 lg:col-start-2 lg:row-start-1">
          <section className="tarjeta p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Entrega
            </h2>
            {pedido.tipoEntrega === "envio" ? (
              <>
                <p className="flex items-start gap-2 text-base">
                  <Truck className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                  <span>{pedido.direccionEntrega}</span>
                </p>
                {pedido.zonaEnvio && (
                  <p className="mt-1.5 flex items-center gap-2 text-base text-muted-foreground">
                    <MapPin className="h-5 w-5 shrink-0" />
                    {pedido.zonaEnvio}
                  </p>
                )}
              </>
            ) : (
              <p className="flex items-center gap-2 text-base">
                <Store className="h-5 w-5 shrink-0 text-muted-foreground" />
                Retira en {pedido.sucursal}
              </p>
            )}
          </section>

          <section className="tarjeta p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Cobro
            </h2>
            <dl className="space-y-2 text-base">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Medio</dt>
                <dd>{pedido.medioPago ? MEDIOS[pedido.medioPago] : "—"}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Estado</dt>
                <dd>
                  <EtiquetaEstado estado={pedido.estadoPago} />
                </dd>
              </div>
            </dl>
          </section>

          <section className="tarjeta p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Contacto
            </h2>
            {pedido.customerId ? (
              <Link
                href={`/admin/clientes/${pedido.customerId}`}
                className="text-base font-medium hover:text-brand-orange"
              >
                {pedido.cliente}
              </Link>
            ) : (
              <p className="text-base font-medium">{pedido.cliente}</p>
            )}
            {pedido.telefono && (
              <p className="tabular mt-1 text-base text-muted-foreground">
                {pedido.telefono}
              </p>
            )}
            {pedido.email && (
              <p className="truncate text-base text-muted-foreground">
                {pedido.email}
              </p>
            )}
          </section>

          <section className="tarjeta p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Historial
            </h2>
            <ol className="space-y-3">
              {pedido.historial.map((h) => (
                <li key={h.id} className="flex gap-3">
                  <span
                    className="mt-2 h-2 w-2 shrink-0 rounded-full bg-border"
                    aria-hidden="true"
                  />
                  <div>
                    <EtiquetaEstado estado={h.estado} />
                    {h.nota && (
                      <p className="mt-1 text-base text-muted-foreground">
                        {h.nota}
                      </p>
                    )}
                    <p className="text-sm text-muted-foreground">
                      {fechaHora.format(h.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}
