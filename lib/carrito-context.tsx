"use client";

import {
  createContext,
  useContext,
  useOptimistic,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  agregarAlCarrito,
  agregarVarios,
  cambiarCantidad,
  quitarDelCarrito,
  vaciarCarrito,
} from "@/app/(public)/carrito-actions";
import type { Carrito, ItemCarrito } from "@/lib/dal/carrito";

export interface ItemNuevo {
  variantId?: string;
  descripcion: string;
  unidad?: string;
  cantidad: number;
  origen?: string;
  notas?: string;
}

interface ContextoCarrito {
  items: ItemCarrito[];
  cantidadItems: number;
  subtotal: number;
  conPrecioDesactualizado: number;
  /** Cuánto se ahorra por los descuentos por volumen de la lista aplicada. */
  ahorroPorVolumen: number;
  /** Nombre de la lista, cuando no es la general. */
  listaDiferenciada: string | null;
  guardando: boolean;
  agregar: (item: ItemNuevo) => void;
  agregarLista: (items: ItemNuevo[]) => void;
  cambiar: (itemId: string, cantidad: number) => void;
  quitar: (itemId: string) => void;
  vaciar: () => void;
}

const Contexto = createContext<ContextoCarrito | undefined>(undefined);

/**
 * Presupuesto en curso.
 *
 * El estado vive en la base; acá solo se refleja. Los cambios se muestran al
 * instante con `useOptimistic` y después se confirman contra el servidor: con
 * una conexión lenta, un carrito que tarda un segundo en responder se siente
 * roto y la gente vuelve a tocar el botón.
 */
export function CarritoProvider({
  carrito,
  children,
}: {
  carrito: Carrito;
  children: ReactNode;
}) {
  const router = useRouter();
  const [guardando, startTransition] = useTransition();

  const [optimista, aplicar] = useOptimistic(
    carrito.items,
    (
      estado: ItemCarrito[],
      accion:
        | { tipo: "cantidad"; id: string; cantidad: number }
        | { tipo: "quitar"; id: string }
        | { tipo: "vaciar" },
    ) => {
      if (accion.tipo === "vaciar") return [];
      if (accion.tipo === "quitar")
        return estado.filter((i) => i.id !== accion.id);
      return estado.map((i) =>
        i.id === accion.id
          ? {
              ...i,
              cantidad: accion.cantidad,
              subtotal: (i.precioActual ?? i.precioUnitario ?? 0) * accion.cantidad,
            }
          : i,
      );
    },
  );

  function conAviso(
    ejecutar: () => Promise<{ ok?: string; error?: string }>,
    optimizar?: () => void,
  ) {
    startTransition(async () => {
      optimizar?.();
      const resultado = await ejecutar();
      if (resultado.error) toast.error(resultado.error);
      else if (resultado.ok) toast.success(resultado.ok);
      router.refresh();
    });
  }

  const valor: ContextoCarrito = {
    items: optimista,
    cantidadItems: optimista.length,
    subtotal: optimista.reduce((s, i) => s + i.subtotal, 0),
    conPrecioDesactualizado: carrito.conPrecioDesactualizado,
    // El ahorro y la lista no se recalculan del lado del cliente: el descuento
    // depende de escalas que solo conoce el servidor. Al cambiar una cantidad,
    // el `router.refresh()` trae el número correcto.
    ahorroPorVolumen: carrito.ahorroPorVolumen,
    listaDiferenciada: carrito.listaDiferenciada,
    guardando,
    agregar: (item) =>
      conAviso(() =>
        agregarAlCarrito({
          variantId: item.variantId,
          descripcion: item.descripcion,
          unidad: item.unidad ?? "unidad",
          cantidad: item.cantidad,
          origen: item.origen ?? "catalogo",
          notas: item.notas,
        }),
      ),
    agregarLista: (items) =>
      conAviso(() =>
        agregarVarios(
          items.map((i) => ({
            variantId: i.variantId,
            descripcion: i.descripcion,
            unidad: i.unidad ?? "unidad",
            cantidad: i.cantidad,
            origen: i.origen ?? "calculadora",
            notas: i.notas,
          })),
        ),
      ),
    cambiar: (itemId, cantidad) =>
      conAviso(
        () => cambiarCantidad(itemId, cantidad),
        () => aplicar({ tipo: "cantidad", id: itemId, cantidad }),
      ),
    quitar: (itemId) =>
      conAviso(
        () => quitarDelCarrito(itemId),
        () => aplicar({ tipo: "quitar", id: itemId }),
      ),
    vaciar: () =>
      conAviso(
        () => vaciarCarrito(),
        () => aplicar({ tipo: "vaciar" }),
      ),
  };

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useCarrito() {
  const contexto = useContext(Contexto);
  if (!contexto) {
    throw new Error("useCarrito tiene que usarse dentro de CarritoProvider");
  }
  return contexto;
}
