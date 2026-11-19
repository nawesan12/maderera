"use client";

import { Suspense, use, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageCircle, Plus, RotateCcw, ShoppingCart, Trash2 } from "lucide-react";
import type { PlacaCortable } from "@/lib/dal/cortes-publico";
import type { PreciosDePlaca } from "@/lib/dal/visitante";
import { usePlanos, type PedidoDePlano } from "@/lib/cortes/en-vivo";
import { fraccionDePlaca, medidaDePlaca, nombreDeLaMitad, type MedidaDePlaca, type Mitad } from "@/lib/cortes/placa";
import { tirasDePlaca } from "@/lib/cortes/tiras";
import { leerEnlaceDeCorte } from "@/lib/cortes/enlace";
import {
  filasDelEnlace,
  filaVacia,
  grupoNuevo,
  leerBorrador,
  leerListaPegada,
  medidasDelBorrador,
  medidasSospechosas,
  nombreDelTapacanto,
  textoDelPedido,
  type Borrador,
  type Fila,
  type GrupoDelArmador,
  type PiezaDelPedido,
  type Tapacanto,
} from "@/lib/cortes/armador";
import type { PresupuestoDeCorte } from "@/lib/cortes/tipos";
import { PlanoSimple } from "@/components/cortes/plano-simple";
import { PreguntaMm } from "@/components/cortes/pregunta-mm";
import { contarCanto, SelectorDeCanto } from "@/components/cortes/selector-canto";
import { formatearMonto } from "@/lib/formato";
import { agregarCorteAlCarrito, guardarConsultaDeCorte } from "./actions";
import { useTienda } from "@/lib/tienda-context";
import { DONDE_SE_CORTA, HORARIO_CORTES, dondeSeCortaAlEmpezar } from "@/lib/sucursales";

/**
 * El despiece a medio cargar queda en el navegador: en la obra se corta la
 * señal o se cierra la pestaña, y perder veinte medidas es tener que volver a
 * medir.
 */
const BORRADOR = "mjbj:corte:borrador";

/** El valor del desplegable de tapacanto que abre el campo de texto. */
const OTRO_CANTO = "otro";

/** A dónde va el pedido por WhatsApp: cada sucursal con su número. */
export interface SucursalDelCorte {
  slug: string;
  nombre: string;
  whatsapp: string | null;
}

/** Lo que se calcula de cada grupo antes de pedirle el plano a Go. */
interface GrupoResuelto {
  grupo: GrupoDelArmador;
  placa: PlacaCortable | undefined;
  mitad: Mitad;
  medida: MedidaDePlaca;
  piezas: PiezaDelPedido[];
}

/**
 * El armador de cortes del sitio: la herramienta principal desde que salieron
 * las calculadoras (notas del 9/11/2026).
 *
 * - **Dos modos.** Piezas, como un despiece de mueble; o tiras por metro
 *   lineal, que se convierten en piezas del largo de la placa
 *   (`lib/cortes/tiras.ts`). El motor no distingue: le llegan piezas.
 * - **El canto se elige por lado** tocando el dibujo de la pieza, y se guarda
 *   como cuántos lados del largo y del ancho (`SelectorDeCanto`).
 * - **Varias placas en un pedido** (revisión de un carpintero, 18/11/2026):
 *   cada grupo con su placa, su tapacanto, su plano y su cuenta, y un solo
 *   WhatsApp con una sola consulta guardada. La lógica que no es pantalla
 *   está en `lib/cortes/armador.ts`.
 * - **Sin acomodo a mano.** De qué placa sale cada pieza lo decide el taller.
 * - **Enter agrega una medida**, igual que en el mostrador.
 *
 * Termina en WhatsApp: el corte se guarda (`/api/v1/cortes/consulta`) y el
 * mensaje lleva el enlace al plano, que quien atiende convierte en orden de
 * corte desde el panel. Con la tienda encendida, además, al carrito.
 */
export function VistaDeCorteDeQuienMira({
  precios,
  ...props
}: {
  placas: PlacaCortable[];
  tapacantos: Tapacanto[];
  anchoSierra: number;
  sucursales: SucursalDelCorte[];
  precios: Promise<PreciosDePlaca>;
}) {
  // El enlace manda la placa o el despiece: con otro hash, el armador se
  // rearma desde cero con lo que trae (la `key`).
  const hash = useHash();
  return (
    <Suspense fallback={<VistaDeCorte key={hash} {...props} hash={hash} propios={{}} />}>
      <VistaConPrecios key={hash} promesa={precios} {...props} hash={hash} />
    </Suspense>
  );
}

function VistaConPrecios({
  promesa,
  ...props
}: {
  placas: PlacaCortable[];
  tapacantos: Tapacanto[];
  anchoSierra: number;
  sucursales: SucursalDelCorte[];
  hash: string;
  promesa: Promise<PreciosDePlaca>;
}) {
  return <VistaDeCorte {...props} propios={use(promesa)} />;
}

/** Las piezas que manda un grupo: las filas cargadas, o las tiras ya pasadas a piezas. */
function piezasDelGrupo(g: GrupoDelArmador, largoDePlaca: number): PiezaDelPedido[] {
  if (g.modo === "tiras") {
    const t = tirasDePlaca(
      {
        anchoMm: Number(g.tiras.ancho) || 0,
        metros: Number(g.tiras.metros.replace(",", ".")) || 0,
        cantoLargo: contarCanto(g.tiras.lados).cantoLargo,
      },
      largoDePlaca,
    );
    return t ? [t] : [];
  }
  return g.filas
    .map((f) => ({
      largoMm: Math.round(Number(f.largo) || 0),
      anchoMm: Math.round(Number(f.ancho) || 0),
      cantidad: Math.round(Number(f.cantidad) || 0),
      respetaVeta: f.veta ? 1 : 0,
      ...contarCanto(f.lados),
      etiqueta: f.nombre.trim() || null,
    }))
    .filter((p) => p.largoMm > 0 && p.anchoMm > 0 && p.cantidad > 0);
}

const CUENTA_VACIA: PresupuestoDeCorte = {
  placasEnteras: 0,
  fraccion: 1,
  precioPorPlaca: 0,
  subtotalPlacas: 0,
  pasadasCobrables: 0,
  precioPorPasada: 0,
  subtotalCorte: 0,
  metrosCanto: 0,
  subtotalCanto: 0,
  total: 0,
  faltan: [],
};

function VistaDeCorte({
  placas: deLaPagina,
  tapacantos,
  anchoSierra,
  sucursales,
  hash,
  propios,
}: {
  placas: PlacaCortable[];
  tapacantos: Tapacanto[];
  anchoSierra: number;
  sucursales: SucursalDelCorte[];
  /** El hash del enlace: `#placa=` o `#piezas=…&material=…` (ver `lib/cortes/enlace.ts`). */
  hash: string;
  /** El precio propio de cada placa y de su corte. Vacío para el público. */
  propios: PreciosDePlaca;
}) {
  const router = useRouter();
  // Con la tienda apagada la API manda los precios en cero: el armador dibuja
  // y cuenta, pero no cobra.
  const { activa } = useTienda();

  const placas = useMemo(
    () =>
      deLaPagina.map((p) => {
        const propio = propios[p.variantId];
        return propio ? { ...p, ...propio } : p;
      }),
    [deLaPagina, propios],
  );
  // La placa y las piezas con que arranca: las del enlace («Pedila cortada»
  // de la ficha, o el despiece que armó el asistente) o la primera placa.
  const [delEnlace] = useState(() => leerEnlaceDeCorte(hash, placas));
  const [grupos, setGrupos] = useState<GrupoDelArmador[]>(() => [
    grupoNuevo(
      delEnlace.placa ?? placas[0]?.variantId ?? "",
      delEnlace.piezas.length > 0 ? filasDelEnlace(delEnlace.piezas) : undefined,
    ),
  ]);
  // El aserradero es donde está la seccionadora: es la que arranca elegida.
  const [sucursal, setSucursal] = useState(
    sucursales.find((s) => s.slug === DONDE_SE_CORTA.sucursal)?.slug ?? sucursales[0]?.slug ?? "",
  );
  const [aviso, setAviso] = useState<string | null>(null);
  const [guardando, empezar] = useTransition();

  const resueltos: GrupoResuelto[] = grupos.map((grupo) => {
    const placa = placas.find((p) => p.variantId === grupo.variantId) ?? placas[0];
    // La mitad vale solo sobre una placa que se vende partida.
    const mitad = placa?.admiteMedia ? grupo.mitad : null;
    const medida = medidaDePlaca({ varianteLargo: placa?.largoMm, varianteAncho: placa?.anchoMm, mitad, sierra: anchoSierra });
    return { grupo, placa, mitad, medida, piezas: piezasDelGrupo(grupo, medida.largo) };
  });

  // El plano y el precio de cada placa los calcula Go mientras se tipea (ver
  // `lib/cortes/en-vivo.ts`).
  const { planos, cuentas, calculando } = usePlanos(
    resueltos.map(
      ({ placa, mitad, medida, piezas }): PedidoDePlano => ({
        piezas,
        placaLargo: medida.largo,
        placaAncho: medida.ancho,
        anchoSierra,
        presupuesto: {
          tarifa: placa
            ? {
                material: placa.descripcion,
                priceListId: null,
                precioPorPasada: placa.precioPorPasada,
                precioPorMetroCanto: placa.precioPorMetroCanto,
              }
            : undefined,
          precioPorPlaca: placa?.precio ?? null,
          fraccion: fraccionDePlaca(mitad, placa?.precioMediaPct),
        },
      }),
    ),
  );
  const cuentaDe = (i: number) => cuentas[i] ?? CUENTA_VACIA;

  // Un grupo recién agregado y todavía vacío no frena el pedido: se manda lo
  // que tiene piezas.
  const listos = resueltos.map((r, i) => ({ ...r, i })).filter((r) => r.placa && r.piezas.length > 0);
  const sePuede = listos.length > 0 && listos.every((r) => planos[r.i]!.noEntran.length === 0) && !calculando;
  const destino = sucursales.find((s) => s.slug === sucursal);
  const varios = grupos.length > 1;

  function cambiarGrupo(i: number, cambio: Partial<GrupoDelArmador>) {
    setGrupos((previos) => previos.map((g, j) => (j === i ? { ...g, ...cambio } : g)));
  }

  function otraPlaca() {
    // Arranca con la placa que no se eligió todavía: el segundo grupo casi
    // nunca es de la misma.
    const usadas = new Set(grupos.map((g) => g.variantId));
    const libre = placas.find((p) => !usadas.has(p.variantId)) ?? placas[0];
    setGrupos((previos) => [...previos, grupoNuevo(libre?.variantId ?? "")]);
  }

  // Sin enlace que mande otra cosa, se ofrece retomar el último despiece.
  const crudoGuardado = useSyncExternalStore(
    () => () => {},
    () => {
      try {
        return localStorage.getItem(BORRADOR);
      } catch {
        return null;
      }
    },
    () => null,
  );
  const [retomado, setRetomado] = useState(false);
  const guardado = delEnlace.piezas.length === 0 && !retomado ? leerBorrador(crudoGuardado) : null;
  const hayCarga = grupos.some((g) => g.filas.some((f) => f.largo && f.ancho));

  useEffect(() => {
    if (!hayCarga) return;
    try {
      localStorage.setItem(BORRADOR, JSON.stringify({ grupos } satisfies Borrador));
    } catch {
      // Sin almacenamiento (modo privado) el armador anda igual.
    }
  }, [hayCarga, grupos]);

  function retomar(b: Borrador) {
    setGrupos(
      b.grupos.map((g) => ({
        ...g,
        variantId: placas.some((p) => p.variantId === g.variantId) ? g.variantId : (placas[0]?.variantId ?? ""),
      })),
    );
    setRetomado(true);
  }

  const pedidoDe = (r: GrupoResuelto) => ({
    variantId: r.placa!.variantId,
    mitad: r.mitad,
    cantoDescripcion: r.grupo.canto.trim() || null,
    piezas: r.piezas,
  });

  function comprar() {
    if (!sePuede) return;
    empezar(async () => {
      // Un corte del carrito es de una placa: va uno por grupo.
      for (const r of listos) {
        const res = await agregarCorteAlCarrito(pedidoDe(r));
        if (res.error) {
          setAviso(varios ? `Placa ${r.i + 1}: ${res.error}` : res.error);
          return;
        }
      }
      router.push("/carrito");
    });
  }

  function pedirPorWhatsapp() {
    if (!sePuede || !destino?.whatsapp) return;
    // La ventana se abre ya, dentro del clic: abierta después de esperar al
    // servidor, el navegador del teléfono la bloquea.
    const ventana = window.open("", "_blank");
    empezar(async () => {
      const r = await guardarConsultaDeCorte({ sucursal, grupos: listos.map(pedidoDe) });
      if (!r.token) {
        ventana?.close();
        setAviso(r.error ?? "No se pudo guardar el corte.");
        return;
      }
      const texto = textoDelPedido(
        listos.map((g) => ({ placa: g.placa!.descripcion, mitad: g.mitad, canto: g.grupo.canto, piezas: g.piezas })),
        `${window.location.origin}/corte/c/${r.token}`,
      );
      const url = `https://wa.me/${destino.whatsapp}?text=${encodeURIComponent(texto)}`;
      if (ventana) ventana.location.href = url;
      else window.location.href = url;
    });
  }

  /*
   * «¿Están en mm?» antes de mandar, si el lado más largo del despiece mide
   * menos de 300 (T4, hallazgo 22; la regla en `medidasSospechosas`). Una sola vez por armado: contestado que
   * sí, no se vuelve a preguntar. Las tiras no cuentan: su largo es el de la
   * placa.
   */
  const [mmConfirmado, setMmConfirmado] = useState(false);
  const [preguntaMm, setPreguntaMm] = useState<"whatsapp" | "carrito" | null>(null);
  const sospechosas = medidasSospechosas(grupos.filter((g) => g.modo === "piezas").flatMap((g) => g.filas));
  function antesPreguntar(que: "whatsapp" | "carrito") {
    if (!mmConfirmado && sospechosas) {
      setPreguntaMm(que);
      return;
    }
    if (que === "whatsapp") pedirPorWhatsapp();
    else comprar();
  }
  function contestarSi() {
    const que = preguntaMm;
    setMmConfirmado(true);
    setPreguntaMm(null);
    // Dentro del mismo toque: el WhatsApp abre su ventana en el clic.
    if (que === "whatsapp") pedirPorWhatsapp();
    else if (que === "carrito") comprar();
  }
  function corregir() {
    setPreguntaMm(null);
    setEnMovil("piezas");
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>("[data-largo]")?.focus());
  }

  const totales = resueltos.reduce(
    (t, _, i) => ({
      placas: t.placas + planos[i]!.placas.length,
      pasadas: t.pasadas + planos[i]!.pasadas,
      metros: t.metros + cuentaDe(i).metrosCanto,
      total: t.total + cuentaDe(i).total,
    }),
    { placas: 0, pasadas: 0, metros: 0, total: 0 },
  );

  // La placa que se está editando. Con una sola, siempre es esa.
  const [activo, setActivo] = useState(0);
  const iActivo = Math.min(activo, grupos.length - 1);
  // En el teléfono no entran las tres columnas: piezas o plano, de a uno.
  const [enMovil, setEnMovil] = useState<"piezas" | "plano">("piezas");

  function sacarPlaca(i: number) {
    setGrupos((previos) => previos.filter((_, j) => j !== i));
    setActivo((a) => (a >= i && a > 0 ? a - 1 : a));
  }

  function agregarPlaca() {
    otraPlaca();
    setActivo(grupos.length);
    setEnMovil("piezas");
  }

  const actual = resueltos[iActivo]!;
  const planoActual = planos[iActivo]!;
  const cuentaActual = cuentaDe(iActivo);

  const botonWhatsapp = (
    <button
      type="button"
      onClick={() => antesPreguntar("whatsapp")}
      disabled={!sePuede || guardando || !destino?.whatsapp}
      // Un <button> y no `BotonWhatsapp`: antes de abrir WhatsApp guarda el
      // corte. Se ve igual que todos (hallazgo 27): el mismo verde y el alto
      // de `tamano="grande"`.
      className="inline-flex h-[50px] shrink-0 items-center justify-center gap-2.5 rounded-[10px] bg-whatsapp-boton px-5 text-base font-semibold text-white transition-colors hover:bg-whatsapp-boton-hover disabled:opacity-50"
    >
      {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
      Pedir por WhatsApp
    </button>
  );

  return (
    <div data-sin-flotantes className="pb-28 lg:pb-0">
      {/* La barra del pedido entero: lo que suma todo y el botón para
          mandarlo, siempre a la vista. Antes estaba en una tarjeta al
          costado y, con varias placas, quedaba lejos de lo que se cargaba. */}
      <header className="superficie flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl px-5 py-3.5">
        <div className="mr-auto">
          <h1 className="text-[24px] font-bold leading-tight tracking-[-0.02em]">Corte de placas a medida</h1>
          <p className="text-sm text-texto-2">{dondeSeCortaAlEmpezar()} · {HORARIO_CORTES}</p>
        </div>

        <dl className="hidden items-center gap-6 sm:flex">
          <Cifra valor={totales.placas} nombre={totales.placas === 1 ? "placa" : "placas"} />
          <Cifra valor={totales.pasadas} nombre={totales.pasadas === 1 ? "pasada" : "pasadas"} />
          <Cifra valor={Math.round(totales.metros * 100) / 100} nombre="m de canto" />
          {activa && totales.total > 0 && <Cifra valor={formatearMonto(totales.total)} nombre="total" />}
        </dl>

        {sucursales.length > 1 && (
          <div className="flex gap-1.5" role="group" aria-label="Sucursal">
            {sucursales.map((s) => (
              <Chip key={s.slug} activo={sucursal === s.slug} onClick={() => setSucursal(s.slug)}>
                {s.nombre}
              </Chip>
            ))}
          </div>
        )}

        {preguntaMm ? (
          <PreguntaMm className="hidden lg:flex" onSi={contestarSi} onCorregir={corregir} />
        ) : (
          <div className="hidden gap-2 lg:flex">
            {activa && (
              <button
                type="button"
                onClick={() => antesPreguntar("carrito")}
                disabled={!sePuede || guardando}
                aria-label="Agregarlo al carrito"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-[10px] bg-accion px-4 text-base font-semibold text-white transition-colors hover:bg-accion-hover disabled:opacity-50"
              >
                <ShoppingCart className="h-4 w-4" />
              </button>
            )}
            {botonWhatsapp}
          </div>
        )}
      </header>

      {aviso && (
        <p className="mt-3 rounded-lg bg-[#fdf1ea] px-3.5 py-2.5 text-[14.5px] text-[#8a3b12]">{aviso}</p>
      )}

      {guardado && !hayCarga && (
        <button
          type="button"
          onClick={() => retomar(guardado)}
          className="mt-3 inline-flex h-11 items-center gap-2 rounded-lg bg-naranja-claro px-4 text-[14.5px] font-semibold text-acento-sobre-claro"
        >
          <RotateCcw className="h-4 w-4" />
          Seguir con el corte anterior ({medidasDelBorrador(guardado)}{" "}
          {medidasDelBorrador(guardado) === 1 ? "medida" : "medidas"})
        </button>
      )}

      {/* El espacio de trabajo: las placas del pedido, la que se edita y su
          plano, las tres a la vista en una pantalla ancha. En el teléfono las
          placas pasan a pestañas y piezas y plano se alternan. */}
      <div className="mt-4 grid gap-4 lg:h-[calc(100dvh-230px)] lg:min-h-[560px] lg:grid-cols-[220px_minmax(0,1.5fr)_minmax(0,1fr)]">
        <nav aria-label="Placas del pedido" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:flex lg:flex-col lg:overflow-y-auto">
          {resueltos.map((r, i) => {
            const plano = planos[i]!;
            const cuantas = r.piezas.reduce((n, p) => n + p.cantidad, 0);
            const aprovechado =
              plano.placas.length > 0
                ? Math.round((plano.placas.reduce((n, h) => n + h.aprovechado, 0) / plano.placas.length) * 100)
                : null;
            const [material, ...resto] = (r.placa?.descripcion ?? "Placa").split(" — ");
            return (
              <button
                key={r.grupo.clave}
                type="button"
                onClick={() => setActivo(i)}
                aria-current={i === iActivo ? "true" : undefined}
                className={`min-w-0 rounded-xl px-4 py-3 text-left transition-colors ${
                  i === iActivo ? "bg-oscuro-marca text-white" : "superficie hover:bg-sitio-alt"
                }`}
              >
                <span className="block text-[15px] font-semibold leading-snug">{material}</span>
                <span className={`block text-[13px] ${i === iActivo ? "text-white/70" : "text-texto-2"}`}>
                  {resto.at(-1)}
                  {r.mitad ? " · media" : ""}
                </span>
                <span className={`tabular mt-1.5 block text-[13px] ${i === iActivo ? "text-white/85" : "text-texto-3"}`}>
                  {cuantas} {cuantas === 1 ? "pieza" : "piezas"}
                  {aprovechado !== null && ` · ${plano.placas.length} ${plano.placas.length === 1 ? "placa" : "placas"} · ${aprovechado}%`}
                  {plano.noEntran.length > 0 && " · no entra"}
                </span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={agregarPlaca}
            className="inline-flex min-w-0 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-linea px-4 py-3 text-[15px] font-semibold text-texto-2 transition-colors hover:bg-sitio-alt"
          >
            <Plus className="h-4 w-4" />
            Otra placa
          </button>
        </nav>

        <div className="flex gap-1.5 lg:hidden" role="group" aria-label="Qué ver">
          <Chip activo={enMovil === "piezas"} onClick={() => setEnMovil("piezas")} ancho>
            Piezas
          </Chip>
          <Chip activo={enMovil === "plano"} onClick={() => setEnMovil("plano")} ancho>
            Plano{planoActual.placas.length > 0 ? ` (${planoActual.placas.length})` : ""}
          </Chip>
        </div>

        <section className={`superficie flex min-h-0 flex-col rounded-2xl ${enMovil === "plano" ? "hidden lg:flex" : ""}`}>
          <EditorDeGrupo
            key={actual.grupo.clave}
            resuelto={actual}
            placas={placas}
            tapacantos={tapacantos}
            activa={activa}
            alCambiar={(cambio) => cambiarGrupo(iActivo, cambio)}
            alSacar={varios ? () => sacarPlaca(iActivo) : undefined}
          />
        </section>

        <section
          aria-label="Plano"
          className={`superficie min-h-0 overflow-y-auto rounded-2xl p-4 ${enMovil === "piezas" ? "hidden lg:block" : ""}`}
        >
          {planoActual.noEntran.length > 0 && (
            <p className="mb-3 rounded-lg bg-[#fdf1ea] px-3.5 py-2.5 text-[14.5px] text-[#8a3b12]">
              {planoActual.noEntran.length === 1
                ? "Una medida no entra en la placa"
                : `${planoActual.noEntran.length} medidas no entran en la placa`}
              : {planoActual.noEntran.map((p) => `${p.largoMm} × ${p.anchoMm} mm`).join(", ")}.
            </p>
          )}
          {planoActual.placas.length > 0 ? (
            <PlanoSimple plano={planoActual} unaColumna />
          ) : (
            <div className="flex h-full min-h-[220px] items-center justify-center rounded-xl bg-hundida">
              <span className="tabular text-texto-3">
                {actual.medida.largo} × {actual.medida.ancho} mm
              </span>
            </div>
          )}
          {activa && actual.piezas.length > 0 && (
            <dl className="mt-4 space-y-1.5 text-[14.5px]">
              {cuentaActual.placasEnteras > 0 && <Renglon que="Placas" cuanto={cuentaActual.subtotalPlacas} />}
              {cuentaActual.subtotalCorte > 0 && <Renglon que="Corte" cuanto={cuentaActual.subtotalCorte} />}
              {cuentaActual.subtotalCanto > 0 && <Renglon que="Tapacanto" cuanto={cuentaActual.subtotalCanto} />}
            </dl>
          )}
        </section>
      </div>

      {/* En el teléfono, la cuenta y el botón abajo y fijos: con el teclado
          abierto y veinte medidas, el botón quedaba al final de todo. */}
      <div className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-3 bg-card px-4 py-3 shadow-[0_-8px_24px_-12px_rgb(60_50_40_/_0.35)] lg:hidden">
        <p className="tabular mr-auto text-[14px] leading-tight text-texto-2">
          <strong className="text-base text-foreground">
            {totales.placas} {totales.placas === 1 ? "placa" : "placas"}
          </strong>
          <br />
          {activa && totales.total > 0
            ? formatearMonto(totales.total)
            : `${totales.pasadas} ${totales.pasadas === 1 ? "pasada" : "pasadas"}`}
        </p>
        {preguntaMm ? (
          <PreguntaMm onSi={contestarSi} onCorregir={corregir} />
        ) : (
          <>
            {/* Con la tienda encendida, el carrito también acá: arriba vive en
                la barra de pantalla ancha y en el teléfono desaparecía. */}
            {activa && (
              <button
                type="button"
                onClick={() => antesPreguntar("carrito")}
                disabled={!sePuede || guardando}
                aria-label="Agregarlo al carrito"
                className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-[10px] bg-accion text-white transition-colors hover:bg-accion-hover disabled:opacity-50"
              >
                <ShoppingCart className="h-5 w-5" />
              </button>
            )}
            {botonWhatsapp}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * La placa que se edita: material, media placa y tapacanto en una fila, y las
 * piezas como una planilla. En pantalla ancha cada pieza es un renglón con
 * los encabezados arriba una sola vez.
 */
function EditorDeGrupo({
  resuelto: { grupo, placa, mitad, medida, piezas },
  placas,
  tapacantos,
  activa,
  alCambiar,
  alSacar,
}: {
  resuelto: GrupoResuelto;
  placas: PlacaCortable[];
  tapacantos: Tapacanto[];
  activa: boolean;
  alCambiar: (cambio: Partial<GrupoDelArmador>) => void;
  alSacar?: () => void;
}) {
  const { filas, tiras, modo } = grupo;
  const lista = useRef<HTMLDivElement>(null);

  function actualizar<K extends keyof Fila>(i: number, campo: K, valor: Fila[K]) {
    alCambiar({ filas: filas.map((f, j) => (j === i ? { ...f, [campo]: valor } : f)) });
  }

  // Enter en el último renglón agrega otro y salta a su largo: se carga un
  // despiece entero sin tocar el mouse.
  function agregarFila() {
    alCambiar({ filas: [...filas, filaVacia()] });
    requestAnimationFrame(() => {
      const largos = lista.current?.querySelectorAll<HTMLInputElement>("[data-largo]");
      largos?.[largos.length - 1]?.focus();
    });
  }

  // Lo pegado reemplaza el renglón donde se pegó (y los vacíos de abajo).
  function pegarLista(i: number, e: React.ClipboardEvent) {
    const nuevas = leerListaPegada(e.clipboardData.getData("text"));
    if (!nuevas) return;
    e.preventDefault();
    alCambiar({ filas: [...filas.slice(0, i), ...nuevas, ...filas.slice(i + 1).filter((f) => f.largo || f.ancho)] });
  }

  // La planilla se arma según el ancho de su columna (`@container`), no el de
  // la pantalla: a 1024 px la columna del centro mide ~430 px y las columnas
  // fijas se salían de costado.
  const columnas = "@2xl:grid @2xl:grid-cols-[minmax(120px,1fr)_84px_84px_60px_92px_68px_36px] @2xl:items-center @2xl:gap-2";

  return (
    <>
      <div className="flex flex-wrap items-end gap-2 border-b border-linea-tenue p-4">
        <label className="block min-w-[240px] flex-1">
          <span className="sr-only">Placa</span>
          <select
            value={placa?.variantId ?? ""}
            onChange={(e) => alCambiar({ variantId: e.target.value })}
            className="h-11 w-full rounded-lg border border-linea bg-background px-3 text-base font-medium"
          >
            {placas.map((p) => (
              <option key={p.variantId} value={p.variantId}>
                {activa ? `${p.descripcion} — ${formatearMonto(p.precio)}` : p.descripcion}
              </option>
            ))}
          </select>
        </label>
        {placa?.admiteMedia && (
          <div className="flex gap-1.5" role="group" aria-label="Placa entera o media">
            {([null, "largo", "ancho"] as const).map((m) => (
              <Chip key={m ?? "entera"} activo={mitad === m} onClick={() => alCambiar({ mitad: m })}>
                {m === null ? "Entera" : m === "largo" ? "½ largo" : "½ ancho"}
              </Chip>
            ))}
          </div>
        )}
        {alSacar && (
          <button
            type="button"
            onClick={alSacar}
            aria-label="Sacar esta placa del pedido"
            className="flex h-11 w-11 items-center justify-center rounded-lg text-texto-3 transition-colors hover:bg-sitio-alt hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
        <div className="flex w-full flex-wrap items-end gap-2">
          <div className="flex gap-1.5" role="group" aria-label="Qué querés cortar">
            <Chip activo={modo === "piezas"} onClick={() => alCambiar({ modo: "piezas" })}>
              Piezas
            </Chip>
            <Chip activo={modo === "tiras"} onClick={() => alCambiar({ modo: "tiras" })}>
              Tiras
            </Chip>
          </div>
          <div className="min-w-[220px] flex-1">
            <ElegirTapacanto key={grupo.clave} grupo={grupo} tapacantos={tapacantos} alCambiar={alCambiar} />
          </div>
          <span className="tabular pb-3 text-sm text-texto-3">
            {nombreDeLaMitad(mitad)} · {medida.largo} × {medida.ancho} mm
          </span>
        </div>
      </div>

      {modo === "piezas" ? (
        <div ref={lista} className="@container min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pb-4">
          <div className={`sticky top-0 z-10 hidden bg-card py-2 text-[13px] font-semibold uppercase tracking-[0.04em] text-texto-3 ${columnas}`}>
            <span>Pieza</span>
            <span>Largo (mm)</span>
            <span>Ancho (mm)</span>
            <span>Cant.</span>
            <span className="text-center">Canto</span>
            <span className="text-center">Veta</span>
            <span />
          </div>
          <div className="divide-y divide-linea-tenue">
            {filas.map((f, i) => (
              <div
                key={i}
                className={`flex flex-wrap items-center gap-2 py-2.5 ${columnas}`}
                onPaste={(e) => pegarLista(i, e)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  // Enter sobre un botón (Veta, un lado del canto) hace lo del botón.
                  if ((e.target as HTMLElement).tagName !== "INPUT") return;
                  e.preventDefault();
                  if (i === filas.length - 1) agregarFila();
                }}
              >
                <label className="block w-full @2xl:w-auto">
                  <span className="sr-only">Pieza</span>
                  <input
                    type="text"
                    value={f.nombre}
                    onChange={(e) => actualizar(i, "nombre", e.target.value)}
                    placeholder="Lateral"
                    maxLength={40}
                    className="h-10 w-full rounded-lg border border-linea bg-background px-3 text-base"
                  />
                </label>
                <div className="grid w-full grid-cols-[1fr_1fr_72px] gap-2 @2xl:contents">
                  <Numero etiqueta="Largo (mm)" valor={f.largo} alCambiar={(v) => actualizar(i, "largo", v)} placeholder="1200" marca="largo" />
                  <Numero etiqueta="Ancho (mm)" valor={f.ancho} alCambiar={(v) => actualizar(i, "ancho", v)} placeholder="400" />
                  <Numero etiqueta="Cant." valor={f.cantidad} alCambiar={(v) => actualizar(i, "cantidad", v)} />
                </div>
                <div className="flex justify-center">
                  <SelectorDeCanto
                    chico
                    rotulo
                    largo={Number(f.largo) || 0}
                    ancho={Number(f.ancho) || 0}
                    lados={f.lados}
                    alCambiar={(lados) => actualizar(i, "lados", lados)}
                  />
                </div>
                <div className="flex justify-center">
                  <Chip activo={f.veta} onClick={() => actualizar(i, "veta", !f.veta)}>
                    Veta
                  </Chip>
                </div>
                <button
                  type="button"
                  onClick={() => alCambiar({ filas: filas.length === 1 ? [filaVacia()] : filas.filter((_, j) => j !== i) })}
                  aria-label={`Sacar la medida ${i + 1}`}
                  className="ml-auto flex h-10 w-10 items-center justify-center rounded-lg text-texto-3 transition-colors hover:bg-sitio-alt hover:text-destructive @2xl:ml-0"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={agregarFila}
            className="mt-2 inline-flex h-11 items-center gap-2 rounded-lg px-3 text-[14.5px] font-semibold text-acento-texto transition-colors hover:bg-sitio-alt"
          >
            <Plus className="h-4 w-4" />
            Otra medida
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
          <div className="grid min-w-[15rem] flex-1 grid-cols-2 gap-2">
            <Numero
              etiqueta="Ancho de la tira (mm)"
              valor={tiras.ancho}
              alCambiar={(v) => alCambiar({ tiras: { ...tiras, ancho: v } })}
              placeholder="80"
              visible
            />
            <Numero
              etiqueta="Metros en total"
              valor={tiras.metros}
              alCambiar={(v) => alCambiar({ tiras: { ...tiras, metros: v } })}
              placeholder="12"
              decimal
              visible
            />
          </div>
          <SelectorDeCanto
            largo={medida.largo}
            ancho={Number(tiras.ancho) || 80}
            soloLargos
            lados={{ ...tiras.lados, izquierda: false, derecha: false }}
            alCambiar={(lados) => alCambiar({ tiras: { ...tiras, lados: { ...lados, izquierda: false, derecha: false } } })}
          />
          {piezas[0] && (
            <p className="tabular w-full text-sm text-texto-2">
              {piezas[0].cantidad} tiras de {piezas[0].largoMm} × {piezas[0].anchoMm} mm
            </p>
          )}
        </div>
      )}
    </>
  );
}

/**
 * El tapacanto del grupo: los del catálogo en un desplegable, con su tipo y
 * su espesor, y «Otro» para escribirlo. Sin tapacantos cargados en el
 * catálogo queda el campo de texto de siempre.
 */
function ElegirTapacanto({
  grupo,
  tapacantos,
  alCambiar,
}: {
  grupo: GrupoDelArmador;
  tapacantos: Tapacanto[];
  alCambiar: (cambio: Partial<GrupoDelArmador>) => void;
}) {
  const elegido = tapacantos.find((t) => t.variantId === grupo.cantoId);
  // Texto escrito a mano (o un borrador viejo): queda en «Otro».
  const valor = elegido ? elegido.variantId : grupo.canto ? OTRO_CANTO : "";
  const [abierto, setAbierto] = useState(valor === OTRO_CANTO);
  const libre = (
    <input
      value={grupo.canto}
      onChange={(e) => alCambiar({ canto: e.target.value, cantoId: null })}
      placeholder="Tapacanto"
      aria-label={tapacantos.length > 0 ? "Otro tapacanto" : undefined}
      className="h-11 w-full rounded-lg border border-linea bg-background px-3 text-base"
    />
  );
  if (tapacantos.length === 0) {
    return (
      <label className="block">
        <span className="sr-only">Color del tapacanto</span>
        {libre}
      </label>
    );
  }
  const enOtro = (abierto || valor === OTRO_CANTO) && !elegido;
  return (
    <div>
      <label className="block">
        <span className="sr-only">Tapacanto</span>
        <select
          value={enOtro ? OTRO_CANTO : valor}
          onChange={(e) => {
            const v = e.target.value;
            const t = tapacantos.find((x) => x.variantId === v);
            setAbierto(v === OTRO_CANTO);
            alCambiar(t ? { canto: nombreDelTapacanto(t), cantoId: t.variantId } : { canto: "", cantoId: null });
          }}
          className="h-11 w-full rounded-lg border border-linea bg-background px-3 text-base"
        >
          <option value="">Tapacanto: sin elegir</option>
          {tapacantos.map((t) => (
            <option key={t.variantId} value={t.variantId}>
              {nombreDelTapacanto(t)}
            </option>
          ))}
          <option value={OTRO_CANTO}>Otro</option>
        </select>
      </label>
      {enOtro && <div className="mt-2">{libre}</div>}
    </div>
  );
}

/**
 * El hash de la dirección. En el servidor no hay hash, así que la primera
 * pintura es la de siempre y React la corrige al hidratar, sin aviso de
 * diferencia.
 */
function useHash(): string {
  return useSyncExternalStore(
    (avisar) => {
      window.addEventListener("hashchange", avisar);
      return () => window.removeEventListener("hashchange", avisar);
    },
    () => window.location.hash,
    () => "",
  );
}

function Chip({
  activo,
  onClick,
  ancho,
  children,
}: {
  activo: boolean;
  onClick: () => void;
  ancho?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={`h-11 rounded-lg px-3.5 text-[14.5px] font-medium transition-colors ${ancho ? "flex-1" : ""} ${
        activo ? "bg-accion text-white" : "border border-linea text-texto-2 hover:bg-sitio-alt"
      }`}
    >
      {children}
    </button>
  );
}

function Numero({
  etiqueta,
  valor,
  alCambiar,
  visible,
  placeholder,
  decimal,
  marca,
}: {
  etiqueta: string;
  valor: string;
  alCambiar: (v: string) => void;
  /** En la planilla la etiqueta va chica en el teléfono y en el encabezado en pantalla ancha. */
  visible?: boolean;
  placeholder?: string;
  decimal?: boolean;
  /** `largo`: el campo al que salta el foco al agregar un renglón. */
  marca?: "largo";
}) {
  return (
    <label className="block">
      <span className={visible ? "mb-1 block text-sm font-medium" : "mb-0.5 block text-xs text-texto-3 @2xl:sr-only"}>{etiqueta}</span>
      <input
        type={decimal ? "text" : "number"}
        inputMode={decimal ? "decimal" : "numeric"}
        min="1"
        value={valor}
        onChange={(e) => alCambiar(e.target.value)}
        placeholder={placeholder}
        data-largo={marca === "largo" ? "" : undefined}
        className="tabular h-10 w-full rounded-lg border border-linea bg-background px-3 text-base"
      />
    </label>
  );
}

function Cifra({ valor, nombre }: { valor: number | string; nombre: string }) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="mt-0.5 text-[13px] text-texto-2">{nombre}</dt>
      <dd className="tabular text-[22px] font-bold leading-none tracking-[-0.02em]">
        {typeof valor === "number" ? String(valor).replace(".", ",") : valor}
      </dd>
    </div>
  );
}

function Renglon({ que, cuanto }: { que: string; cuanto: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-texto-2">{que}</dt>
      <dd className="tabular font-medium">{formatearMonto(cuanto)}</dd>
    </div>
  );
}
