import { estadoEnSucursal, type EstadoEnSucursal } from "@/lib/stock-ajuste";
import { formatearCantidad, formatearLargo, piezasDeMetros } from "@/lib/unidades";

/** El color del número y del estado, el mismo en la fila corta y en el detalle. */
export const TINTA_DEL_ESTADO: Record<EstadoEnSucursal, string> = {
  faltante: "text-destructive",
  "sin-stock": "text-brand-orange-dark dark:text-acento-texto",
  reponer: "text-brand-orange-dark dark:text-acento-texto",
  "va-bajando": "",
  bien: "",
};

const BARRA_DEL_ESTADO: Record<EstadoEnSucursal, string> = {
  faltante: "bg-destructive",
  "sin-stock": "bg-border",
  reponer: "bg-brand-orange",
  "va-bajando": "bg-amber-400",
  bien: "bg-saldo-favor",
};

export function textoDelEstado(estado: EstadoEnSucursal, disponible: number): string {
  switch (estado) {
    case "faltante":
      return `Faltan ${formatearCantidad(-disponible)}`;
    case "sin-stock":
      return "Sin stock";
    case "reponer":
      return "Hay que reponer";
    case "va-bajando":
      return "Va bajando";
    default:
      return "Bien";
  }
}

/**
 * Nivel de stock de una sucursal.
 *
 * La barra muestra lo disponible contra el mínimo de reposición, que es la
 * comparación que importa: veinte placas pueden ser mucho o poco según lo que
 * se venda de ese producto. La escala llega hasta tres veces el mínimo: más
 * arriba ya no cambia la decisión.
 *
 * **El número grande es lo disponible, con signo.** Es lo que se puede
 * vender; negativo es lo vendido de más, el faltante a comprar (mes
 * simulado, H218), y la suma de estos números es el total de la tarjeta
 * (H198). Abajo, el desglose que arma ese número: lo que hay en el galpón, lo
 * vendido sin retirar y lo que ya salió en el camión de un pedido en camino
 * (H166), que el sistema todavía cuenta en el físico pero no está en el
 * estante. Solo cuando hay algo de eso: si no, serían números repetidos.
 */
export function NivelStock({
  sucursal,
  cantidad,
  reservado = 0,
  disponible,
  enReparto = 0,
  llegando = 0,
  minimo,
  unidad,
  largoMm,
}: {
  sucursal: string;
  /** Físico: lo que el sistema cuenta en la sucursal. */
  cantidad: number;
  /** Comprometido en pedidos sin retirar (incluye lo que está en reparto). */
  reservado?: number;
  /** Físico − reservado, con signo. */
  disponible: number;
  enReparto?: number;
  llegando?: number;
  minimo: number;
  /** La abreviatura («placa», «u.»), para el lector de pantalla y el número. */
  unidad?: string;
  /**
   * Largo de la pieza del metro lineal. Con él, «28,8» se lee además como
   * «12 piezas de 2,40», que es lo que se encuentra al ir a contar.
   */
  largoMm?: number | null;
}) {
  const estado = estadoEnSucursal(disponible, minimo);
  const libre = Math.max(disponible, 0);
  const enPiezas = largoMm && libre > 0 ? piezasDeMetros(libre, largoMm) : null;
  const tope = Math.max(minimo * 3, 1);
  const porcentaje = estado === "faltante" ? 100 : Math.min((libre / tope) * 100, 100);
  const texto = textoDelEstado(estado, disponible);
  const galpon = cantidad - enReparto;
  const sinRetirar = reservado - enReparto;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-muted-foreground">{sucursal}</span>
        <span className={`tabular text-lg font-semibold ${estado === "sin-stock" ? "text-muted-foreground" : TINTA_DEL_ESTADO[estado]}`}>
          {formatearCantidad(disponible)}
          {unidad && <span className="ml-1 text-sm font-normal text-muted-foreground">{unidad}</span>}
        </span>
      </div>

      <div
        className="mt-1 h-2 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`${sucursal}: ${formatearCantidad(disponible)} ${unidad ?? "u."} disponibles, mínimo ${formatearCantidad(minimo)}. ${texto}.`}
      >
        <div
          className={`h-full rounded-full transition-[width] ${BARRA_DEL_ESTADO[estado]}`}
          style={{ width: `${Math.max(porcentaje, libre > 0 ? 4 : 0)}%` }}
        />
      </div>

      <p className="mt-1 flex items-baseline justify-between gap-2 text-sm">
        <span className={TINTA_DEL_ESTADO[estado] || "text-muted-foreground"}>{texto}</span>
        {minimo > 0 && <span className="tabular text-muted-foreground">mín. {formatearCantidad(minimo)}</span>}
      </p>

      {enPiezas && (
        <p className="tabular mt-0.5 text-sm text-muted-foreground">
          {enPiezas.piezas} × {formatearLargo(largoMm!)}
          {enPiezas.resto > 0 ? ` + ${formatearCantidad(enPiezas.resto)} m` : ""}
        </p>
      )}

      {(reservado > 0 || enReparto > 0) && (
        <p className="tabular mt-0.5 text-sm text-muted-foreground">
          {formatearCantidad(galpon)} en el galpón
          {sinRetirar > 0 && ` · ${formatearCantidad(sinRetirar)} sin retirar`}
          {enReparto > 0 && ` · ${formatearCantidad(enReparto)} en reparto`}
        </p>
      )}

      {llegando > 0 && (
        <p className="estado-espera tabular mt-0.5 text-sm font-medium">+{formatearCantidad(llegando)} llegando</p>
      )}
    </div>
  );
}
