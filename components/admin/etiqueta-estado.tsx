/**
 * Estados del sistema, en un solo lugar.
 *
 * Cada estado tiene una etiqueta y una familia de color. La etiqueta se lee; el
 * acento se escanea: es una franja al costado de la fila que permite ver de un
 * vistazo cuánto hay pendiente sin leer una sola palabra.
 *
 * Que el mismo estado se vea igual en todas las pantallas es lo que hace que el
 * color signifique algo. Si "listo" fuera verde en Pedidos y azul en el Resumen,
 * habría que leer siempre.
 *
 * **Las familias son seis y están definidas en `globals.css`.** Acá vive solo el
 * mapeo de estado a familia, que es la decisión de negocio: qué cuenta como
 * "espera acción" y qué como "cerrado" no es una elección de color.
 *
 * El color nunca va solo: siempre lo acompaña la etiqueta escrita. Por eso la
 * franja de las familias que no piden atención es deliberadamente tenue.
 */

type Familia =
  /** Alguien tiene que hacer algo. */
  | "espera"
  /** Está avanzando y no hace falta intervenir. */
  | "info"
  /** En curso, con el color de la marca. */
  | "marca"
  /** Se resolvió bien. */
  | "ok"
  /** Algo salió mal y hay que mirarlo. */
  | "problema"
  /** Terminado o dado de baja: no tiene que llamar la atención. */
  | "cerrado";

interface Estilo {
  etiqueta: string;
  familia: Familia;
  /** Si el estado todavía espera que alguien haga algo. */
  abierto: boolean;
}

const ESTADOS: Record<string, Estilo> = {
  // Presupuestos
  pendiente: { etiqueta: "Pendiente", familia: "espera", abierto: true },
  revision: { etiqueta: "En revisión", familia: "info", abierto: true },
  enviado: { etiqueta: "Enviado", familia: "marca", abierto: true },
  aceptado: { etiqueta: "Aceptado", familia: "ok", abierto: false },
  rechazado: { etiqueta: "Rechazado", familia: "cerrado", abierto: false },
  vencido: { etiqueta: "Vencido", familia: "cerrado", abierto: false },

  // Pedidos
  preparando: { etiqueta: "Preparando", familia: "espera", abierto: true },
  listo: { etiqueta: "Listo", familia: "ok", abierto: true },
  "en-camino": { etiqueta: "En camino", familia: "info", abierto: true },
  entregado: { etiqueta: "Entregado", familia: "cerrado", abierto: false },
  cancelado: { etiqueta: "Cancelado", familia: "cerrado", abierto: false },

  // Cortes
  "en-cola": { etiqueta: "En cola", familia: "espera", abierto: true },
  "en-proceso": { etiqueta: "En la máquina", familia: "marca", abierto: true },
  terminado: { etiqueta: "Terminado", familia: "ok", abierto: true },
  retirado: { etiqueta: "Retirado", familia: "cerrado", abierto: false },

  // Clientes
  activo: { etiqueta: "Activo", familia: "ok", abierto: false },
  moroso: { etiqueta: "Moroso", familia: "problema", abierto: true },
  inactivo: { etiqueta: "Inactivo", familia: "cerrado", abierto: false },

  // Comprobantes
  emitida: { etiqueta: "Emitida", familia: "info", abierto: true },
  autorizada: { etiqueta: "Autorizada", familia: "ok", abierto: false },
  anulada: { etiqueta: "Anulada", familia: "cerrado", abierto: false },
  rechazada: { etiqueta: "Rechazada por ARCA", familia: "problema", abierto: true },
  borrador: { etiqueta: "Borrador", familia: "espera", abierto: true },

  // Pagos y cuenta corriente
  pagado: { etiqueta: "Pagado", familia: "ok", abierto: false },
  parcial: { etiqueta: "Pago parcial", familia: "espera", abierto: true },
  compra: { etiqueta: "Compra", familia: "cerrado", abierto: false },
  pago: { etiqueta: "Pago", familia: "ok", abierto: false },
  nota_credito: { etiqueta: "Nota de crédito", familia: "info", abierto: false },
  nota_debito: { etiqueta: "Nota de débito", familia: "espera", abierto: false },
  ajuste: { etiqueta: "Ajuste", familia: "cerrado", abierto: false },

  // Cobros. "Iniciado" es el abandono de checkout: se generó el link y nadie
  // volvió. Se distingue del rechazo porque no hay nada que resolver.
  iniciado: { etiqueta: "Sin pagar", familia: "cerrado", abierto: false },
  en_revision: { etiqueta: "A verificar", familia: "espera", abierto: true },
  aprobado: { etiqueta: "Acreditado", familia: "ok", abierto: false },
  reintegrado: { etiqueta: "Reintegrado", familia: "info", abierto: false },
};

const PREDETERMINADO: Estilo = {
  etiqueta: "",
  familia: "cerrado",
  abierto: false,
};

/** Clase que define las tres variables de color de la familia. */
export function claseDeFamilia(estado: string): string {
  return `estado-${estiloDeEstado(estado).familia}`;
}

export function estiloDeEstado(estado: string): Estilo {
  const encontrado = ESTADOS[estado];
  if (encontrado) return encontrado;

  return {
    ...PREDETERMINADO,
    etiqueta:
      estado.charAt(0).toUpperCase() + estado.slice(1).replace(/[-_]/g, " "),
  };
}

export function EtiquetaEstado({ estado }: { estado: string }) {
  const { etiqueta } = estiloDeEstado(estado);

  return (
    <span
      className={`${claseDeFamilia(estado)} inline-flex shrink-0 items-center rounded-full bg-[var(--estado-fondo)] px-2.5 py-1 text-sm font-medium text-[var(--estado-tinta)]`}
    >
      {etiqueta}
    </span>
  );
}

/**
 * Franja de color al costado de una fila.
 * Va dentro de un contenedor con `relative` y `overflow-hidden`.
 */
export function AcentoEstado({ estado }: { estado: string }) {
  return (
    <span
      className={`${claseDeFamilia(estado)} absolute inset-y-0 left-0 w-1 bg-[var(--estado-acento)]`}
      aria-hidden="true"
    />
  );
}
