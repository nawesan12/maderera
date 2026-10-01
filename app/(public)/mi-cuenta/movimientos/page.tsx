import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { clienteDeLaSesion } from "@/lib/dal/cuenta";
import {
  desdeDelPeriodo,
  historialDelCliente,
  saldoDelCliente,
} from "@/lib/dal/historial-cliente";
import { LineaDeTiempo } from "@/components/cuenta/linea-de-tiempo";
import { FiltrosDeMovimientos, esFiltro } from "@/components/cuenta/filtros-de-movimientos";
import { formatearMonto } from "@/lib/formato";

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

  const [historial, saldo] = await Promise.all([
    historialDelCliente(cliente.id, { desde: desdeDelPeriodo(periodo), filtro }),
    saldoDelCliente(cliente.id),
  ]);

  const pendientes = historial.movimientos.filter(
    (m) => m.clase === "pago_en_revision" || m.clase === "cheque_por_recibir",
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Movimientos</h1>
          <p className="mt-1 text-[15px] text-muted-foreground">
            Tus compras, tus pagos con su recibo y los cheques que nos mandaste.
          </p>
        </div>
        {saldo !== 0 && (
          <Link
            href="/mi-cuenta/cuenta-corriente"
            className="rounded-xl border border-linea bg-card px-4 py-2.5 text-right transition-colors hover:bg-chip"
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
          {pendientes.length === 1
            ? "Tenés un pago que estamos verificando."
            : `Tenés ${pendientes.length} pagos que estamos verificando.`}{" "}
          Cuando lo confirmemos baja tu saldo y te llega el recibo por correo.
        </p>
      )}

      <section className="overflow-hidden rounded-xl border bg-card">
        <FiltrosDeMovimientos base="/mi-cuenta/movimientos" periodo={periodo} filtro={filtro} />
        <LineaDeTiempo
          movimientos={historial.movimientos}
          enlacePedido={(p) => `/mi-cuenta/pedidos/${p.numero}`}
          vacio="No hay movimientos en este período."
        />
      </section>

      {saldo > 0 && (
        <p className="text-[15px] text-muted-foreground">
          Para pagar tu cuenta con transferencia, depósito o cheque, entrá a{" "}
          <Link href="/mi-cuenta/cuenta-corriente" className="font-medium text-brand-orange hover:underline">
            Cuenta corriente
          </Link>
          .
        </p>
      )}
    </div>
  );
}
