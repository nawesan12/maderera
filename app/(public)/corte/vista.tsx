"use client";

import { Suspense, use, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageCircle, Plus, ShoppingCart, Trash2 } from "lucide-react";
import type { PlacaCortable } from "@/lib/dal/cortes-publico";
import type { PreciosDePlaca } from "@/lib/dal/visitante";
import { usePlano } from "@/lib/cortes/en-vivo";
import { fraccionDePlaca, medidaDePlaca, nombreDeLaMitad, type Mitad } from "@/lib/cortes/placa";
import { tirasDePlaca } from "@/lib/cortes/tiras";
import { leerEnlaceDeCorte } from "@/lib/cortes/enlace";
import { PlanoSimple } from "@/components/cortes/plano-simple";
import { contarCanto, SelectorDeCanto, SIN_CANTO, type LadosConCanto } from "@/components/cortes/selector-canto";
import { formatearMonto } from "@/lib/formato";
import { agregarCorteAlCarrito, guardarConsultaDeCorte } from "./actions";
import { useTienda } from "@/lib/tienda-context";

interface Fila {
  largo: string;
  ancho: string;
  cantidad: string;
  veta: boolean;
  lados: LadosConCanto;
}

const vacia = (): Fila => ({ largo: "", ancho: "", cantidad: "1", veta: false, lados: SIN_CANTO });

/** A dónde va el pedido por WhatsApp: cada sucursal con su número. */
export interface SucursalDelCorte {
  slug: string;
  nombre: string;
  whatsapp: string | null;
}

type Pieza = {
  largoMm: number;
  anchoMm: number;
  cantidad: number;
  respetaVeta: number;
  cantoLargo: number;
  cantoAncho: number;
  etiqueta: string | null;
};

/**
 * El armador de cortes del sitio: la herramienta principal desde que salieron
 * las calculadoras (notas del 9/11/2026).
 *
 * - **Dos modos.** Piezas, como un despiece de mueble; o tiras por metro
 *   lineal, que se convierten en piezas del largo de la placa
 *   (`lib/cortes/tiras.ts`). El motor no distingue: le llegan piezas.
 * - **El canto se elige por lado** tocando el dibujo de la pieza, y se guarda
 *   como cuántos lados del largo y del ancho (`SelectorDeCanto`).
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
  anchoSierra: number;
  sucursales: SucursalDelCorte[];
  hash: string;
  promesa: Promise<PreciosDePlaca>;
}) {
  return <VistaDeCorte {...props} propios={use(promesa)} />;
}

function VistaDeCorte({
  placas: deLaPagina,
  anchoSierra,
  sucursales,
  hash,
  propios,
}: {
  placas: PlacaCortable[];
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
  const [elegida, setVariantId] = useState<string | null>(null);
  const variantId = elegida ?? delEnlace.placa ?? placas[0]?.variantId ?? "";
  const [mitadElegida, setMitad] = useState<Mitad>(null);
  const [canto, setCanto] = useState("");
  const [modo, setModo] = useState<"piezas" | "tiras">("piezas");
  const [filas, setFilas] = useState<Fila[]>(() =>
    delEnlace.piezas.length > 0
      ? delEnlace.piezas.map((p) => ({
          largo: String(p.largo),
          ancho: String(p.ancho),
          cantidad: String(p.cantidad),
          veta: false,
          lados: { arriba: p.cantoLargo >= 1, abajo: p.cantoLargo >= 2, izquierda: p.cantoAncho >= 1, derecha: p.cantoAncho >= 2 },
        }))
      : [vacia()],
  );
  const [tiras, setTiras] = useState({ ancho: "", metros: "", lados: SIN_CANTO });
  // El aserradero es donde está la seccionadora: es la que arranca elegida.
  const [sucursal, setSucursal] = useState(
    sucursales.find((s) => s.slug === "aserradero")?.slug ?? sucursales[0]?.slug ?? "",
  );
  const [aviso, setAviso] = useState<string | null>(null);
  const [guardando, empezar] = useTransition();

  const placa = placas.find((p) => p.variantId === variantId) ?? placas[0];
  // La mitad vale solo sobre una placa que se vende partida.
  const mitad = placa?.admiteMedia ? mitadElegida : null;

  const medida = medidaDePlaca({ varianteLargo: placa?.largoMm, varianteAncho: placa?.anchoMm, mitad });

  const piezas = useMemo((): Pieza[] => {
    if (modo === "tiras") {
      const t = tirasDePlaca(
        {
          anchoMm: Number(tiras.ancho) || 0,
          metros: Number(tiras.metros.replace(",", ".")) || 0,
          cantoLargo: contarCanto(tiras.lados).cantoLargo,
        },
        medida.largo,
      );
      return t ? [t] : [];
    }
    return filas
      .map((f) => ({
        largoMm: Math.round(Number(f.largo) || 0),
        anchoMm: Math.round(Number(f.ancho) || 0),
        cantidad: Math.round(Number(f.cantidad) || 0),
        respetaVeta: f.veta ? 1 : 0,
        ...contarCanto(f.lados),
        etiqueta: null,
      }))
      .filter((p) => p.largoMm > 0 && p.anchoMm > 0 && p.cantidad > 0);
  }, [modo, filas, tiras, medida.largo]);

  // El plano y el precio los calcula Go mientras se tipea (ver
  // `lib/cortes/en-vivo.ts`).
  const { plano, cuenta: calculada, calculando } = usePlano({
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
  });
  const cuenta = calculada ?? {
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

  const sePuede = piezas.length > 0 && plano.noEntran.length === 0 && !calculando;
  const destino = sucursales.find((s) => s.slug === sucursal);

  function actualizar<K extends keyof Fila>(i: number, campo: K, valor: Fila[K]) {
    setFilas((previas) => previas.map((f, j) => (j === i ? { ...f, [campo]: valor } : f)));
  }

  function agregarFila() {
    setFilas((previas) => [...previas, vacia()]);
  }

  const pedido = () => ({
    variantId: placa!.variantId,
    mitad,
    cantoDescripcion: canto.trim() || null,
    piezas,
  });

  function comprar() {
    if (!placa || !sePuede) return;
    empezar(async () => {
      const r = await agregarCorteAlCarrito(pedido());
      if (r.error) {
        setAviso(r.error);
        return;
      }
      router.push("/carrito");
    });
  }

  function pedirPorWhatsapp() {
    if (!placa || !sePuede || !destino?.whatsapp) return;
    // La ventana se abre ya, dentro del clic: abierta después de esperar al
    // servidor, el navegador del teléfono la bloquea.
    const ventana = window.open("", "_blank");
    empezar(async () => {
      const r = await guardarConsultaDeCorte({ ...pedido(), sucursal });
      if (!r.token) {
        ventana?.close();
        setAviso(r.error ?? "No se pudo guardar el corte.");
        return;
      }
      const url = enlaceDelPedido(destino.whatsapp!, placa.descripcion, mitad, canto, piezas, r.token);
      if (ventana) ventana.location.href = url;
      else window.location.href = url;
    });
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-5">
        <section className="rounded-xl border border-linea bg-card p-5">
          <label className="block">
            <span className="text-base font-semibold">Placa</span>
            <select
              value={variantId}
              onChange={(e) => setVariantId(e.target.value)}
              className="mt-2 h-11 w-full rounded-lg border border-linea bg-background px-3 text-base"
            >
              {placas.map((p) => (
                <option key={p.variantId} value={p.variantId}>
                  {activa ? `${p.descripcion} — ${formatearMonto(p.precio)}` : p.descripcion}
                </option>
              ))}
            </select>
          </label>

          {placa?.admiteMedia && (
            <div className="mt-3 flex flex-wrap gap-2">
              {([null, "largo", "ancho"] as const).map((m) => (
                <Chip key={m ?? "entera"} activo={mitad === m} onClick={() => setMitad(m)}>
                  {m === null ? "Placa entera" : m === "largo" ? "Media a lo largo" : "Media al ancho"}
                </Chip>
              ))}
            </div>
          )}

          <p className="tabular mt-3 text-sm text-texto-2">
            {nombreDeLaMitad(mitad)} · {medida.largo} × {medida.ancho} mm
          </p>
        </section>

        <section className="rounded-xl border border-linea bg-card p-5">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Qué querés cortar">
            <Chip activo={modo === "piezas"} onClick={() => setModo("piezas")}>
              Piezas
            </Chip>
            <Chip activo={modo === "tiras"} onClick={() => setModo("tiras")}>
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
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      if (i === filas.length - 1) agregarFila();
                    }}
                  >
                    <div className="grid min-w-[15rem] flex-1 grid-cols-[1fr_1fr_72px] gap-2">
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
                        onClick={() =>
                          setFilas((previas) =>
                            previas.length === 1 ? [vacia()] : previas.filter((_, j) => j !== i),
                          )
                        }
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
                  alCambiar={(v) => setTiras((t) => ({ ...t, ancho: v }))}
                  placeholder="80"
                />
                <Numero
                  etiqueta="Metros en total"
                  valor={tiras.metros}
                  alCambiar={(v) => setTiras((t) => ({ ...t, metros: v }))}
                  placeholder="12"
                  decimal
                />
              </div>
              <SelectorDeCanto
                largo={medida.largo}
                ancho={Number(tiras.ancho) || 80}
                soloLargos
                lados={{ ...tiras.lados, izquierda: false, derecha: false }}
                alCambiar={(lados) => setTiras((t) => ({ ...t, lados: { ...lados, izquierda: false, derecha: false } }))}
              />
              {piezas[0] && (
                <p className="tabular w-full text-sm text-texto-2">
                  {piezas[0].cantidad} tiras de {piezas[0].largoMm} × {piezas[0].anchoMm} mm
                </p>
              )}
            </div>
          )}

          <label className="mt-5 block">
            <span className="text-sm font-medium">Color del tapacanto</span>
            <input
              value={canto}
              onChange={(e) => setCanto(e.target.value)}
              placeholder="Blanco, o el mismo de la placa"
              className="mt-1 h-11 w-full rounded-lg border border-linea bg-background px-3 text-base"
            />
          </label>
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
          <section className="rounded-xl border border-linea bg-card p-5">
            <PlanoSimple plano={plano} />
          </section>
        )}
      </div>

      <aside className="space-y-3 lg:sticky lg:top-[92px]">
        <section className="rounded-xl border border-linea bg-card p-5">
          <dl className="grid grid-cols-3 gap-2 text-center">
            <Cifra valor={plano.placas.length} nombre={plano.placas.length === 1 ? "placa" : "placas"} />
            <Cifra valor={plano.pasadas} nombre={plano.pasadas === 1 ? "pasada" : "pasadas"} />
            <Cifra
              valor={Math.round(cuenta.metrosCanto * 100) / 100}
              nombre="m de canto"
            />
          </dl>

          {activa && piezas.length > 0 && (
            <>
              <dl className="mt-4 space-y-1.5 border-t border-linea pt-3 text-[14.5px]">
                {cuenta.placasEnteras > 0 && <Renglon que="Placas" cuanto={cuenta.subtotalPlacas} />}
                {cuenta.subtotalCorte > 0 && <Renglon que="Corte" cuanto={cuenta.subtotalCorte} />}
                {cuenta.subtotalCanto > 0 && <Renglon que="Tapacanto" cuanto={cuenta.subtotalCanto} />}
              </dl>
              <div className="mt-3 flex items-baseline justify-between border-t border-linea pt-3">
                <span className="text-base font-semibold">Total</span>
                <span className="tabular text-2xl font-bold">{formatearMonto(cuenta.total)}</span>
              </div>
              {cuenta.placasEnteras > 0 && (
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

/**
 * El pedido del corte, escrito para WhatsApp como lo anota quien atiende:
 * placa, medidas con su canto, y el enlace al plano.
 */
function enlaceDelPedido(
  whatsapp: string,
  placa: string,
  mitad: Mitad,
  canto: string,
  piezas: Pieza[],
  token: string,
): string {
  const lados = (p: Pieza) => {
    const partes = [
      p.cantoLargo ? `${p.cantoLargo} ${p.cantoLargo === 1 ? "largo" : "largos"}` : "",
      p.cantoAncho ? `${p.cantoAncho} ${p.cantoAncho === 1 ? "ancho" : "anchos"}` : "",
    ].filter(Boolean);
    return partes.length ? `, canto en ${partes.join(" y ")}` : "";
  };
  const texto = [
    "Hola! Quería pedir este corte:",
    `Placa: ${placa}${mitad ? ` (media, al ${mitad})` : ""}`,
    ...piezas.map(
      (p) => `• ${p.cantidad} de ${p.largoMm} × ${p.anchoMm} mm${p.respetaVeta ? ", con veta" : ""}${lados(p)}`,
    ),
    ...(canto.trim() ? [`Tapacanto: ${canto.trim()}`] : []),
    `${window.location.origin}/corte/c/${token}`,
  ].join("\n");
  return `https://wa.me/${whatsapp}?text=${encodeURIComponent(texto)}`;
}

function Renglon({ que, cuanto }: { que: string; cuanto: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-texto-2">{que}</dt>
      <dd className="tabular font-medium">{formatearMonto(cuanto)}</dd>
    </div>
  );
}
