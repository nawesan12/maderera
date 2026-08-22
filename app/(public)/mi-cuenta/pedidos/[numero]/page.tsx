import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Clock,
  MapPin,
  MessageCircle,
  Store,
  Truck,
} from "lucide-react";
import { EtiquetaEstado } from "@/components/admin/etiqueta-estado";
import { ETAPAS_PEDIDO, ETAPAS_RETIRO, Pasos } from "@/components/admin/pasos";
import { miPedido } from "@/lib/dal/cuenta";
import {
  fechaHora,
  fechaLarga,
  formatearMonto,
  formatearUnidad,
  plural,
} from "@/lib/formato";
import { VolverAPedir } from "./volver-a-pedir";

const COMO_SIGUE: Record<string, string> = {
  mercado_pago: "Te pasamos el link de pago por WhatsApp.",
  transferencia:
    "Te pasamos los datos bancarios por WhatsApp. Preparamos el pedido cuando se acredita.",
  efectivo: "Abonás al retirar o cuando te lo entregamos.",
  cuenta_corriente: "Quedó cargado en tu cuenta corriente.",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ numero: string }>;
}): Promise<Metadata> {
  const { numero } = await params;
  return { title: `Pedido ${numero}` };
}

export default async function DetallePedidoPage({
  params,
}: {
  params: Promise<{ numero: string }>;
}) {
  const { numero } = await params;
  const pedido = await miPedido(numero);

  // El DAL ya filtró por dueño: si no vuelve nada, o no existe o no es suyo, y
  // las dos cosas se contestan igual. Decir "existe pero no es tuyo" confirma
  // que ese número de pedido existe.
  if (!pedido) notFound();

  const etapas = pedido.tipoEntrega === "retiro" ? ETAPAS_RETIRO : ETAPAS_PEDIDO;
  const cancelado = pedido.estado === "cancelado";
  const mensaje = encodeURIComponent(
    `Hola! Consulto por el pedido ${pedido.numero}.`,
  );

  return (
    <div className="space-y-6">
      <Link
        href="/mi-cuenta/pedidos"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver a mis pedidos
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="tabular text-2xl font-bold tracking-tight">
              {pedido.numero}
            </h1>
            <EtiquetaEstado estado={pedido.estado} />
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Hecho el {fechaLarga.format(pedido.createdAt)}
          </p>
        </div>
        <span className="tabular text-3xl font-bold">
          {formatearMonto(pedido.total)}
        </span>
      </header>

      {/* Recorrido: la pregunta que trae acá es "¿cuánto falta?" */}
      <section className="rounded-xl border bg-white p-5">
        <Pasos etapas={etapas} actual={pedido.estado} cancelado={cancelado} />
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        {/* Productos */}
        <section className="overflow-hidden rounded-xl border bg-white">
          <h2 className="border-b px-5 py-3.5 font-medium">
            Qué pediste
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {plural(pedido.items.length, "producto")}
            </span>
          </h2>

          <ul className="divide-y">
            {pedido.items.map((item) => (
              <li
                key={item.id}
                className="flex items-baseline justify-between gap-4 px-5 py-3.5"
              >
                <div className="min-w-0">
                  <p>{item.descripcion}</p>
                  <p className="tabular mt-0.5 text-sm text-muted-foreground">
                    {Number(item.cantidad)} {formatearUnidad(item.unidad)} ×{" "}
                    {formatearMonto(item.precioUnitario)}
                  </p>
                </div>
                <span className="tabular shrink-0 font-medium">
                  {formatearMonto(item.subtotal)}
                </span>
              </li>
            ))}
          </ul>

          <dl className="space-y-2 border-t bg-brand-cream/30 px-5 py-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="tabular">{formatearMonto(pedido.subtotal)}</dd>
            </div>
            {Number(pedido.costoEnvio) > 0 && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">
                  Envío{pedido.zonaEnvio ? ` · ${pedido.zonaEnvio}` : ""}
                </dt>
                <dd className="tabular">{formatearMonto(pedido.costoEnvio)}</dd>
              </div>
            )}
            <div className="flex items-baseline justify-between border-t pt-2.5">
              <dt className="font-semibold">Total</dt>
              <dd className="tabular text-xl font-bold">
                {formatearMonto(pedido.total)}
              </dd>
            </div>
          </dl>
        </section>

        <div className="space-y-4">
          {/* Entrega */}
          <section className="rounded-xl border bg-white p-5">
            <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {pedido.tipoEntrega === "retiro" ? (
                <Store className="h-4 w-4" />
              ) : (
                <Truck className="h-4 w-4" />
              )}
              {pedido.tipoEntrega === "retiro" ? "Lo retirás en" : "Te lo llevamos a"}
            </h2>

            {pedido.tipoEntrega === "retiro" ? (
              <>
                <p className="font-medium">{pedido.sucursal ?? "Sucursal"}</p>
                {pedido.sucursalDireccion && (
                  <p className="mt-0.5 flex items-start gap-1.5 text-sm text-muted-foreground">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {pedido.sucursalDireccion}
                  </p>
                )}
                {pedido.sucursalHorario && (
                  <p className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
                    <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {pedido.sucursalHorario}
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="font-medium">{pedido.direccionEntrega}</p>
                {pedido.zonaEnvio && (
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Zona {pedido.zonaEnvio}
                  </p>
                )}
              </>
            )}
          </section>

          {/* Pago */}
          <section className="rounded-xl border bg-white p-5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Pago
              </h2>
              <EtiquetaEstado estado={pedido.estadoPago} />
            </div>
            <p className="text-sm text-muted-foreground">
              {pedido.medioPago
                ? COMO_SIGUE[pedido.medioPago]
                : "Coordinamos el pago por WhatsApp."}
            </p>
          </section>

          {pedido.notas && (
            <section className="rounded-xl border border-dashed p-5">
              <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Tu nota
              </h2>
              <p className="text-sm">{pedido.notas}</p>
            </section>
          )}
        </div>
      </div>

      {/* Historial real, no una línea de tiempo inventada */}
      {pedido.historial.length > 0 && (
        <section className="rounded-xl border bg-white p-5">
          <h2 className="mb-4 font-medium">Qué fue pasando</h2>
          <ol className="space-y-0">
            {pedido.historial.map((paso, i) => (
              <li key={paso.id} className="flex gap-3.5">
                <div className="flex flex-col items-center">
                  <span
                    className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                      i === 0 ? "bg-brand-orange" : "bg-border"
                    }`}
                  />
                  {i < pedido.historial.length - 1 && (
                    <span className="w-px flex-1 bg-border" />
                  )}
                </div>
                <div className={i < pedido.historial.length - 1 ? "pb-5" : ""}>
                  <p className="flex flex-wrap items-center gap-2">
                    <EtiquetaEstado estado={paso.estado} />
                    <span className="tabular text-sm text-muted-foreground">
                      {fechaHora.format(paso.createdAt)}
                    </span>
                  </p>
                  {paso.nota && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {paso.nota}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="flex flex-wrap gap-3">
        <VolverAPedir numero={pedido.numero} />
        <a
          href={`https://wa.me/542235903118?text=${mensaje}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-11 items-center gap-2 rounded-lg bg-brand-green px-4 font-medium text-white transition-colors hover:bg-brand-green/90"
        >
          <MessageCircle className="h-4 w-4" />
          Consultar por este pedido
        </a>
      </div>
    </div>
  );
}
