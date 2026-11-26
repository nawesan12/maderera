import type { Metadata } from "next";
import Link from "next/link";
import { Download, FileText, Printer, ShieldCheck } from "lucide-react";
import { AcentoEstado, EtiquetaEstado } from "@/components/admin/etiqueta-estado";
import { misComprobantes } from "@/lib/dal/cuenta";
import { fechaCorta, formatearMonto, plural } from "@/lib/formato";
import {
  nombreComprobante,
  numeroFormateado,
  type TipoComprobante,
} from "@/lib/fiscal/comprobantes";

export const metadata: Metadata = { title: "Comprobantes" };

export default async function MisComprobantesPage() {
  const comprobantes = await misComprobantes();

  if (comprobantes.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed bg-card/60 px-6 py-16 text-center">
        <FileText className="mx-auto h-10 w-10 text-muted-foreground/60" />
        <h1 className="mt-4 text-xl font-semibold">Todavía no hay facturas</h1>
        <p className="mx-auto mt-1.5 max-w-sm text-muted-foreground">
          Cuando te facturemos una compra, la vas a poder ver y descargar desde
          acá.
        </p>
        <Link
          href="/mi-cuenta/pedidos"
          className="mt-5 inline-flex h-11 items-center rounded-lg border bg-card px-5 font-medium transition-colors hover:bg-muted"
        >
          Ver mis pedidos
        </Link>
      </div>
    );
  }

  // Lo facturado de verdad: sin las anuladas ni las de una venta anulada que
  // nunca se autorizó (se dan de baja), y las notas de crédito restan. Antes
  // la factura de la venta anulada sumaba y el total no daba con Pedidos.
  const fuera = (c: (typeof comprobantes)[number]) =>
    c.estado === "anulada" || (c.ventaAnulada && !c.cae);
  const total = comprobantes
    .filter((c) => !fuera(c))
    .reduce((suma, c) => suma + (c.tipo.startsWith("nota_credito") ? -c.total : c.total), 0);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Mis comprobantes</h1>
        <p className="text-sm text-muted-foreground">
          {plural(comprobantes.length, "comprobante")} ·{" "}
          <span className="tabular">{formatearMonto(total)}</span> facturados
        </p>
      </header>

      <div className="space-y-3">
        {comprobantes.map((comprobante) => {
          const esNota = comprobante.tipo.startsWith("nota_credito");
          const anulada = fuera(comprobante);
          // Sin CAE no vale como factura: se dice en la fila, no solo en el
          // papel (H077).
          const estado = anulada ? "anulada" : comprobante.cae ? null : "emitida";

          return (
            <article
              key={comprobante.id}
              className="relative overflow-hidden rounded-xl border bg-card"
            >
              <AcentoEstado estado={estado ?? comprobante.estado} />

              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 p-5 pl-6">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-semibold">
                    {nombreComprobante(comprobante.tipo as TipoComprobante)}
                    <span className="tabular text-muted-foreground">
                      {numeroFormateado(
                        comprobante.puntoVenta,
                        comprobante.numero,
                      )}
                    </span>
                    {comprobante.cae ? (
                      <span
                        className="inline-flex items-center gap-1 text-sm font-normal text-saldo-favor"
                        title="Autorizada por ARCA"
                      >
                        <ShieldCheck className="h-3.5 w-3.5" />
                        Autorizada
                      </span>
                    ) : (
                      !anulada && <EtiquetaSinValor />
                    )}
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {fechaCorta.format(comprobante.fechaEmision)}
                    {comprobante.pedido && <span className="tabular"> · {comprobante.pedido}</span>}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <span
                    className={`tabular text-xl font-semibold ${
                      esNota ? "text-saldo-favor" : ""
                    }`}
                  >
                    {esNota ? "−" : ""}
                    {formatearMonto(comprobante.total)}
                  </span>

                  {anulada ? (
                    <EtiquetaEstado estado="anulada" />
                  ) : (
                    <span className="flex items-center gap-2">
                      <Link
                        href={`/comprobante/${comprobante.id}`}
                        target="_blank"
                        className="inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-sm font-medium transition-colors hover:bg-muted"
                      >
                        <Printer className="h-4 w-4" />
                        Ver
                      </Link>
                      <a
                        href={`/api/comprobantes/${comprobante.id}/pdf`}
                        className="inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-sm font-medium transition-colors hover:bg-muted"
                      >
                        <Download className="h-4 w-4" />
                        PDF
                      </a>
                    </span>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

/** La factura sin CAE: el estado «Sin autorizar», dicho para el cliente. */
function EtiquetaSinValor() {
  return (
    <span className="estado-espera inline-flex shrink-0 items-center rounded-full bg-[var(--estado-fondo)] px-2.5 py-1 text-sm font-medium text-[var(--estado-tinta)]">
      Sin valor fiscal
    </span>
  );
}
