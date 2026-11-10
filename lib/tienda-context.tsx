"use client";

import { createContext, useContext, type ReactNode } from "react";
import { TIENDA_ENCENDIDA, type Tienda } from "@/lib/tienda";

const Contexto = createContext<Tienda>(TIENDA_ENCENDIDA);

/**
 * Los interruptores de la tienda para los componentes del navegador. Los pone
 * el layout público con los ajustes cacheados: cambiar uno en el panel
 * invalida esa caché y el sitio se rearma con el valor nuevo.
 */
export function TiendaProvider({ tienda, children }: { tienda: Tienda; children: ReactNode }) {
  return <Contexto.Provider value={tienda}>{children}</Contexto.Provider>;
}

export function useTienda(): Tienda {
  return useContext(Contexto);
}
