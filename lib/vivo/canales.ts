/**
 * Los canales del tiempo real y quién puede escuchar cada uno.
 *
 * Sin `server-only`: lo importan también los componentes que escuchan, para
 * nombrar los canales con el mismo tipo.
 */
export const CANALES = ["whatsapp", "taller", "pedidos", "precios"] as const;
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
};

export interface EventoEnVivo {
  canal: Canal;
  id?: string;
  numero?: string;
  estado?: string;
}

export function esEventoEnVivo(valor: unknown): valor is EventoEnVivo {
  return (
    typeof valor === "object" &&
    valor !== null &&
    CANALES.includes((valor as { canal?: Canal }).canal as Canal)
  );
}
