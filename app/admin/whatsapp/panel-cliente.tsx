"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Loader2, UserPlus, Wallet } from "lucide-react";
import { EtiquetaEstado } from "@/components/admin/etiqueta-estado";
import { fechaCorta, moneda } from "@/lib/formato";
import { vincularCliente, type EstadoWhatsapp } from "./actions";
import type { obtenerConversacion } from "@/lib/dal/admin/whatsapp";

type Detalle = NonNullable<Awaited<ReturnType<typeof obtenerConversacion>>>;

const estadoInicial: EstadoWhatsapp = {};

/**
 * Contexto del cliente, al costado de la conversación.
 *
 * Las dos preguntas que llegan por WhatsApp a una maderera son "¿ya está listo
 * lo mío?" y "¿cuánto debo?". Tenerlas contestadas antes de leer el mensaje es
 * la diferencia entre responder en diez segundos o abrir tres pantallas y
 * volver.
 */
export function PanelCliente({ detalle }: { detalle: Detalle }) {
  if (!detalle.customerId) {
    return <SinFicha conversacionId={detalle.id} waJid={detalle.waJid} />;
  }

  const excedido =
    detalle.limiteCredito > 0 && detalle.saldo > detalle.limiteCredito;

  return (
    <div className="space-y-4 lg:sticky lg:top-24">
      <section className="tarjeta p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-base font-medium">
              {detalle.clienteNombre}
            </h2>
            {detalle.clienteEmail && (
              <p className="truncate text-sm text-muted-foreground">
                {detalle.clienteEmail}
              </p>
            )}
          </div>
          {detalle.clienteEstado && (
            <EtiquetaEstado estado={detalle.clienteEstado} />
          )}
        </div>

        <Link
          href={`/admin/clientes/${detalle.customerId}`}
          className="mt-3 inline-flex h-10 w-full items-center justify-center rounded-lg border text-base font-medium transition-colors hover:bg-muted"
        >
          Abrir ficha completa
        </Link>
      </section>

      {(detalle.saldo !== 0 || detalle.limiteCredito > 0) && (
        <section className="tarjeta p-4">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            <Wallet className="h-4 w-4" />
            Cuenta corriente
          </h3>
          <p
            className={`tabular mt-1.5 text-2xl font-semibold ${
              excedido
                ? "text-red-700"
                : detalle.saldo > 0
                  ? "text-brand-orange-dark"
                  : "text-green-700"
            }`}
          >
            {moneda.format(Math.abs(detalle.saldo))}
          </p>
          <p className="mt-0.5 text-base text-muted-foreground">
            {detalle.saldo > 0
              ? "Debe"
              : detalle.saldo < 0
                ? "A favor"
                : "Sin deuda"}
            {detalle.limiteCredito > 0 && (
              <> · límite {moneda.format(detalle.limiteCredito)}</>
            )}
          </p>
          {excedido && (
            <p className="mt-1.5 text-base text-red-700">
              Supera el límite. No debería llevarse más a cuenta.
            </p>
          )}
        </section>
      )}

      <section className="tarjeta overflow-hidden">
        <h3 className="px-4 py-3 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Últimos pedidos
        </h3>
        {detalle.pedidos.length === 0 ? (
          <p className="border-t px-4 py-5 text-center text-base text-muted-foreground">
            Sin pedidos todavía.
          </p>
        ) : (
          <ul className="divide-y border-t">
            {detalle.pedidos.map((pedido) => (
              <li key={pedido.id}>
                <Link
                  href={`/admin/pedidos/${pedido.id}`}
                  className="flex items-center gap-2 px-4 py-3 transition-colors hover:bg-muted/60"
                >
                  <span className="min-w-0 flex-1">
                    <span className="tabular block text-base">
                      {pedido.numero}
                    </span>
                    <span className="block text-sm text-muted-foreground">
                      {fechaCorta.format(pedido.createdAt)}
                      {pedido.sucursal ? ` · ${pedido.sucursal}` : ""}
                    </span>
                  </span>
                  <EtiquetaEstado estado={pedido.estado} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * Conversación de un número que no está en la base.
 *
 * Pasa seguido: alguien pregunta por un precio antes de ser cliente. Lo que se
 * ofrece es cargarlo, porque es el momento en que se tienen sus datos a mano.
 */
function SinFicha({
  conversacionId,
  waJid,
}: {
  conversacionId: string;
  waJid: string;
}) {
  const [estado, accion, pendiente] = useActionState(
    vincularCliente,
    estadoInicial,
  );

  return (
    <section className="tarjeta lg:sticky lg:top-24 p-4">
      <h2 className="flex items-center gap-2 text-base font-medium">
        <UserPlus className="h-5 w-5 text-muted-foreground" />
        Sin ficha de cliente
      </h2>
      <p className="mt-1.5 text-base text-muted-foreground">
        Este número no coincide con ningún cliente cargado. Si ya es cliente,
        pegá el teléfono en su ficha y se vincula solo la próxima vez que
        escriba.
      </p>

      <Link
        href="/admin/clientes"
        className="mt-3 inline-flex h-10 w-full items-center justify-center rounded-lg border text-base font-medium transition-colors hover:bg-muted"
      >
        Buscar en clientes
      </Link>

      <form action={accion} className="mt-2.5">
        <input type="hidden" name="conversacionId" value={conversacionId} />
        <label
          htmlFor={`vincular-${conversacionId}`}
          className="text-sm text-muted-foreground"
        >
          O pegá el id de la ficha para vincularla ahora
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id={`vincular-${conversacionId}`}
            name="customerId"
            placeholder="id del cliente"
            className="h-10 min-w-0 flex-1 rounded-lg border bg-background px-2.5 text-sm"
          />
          <button
            type="submit"
            disabled={pendiente}
            className="inline-flex h-10 shrink-0 items-center rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted disabled:opacity-60"
          >
            {pendiente ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              "Vincular"
            )}
          </button>
        </div>
      </form>

      {estado.error && (
        <p role="alert" className="mt-2 text-base text-red-700">
          {estado.error}
        </p>
      )}
      {estado.ok && (
        <p role="status" className="mt-2 text-base text-green-700">
          {estado.ok}
        </p>
      )}

      <p className="tabular mt-3 border-t pt-3 text-sm text-muted-foreground">
        {waJid.split("@")[0]}
      </p>
    </section>
  );
}
