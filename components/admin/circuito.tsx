"use client";

import { createContext, useContext } from "react";
import { etiquetaDeCircuito, etiquetasDelCircuito, rotuloDelCircuito, type NombreDelCircuito } from "@/lib/circuito";

/**
 * La palabra del circuito sin factura que eligió el admin
 * (`etiqueta_del_circuito`), para los componentes de cliente del panel. La
 * pone el layout del panel; sin proveedor vale la de arranque, «B».
 */
const Contexto = createContext<NombreDelCircuito>("b");

export function ProveedorDelCircuito({ nombre, children }: { nombre: NombreDelCircuito; children: React.ReactNode }) {
  return <Contexto.Provider value={nombre}>{children}</Contexto.Provider>;
}

/** El nombre elegido («b», «sin_factura» o «interno»). */
export function useNombreDelCircuito(): NombreDelCircuito {
  return useContext(Contexto);
}

/** Las etiquetas de los dos circuitos con la palabra elegida. */
export function useEtiquetasDelCircuito() {
  return etiquetasDelCircuito(useContext(Contexto));
}

/** El nombre de un circuito («Facturas», «B»…), para usar desde una pantalla de servidor. */
export function EtiquetaDeCircuito({ valor }: { valor: string }) {
  return <>{etiquetaDeCircuito(valor, etiquetasDelCircuito(useContext(Contexto)))}</>;
}

/** El chip o el título del circuito sin factura: «Circuito B», «Sin factura»… */
export function RotuloDelCircuito() {
  return <>{rotuloDelCircuito(useContext(Contexto))}</>;
}
