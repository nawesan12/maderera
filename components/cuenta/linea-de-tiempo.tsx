import Link from "next/link";
import { FileText } from "lucide-react";
import type { ClaseDeMovimiento, MovimientoDelCliente } from "@/lib/dal/historial-cliente";

/**
 * Los movimientos de un cliente, agrupados por mes.
 *
 * La comparten Mi cuenta y la ficha del panel: el cliente y quien lo atiende
 * tienen que ver lo mismo, en el mismo orden y con las mismas palabras, o la
 * conversación por teléfono empieza con «a mí me figura otra cosa».
 *
 * **Lo que no mueve la cuenta se ve, pero se distingue.** Una compra de
 * contado o una transferencia en revisión van con el importe en gris y sin
 * signo: están para que el cliente sepa que las vimos, no para que sume.
 */

/** Cómo se dice cada clase y qué familia de color lleva (ver `globals.css`). */
const ESTILO: Record<ClaseDeMovimiento, { etiqueta: string; familia: string }> = {
  compra: { etiqueta: "Compra a cuenta", familia: "estado-marca" },
  pago: { etiqueta: "Pago", familia: "estado-ok" },
  nota_credito: { etiqueta: "Nota de crédito", familia: "estado-ok" },
  nota_debito: { etiqueta: "Nota de débito", familia: "estado-problema" },
  ajuste: { etiqueta: "Ajuste", familia: "estado-cerrado" },
  compra_contado: { etiqueta: "Compra", familia: "estado-cerrado" },
  pago_en_revision: { etiqueta: "En revisión", familia: "estado-espera" },
  pago_rechazado: { etiqueta: "No acreditado", familia: "estado-problema" },
  cheque_por_recibir: { etiqueta: "Cheque por recibir", familia: "estado-espera" },
  cheque_rechazado: { etiqueta: "Cheque rechazado", familia: "estado-problema" },
};

const MES = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" });
const DIA = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit" });
const PESOS = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 2,
});

export function LineaDeTiempo({
  movimientos,
  enlacePedido,
  vacio = "Todavía no hay movimientos en este período.",
}: {
  movimientos: MovimientoDelCliente[];
  /** Adónde lleva un pedido: la ficha del panel o el seguimiento del cliente. */
  enlacePedido: (pedido: { id: string; numero: string }) => string;
  vacio?: string;
}) {
  if (movimientos.length === 0) {
    return <p className="px-5 py-10 text-center text-base text-muted-foreground">{vacio}</p>;
  }

  // Agrupados por mes, en el orden en que llegan (lo más nuevo arriba).
  const meses: { clave: string; titulo: string; filas: MovimientoDelCliente[] }[] = [];
  for (const m of movimientos) {
    const clave = `${m.fecha.getFullYear()}-${m.fecha.getMonth()}`;
    const ultimo = meses.at(-1);
    if (ultimo?.clave === clave) ultimo.filas.push(m);
    else {
      const titulo = MES.format(m.fecha);
      meses.push({ clave, titulo: titulo[0]!.toUpperCase() + titulo.slice(1), filas: [m] });
    }
  }

  return (
    <div>
      {meses.map((mes) => (
        <section key={mes.clave}>
          <h3 className="sticky top-0 z-[1] border-y border-linea bg-hundida px-5 py-2 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {mes.titulo}
          </h3>
          <ul className="divide-y divide-linea">
            {mes.filas.map((m) => (
              <Fila key={`${m.clase}-${m.id}`} movimiento={m} enlacePedido={enlacePedido} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Fila({
  movimiento: m,
  enlacePedido,
}: {
  movimiento: MovimientoDelCliente;
  enlacePedido: (pedido: { id: string; numero: string }) => string;
}) {
  const estilo = ESTILO[m.clase];
  // Si el título repite la etiqueta («Compra a cuenta» dos veces), el detalle
  // pasa a ser el título: es lo que distingue un renglón de otro.
  const repite = m.titulo === estilo.etiqueta && Boolean(m.detalle);
  const titulo = repite ? m.detalle! : m.titulo;
  const detalle = repite ? null : m.detalle;
  const mueve = m.importe !== null;
  const importe = m.importe ?? m.importeInformativo;

  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-1.5 px-5 py-3.5">
      <span className="tabular w-12 shrink-0 pt-0.5 text-sm text-muted-foreground">
        {DIA.format(m.fecha)}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span
            className={`${estilo.familia} rounded-full bg-[var(--estado-fondo)] px-2 py-0.5 text-xs font-semibold text-[var(--estado-tinta)]`}
          >
            {estilo.etiqueta}
          </span>
          <span className="text-base font-medium">{titulo}</span>
        </span>
        {detalle && (
          <span className="mt-0.5 block text-sm text-muted-foreground">{detalle}</span>
        )}
        {(m.pedido || m.recibo) && (
          <span className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {m.pedido && (
              <Link
                href={enlacePedido(m.pedido)}
                className="tabular text-acento-texto hover:underline"
              >
                {m.pedido.numero}
              </Link>
            )}
            {m.recibo && (
              <a
                href={`/api/recibos/${m.recibo.id}/pdf`}
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-1 text-acento-texto hover:underline"
              >
                <FileText className="h-3.5 w-3.5" />
                Recibo <span className="tabular">{m.recibo.numero}</span>
                {m.recibo.anulado && " (anulado)"}
              </a>
            )}
          </span>
        )}
      </span>

      {importe !== null && (
        <span
          className={`tabular shrink-0 text-right text-base ${
            !mueve
              ? "text-muted-foreground"
              : importe > 0
                ? "font-semibold"
                : "font-semibold text-saldo-favor"
          }`}
        >
          {mueve ? (importe > 0 ? "+" : "−") : ""}
          {PESOS.format(Math.abs(importe))}
          {!mueve && <span className="block text-xs">no mueve la cuenta</span>}
        </span>
      )}
    </li>
  );
}
