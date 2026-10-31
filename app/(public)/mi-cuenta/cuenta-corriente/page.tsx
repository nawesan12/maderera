import type { Metadata } from "next";
import { enlaceWhatsapp } from "@/lib/whatsapp/enlace";
import Link from "next/link";
import { MessageCircle, Printer, Receipt } from "lucide-react";
import { EtiquetaEstado } from "@/components/admin/etiqueta-estado";
import { clienteDeLaSesion, miCuentaCorriente } from "@/lib/dal/cuenta";
import { datosParaTransferir } from "@/lib/dal/pagos";
import { PagarDeuda } from "@/components/cuenta/pagar-deuda";
import { fechaCorta, formatearMonto } from "@/lib/formato";

export const metadata: Metadata = { title: "Cuenta corriente" };

export default async function CuentaCorrientePage({
  searchParams,
}: {
  searchParams: Promise<{ pago?: string }>;
}) {
  const whatsapp = await enlaceWhatsapp("Hola! Consulto por mi cuenta corriente.");
  const [cuenta, banco, { pago }, cliente] = await Promise.all([
    miCuentaCorriente(),
    datosParaTransferir(),
    searchParams,
    clienteDeLaSesion(),
  ]);

  if (cuenta.movimientos.length === 0 && cuenta.limiteCredito === 0) {
    return (
      <div className="rounded-2xl border border-dashed bg-card/60 px-6 py-16 text-center">
        <Receipt className="mx-auto h-10 w-10 text-muted-foreground/60" />
        <h1 className="mt-4 text-xl font-semibold">
          No tenés cuenta corriente
        </h1>
        <p className="mx-auto mt-1.5 max-w-md text-muted-foreground">
          La cuenta corriente es para clientes habilitados: comprás y abonás
          después, dentro de un límite acordado. Si te interesa, escribinos y lo
          vemos.
        </p>
        <a
          href={whatsapp}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-5 inline-flex h-11 items-center gap-2 rounded-lg bg-verde-whatsapp px-5 font-medium text-white transition-colors hover:bg-brand-green/90"
        >
          <MessageCircle className="h-4 w-4" />
          Consultar por cuenta corriente
        </a>
      </div>
    );
  }

  const usado = Math.max(cuenta.saldo, 0);
  const porcentaje =
    cuenta.limiteCredito > 0
      ? Math.min((usado / cuenta.limiteCredito) * 100, 100)
      : 0;
  const excedido = cuenta.limiteCredito > 0 && usado > cuenta.limiteCredito;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Cuenta corriente</h1>

        {/* El mismo resumen que imprime el panel. Que el cliente pueda sacarlo
            solo evita el pedido por WhatsApp y la respuesta a mano. */}
        {cliente && (
          <a
            href={`/cuenta/${cliente.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-linea px-3.5 py-2 text-sm font-medium transition-colors hover:bg-chip"
          >
            <Printer className="h-4 w-4" />
            Ver resumen imprimible
          </a>
        )}
      </div>

      {/* Estado de la cuenta: saldo grande y el margen que queda, medido */}
      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="grid gap-6 p-6 sm:grid-cols-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Saldo
            </p>
            <p
              className={`tabular mt-1 text-3xl font-semibold ${
                cuenta.saldo > 0
                  ? "text-saldo-debe"
                  : cuenta.saldo < 0
                    ? "text-saldo-favor"
                    : "text-saldo-cero"
              }`}
            >
              {formatearMonto(Math.abs(cuenta.saldo))}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {cuenta.saldo > 0
                ? "Pendiente de pago"
                : cuenta.saldo < 0
                  ? "A tu favor"
                  : "Estás al día"}
            </p>
          </div>

          {cuenta.limiteCredito > 0 && (
            <>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Tu límite
                </p>
                <p className="tabular mt-1 text-3xl font-semibold text-muted-foreground">
                  {formatearMonto(cuenta.limiteCredito)}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Disponible
                </p>
                <p className="tabular mt-1 text-3xl font-semibold">
                  {formatearMonto(cuenta.disponible)}
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Para tu próxima compra
                </p>
              </div>
            </>
          )}
        </div>

        {cuenta.limiteCredito > 0 && (
          <div className="border-t bg-sitio-alt px-6 py-4">
            <div
              className="h-2.5 overflow-hidden rounded-full bg-black/10"
              role="img"
              aria-label={`Usás el ${Math.round(porcentaje)} por ciento de tu límite`}
            >
              <div
                className={`h-full rounded-full ${
                  excedido
                    ? "bg-red-600"
                    : porcentaje > 80
                      ? "bg-amber-500"
                      : "bg-brand-orange"
                }`}
                style={{ width: `${Math.max(porcentaje, usado > 0 ? 3 : 0)}%` }}
              />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {excedido ? (
                <span className="text-red-700">
                  Superás tu límite en{" "}
                  <span className="tabular">
                    {formatearMonto(usado - cuenta.limiteCredito)}
                  </span>
                  . Para seguir comprando a cuenta hay que regularizarlo.
                </span>
              ) : (
                `Usás el ${Math.round(porcentaje)}% de tu límite.`
              )}
            </p>
          </div>
        )}
      </section>

      {/* La vuelta desde la pasarela trae el resultado en la URL. El saldo de
          arriba ya es el real: lo que falta es decir qué pasó, porque un pago
          rechazado no cambia ningún número y sin este cartel parece que no pasó
          nada. */}
      {pago === "aprobado" && (
        <p className="flex items-start gap-2 rounded-xl border border-brand-green/30 bg-brand-green/5 p-4">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-verde-whatsapp text-white">
            ✓
          </span>
          Recibimos tu pago. El saldo de arriba ya lo tiene descontado.
        </p>
      )}

      {pago === "rechazado" && (
        <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-destructive">
          El pago no se aprobó. Podés intentar de nuevo con otro medio o
          transferir.
        </p>
      )}

      <PagarDeuda saldo={cuenta.saldo} banco={banco} />

      {/* El saldo a favor no se «usa» acá: ya descuenta solo de lo que se
          debe. Donde sirve es al comprar, y conviene decirlo, porque si no el
          cliente lo pide por WhatsApp. */}
      {cuenta.saldo < 0 && (
        <p className="rounded-xl border border-linea bg-card p-4 text-[15px]">
          Tenés <strong className="tabular">{formatearMonto(-cuenta.saldo)}</strong> a favor. Se
          descuenta solo de tu próxima compra: en el carrito elegí «Con mi saldo a favor», o
          avisá en el mostrador.
        </p>
      )}

      {/* Acá sí va tabla: son cifras que se comparan columna contra columna, y
          el saldo corrido solo se sigue si está alineado. */}
      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-5 py-3.5">
          <h2 className="font-medium">Libro de la cuenta</h2>
          {/* Acá va solo lo que mueve el saldo. Las compras de contado, las
              transferencias en revisión y los cheques por recibir están en
              Movimientos. */}
          <Link href="/mi-cuenta/movimientos" className="text-sm font-medium text-acento-texto hover:underline">
            Ver todos tus movimientos
          </Link>
        </div>

        {cuenta.movimientos.length === 0 ? (
          <p className="px-5 py-10 text-center text-muted-foreground">
            Todavía no hay movimientos en tu cuenta.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left">
              <thead>
                <tr className="border-b text-xs uppercase tracking-[0.06em] text-muted-foreground">
                  <th scope="col" className="px-5 py-2.5 font-semibold">
                    Fecha
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">
                    Concepto
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                    Importe
                  </th>
                  <th scope="col" className="px-5 py-2.5 text-right font-semibold">
                    Saldo
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {cuenta.movimientos.map((m) => (
                  <tr key={m.id}>
                    <td className="tabular whitespace-nowrap px-5 py-3.5 text-sm text-muted-foreground">
                      {fechaCorta.format(m.createdAt)}
                    </td>
                    <td className="px-3 py-3.5">
                      <span className="flex flex-wrap items-center gap-2">
                        <EtiquetaEstado estado={m.tipo} />
                        <span className="text-sm">{m.detalle ?? ""}</span>
                      </span>
                      {m.referencia && !m.receiptId && (
                        <PedidoRelacionado referencia={m.referencia} />
                      )}
                      {/* El pago con recibo lleva el papel a un clic: es lo
                          que el cliente le manda a su contador. */}
                      {m.receiptId && (
                        <a
                          href={`/api/recibos/${m.receiptId}/pdf`}
                          target="_blank"
                          rel="noopener"
                          className="tabular mt-0.5 block text-sm text-acento-texto hover:underline"
                        >
                          Recibo {m.referencia}
                        </a>
                      )}
                    </td>
                    <td
                      className={`tabular whitespace-nowrap px-3 py-3.5 text-right font-medium ${
                        m.monto > 0 ? "" : "text-green-700"
                      }`}
                    >
                      {m.monto > 0 ? "+" : ""}
                      {formatearMonto(m.monto)}
                    </td>
                    <td className="tabular whitespace-nowrap px-5 py-3.5 text-right text-muted-foreground">
                      {formatearMonto(m.saldoDespues)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-sm text-muted-foreground">
        ¿Ves algo que no cuadra?{" "}
        <a
          href={whatsapp}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-acento-texto hover:underline"
        >
          Escribinos
        </a>{" "}
        y lo revisamos juntos.
      </p>
    </div>
  );
}

/**
 * Enlace al pedido que originó el movimiento.
 *
 * La referencia guarda el número del comprobante. Cuando es un pedido, poder
 * abrirlo desde acá es lo que convierte una cifra suelta en algo verificable:
 * "¿qué compré ese día?" se contesta con un click.
 */
function PedidoRelacionado({ referencia }: { referencia: string }) {
  if (!referencia.startsWith("PED-")) {
    return (
      <span className="tabular mt-0.5 block text-sm text-muted-foreground">
        {referencia}
      </span>
    );
  }

  return (
    <Link
      href={`/mi-cuenta/pedidos/${referencia}`}
      className="tabular mt-0.5 block text-sm text-acento-texto hover:underline"
    >
      {referencia}
    </Link>
  );
}
