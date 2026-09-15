"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { haySenal } from "@/lib/senal-navegador";
import type { VistaDePrecio } from "@/lib/precios/vista";

export interface PrecioPropio {
  desde: string | null;
  anterior: string | null;
  descuento: number | null;
}

interface Precios {
  /** Por slug de producto. Vacío para el público, que es casi todo el tráfico. */
  porSlug: Record<string, PrecioPropio>;
  /** Nombre de la lista, para poder decirlo en pantalla. */
  lista: string | null;
  /**
   * Con IVA o sin IVA. Null mientras no se sabe, y ahí manda lo que mandó el
   * servidor, que es «final»: lo que corresponde mostrarle al público.
   */
  vista: VistaDePrecio | null;
}

const NINGUNO: Precios = { porSlug: {}, lista: null, vista: null };

const Contexto = createContext<Precios>(NINGUNO);

/** Dónde se guarda la respuesta entre navegaciones de la misma pestaña. */
const CAJON = "mis-precios";

/**
 * El precio del profesional, traído por el navegador.
 *
 * **Por qué existe.** La portada y el catálogo se sirven estáticos, con un solo
 * HTML para todo el mundo y precio de público. Eso es lo que permite que no
 * toquen la base en cada visita. Pero un profesional aprobado tiene su propia
 * lista, y esconderle su precio sería romperle la razón por la que pidió la
 * cuenta. Entonces la página sale con el precio de público —que se ve al
 * instante, sin esqueletos— y esto lo reemplaza cuando llega el suyo.
 *
 * **Para quien no tiene cuenta esto no hace nada**: sin la cookie señal no sale
 * ni un pedido. Es el mismo criterio que `EstadoProvider`.
 *
 * La respuesta queda en `sessionStorage` para que al moverse por el catálogo no
 * se vuelva a pedir. No es una decisión de permisos —quién tiene qué lista lo
 * resuelve el servidor con la cookie, en `/api/mis-precios`— sino la respuesta
 * ya calculada de este visitante, guardada en su propia pestaña. Al cerrar
 * sesión la señal desaparece y esto se limpia con ella.
 */
/** Lo guardado en esta pestaña, o null si no hay nada utilizable. */
function leerGuardado(): Precios | null {
  try {
    const crudo = sessionStorage.getItem(CAJON);
    return crudo ? (JSON.parse(crudo) as Precios) : null;
  } catch {
    // Un JSON roto o el almacenamiento bloqueado: se pide de nuevo.
    return null;
  }
}

/** Guarda la respuesta, o la borra con `null`. */
function guardar(precios: Precios | null) {
  try {
    if (precios) sessionStorage.setItem(CAJON, JSON.stringify(precios));
    else sessionStorage.removeItem(CAJON);
  } catch {
    // Sin lugar donde guardarlo se vuelve a pedir en la próxima página.
  }
}

export function PreciosProvider({ children }: { children: ReactNode }) {
  const [precios, setPrecios] = useState<Precios>(NINGUNO);

  useEffect(() => {
    if (!haySenal()) {
      // Quedó una respuesta de una sesión anterior: se tira. Mostrar precios de
      // profesional a quien ya cerró sesión sería exactamente lo que todo este
      // módulo cuida.
      guardar(null);
      return;
    }

    let vigente = true;

    /*
     * Todo el camino va por promesa, incluida la lectura de lo guardado.
     *
     * No es un rodeo: la página se pinta primero con el precio de público —que
     * es lo que mandó el servidor— y recién después cambia. Poner el precio
     * propio de entrada, en el primer render, haría que el HTML del navegador
     * no coincida con el del servidor, que es el error de hidratación clásico.
     */
    Promise.resolve()
      .then((): Precios | Promise<Precios | null> => {
        const guardado = leerGuardado();
        if (guardado) return guardado;

        return fetch("/api/mis-precios")
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            if (!d) return null;
            const traido: Precios = {
              porSlug: d.precios ?? {},
              lista: d.lista ?? null,
              vista: d.vista ?? null,
            };
            guardar(traido);
            return traido;
          });
      })
      .then((nuevos) => {
        if (vigente && nuevos) setPrecios(nuevos);
      })
      .catch(() => {
        // Si falla, queda el precio de público. Es el lado seguro: de menos
        // nunca de más, y el presupuesto se arma igual con la lista real.
      });

    return () => {
      vigente = false;
    };
  }, []);

  return <Contexto.Provider value={precios}>{children}</Contexto.Provider>;
}

/**
 * El precio propio de un producto, si lo hay.
 *
 * Devuelve `null` para el público y para cualquier producto que la lista propia
 * no tenga cargado, y en los dos casos se muestra lo que vino del servidor.
 */
export function usePrecioPropio(slug: string): PrecioPropio | null {
  return useContext(Contexto).porSlug[slug] ?? null;
}

/** Con qué vista de IVA mira esta persona, si ya se sabe. */
export function useVistaPropia(): VistaDePrecio | null {
  return useContext(Contexto).vista;
}
