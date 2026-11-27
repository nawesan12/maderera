"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, PenLine, Search, Scissors } from "lucide-react";
import { formatearPrecio } from "@/lib/formato";
import { enterDelBuscador } from "@/lib/mostrador/atajos";
import { leerTipeo, vaSinDecimales, type LineaDeVenta } from "@/lib/mostrador/importes";
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
import { buscarEnMostrador, presupuestoParaLaVenta } from "./actions";

/** «P-2026-0020», «p-2026-20» o «P2026-20»: el número de un presupuesto. */
const ES_PRESUPUESTO = /^\s*p-?\d{4}-\d{1,6}\s*$/i;

export function Buscador({
  copia,
  branchId,
  customerId,
  listaDelCliente,
  onElegir,
  onSuelta,
  onCortar,
  onNoEntra,
  onPresupuesto,
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
  /** Se quiso agregar algo que no entra así (sin precio, o con decimales lo que va entero). */
  onNoEntra: (texto: string) => void;
  /** Se tipeó el número de un presupuesto («P-2026-0020»): se trae a la venta. */
  onPresupuesto?: (numero: string) => void;
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

  /*
   * El número de un presupuesto se reconoce mientras se tipea y se dice qué
   * es, con su cliente y su total: decía «No hay nada en el catálogo…
   * Cargarlo a mano» y Enter lo traía igual (mes simulado, M2S2-134).
   */
  const esPresupuesto = Boolean(onPresupuesto) && !sinConexion && ES_PRESUPUESTO.test(texto);
  const [presupuesto, setPresupuesto] = useState<{ numero: string; cliente: string; total: number } | null>(null);
  useEffect(() => {
    if (!esPresupuesto) return;
    let vigente = true;
    const numero = texto.trim();
    const t = setTimeout(async () => {
      try {
        const r = await presupuestoParaLaVenta(numero);
        if (!vigente) return;
        setPresupuesto(
          "error" in r
            ? null
            : {
                numero: r.numero,
                cliente: r.contactoNombre,
                total: r.lineas.reduce((s, l) => s + Math.round(l.cantidad * l.precioUnitario * 100) / 100, 0),
              },
        );
      } catch {
        if (vigente) setPresupuesto(null);
      }
    }, 250);
    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [esPresupuesto, texto]);

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
  /** El aviso de lo que no tiene precio, con las dos salidas que hay. */
  function sinPrecio(r: (typeof resultados)[number]) {
    return `${r.producto} — ${r.medida} no tiene precio. Cargalo a mano o ponele precio en Precios.`;
  }

  function elegir(r: (typeof resultados)[number], presentacion: Presentacion = null, yCobrar = false) {
    const producto = comoSeVende(r);
    const pres = presentacion && admiteMedia(producto) ? presentacion : null;
    const unidad = unidadDeLinea(producto);
    // «2,5*bisagra» no se redondea a tres sin decir nada: no entra, y se
    // dice por qué (revisión del carril F).
    if (vaSinDecimales({ variantId: r.variantId, unidad }, cantidad)) {
      onNoEntra(`${r.producto} — ${r.medida} va sin decimales.`);
      return;
    }
    onElegir({
      variantId: r.variantId,
      descripcion: descripcionConPresentacion(`${r.producto} — ${r.medida}`, pres),
      unidad,
      cantidad,
      precioUnitario: precioDeLinea(r.precio, producto, pres),
      precioLista: precioDeLinea(r.precio, producto, pres),
      precioAnterior: r.precioAnterior ? precioDeLinea(r.precioAnterior, producto, pres) : null,
      presentacion: pres,
      // Lo disponible acá, para que el renglón diga «faltan» antes de cobrar
      // y no recién después (mes simulado, M2S3-050).
      disponible: r.stock,
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

            // El número de un presupuesto trae sus renglones y su cliente
            // (mes simulado: no había forma de cobrarlo desde acá).
            if (e.key === "Enter" && onPresupuesto && !sinConexion && ES_PRESUPUESTO.test(texto)) {
              e.preventDefault();
              onPresupuesto(texto.trim());
              setTexto("");
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
                onNoEntra(sinPrecio(r));
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

      {esPresupuesto && (
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            onPresupuesto?.(texto.trim());
            setTexto("");
          }}
          className="absolute inset-x-0 top-full z-20 mt-1.5 flex w-full items-center gap-3 rounded-xl border border-linea bg-popover px-4 py-3 text-left shadow-lg transition-colors hover:bg-hundida"
        >
          <span className="min-w-0 flex-1">
            <span className="codigo block text-base font-semibold">{presupuesto?.numero ?? texto.trim().toUpperCase()}</span>
            {presupuesto && <span className="block truncate text-sm text-muted-foreground">{presupuesto.cliente}</span>}
          </span>
          {presupuesto && <span className="tabular shrink-0 text-lg font-semibold">{formatearPrecio(presupuesto.total)}</span>}
          <kbd className="shrink-0 rounded border border-linea px-1.5 py-0.5 text-xs text-muted-foreground">Enter</kbd>
        </button>
      )}

      {!esPresupuesto && resuelto && visibles.length === 0 && (
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
            <FilaDeResultado
              key={r.variantId}
              r={r}
              elegido={i === elegido}
              sePuedeCortar={sePuedeCortar}
              onElegir={(media) => elegir(r, media)}
              onSinPrecio={() => onNoEntra(sinPrecio(r))}
              onCortar={() => {
                onCortar(r as ResultadoDeMostrador);
                setTexto("");
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}


/**
 * Un resultado del buscador: el nombre arriba y entero; la media placa y
 * «Cortar», abajo. Al lado, con las teclas del elegido, al nombre le quedaba
 * una letra por renglón («M…», «Me…») y se agregaba la medida equivocada sin
 * poder leerla (mes simulado, H017).
 */
function FilaDeResultado({
  r,
  elegido,
  sePuedeCortar,
  onElegir,
  onSinPrecio,
  onCortar,
}: {
  r: Parameters<typeof comoSeVende>[0] & {
    variantId: string;
    sku: string;
    producto: string;
    medida: string;
    precio: number;
    precioAnterior?: number | null;
    stock: number;
  };
  elegido: boolean;
  sePuedeCortar: boolean;
  onElegir: (media?: "media_largo" | "media_ancho") => void;
  onSinPrecio: () => void;
  onCortar: () => void;
}) {
  const media = admiteMedia(comoSeVende(r)) && r.precio > 0;
  const cortar = sePuedeCortar && Boolean(r.largoMm && r.anchoMm);
  return (
      <li className={elegido ? "bg-hundida" : ""}>
        <button
          // Sin precio no se agrega (decisión 4): no hay productos a $0.
          onClick={() => (r.precio > 0 ? onElegir() : onSinPrecio())}
          aria-disabled={!(r.precio > 0)}
          className={`flex w-full min-w-0 items-center gap-3 px-4 pt-3 text-left transition-colors hover:bg-hundida ${
            media || cortar ? "pb-1.5" : "pb-3"
          } ${r.precio > 0 ? "" : "text-muted-foreground"}`}
        >
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 break-words text-base font-medium">
              {r.producto} — {r.medida}
            </span>
            <span className="block text-sm text-muted-foreground">
              {r.sku} · {r.stock > 0 ? `${formatearCantidad(r.stock)} disponibles acá` : "sin stock acá"}
            </span>
          </span>
          <span className="tabular shrink-0 text-right text-lg font-semibold">
            {r.precioAnterior != null && r.precio > 0 && (
              <s className="block text-sm font-normal text-muted-foreground">{formatearPrecio(r.precioAnterior)}</s>
            )}
            <span className={r.precioAnterior != null && r.precio > 0 ? "text-rojo-oferta" : undefined}>
              {r.precio > 0 ? formatearPrecio(r.precio) : "sin precio"}
            </span>
            {seVendePorM2(comoSeVende(r)) && (
              <span className="block text-sm font-normal text-muted-foreground">
                el m²
              </span>
            )}
          </span>
          {elegido && (
            <kbd className="shrink-0 rounded border border-linea px-1.5 py-0.5 text-xs text-muted-foreground">
              Enter
            </kbd>
          )}
        </button>

        {(media || cortar) && (
          <span className="flex flex-wrap justify-end gap-1.5 px-4 pb-2.5">
            {/* Media placa: dos botones y no un menú, porque el sentido
                cambia qué piezas entran y se elige mirando la placa. Con
                teclado, Mayús + Enter (al largo) y Alt + Enter (al ancho). */}
            {media &&
              (
                [
                  ["media_largo", "Media a lo largo", "Mayús"],
                  ["media_ancho", "Media al ancho", "Alt"],
                ] as const
              ).map(([valor, texto, tecla]) => (
                <button
                  key={valor}
                  onClick={() => onElegir(valor)}
                  title={nombreDePresentacion(valor) ?? undefined}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-background px-2.5 text-sm font-medium shadow-[var(--sombra-hoja)] transition-colors hover:bg-hundida"
                >
                  {texto}
                  <span className="tabular text-muted-foreground">
                    {formatearPrecio(precioDeLinea(r.precio, comoSeVende(r), valor))}
                  </span>
                  {elegido && (
                    <kbd className="rounded border border-linea px-1 text-[11px] text-muted-foreground">{tecla} + Enter</kbd>
                  )}
                </button>
              ))}

            {/* Cortar, solo para lo que tiene medida de placa cargada: un
                tarugo no se corta, y sin las dos medidas no hay plano.
                Sin conexión tampoco aparece: un corte es un trabajo del
                taller que necesita el catálogo. */}
            {cortar && (
              <button
                onClick={onCortar}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-background px-2.5 text-sm font-medium text-acento-texto shadow-[var(--sombra-hoja)] transition-colors hover:bg-hundida"
              >
                <Scissors className="h-4 w-4" />
                Cortar
                {elegido && (
                  <kbd className="rounded border border-linea px-1 text-[11px] text-muted-foreground">Ctrl + Enter</kbd>
                )}
              </button>
            )}
          </span>
        )}
      </li>
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
