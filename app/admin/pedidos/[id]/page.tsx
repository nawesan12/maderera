import Link from "next/link";
import { notFound } from "next/navigation";
import { esUuid } from "@/lib/uuid";
import { MapPin, Scissors, Store, Truck } from "lucide-react";
import { EncabezadoFicha } from "@/components/admin/encabezado-ficha";
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
import { cortesDelPedido } from "@/lib/dal/admin/cortes";
import { requireStaff } from "@/lib/dal/session";
import { puedeEntrar } from "@/lib/roles";
import { AvisarPorWhatsapp } from "@/components/admin/avisar-por-whatsapp";
import { avisoManual, avisosManuales } from "@/lib/whatsapp/aviso-manual-datos";
import type { EventoManual } from "@/lib/whatsapp/aviso-manual";

const MEDIOS: Record<string, string> = {
  mercado_pago: "Mercado Pago",
  transferencia: "Transferencia",
  efectivo: "Efectivo",
  cuenta_corriente: "Cuenta corriente",
  cheque: "Cheque",
};

export default async function FichaPedidoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!esUuid(id)) notFound();
  const [usuario, pedido] = await Promise.all([
    requireStaff(),
    obtenerPedido(id),
  ]);

  if (!pedido) notFound();

  /*
   * El margen es de administración, como los reportes: es el número que no se
   * muestra en el mostrador. La pantalla la ven también vendedores y depósito.
   * Lo calcula Go (internal/pedidos, MargenDelPedido) y solo se lo manda al
   * admin.
   */
  const esAdmin = usuario.staffRole === "admin";

  const margen = esAdmin ? pedido.margen : null;

  // Si el pedido ya se facturó, el botón se reemplaza por el enlace al
  // comprobante: dos facturas del mismo pedido obligan a anular una.
  const datosFactura = await pedidoParaFacturar(id);
  const facturado = datosFactura?.yaFacturado ?? null;

  // El aviso que corresponde al estado: lo que el cliente tiene que saber ahora.
  // Solo para quien atiende el WhatsApp de la maderera (no depósito).
  const eventoAviso = puedeEntrar("/admin/whatsapp", usuario.staffRole) ? (EVENTO_DEL_ESTADO[pedido.estado] ?? null) : null;

  const [pendientes, remitos, cortes, aviso] = await Promise.all([
    saldoDeAcopio(id),
    remitosDelPedido(id),
    cortesDelPedido(id),
    eventoAviso ? avisoManual(eventoAviso, { tipo: "order", id }) : null,
  ]);

  // El remito también se manda gratis, desde la app del teléfono.
  const avisosRemito = puedeEntrar("/admin/whatsapp", usuario.staffRole)
    ? await avisosManuales(
        "documento",
        "delivery",
        remitos.filter((r) => r.estado !== "anulada").map((r) => r.id),
      )
    : {};

  const etapas =
    pedido.tipoEntrega === "retiro" ? ETAPAS_RETIRO : ETAPAS_PEDIDO;

  return (
    <div className="space-y-6">
      <EncabezadoFicha
        volverA="/admin/pedidos"
        volverTexto="Volver a pedidos"
        titulo={pedido.cliente}
        estado={
          <>
            <EtiquetaEstado estado={pedido.estado} />
            {pedido.estadoPago !== "pagado" && (
              <span className="estado-espera rounded-full bg-[var(--estado-fondo)] px-2.5 py-1 text-sm font-medium text-[var(--estado-tinta)]">
                Sin cobrar
              </span>
            )}
          </>
        }
        detalle={
          <>
            <span className="tabular">{pedido.numero}</span>
            {pedido.empresa && ` · ${pedido.empresa}`}
            {` · ${fechaHora.format(pedido.createdAt)}`}
          </>
        }
        acciones={
          <>
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
              cobroACuenta={
                pedido.medioPago === "cuenta_corriente" && pedido.customerId
                  ? { customerId: pedido.customerId, nombre: pedido.cliente, numero: pedido.numero, total: Number(pedido.total) }
                  : null
              }
            />
          </>
        }
      />

      {/* Recorrido */}
      <section className="tarjeta p-5">
        <Pasos
          etapas={etapas}
          actual={pedido.estado}
          cancelado={pedido.estado === "cancelado"}
        />
      </section>

      {/* Avisarle al cliente, gratis, desde WhatsApp Business. Lo que pide una
          decisión —listo o en camino y todavía sin avisar— va con borde de acento. */}
      {aviso && (
        <section
          className={
            (pedido.estado === "listo" || pedido.estado === "en-camino") && !aviso.yaAvisado
              ? "tarjeta-atencion p-5"
              : "tarjeta p-5"
          }
        >
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Avisarle: {aviso.titulo.toLowerCase()}
          </h2>
          <AvisarPorWhatsapp aviso={aviso} atajo />
        </section>
      )}

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

          {/*
            * El margen de esta venta.
            *
            * Solo para administración: es el número que no se muestra en el
            * mostrador. Y solo aparece si alguna línea tiene costo congelado;
            * las anteriores al módulo de compras no lo tienen y se cuentan
            * aparte en vez de promediarse como si hubieran costado cero.
            */}
          {esAdmin && margen && (
            <div className="border-t bg-muted/40 px-5 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <p className="text-base font-medium">Margen de esta venta</p>
                  <p className="text-sm text-muted-foreground">
                    {moneda.format(margen.neto)} netos menos{" "}
                    {moneda.format(margen.costo)} de costo
                    {margen.sinCosto > 0 &&
                      ` · ${margen.sinCosto} renglones sin costo, fuera de la cuenta`}
                  </p>
                </div>
                <p
                  className={`tabular text-xl font-semibold ${
                    margen.ganancia < 0 ? "text-saldo-debe" : "text-saldo-favor"
                  }`}
                >
                  {moneda.format(margen.ganancia)}
                  {margen.neto > 0 && (
                    <span className="ml-2 text-base text-muted-foreground">
                      {((margen.ganancia / margen.neto) * 100).toFixed(1)}%
                    </span>
                  )}
                </p>
              </div>
            </div>
          )}
        </section>

        {/* El corte, en la ficha del pedido.

            Es la pregunta de todos los días en una maderera con seccionadora:
            "el pedido está listo menos el corte". Antes no se podía contestar
            desde acá —la columna que ata las dos cosas existía en la base y no
            la escribía nadie—, así que el corte se cargaba suelto y el pedido
            no sabía que estaba esperando. */}
        <section className="tarjeta p-5 lg:col-start-1">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Corte
            </h2>
            <Link
              href={`/admin/cortes/nuevo?pedido=${pedido.id}`}
              className="text-base text-brand-orange hover:underline"
            >
              Mandar a cortar
            </Link>
          </div>

          {cortes.length === 0 ? (
            <p className="text-base text-muted-foreground">
              Este pedido no tiene ningún corte cargado.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {cortes.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/admin/cortes/${c.id}`}
                    className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/50"
                  >
                    <Scissors
                      className="h-5 w-5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="tabular block text-base">{c.numero}</span>
                      <span className="block text-sm text-muted-foreground">
                        {c.material}
                      </span>
                    </span>
                    <EtiquetaEstado estado={c.estado} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="lg:col-start-1">
          <Entregas
            whatsapp={puedeEntrar("/admin/whatsapp", usuario.staffRole)}
            avisos={avisosRemito}
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
                <dt className="text-muted-foreground">Forma de pago</dt>
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

/** Qué aviso le corresponde al pedido según dónde está. */
const EVENTO_DEL_ESTADO: Partial<Record<string, EventoManual>> = {
  pendiente: "pedido_recibido",
  preparando: "preparando",
  listo: "listo",
  "en-camino": "en-camino",
  entregado: "entregado",
};
