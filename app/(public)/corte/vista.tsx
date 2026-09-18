"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, ShoppingCart, Trash2 } from "lucide-react";
import type { PlacaCortable } from "@/lib/dal/cortes-publico";
import { calcularPlanoDeCorte } from "@/lib/cortes/plano";
import { presupuestarCorte } from "@/lib/cortes/presupuesto";
import {
  fraccionDePlaca,
  medidaDePlaca,
  nombreDeLaMitad,
  type Mitad,
} from "@/lib/cortes/placa";
import { PlanoSimple } from "@/components/cortes/plano-simple";
import { formatearMonto } from "@/lib/formato";
import { haySenal } from "@/lib/senal-navegador";
import { agregarCorteAlCarrito } from "./actions";

interface Fila {
  largo: string;
  ancho: string;
  cantidad: string;
  veta: boolean;
  canto: boolean;
}

const vacia = (): Fila => ({
  largo: "",
  ancho: "",
  cantidad: "1",
  veta: false,
  canto: false,
});

/**
 * El armador de cortes del sitio.
 *
 * Es la versión simplificada del alta del panel, y lo simplificado es a
 * propósito:
 *
 * - **Una sola casilla de tapacanto por medida**, no cuatro lados. Quien pide
 *   un corte desde el teléfono quiere decir "con canto" o "sin canto"; el
 *   detalle de qué lado lleva se acuerda en el mostrador. La casilla marca los
 *   dos lados del largo, que es el caso de una repisa o un estante.
 * - **Sin acomodo a mano.** De qué placa sale cada pieza lo decide el taller.
 * - **Enter agrega una medida**, igual que en el mostrador: un despiece son
 *   cinco o seis renglones seguidos y ir al botón con el mouse entre uno y otro
 *   es el rodeo que hace que se termine mandando por WhatsApp.
 *
 * El plano se rehace en el navegador con cada tecla —`lib/cortes/plano.ts` es
 * geometría pura— y el precio sale del mismo `presupuestarCorte` que usa el
 * panel. Al agregarlo al carrito, el servidor recalcula todo.
 */
/** Lo que devuelve `/api/mis-placas`: el precio propio de cada placa. */
type PreciosDePlaca = Record<
  string,
  { precio: number; precioPorPasada: number; precioPorMetroCanto: number }
>;

export function VistaDeCorte({
  placas: deLaPagina,
  anchoSierra,
}: {
  placas: PlacaCortable[];
  anchoSierra: number;
}) {
  const router = useRouter();

  /*
   * El precio del profesional, traído por el navegador.
   *
   * La pantalla llega con el precio de público —que es lo que permite servirla
   * de la caché en vez de armarla en cada visita— y esto lo reemplaza para
   * quien tiene lista propia: el precio de la placa y también las tarifas de
   * corte, que dependen de la lista igual que el material.
   *
   * **Para quien no tiene cuenta no hace nada**: sin la señal no sale ni un
   * pedido. Y lo que se cobra no sale de acá en ningún caso: al agregar el
   * corte al carrito el servidor vuelve a buscar la placa y a presupuestar con
   * la lista real.
   */
  const [propios, setPropios] = useState<PreciosDePlaca>({});

  useEffect(() => {
    if (!haySenal()) return;

    let vigente = true;

    fetch("/api/mis-placas")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (vigente && d?.placas) setPropios(d.placas as PreciosDePlaca);
      })
      .catch(() => {
        // Queda el precio de público, que es el lado seguro: de menos nunca de
        // más, y el carrito se arma igual con la lista real.
      });

    return () => {
      vigente = false;
    };
  }, []);

  const placas = useMemo(
    () =>
      deLaPagina.map((p) => {
        const propio = propios[p.variantId];
        return propio ? { ...p, ...propio } : p;
      }),
    [deLaPagina, propios],
  );
  const [variantId, setVariantId] = useState(placas[0]?.variantId ?? "");
  const [mitad, setMitad] = useState<Mitad>(null);
  const [canto, setCanto] = useState("");
  const [filas, setFilas] = useState<Fila[]>([vacia()]);
  const [aviso, setAviso] = useState<{ texto: string; mal: boolean } | null>(
    null,
  );
  const [guardando, empezar] = useTransition();

  const placa = placas.find((p) => p.variantId === variantId) ?? placas[0];

  const medida = medidaDePlaca({
    varianteLargo: placa?.largoMm,
    varianteAncho: placa?.anchoMm,
    mitad,
  });

  const piezas = useMemo(
    () =>
      filas
        .map((f) => ({
          largoMm: Math.round(Number(f.largo) || 0),
          anchoMm: Math.round(Number(f.ancho) || 0),
          cantidad: Math.round(Number(f.cantidad) || 0),
          respetaVeta: f.veta ? 1 : 0,
          // La casilla marca los dos lados del largo: es el canto que se ve en
          // un estante. El detalle fino se acuerda en el mostrador.
          cantoLargo: f.canto ? 2 : 0,
          cantoAncho: 0,
          etiqueta: null,
        }))
        .filter((p) => p.largoMm > 0 && p.anchoMm > 0 && p.cantidad > 0),
    [filas],
  );

  const plano = useMemo(
    () =>
      calcularPlanoDeCorte({
        piezas,
        placaLargo: medida.largo,
        placaAncho: medida.ancho,
        anchoSierra,
      }),
    [piezas, medida.largo, medida.ancho, anchoSierra],
  );

  const cuenta = useMemo(
    () =>
      presupuestarCorte({
        plano,
        tarifa: placa
          ? {
              material: placa.descripcion,
              priceListId: null,
              precioPorPasada: placa.precioPorPasada,
              precioPorMetroCanto: placa.precioPorMetroCanto,
            }
          : null,
        precioPorPlaca: placa?.precio ?? null,
        piezas,
        fraccion: fraccionDePlaca(mitad),
      }),
    [plano, placa, piezas, mitad],
  );

  const sePuede = piezas.length > 0 && plano.noEntran.length === 0;

  function actualizar(i: number, campo: keyof Fila, valor: string | boolean) {
    setFilas((previas) =>
      previas.map((f, j) => (j === i ? { ...f, [campo]: valor } : f)),
    );
  }

  function agregarFila() {
    setFilas((previas) => [...previas, vacia()]);
  }

  function comprar() {
    if (!placa || !sePuede) return;

    empezar(async () => {
      const r = await agregarCorteAlCarrito({
        variantId: placa.variantId,
        mitad,
        cantoDescripcion: canto.trim() || null,
        piezas,
      });

      if (r.error) {
        setAviso({ texto: r.error, mal: true });
        return;
      }

      // Al carrito, que es donde sigue la compra. El corte ya está guardado.
      router.push("/carrito");
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
      <div className="space-y-5">
        <section className="rounded-xl border border-linea bg-card p-5">
          <h2 className="text-base font-semibold">Qué placa</h2>

          <label className="mt-3 block">
            <span className="text-sm font-medium">Placa</span>
            <select
              value={variantId}
              onChange={(e) => setVariantId(e.target.value)}
              className="mt-1 h-11 w-full rounded-lg border border-linea bg-background px-3 text-base"
            >
              {placas.map((p) => (
                <option key={p.variantId} value={p.variantId}>
                  {p.descripcion} — {formatearMonto(p.precio)}
                </option>
              ))}
            </select>
          </label>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">De qué sale:</span>
            {([null, "largo", "ancho"] as const).map((m) => (
              <button
                key={m ?? "entera"}
                type="button"
                onClick={() => setMitad(m)}
                aria-pressed={mitad === m}
                className={`h-10 rounded-lg px-3 text-[14.5px] font-medium transition-colors ${
                  mitad === m
                    ? "bg-accion text-white"
                    : "border border-linea text-texto-2 hover:bg-sitio-alt"
                }`}
              >
                {m === null
                  ? "Placa entera"
                  : m === "largo"
                    ? "Media a lo largo"
                    : "Media al ancho"}
              </button>
            ))}
          </div>

          <p className="mt-2 text-sm text-texto-2">
            {nombreDeLaMitad(mitad)} de{" "}
            <span className="tabular">
              {medida.largo} × {medida.ancho} mm
            </span>
            . La sierra se lleva {anchoSierra} mm en cada corte, y eso ya está
            descontado en el dibujo.
          </p>

          {mitad && placa?.color && (
            <p className="mt-2 rounded-lg bg-naranja-claro px-3.5 py-2.5 text-[14.5px] text-acento-sobre-claro">
              Es una placa <strong>{placa.color}</strong>: el dibujo corre a lo
              largo. Partida al ancho, las dos mitades quedan con la veta
              cruzada.
            </p>
          )}
        </section>

        <section className="rounded-xl border border-linea bg-card p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">Las medidas</h2>
            <p className="text-sm text-texto-2">
              En milímetros. Enter agrega otra.
            </p>
          </div>

          <div className="mt-3 space-y-2.5">
            {filas.map((f, i) => (
              <div
                key={i}
                className="grid grid-cols-[1fr_1fr_72px_auto] items-end gap-2"
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  if (i === filas.length - 1) agregarFila();
                }}
              >
                <label className="block">
                  {i === 0 && (
                    <span className="mb-1 block text-sm font-medium">
                      Largo
                    </span>
                  )}
                  <input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    value={f.largo}
                    onChange={(e) => actualizar(i, "largo", e.target.value)}
                    placeholder="1200"
                    className="h-11 w-full rounded-lg border border-linea bg-background px-3 text-base"
                  />
                </label>

                <label className="block">
                  {i === 0 && (
                    <span className="mb-1 block text-sm font-medium">
                      Ancho
                    </span>
                  )}
                  <input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    value={f.ancho}
                    onChange={(e) => actualizar(i, "ancho", e.target.value)}
                    placeholder="400"
                    className="h-11 w-full rounded-lg border border-linea bg-background px-3 text-base"
                  />
                </label>

                <label className="block">
                  {i === 0 && (
                    <span className="mb-1 block text-sm font-medium">
                      Cant.
                    </span>
                  )}
                  <input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    value={f.cantidad}
                    onChange={(e) => actualizar(i, "cantidad", e.target.value)}
                    className="h-11 w-full rounded-lg border border-linea bg-background px-3 text-base"
                  />
                </label>

                <button
                  type="button"
                  onClick={() =>
                    setFilas((previas) =>
                      previas.length === 1
                        ? [vacia()]
                        : previas.filter((_, j) => j !== i),
                    )
                  }
                  aria-label={`Sacar la medida ${i + 1}`}
                  className="flex h-11 w-11 items-center justify-center rounded-lg text-texto-3 transition-colors hover:bg-sitio-alt hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>

                <div className="col-span-4 -mt-1 flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-[14.5px] text-texto-2">
                    <input
                      type="checkbox"
                      checked={f.veta}
                      onChange={(e) => actualizar(i, "veta", e.target.checked)}
                      className="h-4 w-4 accent-brand-orange"
                    />
                    Respeta la veta
                  </label>
                  <label className="flex items-center gap-2 text-[14.5px] text-texto-2">
                    <input
                      type="checkbox"
                      checked={f.canto}
                      onChange={(e) => actualizar(i, "canto", e.target.checked)}
                      className="h-4 w-4 accent-brand-orange"
                    />
                    Con tapacanto
                  </label>
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={agregarFila}
            className="mt-3 inline-flex h-11 items-center gap-2 rounded-lg border border-linea px-4 text-[14.5px] font-semibold transition-colors hover:bg-sitio-alt"
          >
            <Plus className="h-4 w-4" />
            Otra medida
          </button>

          <label className="mt-4 block">
            <span className="text-sm font-medium">
              Color del tapacanto (opcional)
            </span>
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
            :{" "}
            {plano.noEntran
              .map((p) => `${p.largoMm} × ${p.anchoMm} mm`)
              .join(", ")}
            . Revisalas, o probá con una placa más grande.
          </p>
        )}

        {plano.placas.length > 0 && (
          <section className="rounded-xl border border-linea bg-card p-5">
            <h2 className="text-base font-semibold">Cómo entra</h2>
            <p className="mt-0.5 text-sm text-texto-2">
              Las líneas naranjas son los cortes; el punteado, lo que sobra.
            </p>
            <div className="mt-3">
              <PlanoSimple plano={plano} />
            </div>
          </section>
        )}
      </div>

      {/* El precio, siempre a la vista: es lo que la persona vino a averiguar. */}
      <aside className="space-y-3 lg:sticky lg:top-[92px]">
        <section className="rounded-xl border border-linea bg-card p-5">
          <h2 className="text-base font-semibold">Tu corte</h2>

          {piezas.length === 0 ? (
            <p className="mt-2 text-base text-texto-2">
              Cargá la primera medida y vas a ver acá el precio y el dibujo.
            </p>
          ) : (
            <>
              <dl className="mt-3 space-y-1.5 text-[14.5px]">
                {cuenta.placasEnteras > 0 && (
                  <Renglon
                    que={`${cuenta.placasEnteras} ${
                      mitad
                        ? cuenta.placasEnteras === 1
                          ? "media placa"
                          : "medias placas"
                        : cuenta.placasEnteras === 1
                          ? "placa"
                          : "placas"
                    }`}
                    cuanto={cuenta.subtotalPlacas}
                  />
                )}
                {cuenta.subtotalCorte > 0 && (
                  <Renglon
                    que={`${cuenta.pasadasCobrables} ${
                      cuenta.pasadasCobrables === 1 ? "pasada" : "pasadas"
                    } de sierra`}
                    cuanto={cuenta.subtotalCorte}
                  />
                )}
                {cuenta.subtotalCanto > 0 && (
                  <Renglon
                    que={`${cuenta.metrosCanto
                      .toFixed(2)
                      .replace(".", ",")} m de tapacanto`}
                    cuanto={cuenta.subtotalCanto}
                  />
                )}
              </dl>

              <div className="mt-3 flex items-baseline justify-between border-t border-linea pt-3">
                <span className="text-base font-semibold">Total</span>
                <span className="tabular text-2xl font-bold">
                  {formatearMonto(cuenta.total)}
                </span>
              </div>

              {cuenta.placasEnteras > 0 && (
                <p className="mt-2 text-sm text-texto-2">
                  De {cuenta.placasEnteras === 1 ? "esta placa" : "estas placas"}{" "}
                  sale más de la mitad, así que se{" "}
                  {cuenta.placasEnteras === 1 ? "vende" : "venden"} entera
                  {cuenta.placasEnteras === 1 ? "" : "s"} y el corte va sin
                  cargo. El recorte te lo llevás vos.
                </p>
              )}

              {cuenta.faltan.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm text-texto-2">
                  {cuenta.faltan.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              )}
            </>
          )}

          {aviso && (
            <p
              className={`mt-3 rounded-lg px-3.5 py-2.5 text-[14.5px] ${
                aviso.mal
                  ? "bg-[#fdf1ea] text-[#8a3b12]"
                  : "bg-naranja-claro text-acento-sobre-claro"
              }`}
            >
              {aviso.texto}
            </p>
          )}

          <button
            type="button"
            onClick={comprar}
            disabled={!sePuede || guardando}
            className="mt-4 inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-[10px] bg-accion text-base font-semibold text-white transition-colors hover:bg-accion-hover disabled:opacity-50"
          >
            {guardando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ShoppingCart className="h-4 w-4" />
            )}
            Agregarlo al carrito
          </button>

          <p className="mt-2 text-sm text-texto-3">
            El precio se confirma al comprar. Si el despiece cambia el acomodo,
            el mostrador te avisa antes de cortar.
          </p>
        </section>
      </aside>
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
