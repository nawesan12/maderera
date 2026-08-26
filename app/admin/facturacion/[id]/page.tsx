import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Download,
  Printer,
  ShieldCheck,
  ShieldAlert,
  Truck,
} from "lucide-react";
import { EtiquetaEstado } from "@/components/admin/etiqueta-estado";
import { fechaCorta, fechaLarga, moneda, plural } from "@/lib/formato";
import { obtenerComprobante } from "@/lib/dal/admin/facturacion";
import {
  discriminaIva,
  nombreComprobante,
  numeroFormateado,
} from "@/lib/fiscal/comprobantes";
import {
  AnularComprobante,
  BotonAutorizar,
  FormularioCobro,
} from "./acciones";

const CONDICIONES: Record<string, string> = {
  responsable_inscripto: "Responsable inscripto",
  monotributista: "Monotributista",
  exento: "Exento",
  consumidor_final: "Consumidor final",
  no_categorizado: "No categorizado",
};

const MEDIOS: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  mercado_pago: "Mercado Pago",
  tarjeta: "Tarjeta",
  cheque: "Cheque",
  cuenta_corriente: "Cuenta corriente",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const comprobante = await obtenerComprobante(id);

  return {
    title: comprobante
      ? `${nombreComprobante(comprobante.tipo)} ${numeroFormateado(comprobante.puntoVenta, comprobante.numero)}`
      : "Comprobante",
  };
}

export default async function FichaComprobantePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const comprobante = await obtenerComprobante(id);

  if (!comprobante) notFound();

  const discrimina = discriminaIva(comprobante.tipo);
  const totalIva = Number(comprobante.iva21) + Number(comprobante.iva105);
  const anulada = comprobante.estado === "anulada";

  return (
    <div className="space-y-6">
      <Link
        href="/admin/facturacion"
        className="inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-5 w-5" />
        Volver a facturación
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {nombreComprobante(comprobante.tipo)}
            </h1>
            <span className="tabular text-2xl font-semibold text-muted-foreground">
              {numeroFormateado(comprobante.puntoVenta, comprobante.numero)}
            </span>
            <EtiquetaEstado estado={comprobante.estado} />
          </div>
          <p className="mt-0.5 text-base text-muted-foreground">
            Emitida el {fechaLarga.format(comprobante.fechaEmision)}
            {comprobante.sucursal ? ` · ${comprobante.sucursal}` : ""}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Dos salidas distintas y las dos hacen falta: la hoja se abre para
              mirarla o mandarla a la impresora, y el PDF se descarga para
              adjuntarlo a un correo o dárselo al contador. */}
          <Link
            href={`/comprobante/${comprobante.id}`}
            target="_blank"
            className="inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-base font-medium transition-colors hover:bg-muted"
          >
            <Printer className="h-5 w-5" />
            Imprimir
          </Link>
          <a
            href={`/api/comprobantes/${comprobante.id}/pdf`}
            className="inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-base font-medium transition-colors hover:bg-muted"
          >
            <Download className="h-5 w-5" />
            PDF
          </a>
        </div>
      </div>

      {/* Estado fiscal: es lo primero que hay que saber del comprobante */}
      {comprobante.cae ? (
        <section className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-green-300 bg-green-50 px-5 py-3.5">
          <ShieldCheck className="h-5 w-5 shrink-0 text-green-700" />
          <p className="text-base text-green-900">
            Autorizada por ARCA · <span className="tabular">CAE {comprobante.cae}</span>
          </p>
          {comprobante.caeVencimiento && (
            <p className="text-base text-green-900/70">
              vence el {fechaCorta.format(comprobante.caeVencimiento)}
            </p>
          )}
        </section>
      ) : (
        <section className="tarjeta-atencion p-5">
          <h2 className="flex items-center gap-2 text-base font-medium">
            <ShieldAlert className="h-5 w-5 text-brand-orange" />
            Sin autorización de ARCA
          </h2>
          <p className="mt-1 text-base text-muted-foreground">
            {comprobante.observacionesArca ??
              "Este comprobante todavía no tiene CAE, así que no tiene valor fiscal. Se puede imprimir para uso interno."}
          </p>
          {!anulada && (
            <div className="mt-3">
              <BotonAutorizar
                id={comprobante.id}
                rechazado={comprobante.estado === "rechazada"}
              />
            </div>
          )}
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          {/* Detalle */}
          <section className="tarjeta overflow-hidden">
            <h2 className="border-b px-5 py-3.5 text-base font-medium">
              Detalle
              <span className="ml-2 text-base font-normal text-muted-foreground">
                {plural(comprobante.items.length, "ítem")}
              </span>
            </h2>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-left">
                <thead>
                  <tr className="border-b text-sm uppercase tracking-[0.06em] text-muted-foreground">
                    <th scope="col" className="px-5 py-2.5 font-semibold">Descripción</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-semibold">Cant.</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                      {discrimina ? "P. unit. neto" : "P. unitario"}
                    </th>
                    {discrimina && (
                      <th scope="col" className="px-3 py-2.5 text-right font-semibold">IVA</th>
                    )}
                    <th scope="col" className="px-5 py-2.5 text-right font-semibold">Subtotal</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {comprobante.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-5 py-3 text-base">{item.descripcion}</td>
                      <td className="tabular px-3 py-3 text-right text-base">
                        {Number(item.cantidad)}
                      </td>
                      <td className="tabular px-3 py-3 text-right text-base">
                        {moneda.format(
                          discrimina
                            ? Number(item.precioUnitario)
                            : Number(item.subtotal) / Number(item.cantidad),
                        )}
                      </td>
                      {discrimina && (
                        <td className="tabular px-3 py-3 text-right text-base text-muted-foreground">
                          {Number(item.alicuotaIva)}%
                        </td>
                      )}
                      <td className="tabular px-5 py-3 text-right text-base font-medium">
                        {moneda.format(Number(item.subtotal))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totales: en la A el IVA se discrimina; en la B va incluido */}
            <dl className="space-y-1.5 border-t bg-muted/40 px-5 py-4 text-base">
              {discrimina ? (
                <>
                  <Fila etiqueta="Neto gravado" valor={moneda.format(Number(comprobante.neto))} />
                  {Number(comprobante.iva21) > 0 && (
                    <Fila etiqueta="IVA 21%" valor={moneda.format(Number(comprobante.iva21))} />
                  )}
                  {Number(comprobante.iva105) > 0 && (
                    <Fila etiqueta="IVA 10,5%" valor={moneda.format(Number(comprobante.iva105))} />
                  )}
                  {Number(comprobante.exento) > 0 && (
                    <Fila etiqueta="Exento" valor={moneda.format(Number(comprobante.exento))} />
                  )}
                </>
              ) : (
                <Fila
                  etiqueta="Subtotal"
                  valor={moneda.format(
                    Number(comprobante.total) - Number(comprobante.tributosTotal),
                  )}
                />
              )}

              {comprobante.tributos.map((tributo) => (
                <Fila
                  key={tributo.id}
                  etiqueta={`${tributo.descripcion} (${Number(tributo.alicuota)}%)`}
                  valor={moneda.format(Number(tributo.importe))}
                />
              ))}

              <div className="flex items-baseline justify-between border-t pt-2.5">
                <dt className="font-semibold">Total</dt>
                <dd className="tabular text-2xl font-bold">
                  {moneda.format(Number(comprobante.total))}
                </dd>
              </div>

              {!discrimina && totalIva > 0 && (
                <p className="pt-1 text-sm text-muted-foreground">
                  IVA contenido: {moneda.format(totalIva)}. En esta factura no se
                  discrimina, pero se informa a ARCA igual.
                </p>
              )}
            </dl>
          </section>

          {/* Cobros */}
          <section className="tarjeta overflow-hidden">
            <h2 className="flex items-baseline justify-between gap-3 border-b px-5 py-3.5 text-base font-medium">
              Cobros
              <span
                className={`tabular text-base font-normal ${
                  comprobante.saldo > 0 ? "text-brand-orange-dark" : "text-green-700"
                }`}
              >
                {comprobante.saldo > 0
                  ? `saldo ${moneda.format(comprobante.saldo)}`
                  : "cobrada"}
              </span>
            </h2>

            {comprobante.cobros.length > 0 && (
              <ul className="divide-y border-b">
                {comprobante.cobros.map((cobro) => (
                  <li
                    key={cobro.id}
                    className="flex items-baseline justify-between gap-3 px-5 py-3"
                  >
                    <span className="text-base">
                      {MEDIOS[cobro.medio] ?? cobro.medio}
                      {cobro.referencia && (
                        <span className="ml-2 text-sm text-muted-foreground">
                          {cobro.referencia}
                        </span>
                      )}
                      <span className="tabular ml-2 text-sm text-muted-foreground">
                        {fechaCorta.format(cobro.fecha)}
                      </span>
                    </span>
                    <span className="tabular text-base font-medium">
                      {moneda.format(Number(cobro.monto))}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {!anulada && comprobante.saldo > 0 && (
              <div className="p-5">
                <FormularioCobro id={comprobante.id} saldo={comprobante.saldo} />
              </div>
            )}
          </section>
        </div>

        <div className="space-y-4">
          <section className="tarjeta p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Cliente
            </h2>
            <p className="text-base font-medium">{comprobante.receptorNombre}</p>
            <dl className="mt-2 space-y-1.5 text-base">
              <Dato
                etiqueta="CUIT"
                valor={comprobante.receptorCuit ?? "—"}
                tabular
              />
              <Dato
                etiqueta="Condición IVA"
                valor={
                  CONDICIONES[comprobante.receptorCondicionIva] ??
                  comprobante.receptorCondicionIva
                }
              />
              {comprobante.receptorDomicilio && (
                <Dato etiqueta="Domicilio" valor={comprobante.receptorDomicilio} />
              )}
            </dl>

            {comprobante.customerId && (
              <Link
                href={`/admin/clientes/${comprobante.customerId}`}
                className="mt-3 inline-flex h-10 w-full items-center justify-center rounded-lg border text-base font-medium transition-colors hover:bg-muted"
              >
                Ver ficha del cliente
              </Link>
            )}
          </section>

          {comprobante.orderId && (
            <Link
              href={`/admin/pedidos/${comprobante.orderId}`}
              className="tarjeta flex items-center gap-3 p-5 transition-colors hover:bg-muted/50"
            >
              <Truck className="h-5 w-5 shrink-0 text-muted-foreground" />
              <span className="text-base">
                <span className="block font-medium">Pedido asociado</span>
                <span className="text-muted-foreground">
                  {comprobante.observaciones ?? "Ver el pedido"}
                </span>
              </span>
            </Link>
          )}

          {comprobante.comprobanteOrigenId && (
            <Link
              href={`/admin/facturacion/${comprobante.comprobanteOrigenId}`}
              className="tarjeta block p-5 transition-colors hover:bg-muted/50"
            >
              <p className="text-base font-medium">Comprobante que corrige</p>
              <p className="text-base text-muted-foreground">
                Ver el original
              </p>
            </Link>
          )}

          {!anulada && comprobante.estado !== "borrador" && (
            <section className="tarjeta p-5">
              <AnularComprobante id={comprobante.id} />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function Fila({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{etiqueta}</dt>
      <dd className="tabular">{valor}</dd>
    </div>
  );
}

function Dato({
  etiqueta,
  valor,
  tabular = false,
}: {
  etiqueta: string;
  valor: string;
  tabular?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{etiqueta}</dt>
      <dd className={`text-right ${tabular ? "tabular" : ""}`}>{valor}</dd>
    </div>
  );
}
