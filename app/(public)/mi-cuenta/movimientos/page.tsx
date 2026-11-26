import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { clienteDeLaSesion } from "@/lib/dal/cuenta";
import { misMovimientos } from "@/lib/dal/historial-cliente";
import { LineaDeTiempo } from "@/components/cuenta/linea-de-tiempo";
import {
  FiltrosDeMovimientos,
  esFiltro,
} from "@/components/cuenta/filtros-de-movimientos";
import { formatearMonto } from "@/lib/formato";
import { avisoDePagosEnVerificacion } from "@/lib/cuenta/portal";

export const metadata: Metadata = { title: "Movimientos" };

/**
 * Todo lo que pasó con la plata del cliente.
 *
 * De la clienta (30/9/2026): «agregar movimientos normales al usuario». Lo ve
 * **todo cliente**, opere a crédito o no: quien compra de contado también
 * quiere saber qué compró, y quien informó una transferencia quiere saber si
 * llegó sin preguntar por WhatsApp. Es la misma línea de tiempo que mira quien
 * lo atiende en el panel.
 */
export default async function MovimientosPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; ver?: string }>;
}) {
  const cliente = await clienteDeLaSesion();
  if (!cliente) redirect("/ingresar?volver=/mi-cuenta/movimientos");

  const { periodo = "12m", ver } = await searchParams;
  const filtro = esFiltro(ver) ? ver : "todo";

  const historial = await misMovimientos({ periodo, filtro });
  const saldo = historial.saldo;
  // Sin nada en todo el historial no hay qué filtrar: ni los filtros de
  // cheques ni «en este período», que invitaba a cambiar el período en vano.
  const sinHistoria =
    historial.movimientos.length === 0 &&
    saldo === 0 &&
    (periodo === "todo" && filtro === "todo"
      ? true
      : (await misMovimientos({ periodo: "todo", filtro: "todo" })).movimientos
          .length === 0);

  const pendientes = historial.movimientos.filter(
    (m) => m.clase === "pago_en_revision" || m.clase === "cheque_por_recibir",
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Movimientos</h1>
        </div>
        {saldo !== 0 && (
          <Link
            href="/mi-cuenta/cuenta-corriente"
            className="rounded-xl superficie px-4 py-2.5 text-right transition-colors hover:bg-chip"
          >
            <span className="block text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {saldo > 0 ? "Tu saldo" : "A tu favor"}
            </span>
            <span
              className={`tabular text-xl font-semibold ${saldo > 0 ? "text-saldo-debe" : "text-saldo-favor"}`}
            >
              {formatearMonto(Math.abs(saldo))}
            </span>
          </Link>
        )}
      </div>

      {/* Lo que está en camino, arriba y aparte: es lo que el cliente viene a
          mirar después de mandar un comprobante o un cheque. */}
      {pendientes.length > 0 && (
        <p className="estado-espera rounded-xl bg-[var(--estado-fondo)] px-4 py-3 text-[15px]">
          {avisoDePagosEnVerificacion(pendientes.length)}
        </p>
      )}

      {sinHistoria ? (
        <div className="rounded-2xl border border-dashed bg-card/60 px-6 py-14 text-center">
          <h2 className="text-xl font-semibold">Todavía no hay movimientos</h2>
          <p className="mx-auto mt-1.5 max-w-sm text-muted-foreground">
            Acá vas a ver lo que compres y lo que pagues.
          </p>
          <Link
            href="/catalogo"
            className="mt-5 inline-flex h-11 items-center rounded-lg border bg-card px-5 font-medium transition-colors hover:bg-muted"
          >
            Ver el catálogo
          </Link>
        </div>
      ) : (
        <section className="overflow-hidden rounded-xl border bg-card">
          <FiltrosDeMovimientos
            base="/mi-cuenta/movimientos"
            periodo={periodo}
            filtro={filtro}
          />
          <LineaDeTiempo
            movimientos={historial.movimientos}
            enlacePedido={(p) => `/mi-cuenta/pedidos/${p.numero}`}
            sinCuenta={
              cliente.limiteCredito <= 0 &&
              saldo === 0 &&
              !historial.movimientos.some((m) => m.importe !== null)
            }
            vacio="No hay movimientos en este período."
          />
        </section>
      )}

      {saldo > 0 && (
        <p className="text-[15px] text-muted-foreground">
          Para pagar tu cuenta con transferencia, depósito o cheque, entrá a{" "}
          <Link
            href="/mi-cuenta/cuenta-corriente"
            className="font-medium text-acento-texto hover:underline"
          >
            Cuenta corriente
          </Link>
          .
        </p>
      )}
    </div>
  );
}
