"use client";

import {
  Suspense,
  createContext,
  use,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { valorDeSenal } from "@/lib/senal-navegador";
import type { EstadoDelVisitante } from "@/lib/dal/visitante";

export type { EstadoDelVisitante };

/** Lo que se sabe de alguien sin nada: nadie adentro, carrito vacío. */
const NADIE: EstadoDelVisitante = { sesion: null, cantidadItems: 0, senal: null };

/** El aviso de que lo que dice el encabezado dejó de valer. */
const AVISO = "mjbj-estado-cambio";

interface Contexto {
  /** Lo que resolvió el servidor para este pedido. Sin resolver en el HTML armado. */
  promesa: Promise<EstadoDelVisitante>;
  /**
   * Lo que el navegador volvió a preguntar, si hizo falta, y para qué promesa.
   *
   * Lleva la promesa a la que corrige porque cuando el servidor manda una nueva
   * —un `router.refresh()`, una navegación que rearma el layout— esa es la
   * verdad y la corrección vieja tiene que dejar de pisarla.
   */
  corregido: { para: Promise<EstadoDelVisitante>; estado: EstadoDelVisitante } | null;
}

const Contexto = createContext<Contexto | null>(null);

/**
 * Qué hacer cuando la señal del navegador no es la que conoce el encabezado.
 *
 * **Es la regla que cierra el agujero de la máquina compartida, y por eso
 * está aparte y tiene test.** El profesional cierra sesión en la máquina del
 * mostrador, entra el siguiente en la misma pestaña, y el encabezado —que vive
 * en el layout y no se rearma al navegar— seguía diciendo el nombre anterior.
 * La señal cambia en cada inicio de sesión (`renovarSenal`), así que una señal
 * distinta es otra persona.
 *
 * - `nada`: la señal es la misma; lo que se sabe sigue valiendo.
 * - `olvidar`: ya no hay señal; no hay nada que preguntar, es alguien sin
 *   sesión ni carrito.
 * - `preguntar`: apareció una señal, o es otra: se vuelve a preguntar.
 */
export function queHacerConLaSenal(
  conocida: string | null,
  actual: string | null,
): "nada" | "olvidar" | "preguntar" {
  if (actual === conocida) return "nada";
  if (actual === null) return "olvidar";
  return "preguntar";
}

/**
 * Hace que el encabezado vuelva a preguntar.
 *
 * Lo llama el botón de cerrar sesión, y cualquier pantalla que cambie algo de
 * lo que dice el encabezado sin pasar por el servidor. El carrito no lo
 * necesita: después de cada cambio hace `router.refresh()`, que rearma el
 * layout y trae el contador nuevo del servidor.
 */
export function olvidarEstado() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AVISO));
  }
}

/**
 * Lo que el encabezado sabe de quien está mirando.
 *
 * Recibe la **promesa** del servidor y no el valor: el layout no la espera, así
 * que la página entera sigue saliendo armada, y solo los pedazos que la usan
 * —el saludo, el contador, el aviso al gremio— esperan, cada uno detrás de su
 * `<Suspense>`. Es el patrón que documenta Next para compartir datos del
 * pedido con componentes de cliente.
 */
export function EstadoProvider({
  estado,
  children,
}: {
  estado: Promise<EstadoDelVisitante>;
  children: ReactNode;
}) {
  const [corregido, setCorregido] = useState<Contexto["corregido"]>(null);

  return (
    <Contexto.Provider value={{ promesa: estado, corregido }}>
      {children}
      {/* La vigilancia usa la ruta, y en una ruta con parámetros eso es un
          dato del pedido: va en su propio límite para no frenar la página. */}
      <Suspense fallback={null}>
        <VigilanteDeSenal promesa={estado} corregido={corregido} corregir={setCorregido} />
      </Suspense>
    </Contexto.Provider>
  );
}

/**
 * Se fija, en cada navegación, si la señal del navegador sigue siendo la que
 * conoce el encabezado. Leer la cookie no cuesta un pedido: solo se pregunta
 * al servidor cuando cambió, que es rarísimo.
 */
function VigilanteDeSenal({
  promesa,
  corregido,
  corregir,
}: {
  promesa: Promise<EstadoDelVisitante>;
  corregido: Contexto["corregido"];
  corregir: (c: Contexto["corregido"]) => void;
}) {
  const delServidor = use(promesa);
  const vigente = corregido?.para === promesa ? corregido.estado : delServidor;
  const ruta = usePathname();
  const [vuelta, setVuelta] = useState(0);
  // Cuál fue el último aviso atendido: un aviso pide **una** pregunta, no que
  // se pregunte en cada navegación de ahí en adelante.
  const atendida = useRef(0);

  useEffect(() => {
    const volverAPreguntar = () => setVuelta((n) => n + 1);
    window.addEventListener(AVISO, volverAPreguntar);
    return () => window.removeEventListener(AVISO, volverAPreguntar);
  }, []);

  useEffect(() => {
    const actual = valorDeSenal();
    const avisaron = vuelta !== atendida.current;
    atendida.current = vuelta;
    const accion = avisaron ? "preguntar" : queHacerConLaSenal(vigente.senal, actual);
    if (accion === "nada") return;

    if (accion === "olvidar" || actual === null) {
      corregir({ para: promesa, estado: NADIE });
      return;
    }

    let enVigor = true;
    fetch("/api/estado")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!enVigor) return;
        corregir({
          para: promesa,
          estado: {
            sesion: d?.sesion ?? null,
            cantidadItems: d?.cantidadItems ?? 0,
            senal: actual,
          },
        });
      })
      .catch(() => {
        // Si falla, queda lo que se sabía. Lo peor que pasa es un nombre
        // viejo en el menú hasta la próxima carga; el acceso no se decide acá.
      });
    return () => {
      enVigor = false;
    };
  }, [ruta, vuelta, vigente.senal, promesa, corregir]);

  return null;
}

/**
 * Lo que se sabe de quien mira. **Suspende** hasta que el servidor lo resuelve,
 * así que quien lo use tiene que estar detrás de un `<Suspense>` cuyo respaldo
 * sea lo que corresponde mostrar mientras tanto.
 */
export function useEstado(): EstadoDelVisitante {
  const contexto = useContext(Contexto);
  if (!contexto) return NADIE;
  if (contexto.corregido?.para === contexto.promesa) return contexto.corregido.estado;
  return use(contexto.promesa);
}
