"use client";

import { Suspense, use, useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react";
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
  nombreDelTapacanto,
  textoDelPedido,
  type Borrador,
  type Fila,
  type GrupoDelArmador,
  type PiezaDelPedido,
  type Tapacanto,
} from "@/lib/cortes/armador";
import type { PlanoDeCorte, PresupuestoDeCorte } from "@/lib/cortes/tipos";
import { PlanoSimple } from "@/components/cortes/plano-simple";
import { contarCanto, SelectorDeCanto } from "@/components/cortes/selector-canto";
import { formatearMonto } from "@/lib/formato";
import { agregarCorteAlCarrito, guardarConsultaDeCorte } from "./actions";
import { useTienda } from "@/lib/tienda-context";

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
    sucursales.find((s) => s.slug === "aserradero")?.slug ?? sucursales[0]?.slug ?? "",
  );
  const [aviso, setAviso] = useState<string | null>(null);
  const [guardando, empezar] = useTransition();

  const resueltos: GrupoResuelto[] = grupos.map((grupo) => {
    const placa = placas.find((p) => p.variantId === grupo.variantId) ?? placas[0];
    // La mitad vale solo sobre una placa que se vende partida.
    const mitad = placa?.admiteMedia ? grupo.mitad : null;
    const medida = medidaDePlaca({ varianteLargo: placa?.largoMm, varianteAncho: placa?.anchoMm, mitad });
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

  const totales = resueltos.reduce(
    (t, _, i) => ({
      placas: t.placas + planos[i]!.placas.length,
      pasadas: t.pasadas + planos[i]!.pasadas,
      metros: t.metros + cuentaDe(i).metrosCanto,
      total: t.total + cuentaDe(i).total,
    }),
    { placas: 0, pasadas: 0, metros: 0, total: 0 },
  );

  return (
    <div data-sin-flotantes className="grid items-start gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-5">
        {guardado && !hayCarga && (
          <button
            type="button"
            onClick={() => retomar(guardado)}
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-naranja-claro px-4 text-[14.5px] font-semibold text-acento-sobre-claro"
          >
            <RotateCcw className="h-4 w-4" />
            Seguir con el corte anterior ({medidasDelBorrador(guardado)}{" "}
            {medidasDelBorrador(guardado) === 1 ? "medida" : "medidas"})
          </button>
        )}

        {resueltos.map((r, i) => (
          <GrupoDeCorte
            key={r.grupo.clave}
            numero={varios ? i + 1 : null}
            resuelto={r}
            plano={planos[i]!}
            placas={placas}
            tapacantos={tapacantos}
            activa={activa}
            alCambiar={(cambio) => cambiarGrupo(i, cambio)}
            alSacar={varios ? () => setGrupos((previos) => previos.filter((_, j) => j !== i)) : undefined}
          />
        ))}

        <button
          type="button"
          onClick={otraPlaca}
          className="inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-xl superficie text-base font-semibold transition-colors hover:bg-sitio-alt"
        >
          <Plus className="h-4 w-4" />
          Otra placa
        </button>
      </div>

      <aside className="space-y-3 lg:sticky lg:top-[92px]">
        <section className="rounded-xl superficie p-5">
          <dl className="grid grid-cols-3 gap-2 text-center">
            <Cifra valor={totales.placas} nombre={totales.placas === 1 ? "placa" : "placas"} />
            <Cifra valor={totales.pasadas} nombre={totales.pasadas === 1 ? "pasada" : "pasadas"} />
            <Cifra valor={Math.round(totales.metros * 100) / 100} nombre="m de canto" />
          </dl>

          {activa && listos.length > 0 && (
            <>
              {listos.map((r) => {
                const cuenta = cuentaDe(r.i);
                return (
                  <dl key={r.grupo.clave} className="mt-4 space-y-1.5 border-t border-linea pt-3 text-[14.5px]">
                    {varios && (
                      <div className="flex items-baseline justify-between gap-3">
                        <dt className="font-semibold">Placa {r.i + 1}</dt>
                        <dd className="tabular font-semibold">{formatearMonto(cuenta.total)}</dd>
                      </div>
                    )}
                    {cuenta.placasEnteras > 0 && <Renglon que="Placas" cuanto={cuenta.subtotalPlacas} />}
                    {cuenta.subtotalCorte > 0 && <Renglon que="Corte" cuanto={cuenta.subtotalCorte} />}
                    {cuenta.subtotalCanto > 0 && <Renglon que="Tapacanto" cuanto={cuenta.subtotalCanto} />}
                  </dl>
                );
              })}
              <div className="mt-3 flex items-baseline justify-between border-t border-linea pt-3">
                <span className="text-base font-semibold">Total</span>
                <span className="tabular text-2xl font-bold">{formatearMonto(totales.total)}</span>
              </div>
              {listos.some((r) => cuentaDe(r.i).placasEnteras > 0) && (
                <p className="mt-2 text-sm text-texto-2">
                  Más de media placa se vende entera y el corte va sin cargo.
                </p>
              )}
            </>
          )}

          {sucursales.length > 1 && (
            <div className="mt-5 flex gap-2" role="group" aria-label="Sucursal">
              {sucursales.map((s) => (
                <Chip key={s.slug} activo={sucursal === s.slug} onClick={() => setSucursal(s.slug)} ancho>
                  {s.nombre}
                </Chip>
              ))}
            </div>
          )}

          {aviso && (
            <p className="mt-3 rounded-lg bg-[#fdf1ea] px-3.5 py-2.5 text-[14.5px] text-[#8a3b12]">{aviso}</p>
          )}

          <button
            type="button"
            onClick={pedirPorWhatsapp}
            disabled={!sePuede || guardando || !destino?.whatsapp}
            className="mt-3 inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-[10px] bg-verde-whatsapp text-base font-semibold text-white transition-colors hover:bg-brand-green/90 disabled:opacity-50"
          >
            {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
            Pedir por WhatsApp
          </button>

          {activa && (
            <button
              type="button"
              onClick={comprar}
              disabled={!sePuede || guardando}
              className="mt-2 inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-[10px] bg-accion text-base font-semibold text-white transition-colors hover:bg-accion-hover disabled:opacity-50"
            >
              <ShoppingCart className="h-4 w-4" />
              Agregarlo al carrito
            </button>
          )}
        </section>
      </aside>
    </div>
  );
}

/** Una placa del pedido: la placa, sus piezas, su tapacanto y su plano. */
function GrupoDeCorte({
  numero,
  resuelto: { grupo, placa, mitad, medida, piezas },
  plano,
  placas,
  tapacantos,
  activa,
  alCambiar,
  alSacar,
}: {
  /** Con una sola placa no se numera. */
  numero: number | null;
  resuelto: GrupoResuelto;
  plano: PlanoDeCorte;
  placas: PlacaCortable[];
  tapacantos: Tapacanto[];
  activa: boolean;
  alCambiar: (cambio: Partial<GrupoDelArmador>) => void;
  alSacar?: () => void;
}) {
  const { filas, tiras, modo } = grupo;

  function actualizar<K extends keyof Fila>(i: number, campo: K, valor: Fila[K]) {
    alCambiar({ filas: filas.map((f, j) => (j === i ? { ...f, [campo]: valor } : f)) });
  }

  function agregarFila() {
    alCambiar({ filas: [...filas, filaVacia()] });
  }

  // Lo pegado reemplaza el renglón donde se pegó (y los vacíos de abajo).
  function pegarLista(i: number, e: React.ClipboardEvent) {
    const nuevas = leerListaPegada(e.clipboardData.getData("text"));
    if (!nuevas) return;
    e.preventDefault();
    alCambiar({ filas: [...filas.slice(0, i), ...nuevas, ...filas.slice(i + 1).filter((f) => f.largo || f.ancho)] });
  }

  return (
    <>
      <section className="rounded-xl superficie p-5">
        <div className="flex items-end gap-2">
          <label className="block flex-1">
            <span className="text-base font-semibold">{numero ? `Placa ${numero}` : "Placa"}</span>
            <select
              value={placa?.variantId ?? ""}
              onChange={(e) => alCambiar({ variantId: e.target.value })}
              className="mt-2 h-11 w-full rounded-lg border border-linea bg-background px-3 text-base"
            >
              {placas.map((p) => (
                <option key={p.variantId} value={p.variantId}>
                  {activa ? `${p.descripcion} — ${formatearMonto(p.precio)}` : p.descripcion}
                </option>
              ))}
            </select>
          </label>
          {alSacar && (
            <button
              type="button"
              onClick={alSacar}
              aria-label={`Sacar la placa ${numero}`}
              className="flex h-11 w-11 items-center justify-center rounded-lg text-texto-3 transition-colors hover:bg-sitio-alt hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>

        {placa?.admiteMedia && (
          <div className="mt-3 flex flex-wrap gap-2">
            {([null, "largo", "ancho"] as const).map((m) => (
              <Chip key={m ?? "entera"} activo={mitad === m} onClick={() => alCambiar({ mitad: m })}>
                {m === null ? "Placa entera" : m === "largo" ? "Media a lo largo" : "Media al ancho"}
              </Chip>
            ))}
          </div>
        )}

        <p className="tabular mt-3 text-sm text-texto-2">
          {nombreDeLaMitad(mitad)} · {medida.largo} × {medida.ancho} mm
        </p>
      </section>

      <section className="rounded-xl superficie p-5">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Qué querés cortar">
          <Chip activo={modo === "piezas"} onClick={() => alCambiar({ modo: "piezas" })}>
            Piezas
          </Chip>
          <Chip activo={modo === "tiras"} onClick={() => alCambiar({ modo: "tiras" })}>
            Tiras por metro
          </Chip>
        </div>

        {modo === "piezas" ? (
          <>
            <div className="mt-4 divide-y divide-linea-tenue">
              {filas.map((f, i) => (
                <div
                  key={i}
                  className="flex flex-wrap items-center gap-x-4 gap-y-3 py-3 first:pt-0"
                  onPaste={(e) => pegarLista(i, e)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    if (i === filas.length - 1) agregarFila();
                  }}
                >
                  <div className="grid min-w-[18rem] flex-1 grid-cols-[1fr_1fr_64px] gap-2 sm:grid-cols-[1.1fr_1fr_1fr_72px]">
                    <label className="col-span-3 block sm:col-span-1">
                      <span className={i > 0 ? "sr-only" : "mb-1 block text-sm font-medium"}>Pieza</span>
                      <input
                        type="text"
                        value={f.nombre}
                        onChange={(e) => actualizar(i, "nombre", e.target.value)}
                        placeholder="Lateral"
                        maxLength={40}
                        className="h-11 w-full rounded-lg border border-linea bg-background px-3 text-base"
                      />
                    </label>
                    <Numero etiqueta="Largo (mm)" valor={f.largo} alCambiar={(v) => actualizar(i, "largo", v)} oculta={i > 0} placeholder="1200" />
                    <Numero etiqueta="Ancho (mm)" valor={f.ancho} alCambiar={(v) => actualizar(i, "ancho", v)} oculta={i > 0} placeholder="400" />
                    <Numero etiqueta="Cant." valor={f.cantidad} alCambiar={(v) => actualizar(i, "cantidad", v)} oculta={i > 0} />
                  </div>

                  <SelectorDeCanto
                    largo={Number(f.largo) || 0}
                    ancho={Number(f.ancho) || 0}
                    lados={f.lados}
                    alCambiar={(lados) => actualizar(i, "lados", lados)}
                  />

                  <div className="flex items-center gap-1">
                    <Chip activo={f.veta} onClick={() => actualizar(i, "veta", !f.veta)}>
                      Veta
                    </Chip>
                    <button
                      type="button"
                      onClick={() => alCambiar({ filas: filas.length === 1 ? [filaVacia()] : filas.filter((_, j) => j !== i) })}
                      aria-label={`Sacar la medida ${i + 1}`}
                      className="flex h-11 w-11 items-center justify-center rounded-lg text-texto-3 transition-colors hover:bg-sitio-alt hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={agregarFila}
              className="mt-2 inline-flex h-11 items-center gap-2 rounded-lg border border-linea px-4 text-[14.5px] font-semibold transition-colors hover:bg-sitio-alt"
            >
              <Plus className="h-4 w-4" />
              Otra medida
            </button>
          </>
        ) : (
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
            <div className="grid min-w-[15rem] flex-1 grid-cols-2 gap-2">
              <Numero
                etiqueta="Ancho de la tira (mm)"
                valor={tiras.ancho}
                alCambiar={(v) => alCambiar({ tiras: { ...tiras, ancho: v } })}
                placeholder="80"
              />
              <Numero
                etiqueta="Metros en total"
                valor={tiras.metros}
                alCambiar={(v) => alCambiar({ tiras: { ...tiras, metros: v } })}
                placeholder="12"
                decimal
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

        <ElegirTapacanto grupo={grupo} tapacantos={tapacantos} alCambiar={alCambiar} />
      </section>

      {plano.noEntran.length > 0 && (
        <p className="rounded-lg border border-[#e7b3a0] bg-[#fdf1ea] px-4 py-3 text-base text-[#8a3b12]">
          {plano.noEntran.length === 1
            ? "Una medida no entra en la placa"
            : `${plano.noEntran.length} medidas no entran en la placa`}
          : {plano.noEntran.map((p) => `${p.largoMm} × ${p.anchoMm} mm`).join(", ")}.
        </p>
      )}

      {plano.placas.length > 0 && (
        <section className="rounded-xl superficie p-5">
          <PlanoSimple plano={plano} />
        </section>
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
      placeholder="Blanco, o el mismo de la placa"
      aria-label={tapacantos.length > 0 ? "Otro tapacanto" : undefined}
      className="mt-1 h-11 w-full rounded-lg border border-linea bg-background px-3 text-base"
    />
  );
  if (tapacantos.length === 0) {
    return (
      <label className="mt-5 block">
        <span className="text-sm font-medium">Color del tapacanto</span>
        {libre}
      </label>
    );
  }
  const enOtro = (abierto || valor === OTRO_CANTO) && !elegido;
  return (
    <div className="mt-5">
      <label className="block">
        <span className="text-sm font-medium">Tapacanto</span>
        <select
          value={enOtro ? OTRO_CANTO : valor}
          onChange={(e) => {
            const v = e.target.value;
            const t = tapacantos.find((x) => x.variantId === v);
            setAbierto(v === OTRO_CANTO);
            alCambiar(t ? { canto: nombreDelTapacanto(t), cantoId: t.variantId } : { canto: "", cantoId: null });
          }}
          className="mt-1 h-11 w-full rounded-lg border border-linea bg-background px-3 text-base"
        >
          <option value="">Sin elegir</option>
          {tapacantos.map((t) => (
            <option key={t.variantId} value={t.variantId}>
              {nombreDelTapacanto(t)}
            </option>
          ))}
          <option value={OTRO_CANTO}>Otro</option>
        </select>
      </label>
      {enOtro && libre}
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
  oculta,
  placeholder,
  decimal,
}: {
  etiqueta: string;
  valor: string;
  alCambiar: (v: string) => void;
  /** En los renglones de abajo la etiqueta queda solo para el lector de pantalla. */
  oculta?: boolean;
  placeholder?: string;
  decimal?: boolean;
}) {
  return (
    <label className="block">
      <span className={oculta ? "sr-only" : "mb-1 block text-sm font-medium"}>{etiqueta}</span>
      <input
        type={decimal ? "text" : "number"}
        inputMode={decimal ? "decimal" : "numeric"}
        min="1"
        value={valor}
        onChange={(e) => alCambiar(e.target.value)}
        placeholder={placeholder}
        className="tabular h-11 w-full rounded-lg border border-linea bg-background px-3 text-base"
      />
    </label>
  );
}

function Cifra({ valor, nombre }: { valor: number; nombre: string }) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="mt-1 text-sm text-texto-2">{nombre}</dt>
      <dd className="tabular text-[28px] font-bold leading-none tracking-[-0.02em]">
        {String(valor).replace(".", ",")}
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
