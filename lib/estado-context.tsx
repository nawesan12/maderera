"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { haySenal } from "@/lib/senal-navegador";

export interface SesionDelEncabezado {
  nombre: string;
  esStaff: boolean;
}

interface Estado {
  sesion: SesionDelEncabezado | null;
  cantidadItems: number;
}

/**
 * Lo que se muestra mientras no se sabe: nadie adentro, presupuesto en cero.
 * Es el lado seguro —de menos por un instante, nunca de más— y es también lo
 * que ve quien no tiene nada, que no llega a preguntar nunca.
 */
const NADA: Estado = { sesion: null, cantidadItems: 0 };

const Contexto = createContext<Estado>(NADA);

/**
 * Lo que el encabezado sabe de quien está mirando, traído desde el navegador.
 *
 * El sitio público se sirve del CDN: un solo HTML para todo el mundo, sin
 * nombre y sin contador. Esto es lo que lo completa después, y **una sola vez
 * por carga**: el nombre del menú y el número del carrito salen del mismo
 * pedido, porque son la misma pregunta.
 *
 * El pedido solo sale si la señal dice que hay algo (`lib/senal-navegador.ts`).
 * Para quien nunca se logueó ni agregó nada —casi todo el tráfico— esto no
 * hace absolutamente nada: cero pedidos, cero servidor.
 */
export function EstadoProvider({
  inicial,
  children,
}: {
  /**
   * Cuando la pantalla ya es dinámica y lo sabe —el panel, el presupuesto—, se
   * pasa resuelto y no se pregunta nada.
   */
  inicial?: Estado;
  children: ReactNode;
}) {
  const [traido, setTraido] = useState<Estado | null>(null);

  useEffect(() => {
    // Sin señal no hay nada que traer, y preguntarlo sería justamente el pedido
    // que todo esto existe para evitar.
    if (inicial || !haySenal()) return;

    let vigente = true;
    fetch("/api/estado")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!vigente) return;
        setTraido({
          sesion: d?.sesion ?? null,
          cantidadItems: d?.cantidadItems ?? 0,
        });
      })
      .catch(() => {
        // Si falla, el encabezado se queda como el de alguien sin sesión. No
        // hay nada que reintentar: lo peor que pasa es que el menú diga
        // "Ingresar" a alguien que ya entró, y el enlace lo lleva igual.
      });

    return () => {
      vigente = false;
    };
  }, [inicial]);

  return (
    <Contexto.Provider value={inicial ?? traido ?? NADA}>
      {children}
    </Contexto.Provider>
  );
}

export function useEstado(): Estado {
  return useContext(Contexto);
}
