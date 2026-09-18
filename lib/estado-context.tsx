"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { haySenal, valorDeSenal } from "@/lib/senal-navegador";

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

/** Dónde se guarda la respuesta entre navegaciones de la misma pestaña. */
const CAJON = "mjbj-estado";

/** El aviso de que lo guardado dejó de valer. */
const AVISO = "mjbj-estado-cambio";

interface Guardado extends Estado {
  /**
   * Con qué señal se pidió esto.
   *
   * Es lo que permite notar que lo guardado quedó de **otra sesión**: alguien
   * cierra sesión en la máquina del mostrador, entra el siguiente en la misma
   * pestaña, y sin esta marca el encabezado le mostraría el nombre del
   * anterior. Mismo criterio que en `precios-propios-context.tsx`.
   */
  senal: string;
}

function leerGuardado(senal: string): Estado | null {
  try {
    const crudo = sessionStorage.getItem(CAJON);
    if (!crudo) return null;
    const guardado = JSON.parse(crudo) as Guardado;
    if (guardado.senal !== senal) return null;
    return { sesion: guardado.sesion, cantidadItems: guardado.cantidadItems };
  } catch {
    return null;
  }
}

function guardar(estado: Estado, senal: string) {
  try {
    sessionStorage.setItem(CAJON, JSON.stringify({ ...estado, senal }));
  } catch {
    // Sin lugar donde guardarlo se vuelve a pedir en la próxima pantalla.
  }
}

/**
 * Tira lo guardado y hace que el encabezado se vuelva a enterar.
 *
 * Lo llama el carrito después de cada cambio: el contador es parte de esta
 * respuesta, así que agregar o quitar algo la deja vieja. También lo llama el
 * botón de cerrar sesión.
 */
export function olvidarEstado() {
  try {
    sessionStorage.removeItem(CAJON);
  } catch {
    // Si no se puede borrar, el aviso igual fuerza a preguntar de nuevo.
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AVISO));
  }
}

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

  /*
   * La ruta entra como dependencia para que el contador se vuelva a pedir en
   * cada navegación.
   *
   * El provider vive en el layout, así que se monta una sola vez: sin esto, el
   * efecto corría al entrar al sitio y nunca más. Alguien que vaciaba el
   * presupuesto y seguía navegando veía el ícono del carrito con el número
   * viejo hasta recargar la página entera, y lo mismo pasaba cuando la sesión
   * vencía por detrás.
   *
   * No agrega tráfico para quien no tiene nada: sin la cookie señal —que es
   * casi todo el mundo— el efecto sale antes de pedir nada.
   */
  const ruta = usePathname();

  /*
   * Sube de a uno cuando algo invalida lo guardado —agregar al carrito, por
   * ejemplo— y con eso el efecto vuelve a correr y a preguntar.
   */
  const [vuelta, setVuelta] = useState(0);

  useEffect(() => {
    const volverAPreguntar = () => setVuelta((n) => n + 1);
    window.addEventListener(AVISO, volverAPreguntar);
    return () => window.removeEventListener(AVISO, volverAPreguntar);
  }, []);

  useEffect(() => {
    if (inicial) return;

    let vigente = true;

    /*
     * Por promesa y no derecho, para poder leer lo guardado sin romper la
     * hidratación: el primer render tiene que salir igual que el del servidor.
     *
     * **Lo guardado es lo que saca este pedido del camino.** El efecto depende
     * de la ruta para que el contador se actualice al navegar, y eso significa
     * que sin esto cada cambio de pantalla eran seis consultas a la base para
     * responder lo mismo. Ahora se pregunta una vez por pestaña, y de nuevo
     * solo cuando algo lo invalida.
     */
    Promise.resolve()
      .then((): Estado | Promise<Estado | null> | null => {
        // Sin señal no hay nada que traer, y preguntarlo sería justamente el
        // pedido que todo esto existe para evitar.
        const senal = valorDeSenal();
        if (!senal || !haySenal()) return null;

        const guardado = leerGuardado(senal);
        if (guardado) return guardado;

        return fetch("/api/estado")
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            const estado: Estado = {
              sesion: d?.sesion ?? null,
              cantidadItems: d?.cantidadItems ?? 0,
            };
            guardar(estado, senal);
            return estado;
          });
      })
      .then((estado) => {
        if (vigente && estado) setTraido(estado);
      })
      .catch(() => {
        // Si falla, el encabezado se queda como el de alguien sin sesión. No
        // hay nada que reintentar: lo peor que pasa es que el menú diga
        // "Ingresar" a alguien que ya entró, y el enlace lo lleva igual.
      });

    return () => {
      vigente = false;
    };
  }, [inicial, ruta, vuelta]);

  return (
    <Contexto.Provider value={inicial ?? traido ?? NADA}>
      {children}
    </Contexto.Provider>
  );
}

export function useEstado(): Estado {
  return useContext(Contexto);
}
