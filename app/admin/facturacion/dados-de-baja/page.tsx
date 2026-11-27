import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Trash2 } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { Vacio } from "@/components/admin/vacio";
import { dadosDeBaja } from "@/lib/dal/admin/facturacion";
import { fechaCorta, fechaHora, hoyEnArgentina, moneda, plural } from "@/lib/formato";
import { nombreComprobante, numeroFormateado } from "@/lib/fiscal/comprobantes";

export const metadata: Metadata = { title: "Dados de baja" };

/**
 * Los comprobantes sin CAE que se sacaron de su serie.
 *
 * Una baja borra el comprobante del listado de Facturación, y un borrado que
 * no se ve en ninguna pantalla no le sirve al dueño: acá está cada uno, con
 * quién, cuándo y por qué. Debajo, los que bajaron un número por esa baja:
 * el cliente que tenía el PDF del 0005 ahora tiene el 0004, y es a quien hay
 * que reenviárselo. Cada uno lleva a su ficha, donde están el PDF y WhatsApp.
 */
export default async function DadosDeBajaPage() {
  const bajas = await dadosDeBaja();
  const mes = hoyEnArgentina().slice(0, 7);
  const delMes = bajas.filter((b) => hoyEnArgentina(b.createdAt).startsWith(mes)).length;
  const corridos = bajas.reduce((n, b) => n + b.renumerados.length, 0);

  return (
    <div className="space-y-6">
      <Link
        href="/admin/facturacion"
        className="inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-5 w-5" />
        Volver a facturación
      </Link>

      <EncabezadoPanel
        titulo="Dados de baja"
        resumen={`${delMes} este mes · ${bajas.length} en total${corridos ? ` · ${plural(corridos, "corrido")}` : ""}`}
      />

      {bajas.length === 0 ? (
        <section className="tarjeta">
          <Vacio icono={Trash2} titulo="Ningún comprobante dado de baja" />
        </section>
      ) : (
        <ul className="space-y-3">
          {bajas.map((b) => (
            <li key={b.id} className="tarjeta overflow-hidden">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 py-4">
                <div className="min-w-0">
                  <p className="text-base font-medium">
                    {nombreComprobante(b.tipo)}{" "}
                    <span className="tabular text-muted-foreground line-through">
                      {numeroFormateado(b.puntoVenta, b.numero)}
                    </span>
                  </p>
                  <p className="text-base text-muted-foreground">
                    {b.receptorNombre} · emitido el {fechaCorta.format(b.fechaEmision)}
                  </p>
                </div>
                <p className="tabular text-xl font-semibold">{moneda.format(b.total)}</p>
              </div>
              <div className="border-t px-5 py-3 text-base">
                <p>{b.motivo}</p>
                <p className="text-sm text-muted-foreground">
                  {b.usuarioNombre} · {fechaHora.format(b.createdAt)}
                </p>
              </div>
              {/* Quién tiene hoy ese número, si no es uno de los corridos de
                  abajo: el que se emitió después con él. Eran dos
                  comprobantes con el mismo número y nada que lo dijera
                  (M3S2-044). */}
              {b.reuso && !b.renumerados.some((r) => r.invoiceId === b.reuso?.invoiceId) && (
                <Link
                  href={`/admin/facturacion/${b.reuso.invoiceId}`}
                  className="flex flex-wrap items-center gap-x-2 border-t bg-hundida px-5 py-3 text-base hover:bg-muted/50"
                >
                  <span className="codigo font-medium">{numeroFormateado(b.puntoVenta, b.numero)}</span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="lo usa" />
                  <span className="min-w-0">
                    {b.reuso.receptorNombre}
                    {b.reuso.pedido && <span className="codigo ml-2 text-muted-foreground">{b.reuso.pedido}</span>}
                  </span>
                </Link>
              )}
              {b.renumerados.length > 0 && (
                <ul className="divide-y border-t bg-hundida">
                  {b.renumerados.map((r) => (
                    // A 375 px el cliente quedaba en una letra: va arriba y
                    // entero, el número viejo tachado y el nuevo al lado, y
                    // «Reenviar» es un botón de 44 px (H340).
                    <li key={r.invoiceId} className="flex items-center gap-3 px-5 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-base font-medium">{r.receptorNombre}</p>
                        <p className="flex flex-wrap items-center gap-x-2 text-base">
                          <span className="codigo text-muted-foreground line-through">
                            {numeroFormateado(b.puntoVenta, r.de)}
                          </span>
                          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="pasó a" />
                          <span className="codigo font-medium">{numeroFormateado(b.puntoVenta, r.a)}</span>
                          {r.recibos?.length ? (
                            <span className="text-sm text-muted-foreground">· {r.recibos.join(" · ")}</span>
                          ) : null}
                        </p>
                      </div>
                      <Link
                        href={`/admin/facturacion/${r.invoiceId}`}
                        className="tarjeta inline-flex h-11 shrink-0 items-center px-4 text-base font-medium"
                      >
                        Reenviar
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
