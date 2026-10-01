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
import { CARRITO_VACIO } from "@/lib/carrito-vacio";

export interface ItemNuevo {
  variantId?: string;
  descripcion: string;
  unidad?: string;
  cantidad: number;
  /** Media placa al largo o al ancho. */
  presentacion?: "media_largo" | "media_ancho" | null;
  origen?: string;
  notas?: string;
}

interface ContextoCarrito {
  items: ItemCarrito[];
  /**
   * Cuántos renglones tiene, **solo cuando la pantalla trae el carrito**
   * (`/carrito`, `/carrito/confirmar`). En el resto del sitio es null: el
   * contador del encabezado lo resuelve el servidor junto con el saludo
   * (`useEstado`), y el carrito no lo espera para no frenar la página.
   */
  cantidadItems: number | null;
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
  carrito: delServidor,
  children,
}: {
  /**
   * El presupuesto ya resuelto. Lo pasan las pantallas que lo muestran entero
   * —`/carrito`, `/carrito/confirmar`—, que son dinámicas de todas formas porque
   * eso es exactamente lo que tienen para mostrar.
   *
   * El resto del sitio no lo pasa: esas páginas se sirven del CDN, con el
   * mismo HTML para todo el mundo, así que arrancan con el presupuesto vacío y
   * el contador aparece cuando el navegador lo trae.
   */
  carrito?: Carrito;
  children: ReactNode;
}) {
  const router = useRouter();
  const [guardando, startTransition] = useTransition();

  const carrito: Carrito = delServidor ?? CARRITO_VACIO;

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

      // El refresco rearma también el layout, y con él el contador del
      // encabezado: lo vuelve a resolver el servidor con el carrito nuevo.
      router.refresh();
    });
  }

  const valor: ContextoCarrito = {
    items: optimista,
    // Cuando el presupuesto vino del servidor, el contador son los renglones
    // que se están mostrando —con el cambio optimista ya aplicado—. Si no, lo
    // dice el encabezado.
    cantidadItems: delServidor ? optimista.length : null,
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
          presentacion: item.presentacion ?? null,
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
