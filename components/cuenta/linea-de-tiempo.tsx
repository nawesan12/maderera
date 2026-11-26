import type { ReactNode } from "react";
import Link from "next/link";
import { FileText } from "lucide-react";
import type { ClaseDeMovimiento, MovimientoDelCliente } from "@/lib/dal/historial-cliente";
// Los centavos solo cuando los hay, como en el resto de la ficha (mes simulado:
// «$ 339.100,00» acá y «$ 339.100» en Pedidos).
import { formatearMonto } from "@/lib/formato";

/**
 * Los movimientos de un cliente, agrupados por mes.
 *
 * La comparten Mi cuenta y la ficha del panel: el cliente y quien lo atiende
 * tienen que ver lo mismo, en el mismo orden y con las mismas palabras, o la
 * conversación por teléfono empieza con «a mí me figura otra cosa».
 *
 * **Lo que no mueve la cuenta se ve, pero se distingue.** Una compra de
 * contado o una transferencia en revisión van con el importe en gris y sin
 * signo: están para que el cliente sepa que las vimos, no para que sume. El
 * rótulo «no mueve la cuenta» se sacó (simulación del mes, H095): a un
 * consumidor final sin cuenta corriente le hablaba de una cuenta que no
 * tiene, y el gris sin signo ya lo dice.
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
  cheque: { etiqueta: "Cheque", familia: "estado-cerrado" },
  cheque_rechazado: { etiqueta: "Cheque rechazado", familia: "estado-problema" },
};

const MES = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" });
const DIA = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit" });

type ReciboDelMovimiento = NonNullable<MovimientoDelCliente["recibo"]>;

export function LineaDeTiempo({
  movimientos,
  enlacePedido,
  accionDelRecibo,
  sinCuenta = false,
  vacio = "Todavía no hay movimientos en este período.",
}: {
  /**
   * El cliente no tiene cuenta corriente: «no mueve la cuenta» es jerga que
   * no le dice nada, el importe solo alcanza (H394).
   */
  sinCuenta?: boolean;
  movimientos: MovimientoDelCliente[];
  /** Adónde lleva un pedido: la ficha del panel o el seguimiento del cliente. */
  enlacePedido: (pedido: { id: string; numero: string }) => string;
  /** Lo que el panel ofrece sobre un recibo vivo (anularlo); el portal, nada. */
  accionDelRecibo?: (recibo: ReciboDelMovimiento, movimiento: MovimientoDelCliente) => ReactNode;
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
              <Fila
                key={`${m.clase}-${m.id}`}
                movimiento={m}
                enlacePedido={enlacePedido}
                accionDelRecibo={accionDelRecibo}
                sinCuenta={sinCuenta}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * Un movimiento: arriba la fecha, la etiqueta y el importe; abajo el concepto
 * a todo el ancho. Con el importe al costado del concepto, a 375 px el
 * concepto quedaba en una o dos palabras por renglón (H212). El número del
 * pedido va una sola vez: si el concepto ya lo nombra, ese es el enlace.
 */
function Fila({
  movimiento: m,
  enlacePedido,
  accionDelRecibo,
  sinCuenta,
}: {
  movimiento: MovimientoDelCliente;
  enlacePedido: (pedido: { id: string; numero: string }) => string;
  accionDelRecibo?: (recibo: ReciboDelMovimiento, movimiento: MovimientoDelCliente) => ReactNode;
  sinCuenta: boolean;
}) {
  const base = ESTILO[m.clase];
  // La nota de débito de un cheque que rebotó se llama igual en todas las
  // pantallas: «Cheque rechazado» (H303).
  const estilo =
    m.clase === "nota_debito" && /rechazado/i.test(m.detalle ?? "") ? ESTILO.cheque_rechazado : base;
  // Si el título repite la etiqueta («Compra a cuenta» dos veces), el detalle
  // pasa a ser el título: es lo que distingue un renglón de otro.
  const repite = m.titulo === base.etiqueta && Boolean(m.detalle);
  // El recibo va como enlace debajo: «— recibo REC-0002» en el concepto lo
  // decía dos veces.
  const titulo = sinRecibo(repite ? m.detalle! : m.titulo, m.recibo?.numero);
  const detalle = repite ? null : m.detalle ? sinRecibo(m.detalle, m.recibo?.numero) || null : null;
  const mueve = m.importe !== null;
  const importe = m.importe ?? m.importeInformativo;
  // El pago de un recibo anulado sigue en la historia (con su ajuste al lado),
  // pero no puede verse como un pago vivo: fila apagada e importe tachado.
  const anulado = m.clase === "pago" && Boolean(m.recibo?.anulado);
  const pedidoEnTexto = Boolean(
    m.pedido && (titulo.includes(m.pedido.numero) || detalle?.includes(m.pedido.numero)),
  );

  return (
    <li className={`px-5 py-3.5 ${anulado ? "opacity-70" : ""}`}>
      {/* Si la etiqueta y un importe de siete cifras no entran en un renglón,
          el importe baja, alineado a la derecha, en vez de montarse sobre la
          etiqueta (H212, medido a 375 px). */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="tabular shrink-0 text-sm text-muted-foreground">{DIA.format(m.fecha)}</span>
          <span
            className={`${estilo.familia} whitespace-nowrap rounded-full bg-[var(--estado-fondo)] px-2 py-0.5 text-xs font-semibold text-[var(--estado-tinta)]`}
          >
            {estilo.etiqueta}
          </span>
        </span>
        {importe !== null && (
          <span
            className={`tabular ml-auto shrink-0 whitespace-nowrap text-right text-base ${
              anulado
                ? "text-muted-foreground line-through"
                : !mueve
                  ? "text-muted-foreground"
                  : importe > 0
                    ? "font-semibold"
                    : "font-semibold text-saldo-favor"
            }`}
          >
            {mueve ? (importe > 0 ? "+" : "−") : ""}
            {formatearMonto(Math.abs(importe))}
          </span>
        )}
      </div>

      <p className="mt-1 text-base font-medium [overflow-wrap:anywhere]">
        <ConPedido texto={titulo} pedido={m.pedido} enlacePedido={enlacePedido} />
      </p>
      {detalle && (
        <p className="mt-0.5 text-sm text-muted-foreground [overflow-wrap:anywhere]">
          <ConPedido texto={detalle} pedido={m.pedido} enlacePedido={enlacePedido} />
        </p>
      )}
      {((m.pedido && !pedidoEnTexto) || m.recibo || (!mueve && importe !== null && !sinCuenta)) && (
        <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {m.pedido && !pedidoEnTexto && (
            <Link
              href={enlacePedido(m.pedido)}
              className="tabular -my-2.5 inline-flex min-h-11 items-center text-acento-texto hover:underline"
            >
              {m.pedido.numero}
            </Link>
          )}
          {m.recibo && (
            <a
              href={`/api/recibos/${m.recibo.id}/pdf`}
              target="_blank"
              rel="noopener"
              className="-my-2.5 inline-flex min-h-11 items-center gap-1 text-acento-texto hover:underline"
            >
              <FileText className="h-3.5 w-3.5" />
              Recibo <span className="tabular whitespace-nowrap">{m.recibo.numero}</span>
            </a>
          )}
          {m.recibo?.anulado && (
            <span className="estado-problema rounded-full bg-[var(--estado-fondo)] px-2 py-0.5 text-xs font-semibold">
              Anulado
            </span>
          )}
          {/* El recibo emitido no cambia, pero el pago no puede verse entero
              si un cheque suyo rebotó (H303). */}
          {m.recibo?.chequeRechazado && m.clase === "pago" && (
            <span className="estado-problema rounded-full bg-[var(--estado-fondo)] px-2 py-0.5 text-xs font-semibold">
              Con un cheque rechazado
            </span>
          )}
          {m.recibo && !m.recibo.anulado && accionDelRecibo?.(m.recibo, m)}
          {!mueve && importe !== null && !sinCuenta && (
            <span className="text-xs text-muted-foreground">No mueve la cuenta</span>
          )}
        </p>
      )}
    </li>
  );
}

/** El texto con el número de pedido como enlace, si lo nombra. */
function ConPedido({
  texto,
  pedido,
  enlacePedido,
}: {
  texto: string;
  pedido: MovimientoDelCliente["pedido"];
  enlacePedido: (pedido: { id: string; numero: string }) => string;
}) {
  if (!pedido || !texto.includes(pedido.numero)) return <>{texto}</>;
  const [antes, ...resto] = texto.split(pedido.numero);
  return (
    <>
      {antes}
      {/* Alto de dedo sin mover el renglón: el relleno agranda el toque y el
          margen negativo lo devuelve (H312: medía 21 px). */}
      <Link
        href={enlacePedido(pedido)}
        className="tabular -my-3 inline-block whitespace-nowrap py-3 text-acento-texto hover:underline"
      >
        {pedido.numero}
      </Link>
      {resto.join(pedido.numero)}
    </>
  );
}

/** El concepto sin el «— recibo REC-xxxx» que ya va como enlace. */
function sinRecibo(texto: string, recibo: string | undefined): string {
  if (!recibo) return texto;
  return texto.replace(` — recibo ${recibo}`, "").trim();
}
