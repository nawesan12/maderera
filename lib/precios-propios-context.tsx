"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { valorDeSenal } from "@/lib/senal-navegador";
import type { VistaDePrecio } from "@/lib/precios/vista";

export interface PrecioPropio {
  desde: string | null;
  anterior: string | null;
  descuento: number | null;
}

interface Precios {
  /** Por slug de producto. Vacío para el público, que es casi todo el tráfico. */
  porSlug: Record<string, PrecioPropio>;
  /**
   * Por id de variante: el precio de cada medida.
   *
   * Lo usa la ficha del producto, que muestra el precio de la medida elegida y
   * no el «desde» del listado. Sin esto la ficha tendría que preguntarle al
   * servidor quién mira, y volvería a armarse en cada visita.
   */
  porVariante: Record<string, string>;
  /** Nombre de la lista, para poder decirlo en pantalla. */
  lista: string | null;
  /**
   * Con IVA o sin IVA. Null mientras no se sabe, y ahí manda lo que mandó el
   * servidor, que es «final»: lo que corresponde mostrarle al público.
   */
  vista: VistaDePrecio | null;
  /**
   * Con qué señal se pidió esto.
   *
   * Es lo que permite notar que lo guardado quedó de **otra sesión**: el
   * profesional cierra sesión en la máquina del mostrador, entra el siguiente
   * en la misma pestaña, y sin esta marca se le mostraban los precios del
   * anterior como si fueran suyos.
   */
  senal?: string | null;
}

const NINGUNO: Precios = {
  porSlug: {},
  porVariante: {},
  lista: null,
  vista: null,
};

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
/**
 * Si lo que quedó guardado es de esta misma sesión.
 *
 * **Es la regla que cierra el agujero, y por eso está aparte y tiene test.**
 * Lo guardado por otra sesión no se corrige ni se aprovecha en parte: se
 * descarta entero y se vuelve a pedir. Sin señal guardada tampoco sirve —es de
 * antes de que la señal llevara valor— y lo que no se puede atribuir se tira.
 */
export function sirveLoGuardado(
  guardado: Pick<Precios, "senal"> | null,
  senal: string | null,
): boolean {
  if (!guardado || !senal) return false;
  return typeof guardado.senal === "string" && guardado.senal === senal;
}

/** Lo guardado en esta pestaña, si es de esta misma sesión. */
function leerGuardado(senal: string): Precios | null {
  try {
    const crudo = sessionStorage.getItem(CAJON);
    if (!crudo) return null;
    const guardado = JSON.parse(crudo) as Precios;
    if (!sirveLoGuardado(guardado, senal)) return null;
    // Lo guardado puede ser de una versión anterior del sitio, de antes de que
    // existiera el mapa por variante: se completa en vez de dejar un hueco.
    return { ...guardado, porVariante: guardado.porVariante ?? {} };
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

/** Si la respuesta que llegó es la que ya está puesta. */
function iguales(a: Precios, b: Precios) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Tira lo que esta pestaña guardó. Lo usa el botón de cerrar sesión. */
export function olvidarPreciosPropios() {
  guardar(null);
}

export function PreciosProvider({ children }: { children: ReactNode }) {
  const [precios, setPrecios] = useState<Precios>(NINGUNO);

  /*
   * La ruta entra como dependencia, por el mismo motivo que en
   * `EstadoProvider`: este provider vive en el layout y se monta una sola vez.
   *
   * Sin esto el efecto corría al entrar al sitio y nunca más, y lo que quedaba
   * mal era el caso que importa: alguien cierra sesión en otra pestaña —o se
   * le vence—, sigue navegando el catálogo, y sigue viendo su precio de gremio
   * en pantalla hasta recargar entera. La señal ya no está y el precio seguía
   * ahí.
   *
   * No agrega tráfico: al navegar se lee lo guardado en la pestaña, no se
   * vuelve a preguntar.
   */
  const ruta = usePathname();

  useEffect(() => {
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
        const senal = valorDeSenal();

        if (!senal) {
          // Quedó una respuesta de una sesión anterior: se tira, y la pantalla
          // vuelve al precio de público. Mostrar precios de profesional a quien
          // ya cerró sesión es exactamente lo que este módulo cuida.
          guardar(null);
          return NINGUNO;
        }

        const guardado = leerGuardado(senal);
        if (guardado) return guardado;

        return fetch("/api/mis-precios")
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            if (!d) return null;
            const traido: Precios = {
              porSlug: d.precios ?? {},
              porVariante: d.porVariante ?? {},
              lista: d.lista ?? null,
              vista: d.vista ?? null,
              senal,
            };
            guardar(traido);
            return traido;
          });
      })
      .then((nuevos) => {
        if (!vigente || !nuevos) return;
        // Al navegar vuelve a salir lo mismo de la pestaña. Sin comparar, cada
        // navegación entregaría un objeto nuevo y redibujaría cada precio de la
        // pantalla para dejarlo igual.
        setPrecios((antes) => (iguales(antes, nuevos) ? antes : nuevos));
      })
      .catch(() => {
        // Si falla, queda el precio de público. Es el lado seguro: de menos
        // nunca de más, y el presupuesto se arma igual con la lista real.
      });

    return () => {
      vigente = false;
    };
  }, [ruta]);

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

/**
 * Los precios propios por variante, para la ficha del producto.
 *
 * Devuelve el mapa entero y no un precio suelto porque quien lo usa —el
 * selector de medida— los necesita todos: el precio cambia al elegir otra
 * medida, y pedirlos de a uno obligaría a llamar un hook dentro de un bucle.
 */
export function usePreciosPorVariante(): Record<string, string> {
  return useContext(Contexto).porVariante;
}
