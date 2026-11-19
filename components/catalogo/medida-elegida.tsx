"use client";

import { createContext, useContext, useState } from "react";

/**
 * La medida que se eligió en la ficha, para la galería.
 *
 * El selector y la galería son hermanos en la página: cuando se elige otra
 * medida, la galería pasa a su foto (con «MDF» elegido se veía el canto del
 * aglomerado, revisión del 19/11). `null` hasta que se toca algo: la primera
 * foto ya es la de la primera medida.
 */
const Contexto = createContext<{ id: string | null; elegir: (id: string) => void } | null>(null);

export function MedidaElegida({ children }: { children: React.ReactNode }) {
  const [id, elegir] = useState<string | null>(null);
  return <Contexto.Provider value={{ id, elegir }}>{children}</Contexto.Provider>;
}

/** Fuera de una ficha (la vista rápida, el admin) no hay a quién avisar. */
export function useMedidaElegida() {
  return useContext(Contexto);
}
