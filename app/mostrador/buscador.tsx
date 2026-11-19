"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, PenLine, Search, Scissors } from "lucide-react";
import { formatearPrecio } from "@/lib/formato";
import { enterDelBuscador } from "@/lib/mostrador/atajos";
import { cantidadDelRenglon, leerTipeo, type LineaDeVenta } from "@/lib/mostrador/importes";
import type { CopiaLista } from "@/lib/mostrador/offline/use-copia-local";
import type { ResultadoDeMostrador } from "@/lib/mostrador/tipos";
import { formatearCantidad } from "@/lib/unidades";
import {
  admiteMedia,
  descripcionConPresentacion,
  nombreDePresentacion,
  precioDeLinea,
  seVendePorM2,
  unidadDeLinea,
  type Presentacion,
  type ProductoQueSeVende,
} from "@/lib/ventas/forma-de-venta";
import { buscarEnMostrador } from "./actions";

export function Buscador({
  copia,
  branchId,
  customerId,
  listaDelCliente,
  onElegir,
  onSuelta,
  onCortar,
  onSinPrecio,
  sePuedeCortar,
  sinConexion,
}: {
  copia: CopiaLista;
  branchId: string;
  customerId: string | null;
  /** La lista de precios del cliente elegido, para buscar sin servidor. */
  listaDelCliente: string | null;
  /** Agrega la línea; con `yCobrar`, cobra apenas la línea está en la venta. */
  onElegir: (l: LineaDeVenta, yCobrar?: boolean) => void;
  /** Abre el alta a mano con el texto que ya se tipeó. */
  onSuelta: (descripcion: string) => void;
  /** Abre el corte a medida sobre esa placa. */
  onCortar: (placa: ResultadoDeMostrador) => void;
  /** Se quiso agregar algo sin precio: no entra. */
  onSinPrecio: (nombre: string) => void;
  /** Sin conexión, Ctrl+Enter sobre una placa no cobra. */
  sinConexion: boolean;
  /**
   * Si se puede cortar ahora.
   *
   * Sin conexión, no: la venta se encola y el trabajo del taller **no viaja en
   * la cola**. Cobrar un corte cuyo despiece nunca llega al aserradero es peor
   * que no poder venderlo, porque el cliente se va con el comprobante y vuelve
   * a buscar unas piezas que nadie cortó.
   */
  sePuedeCortar: boolean;
}) {
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState<
    Awaited<ReturnType<typeof buscarEnMostrador>>
  >([]);
  const [buscando, setBuscando] = useState(false);
  // El texto de la última búsqueda al servidor que terminó: «no hay nada» se
  // dice recién cuando se buscó ESE texto. Antes salía durante los 180 ms de
  // espera (con la lista vacía de antes) y un Enter en ese momento caía en
  // la búsqueda en curso y no hacía nada.
  const [buscado, setBuscado] = useState("");
  /** Cuál de los resultados está marcado. Se mueve con las flechas. */
  const [marcado, setMarcado] = useState(0);
  const campo = useRef<HTMLInputElement>(null);

  // El foco arranca acá y vuelve acá después de cada ítem: en el mostrador se
  // tipea sin mirar, y un cursor que se va obliga a soltar el teclado.
  useEffect(() => {
    campo.current?.focus();
  }, []);

  // La cantidad puede venir tipeada adelante: «3*pino» son tres tablas de pino.
  // La regla de cuándo eso es una cantidad y cuándo una medida está en
  // `leerTipeo`, con sus pruebas.
  const { cantidad, consulta, explicita } = leerTipeo(texto);

  // Espera corta: quien tipea rápido no dispara una consulta por tecla. Todo
  // el estado se toca adentro del temporizador y nada sincrónicamente en el
  // efecto, que es lo que dispara renders en cascada.
  /*
   * Con copia local la búsqueda **se deriva del render**, no de un efecto.
   *
   * Buscar en memoria sobre unos miles de filas tarda menos que un cuadro de
   * animación: meterlo en un efecto agregaría un render de más por tecla y la
   * regla de hooks lo prohíbe con razón. Sin copia —la primera vez, o un
   * navegador sin IndexedDB— se cae al servidor con la espera de siempre.
   */
  const hayCopia = copia.listo && copia.variantes > 0;

  const locales = useMemo(() => {
    if (!hayCopia || consulta.length < 2) return null;
    return copia.buscar(consulta, customerId, listaDelCliente);
  }, [consulta, hayCopia, copia, customerId, listaDelCliente]);

  useEffect(() => {
    if (hayCopia || consulta.length < 2) return;

    const t = setTimeout(async () => {
      setBuscando(true);
      // En un finally: si la búsqueda falla (se cortó la red, la sesión
      // venció), «buscando» quedaba prendido y el Enter dejaba de abrir la
      // carga a mano hasta recargar la página.
      try {
        setResultados(await buscarEnMostrador(consulta, branchId, customerId));
      } catch {
        setResultados([]);
      } finally {
        setBuscando(false);
        setBuscado(consulta);
      }
    }, 180);

    return () => clearTimeout(t);
  }, [consulta, branchId, customerId, hayCopia]);

  /*
   * Lo que se muestra se deriva del texto y no se guarda: así, al borrar el
   * campo la lista desaparece en el acto, sin esperar los 180 ms ni guardar un
   * estado que después hay que acordarse de limpiar.
   */
  const visibles = consulta.length < 2 ? [] : (locales ?? resultados);
  // Ya se sabe qué hay para este texto: con la copia local, al instante; sin
  // ella, cuando volvió la búsqueda de este mismo texto.
  const resuelto = consulta.length >= 2 && (hayCopia || (!buscando && buscado === consulta));

  // El marcado se acota al leerlo y no se corrige con un efecto: la lista
  // cambia con cada tecla y un `setState` adentro de un efecto por cada
  // pulsación es un render de más.
  const elegido = Math.min(marcado, Math.max(visibles.length - 1, 0));

  /**
   * Agrega el resultado, entero o como media placa.
   *
   * La media solo existe si el producto la admite: sobre un fenólico que se
   * vende entero, `Mayús + Enter` agrega la placa entera en vez de inventar
   * una presentación que el servidor después descartaría.
   */
  function elegir(r: (typeof resultados)[number], presentacion: Presentacion = null, yCobrar = false) {
    const producto = comoSeVende(r);
    const pres = presentacion && admiteMedia(producto) ? presentacion : null;
    const unidad = unidadDeLinea(producto);
    onElegir({
      variantId: r.variantId,
      descripcion: descripcionConPresentacion(`${r.producto} — ${r.medida}`, pres),
      unidad,
      // «2,5*bisagra» son tres bisagras: lo que se vende por unidad va entero.
      cantidad: cantidadDelRenglon({ variantId: r.variantId, unidad }, cantidad),
      precioUnitario: precioDeLinea(r.precio, producto, pres),
      precioLista: precioDeLinea(r.precio, producto, pres),
      presentacion: pres,
    }, yCobrar);
    setTexto("");
    setResultados([]);
    setMarcado(0);
    campo.current?.focus();
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2.5 rounded-xl border border-linea bg-card px-4">
        <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
        <input
          ref={campo}
          data-foco="buscador"
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            setMarcado(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              if (visibles.length === 0) return;
              e.preventDefault();
              setMarcado((m) => {
                const tope = visibles.length - 1;
                const i = Math.min(m, tope);
                return e.key === "ArrowDown"
                  ? Math.min(i + 1, tope)
                  : Math.max(i - 1, 0);
              });
              return;
            }

            if (e.key === "Enter") {
              const r = visibles[elegido];
              // La regla entera, con sus pruebas, está en `enterDelBuscador`.
              const accion = enterDelBuscador({
                ctrl: e.ctrlKey || e.metaKey,
                shift: e.shiftKey,
                alt: e.altKey,
                texto,
                hayResultado: Boolean(r),
                seCorta: Boolean(r && sePuedeCortar && r.largoMm && r.anchoMm),
                resuelto,
                sinPrecio: Boolean(r && !(r.precio > 0)),
                esPlaca: r?.unidad === "placa",
                sinConexion,
              });
              // Vacío, la tecla sigue hasta los atajos de la pantalla (cobrar).
              if (accion.que === "soltar") return;
              // Con algo escrito es del buscador, haga lo que haga.
              e.preventDefault();

              if (accion.que === "cortar" && r) {
                /*
                 * Ctrl+Enter sobre una placa abre el corte a medida. Es el
                 * mismo botón «Cortar» de la lista, que hasta ahora era el
                 * único paso de la venta que obligaba al mouse.
                 */
                onCortar(r as ResultadoDeMostrador);
                setTexto("");
              } else if (accion.que === "sinPrecio" && r) {
                onSinPrecio(`${r.producto} — ${r.medida}`);
              } else if (accion.que === "agregar" && r) {
                elegir(r, accion.media, accion.yCobrar);
              } else if (accion.que === "aMano") {
                /*
                 * Enter sobre algo que no está en el catálogo abre la carga a
                 * mano con ese texto. En el mostrador se tipea "corte a
                 * medida" o "flete centro" y se espera que pase algo; que no
                 * pase nada obliga a buscar otro camino con alguien esperando
                 * enfrente.
                 */
                onSuelta(consulta);
                setTexto("");
              }
              return;
            }
            if (e.key === "Escape") setTexto("");
          }}
          placeholder="Buscá por nombre, medida o código…"
          className="h-14 flex-1 bg-transparent text-lg outline-none placeholder:text-muted-foreground"
        />
        {/* Lo que se entendió del prefijo, mientras se tipea: sin esto, «3*»
            es un asterisco perdido en el medio de la búsqueda. */}
        {explicita && (
          <span className="shrink-0 rounded-lg bg-hundida px-2.5 py-1 text-base font-semibold">
            ×{cantidad}
          </span>
        )}
        {buscando && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {resuelto && visibles.length === 0 && (
        <div className="absolute inset-x-0 top-full z-20 mt-1.5 rounded-xl border border-linea bg-popover p-4 shadow-lg">
          <p className="text-base text-muted-foreground">
            No hay nada en el catálogo con «{consulta}».
          </p>
          <button
            onClick={() => {
              onSuelta(consulta);
              setTexto("");
            }}
            className="mt-2.5 inline-flex h-11 items-center gap-2 rounded-lg border border-linea px-4 text-base font-medium transition-colors hover:bg-hundida"
          >
            <PenLine className="h-4 w-4" />
            Cargarlo a mano
            <kbd className="rounded border border-linea px-1.5 py-0.5 text-xs text-muted-foreground">
              Enter
            </kbd>
          </button>
        </div>
      )}

      {visibles.length > 0 && (
        <ul className="absolute inset-x-0 top-full z-20 mt-1.5 max-h-[420px] overflow-y-auto rounded-xl border border-linea bg-popover shadow-lg">
          {visibles.map((r, i) => (
            <li
              key={r.variantId}
              className={`flex items-stretch ${i === elegido ? "bg-hundida" : ""}`}
            >
              <button
                // Sin precio no se agrega (decisión 4): no hay productos a $0.
                onClick={() => (r.precio > 0 ? elegir(r) : onSinPrecio(`${r.producto} — ${r.medida}`))}
                aria-disabled={!(r.precio > 0)}
                className={`flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-hundida ${
                  r.precio > 0 ? "" : "text-muted-foreground"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-medium">
                    {r.producto} — {r.medida}
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    {r.sku} · {r.stock > 0 ? `${formatearCantidad(r.stock)} en esta sucursal` : "sin stock acá"}
                  </span>
                </span>
                <span className="tabular shrink-0 text-right text-lg font-semibold">
                  {r.precio > 0 ? formatearPrecio(r.precio) : "sin precio"}
                  {seVendePorM2(comoSeVende(r)) && (
                    <span className="block text-sm font-normal text-muted-foreground">
                      el m²
                    </span>
                  )}
                </span>
                {i === elegido && (
                  <kbd className="shrink-0 rounded border border-linea px-1.5 py-0.5 text-xs text-muted-foreground">
                    Enter
                  </kbd>
                )}
              </button>

              {/* Media placa: dos botones y no un menú, porque el sentido
                  cambia qué piezas entran y se elige mirando la placa. Con
                  teclado, Mayús + Enter (al largo) y Alt + Enter (al ancho). */}
              {admiteMedia(comoSeVende(r)) && r.precio > 0 && (
                <span className="flex shrink-0 items-stretch border-l border-linea">
                  {(
                    [
                      ["media_largo", "Media a lo largo", "Mayús"],
                      ["media_ancho", "Media al ancho", "Alt"],
                    ] as const
                  ).map(([valor, texto, tecla]) => (
                    <button
                      key={valor}
                      onClick={() => elegir(r, valor)}
                      title={`${nombreDePresentacion(valor)} · ${formatearPrecio(
                        precioDeLinea(r.precio, comoSeVende(r), valor),
                      )}`}
                      className="flex flex-col items-center justify-center px-3 text-sm font-medium transition-colors hover:bg-hundida"
                    >
                      {texto}
                      <span className="tabular text-xs text-muted-foreground">
                        {formatearPrecio(precioDeLinea(r.precio, comoSeVende(r), valor))}
                      </span>
                      {i === elegido && (
                        <kbd className="mt-0.5 rounded border border-linea px-1 text-[11px] text-muted-foreground">
                          {tecla} + Enter
                        </kbd>
                      )}
                    </button>
                  ))}
                </span>
              )}

              {/* Cortar, solo para lo que tiene medida de placa cargada: un
                  tarugo no se corta, y sin las dos medidas no hay plano.
                  Sin conexión tampoco aparece: la copia local no guarda las
                  medidas de la placa, y un corte es un trabajo del taller que
                  necesita el catálogo. */}
              {sePuedeCortar && r.largoMm && r.anchoMm && (
                <button
                  onClick={() => {
                    onCortar(r as ResultadoDeMostrador);
                    setTexto("");
                  }}
                  className="flex shrink-0 items-center gap-1.5 border-l border-linea px-4 text-base font-medium text-acento-texto transition-colors hover:bg-hundida"
                >
                  <Scissors className="h-4 w-4" />
                  Cortar
                  {i === elegido && (
                    <kbd className="rounded border border-linea px-1.5 py-0.5 text-xs text-muted-foreground">
                      Ctrl + Enter
                    </kbd>
                  )}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


/** Lo que el buscador sabe de cómo se vende un resultado. */
export function comoSeVende(r: {
  unidad: string;
  formaDeVenta?: ProductoQueSeVende["formaDeVenta"];
  precioMediaPct?: number;
  largoMm?: number | null;
  anchoMm?: number | null;
}): ProductoQueSeVende {
  return {
    unit: r.unidad,
    formaDeVenta: r.formaDeVenta ?? "entera",
    precioMediaPct: r.precioMediaPct ?? 50,
    largoMm: r.largoMm,
    anchoMm: r.anchoMm,
  };
}
