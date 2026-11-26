import type { Metadata } from "next";
import { enlaceWhatsapp } from "@/lib/whatsapp/enlace";
import Link from "next/link";
import { Printer, Receipt } from "lucide-react";
import { EtiquetaEstado } from "@/components/admin/etiqueta-estado";
import { clienteDeLaSesion, miCuentaCorriente } from "@/lib/dal/cuenta";
import { datosParaTransferir } from "@/lib/dal/pagos";
import { PagarDeuda } from "@/components/cuenta/pagar-deuda";
import { fechaCorta, formatearMonto } from "@/lib/formato";
import { misMovimientos } from "@/lib/dal/historial-cliente";
import { BotonWhatsapp } from "@/components/whatsapp/boton";

export const metadata: Metadata = { title: "Cuenta corriente" };

export default async function CuentaCorrientePage({
  searchParams,
}: {
  searchParams: Promise<{ pago?: string }>;
}) {
  const whatsapp = await enlaceWhatsapp("Hola! Consulto por mi cuenta corriente.");
  const [cuenta, banco, { pago }, cliente, recientes] = await Promise.all([
    miCuentaCorriente(),
    datosParaTransferir(),
    searchParams,
    clienteDeLaSesion(),
    misMovimientos({ periodo: "3m", filtro: "pagos" }),
  ]);
  const enCamino = recientes.movimientos.filter((m) => m.clase === "pago_en_revision" || m.clase === "cheque_por_recibir");

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
        <BotonWhatsapp enlace={whatsapp} className="mt-5">
          Consultar por cuenta corriente
        </BotonWhatsapp>
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
            className="inline-flex h-11 items-center gap-2 rounded-lg superficie px-3.5 text-sm font-medium transition-colors hover:bg-chip"
          >
            <Printer className="h-4 w-4" />
            Resumen
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
            {/* La deuda nace con el pedido (así se aparta el crédito): lo que
                todavía no se entregó se distingue de lo adeudado (H082). */}
            {cuenta.sinEntregar > 0 && (
              <p className="mt-1 text-sm text-muted-foreground">
                <span className="tabular font-medium text-foreground">{formatearMonto(cuenta.sinEntregar)}</span> de pedidos sin entregar
              </p>
            )}
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
              aria-label={`Usás el ${Math.floor(porcentaje)} por ciento de tu límite`}
            >
              <div
                className={`h-full rounded-full ${
                  excedido
                    ? "bg-destructive"
                    : porcentaje > 80
                      ? "bg-amber-500"
                      : "bg-brand-orange"
                }`}
                style={{ width: `${Math.max(porcentaje, usado > 0 ? 3 : 0)}%` }}
              />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {excedido ? (
                <span className="text-saldo-debe">
                  Superás tu límite en{" "}
                  <span className="tabular">
                    {formatearMonto(usado - cuenta.limiteCredito)}
                  </span>
                  . Para seguir comprando a cuenta hay que regularizarlo.
                </span>
              ) : (
                `Usás el ${Math.floor(porcentaje)}% de tu límite.`
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
        <p className="rounded-xl superficie p-4 text-[15px]">
          Tenés <strong className="tabular">{formatearMonto(-cuenta.saldo)}</strong> a favor. Se
          descuenta solo de tu próxima compra: en el carrito elegí «Con mi saldo a favor», o
          avisá en el mostrador.
        </p>
      )}

      {/* El libro: fecha y concepto a la izquierda, importe y saldo a la
          derecha, uno debajo del otro. Era una tabla que a 375 px cortaba el
          importe y dejaba el saldo afuera (H089). Arriba, lo informado que
          todavía no mueve el saldo: se acaba de informar acá y no aparecía
          (H216). */}
      <section className="tarjeta overflow-hidden rounded-xl bg-card">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-4 pb-2">
          <h2 className="font-medium">Libro de la cuenta</h2>
          <Link href="/mi-cuenta/movimientos" className="-my-2 inline-flex min-h-11 items-center text-sm font-medium text-acento-texto hover:underline">
            Todos tus movimientos
          </Link>
        </div>

        {cuenta.movimientos.length === 0 && enCamino.length === 0 ? (
          <p className="px-5 py-10 text-center text-muted-foreground">
            Todavía no hay movimientos en tu cuenta.
          </p>
        ) : (
          <ul className="divide-y divide-linea">
            {enCamino.map((m) => (
              <li key={`${m.clase}-${m.id}`} className="flex items-start gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="tabular text-sm text-muted-foreground">{fechaCorta.format(m.fecha)}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2">
                    <span className="estado-espera rounded-full bg-[var(--estado-fondo)] px-2.5 py-0.5 text-sm font-medium text-[var(--estado-tinta)]">
                      {m.clase === "cheque_por_recibir" ? "Cheque por recibir" : "En revisión"}
                    </span>
                    <span className="text-sm">{m.titulo}</span>
                  </p>
                </div>
                <span className="tabular shrink-0 pt-5 text-right text-muted-foreground">
                  {formatearMonto(m.importeInformativo ?? 0)}
                </span>
              </li>
            ))}
            {cuenta.movimientos.map((m) => {
              const rechazo = m.tipo === "nota_debito" && /rechazado/i.test(m.detalle ?? "");
              return (
                <li key={m.id} className="flex items-start gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="tabular text-sm text-muted-foreground">{fechaCorta.format(m.createdAt)}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2">
                      {rechazo ? (
                        <span className="estado-problema rounded-full bg-[var(--estado-fondo)] px-2.5 py-0.5 text-sm font-medium text-[var(--estado-tinta)]">
                          Cheque rechazado
                        </span>
                      ) : (
                        <EtiquetaEstado estado={m.tipo} />
                      )}
                      {m.detalle && (
                        <span className="min-w-0 text-sm [overflow-wrap:anywhere]">
                          <ConEnlace texto={m.detalle} referencia={m.referencia} />
                        </span>
                      )}
                    </p>
                    {m.referencia && !m.receiptId && !m.detalle?.includes(m.referencia) && (
                      <PedidoRelacionado referencia={m.referencia} />
                    )}
                    {/* El pago con recibo lleva el papel a un toque, con el
                        número del recibo, no el del cheque (H303). */}
                    {m.receiptId && (
                      <a
                        href={`/api/recibos/${m.receiptId}/pdf`}
                        target="_blank"
                        rel="noopener"
                        className="tabular -my-1.5 inline-flex min-h-11 items-center text-sm text-acento-texto hover:underline"
                      >
                        Recibo {m.reciboNumero ?? m.referencia}
                      </a>
                    )}
                  </div>
                  <div className="shrink-0 pt-5 text-right">
                    <p className={`tabular font-semibold ${m.monto > 0 ? "" : "text-saldo-favor"}`}>
                      {m.monto > 0 ? "+" : "−"}
                      {formatearMonto(Math.abs(m.monto))}
                    </p>
                    <p className="tabular text-sm text-muted-foreground">{formatearMonto(m.saldoDespues)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
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
/**
 * El concepto con el número de pedido como enlace, cuando ya lo nombra
 * («Pedido PED-1050»): así no sale dos veces (H212, H388).
 */
function ConEnlace({ texto, referencia }: { texto: string; referencia: string | null }) {
  if (!referencia?.startsWith("PED-") || !texto.includes(referencia)) return <>{texto}</>;
  const [antes, ...resto] = texto.split(referencia);
  return (
    <>
      {antes}
      <Link href={`/mi-cuenta/pedidos/${referencia}`} className="tabular text-acento-texto hover:underline">
        {referencia}
      </Link>
      {resto.join(referencia)}
    </>
  );
}

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
      className="tabular -my-1.5 inline-flex min-h-11 items-center text-sm text-acento-texto hover:underline"
    >
      {referencia}
    </Link>
  );
}
