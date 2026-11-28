/**
 * Los canales del tiempo real y quién puede escuchar cada uno.
 *
 * Sin `server-only`: lo importan también los componentes que escuchan, para
 * nombrar los canales con el mismo tipo.
 */
export const CANALES = ["whatsapp", "taller", "pedidos", "precios", "ventas", "cobros"] as const;
export type Canal = (typeof CANALES)[number];

/**
 * La pantalla que da derecho a cada canal: quien no puede abrir la bandeja no
 * recibe ni el aviso de que entró un mensaje. Se resuelve con `puedeEntrar`,
 * la misma lista que usan el menú y las páginas.
 */
export const PANTALLA_DEL_CANAL: Record<Canal, string> = {
  whatsapp: "/admin/whatsapp",
  taller: "/admin/cortes",
  pedidos: "/admin/pedidos",
  precios: "/mostrador",
  // Se facturó, se cobró o un pedido cambió de estado (00363): lo escuchan
  // Facturación, Cobranzas y Pedidos. Go deja entrar a quien abre cualquiera
  // de las tres.
  ventas: "/admin/pedidos",
  // Los cobros en línea y por transferencia: Cobranzas se refresca sola
  // (M3S3-045).
  cobros: "/admin/pagos",
};

export interface EventoEnVivo {
  canal: Canal;
  id?: string;
  numero?: string;
  estado?: string;
  /** En «pedidos»: recién creado, y de dónde vino. */
  nuevo?: boolean;
  origen?: string;
}

export function esEventoEnVivo(valor: unknown): valor is EventoEnVivo {
  return (
    typeof valor === "object" &&
    valor !== null &&
    CANALES.includes((valor as { canal?: Canal }).canal as Canal)
  );
}
