/**
 * Estados del sistema, en un solo lugar.
 *
 * Cada estado tiene una etiqueta y un color de acento. La etiqueta se lee; el
 * acento se escanea: es una franja al costado de la fila que permite ver de un
 * vistazo cuánto hay pendiente sin leer una sola palabra.
 *
 * Que el mismo estado se vea igual en todas las pantallas es lo que hace que el
 * color signifique algo. Si "listo" fuera verde en Pedidos y azul en el Resumen,
 * habría que leer siempre.
 */

interface Estilo {
  etiqueta: string;
  /** Clases de la píldora. */
  pildora: string;
  /** Color de la franja lateral. */
  acento: string;
  /** Si el estado todavía espera que alguien haga algo. */
  abierto: boolean;
}

const ESTADOS: Record<string, Estilo> = {
  // Presupuestos
  pendiente: { etiqueta: "Pendiente", pildora: "bg-amber-100 text-amber-900", acento: "bg-amber-400", abierto: true },
  revision: { etiqueta: "En revisión", pildora: "bg-blue-100 text-blue-900", acento: "bg-blue-500", abierto: true },
  enviado: { etiqueta: "Enviado", pildora: "bg-brand-orange/15 text-brand-orange-dark", acento: "bg-brand-orange", abierto: true },
  aceptado: { etiqueta: "Aceptado", pildora: "bg-green-100 text-green-900", acento: "bg-green-600", abierto: false },
  rechazado: { etiqueta: "Rechazado", pildora: "bg-muted text-muted-foreground", acento: "bg-border", abierto: false },
  vencido: { etiqueta: "Vencido", pildora: "bg-muted text-muted-foreground", acento: "bg-border", abierto: false },

  // Pedidos
  preparando: { etiqueta: "Preparando", pildora: "bg-amber-100 text-amber-900", acento: "bg-amber-400", abierto: true },
  listo: { etiqueta: "Listo", pildora: "bg-green-100 text-green-900", acento: "bg-green-600", abierto: true },
  "en-camino": { etiqueta: "En camino", pildora: "bg-blue-100 text-blue-900", acento: "bg-blue-500", abierto: true },
  entregado: { etiqueta: "Entregado", pildora: "bg-muted text-muted-foreground", acento: "bg-border", abierto: false },
  cancelado: { etiqueta: "Cancelado", pildora: "bg-muted text-muted-foreground line-through", acento: "bg-border", abierto: false },

  // Cortes
  "en-cola": { etiqueta: "En cola", pildora: "bg-amber-100 text-amber-900", acento: "bg-amber-400", abierto: true },
  "en-proceso": { etiqueta: "En la máquina", pildora: "bg-brand-orange/15 text-brand-orange-dark", acento: "bg-brand-orange", abierto: true },
  terminado: { etiqueta: "Terminado", pildora: "bg-green-100 text-green-900", acento: "bg-green-600", abierto: true },
  retirado: { etiqueta: "Retirado", pildora: "bg-muted text-muted-foreground", acento: "bg-border", abierto: false },

  // Clientes
  activo: { etiqueta: "Activo", pildora: "bg-green-100 text-green-900", acento: "bg-green-600", abierto: false },
  moroso: { etiqueta: "Moroso", pildora: "bg-red-100 text-red-900", acento: "bg-red-600", abierto: true },
  inactivo: { etiqueta: "Inactivo", pildora: "bg-muted text-muted-foreground", acento: "bg-border", abierto: false },

  // Comprobantes
  emitida: { etiqueta: "Emitida", pildora: "bg-amber-100 text-amber-900", acento: "bg-amber-400", abierto: true },
  autorizada: { etiqueta: "Autorizada", pildora: "bg-green-100 text-green-900", acento: "bg-green-600", abierto: false },
  anulada: { etiqueta: "Anulada", pildora: "bg-muted text-muted-foreground line-through", acento: "bg-border", abierto: false },
  rechazada: { etiqueta: "Rechazada por ARCA", pildora: "bg-red-100 text-red-900", acento: "bg-red-600", abierto: true },
  borrador: { etiqueta: "Borrador", pildora: "bg-muted text-muted-foreground", acento: "bg-border", abierto: true },

  // Pagos y cuenta corriente
  pagado: { etiqueta: "Pagado", pildora: "bg-green-100 text-green-900", acento: "bg-green-600", abierto: false },
  parcial: { etiqueta: "Pago parcial", pildora: "bg-amber-100 text-amber-900", acento: "bg-amber-400", abierto: true },
  compra: { etiqueta: "Compra", pildora: "bg-muted text-muted-foreground", acento: "bg-border", abierto: false },
  pago: { etiqueta: "Pago", pildora: "bg-green-100 text-green-900", acento: "bg-green-600", abierto: false },
  nota_credito: { etiqueta: "Nota de crédito", pildora: "bg-blue-100 text-blue-900", acento: "bg-blue-500", abierto: false },
  nota_debito: { etiqueta: "Nota de débito", pildora: "bg-amber-100 text-amber-900", acento: "bg-amber-400", abierto: false },
  ajuste: { etiqueta: "Ajuste", pildora: "bg-muted text-muted-foreground", acento: "bg-border", abierto: false },

  // Cobros. "Iniciado" es el abandono de checkout: se generó el link y nadie
  // volvió. Se distingue del rechazo porque no hay nada que resolver.
  iniciado: { etiqueta: "Sin pagar", pildora: "bg-muted text-muted-foreground", acento: "bg-border", abierto: false },
  en_revision: { etiqueta: "A verificar", pildora: "bg-amber-100 text-amber-900", acento: "bg-amber-400", abierto: true },
  aprobado: { etiqueta: "Acreditado", pildora: "bg-green-100 text-green-900", acento: "bg-green-600", abierto: false },
  reintegrado: { etiqueta: "Reintegrado", pildora: "bg-blue-100 text-blue-900", acento: "bg-blue-500", abierto: false },
};

const PREDETERMINADO: Estilo = {
  etiqueta: "",
  pildora: "bg-muted text-muted-foreground",
  acento: "bg-border",
  abierto: false,
};

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
  const { etiqueta, pildora } = estiloDeEstado(estado);

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-sm font-medium ${pildora}`}
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
  const { acento } = estiloDeEstado(estado);

  return (
    <span
      className={`absolute inset-y-0 left-0 w-1 ${acento}`}
      aria-hidden="true"
    />
  );
}
