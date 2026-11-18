"use client";

import { useMemo, useState } from "react";
import { Download, Loader2, Plus, Scissors, Trash2 } from "lucide-react";
import { contarCanto, SelectorDeCanto } from "@/components/cortes/selector-canto";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PlanoEditable } from "@/components/cortes/plano-editable";
import type { PiezaFijada } from "@/lib/cortes/tipos";
import { usePlano } from "@/lib/cortes/en-vivo";
import {
  fraccionDePlaca,
  medidaDePlaca,
  nombreDeLaMitad,
  type Mitad,
} from "@/lib/cortes/placa";
import { metrosDeTapacanto } from "@/lib/cortes/tarifa";
import { moneda } from "@/lib/formato";
import type { CorteDeMostrador } from "@/lib/mostrador/tipos";
import type { LineaDeVenta } from "@/lib/mostrador/importes";
import { presentacionDeMitad } from "@/lib/ventas/forma-de-venta";
import { formatearSierra, leerAnchoDeSierra } from "@/lib/cortes/sierra";

/**
 * Vender un corte desde el mostrador.
 *
 * Antes el corte se cobraba como un renglón escrito a mano —"corte a medida",
 * y un precio que alguien decía de memoria— y el trabajo se cargaba después, o
 * no se cargaba. Eran dos sistemas para la misma venta.
 *
 * Acá se carga el despiece, **se ve cómo entra en la placa**, y de ahí salen
 * solas las tres cosas: cuántas placas, si alguna se vende entera, y cuántas
 * pasadas se cobran. Al aceptar deja los renglones en la venta y el despiece
 * para que el trabajo nazca en la cola del taller cuando la venta se cobre.
 *
 * La regla que gobierna el precio está en `lib/cortes/plano.ts`: si de una
 * placa sale más de la mitad, se le vende la placa entera y el corte de esa
 * placa va sin cargo.
 */
interface PiezaCargada {
  largo: string;
  ancho: string;
  cantidad: string;
  veta: boolean;
  cantoLargo: number;
  cantoAncho: number;
  etiqueta: string;
}

const vacia = (): PiezaCargada => ({
  largo: "",
  ancho: "",
  cantidad: "1",
  veta: false,
  cantoLargo: 0,
  cantoAncho: 0,
  etiqueta: "",
});

export function CorteAMedida({
  placa,
  precioPorPasada,
  precioPorMetroCanto,
  anchoSierra: anchoSierraGeneral,
  cliente,
  onCerrar,
  onAgregar,
}: {
  /** La placa elegida del catálogo, con su medida y su precio para este cliente. */
  placa: {
    variantId: string;
    descripcion: string;
    unidad: string;
    precio: number;
    largoMm: number | null;
    anchoMm: number | null;
    /** Para avisar al partir: en una placa de color el dibujo tiene sentido. */
    color?: string | null;
    /** Si se vende partida, y a qué porcentaje de la entera. */
    formaDeVenta?: "entera" | "entera_o_media" | "metro_cuadrado";
    precioMediaPct?: number;
  };
  /** Lo que se lleva el disco por pasada, de /admin/calculadoras. */
  anchoSierra: number;
  precioPorPasada: number;
  precioPorMetroCanto: number;
  /** El nombre del cliente de la venta, para encabezar el PDF del plano. */
  cliente?: string | null;
  onCerrar: () => void;
  onAgregar: (lineas: LineaDeVenta[], corte: CorteDeMostrador) => void;
}) {
  const [piezas, setPiezas] = useState<PiezaCargada[]>([vacia()]);
  const [canto, setCanto] = useState("");
  const [fijadas, setFijadas] = useState<PiezaFijada[]>([]);

  /*
   * De qué sale el trabajo: placa entera o media, y en qué sentido partida.
   *
   * La maderera vende media placa y el mostrador es donde más se pide. El
   * sentido lo elige quien atiende: depende de la placa que haya y de cómo
   * corre el dibujo cuando es de color.
   */
  const [mitad, setMitad] = useState<Mitad>(null);

  /*
   * El disco de este trabajo. Arranca con el de la configuración y se puede
   * cambiar acá (nota del 30/9/2026): el plano, el precio y la hoja del taller
   * salen con este número, y el trabajo lo guarda.
   */
  const [sierraTexto, setSierraTexto] = useState(String(anchoSierraGeneral).replace(".", ","));
  const anchoSierra = leerAnchoDeSierra(sierraTexto) ?? anchoSierraGeneral;

  const medida = medidaDePlaca({
    varianteLargo: placa.largoMm,
    varianteAncho: placa.anchoMm,
    mitad,
  });
  const medidaSupuesta = medida.supuesta;
  const placaLargo = medida.largo;
  const placaAncho = medida.ancho;

  const validas = useMemo(
    () =>
      piezas
        .map((p) => ({
          largoMm: Number(p.largo) || 0,
          anchoMm: Number(p.ancho) || 0,
          cantidad: Number(p.cantidad) || 0,
          respetaVeta: p.veta ? 1 : 0,
          cantoLargo: p.cantoLargo,
          cantoAncho: p.cantoAncho,
          etiqueta: p.etiqueta.trim() || null,
        }))
        .filter((p) => p.largoMm > 0 && p.anchoMm > 0 && p.cantidad > 0),
    [piezas],
  );

  // El plano lo calcula Go mientras se tipea (ver `lib/cortes/en-vivo.ts`).
  const { plano, calculando } = usePlano({
    piezas: validas,
    placaLargo,
    placaAncho,
    anchoSierra,
    fijadas,
  });

  // La misma cuenta que la ficha del corte y la planilla del taller, que ya
  // está probada: no hay dos formas de medir un metro de tapacanto.
  const metrosCanto = useMemo(() => metrosDeTapacanto(validas), [validas]);

  // De media placa se cobra media placa: el plano ya trabaja sobre la medida
  // partida, así que lo único que cambia es el precio del material.
  const pctMedia = placa.precioMediaPct ?? 50;
  const subtotalPlacas = plano.placasEnteras * placa.precio * fraccionDePlaca(mitad, pctMedia);
  // Solo se ofrece partir lo que se vende partido: un fenólico que se vende
  // entero no tiene media placa en ningún lado (nota de la clienta, 30/9/2026).
  const sePuedePartir = placa.formaDeVenta === "entera_o_media";
  const subtotalCorte = plano.pasadasCobrables * precioPorPasada;
  const subtotalCanto = Math.round(metrosCanto * precioPorMetroCanto * 100) / 100;
  const total = subtotalPlacas + subtotalCorte + subtotalCanto;

  const sePuede = validas.length > 0 && plano.noEntran.length === 0 && !calculando;

  /**
   * Suma una pieza y deja el cursor en su largo.
   *
   * Un despiece son cinco o seis medidas seguidas: tener que ir al botón con el
   * mouse entre una y otra es el rodeo que hace que el corte se termine
   * anotando en un papel.
   */
  function sumarPieza() {
    setPiezas((previas) => [...previas, vacia()]);
    requestAnimationFrame(() => {
      const campos = document.querySelectorAll<HTMLInputElement>(
        '[data-pieza="largo"]',
      );
      campos[campos.length - 1]?.focus();
    });
  }

  function cambiar(i: number, campo: keyof PiezaCargada, valor: string | boolean | number) {
    setPiezas((previas) =>
      previas.map((p, j) => (j === i ? { ...p, [campo]: valor } : p)),
    );
  }

  function aceptar() {
    if (!sePuede) return;

    const lineas: LineaDeVenta[] = [];

    /*
     * Las placas que se venden enteras van con su `variantId`: son material del
     * catálogo y tienen que descontar stock del estante. El corte y el
     * tapacanto van sin variante, que es lo que hace que no descuenten nada.
     */
    if (plano.placasEnteras > 0) {
      /*
       * Media placa se cobra al precio de la media y descuenta **media placa**
       * del estante: la otra mitad queda en el depósito y se puede vender
       * suelta. Hasta el 1/10/2026 salía una placa entera, porque el stock no
       * admitía decimales.
       */
      lineas.push({
        presentacion: presentacionDeMitad(mitad),
        variantId: placa.variantId,
        descripcion: mitad
          ? `${placa.descripcion} — ${nombreDeLaMitad(mitad).toLowerCase()}`
          : placa.descripcion,
        unidad: placa.unidad,
        cantidad: plano.placasEnteras,
        precioUnitario: placa.precio * fraccionDePlaca(mitad, pctMedia),
      });
    }

    if (plano.pasadasCobrables > 0 && precioPorPasada > 0) {
      lineas.push({
        variantId: null,
        descripcion: `Corte a medida — ${plano.pasadasCobrables} ${
          plano.pasadasCobrables === 1 ? "pasada" : "pasadas"
        }`,
        unidad: "pasada",
        cantidad: plano.pasadasCobrables,
        precioUnitario: precioPorPasada,
      });
    }

    if (metrosCanto > 0 && precioPorMetroCanto > 0) {
      lineas.push({
        variantId: null,
        descripcion: `Tapacanto pegado${canto.trim() ? ` — ${canto.trim()}` : ""}`,
        unidad: "m",
        cantidad: metrosCanto,
        precioUnitario: precioPorMetroCanto,
      });
    }

    onAgregar(lineas, {
      variantId: placa.variantId,
      materialDescripcion: placa.descripcion,
      cantoDescripcion: canto.trim() || null,
      placaLargoMm: placa.largoMm,
      placaAnchoMm: placa.anchoMm,
      mitad,
      placas: plano.placas.length,
      pasadas: plano.pasadasCobrables,
      acomodoManual: fijadas.length > 0 ? JSON.stringify(fijadas) : null,
      anchoSierraMm: anchoSierra,
      piezas: validas.map((p) => ({
        largoMm: p.largoMm,
        anchoMm: p.anchoMm,
        cantidad: p.cantidad,
        respetaVeta: p.respetaVeta,
        cantoLargo: p.cantoLargo,
        cantoAncho: p.cantoAncho,
        etiqueta: p.etiqueta,
        aclaracion: null,
      })),
    });
  }

  /*
   * El plano en PDF, en el momento y sin cobrar (pedido de Nahuel, 18/11):
   * para dárselo al cliente que lo está pensando o mandarlo al taller.
   */
  const [bajando, setBajando] = useState(false);
  const [errorPdf, setErrorPdf] = useState<string | null>(null);
  async function descargarPlano() {
    if (plano.placas.length === 0) return;
    setBajando(true);
    setErrorPdf(null);
    try {
      const r = await fetch("/api/mostrador/plano", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          material: placa.descripcion,
          canto: canto.trim() || null,
          deQueSale: nombreDeLaMitad(mitad),
          metrosCanto,
          cliente: cliente ?? null,
          placaLargo,
          placaAncho,
          anchoSierra,
          piezas: validas,
          fijadas,
        }),
      });
      if (!r.ok) throw new Error();
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = "plano-de-corte.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setErrorPdf("No se pudo armar el PDF.");
    } finally {
      setBajando(false);
    }
  }

  // Según el ancho de la columna (`@container`), no el de la pantalla.
  const columnas = "@2xl:grid @2xl:grid-cols-[minmax(110px,1fr)_84px_84px_64px_92px_64px_36px] @2xl:items-center @2xl:gap-2";

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && onCerrar()}>
      {/* A pantalla casi completa: es una mesa de trabajo, no un aviso. La
          placa y sus ajustes arriba, la planilla a la izquierda y el plano a
          la derecha, todo a la vista a la vez (antes, en un modal de 1100 px,
          el plano quedaba abajo de las medidas). `sm:max-w-*` porque el
          diálogo base trae `sm:max-w-md` y una clase sin prefijo no lo pisa. */}
      <DialogContent className="flex h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(1600px,96vw)]">
        <DialogHeader className="m-0 border-b border-linea px-6 pb-4 pt-5">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 pr-12">
            <DialogTitle className="flex items-center gap-2 text-xl font-bold tracking-tight">
              <Scissors className="h-5 w-5" />
              Corte a medida
            </DialogTitle>
            <span className="text-base">
              {placa.descripcion}
              <span className="tabular ml-2 text-muted-foreground">
                {placaLargo} × {placaAncho} mm{medidaSupuesta && " (supuesta)"}
              </span>
            </span>

            {sePuedePartir && (
              <div className="flex gap-1.5" role="group" aria-label="De qué sale">
                {([null, "largo", "ancho"] as const).map((m) => (
                  <button
                    key={m ?? "entera"}
                    type="button"
                    onClick={() => setMitad(m)}
                    aria-pressed={mitad === m}
                    className={`h-10 rounded-lg px-3 text-base font-medium transition-colors ${
                      mitad === m ? "boton-accion" : "border border-linea text-muted-foreground hover:bg-hundida"
                    }`}
                  >
                    {m === null ? "Placa entera" : m === "largo" ? "Media a lo largo" : "Media al ancho"}
                  </button>
                ))}
              </div>
            )}

            {/* Los milímetros del disco, dichos y editables: el plano, el
                precio y la hoja del taller salen con este número. */}
            <label className="flex items-center gap-2 text-base">
              <span className="text-muted-foreground">Sierra</span>
              <input
                value={sierraTexto}
                onChange={(e) => setSierraTexto(e.target.value)}
                inputMode="decimal"
                aria-label="Ancho de la sierra, en milímetros"
                aria-invalid={leerAnchoDeSierra(sierraTexto) === null}
                className="tabular h-10 w-16 rounded-lg border border-linea bg-background px-2 text-right text-base"
              />
              <span className="text-muted-foreground">mm</span>
            </label>
            {leerAnchoDeSierra(sierraTexto) === null && (
              <span className="estado-espera text-sm font-medium">
                Entre 0,5 y 10 mm: se usa {formatearSierra(anchoSierraGeneral)}.
              </span>
            )}
          </div>
          {mitad && placa.color && (
            <p className="tarjeta-atencion mt-2 px-4 py-2 text-base">
              La placa es <strong>{placa.color}</strong>: fijate cómo corre el dibujo antes de partirla.
            </p>
          )}
        </DialogHeader>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div
            className="flex min-h-0 flex-col border-linea lg:border-r"
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              // Y no sigue viaje: los atajos de la venta de atrás no tienen
              // nada que hacer mientras se carga un despiece.
              e.stopPropagation();
              // Enter es «otra medida» y Ctrl+Enter es «listo»: se carga el
              // despiece entero sin soltar el teclado.
              if (e.ctrlKey || e.metaKey) {
                if (sePuede) aceptar();
                return;
              }
              sumarPieza();
            }}
          >
            <div className="px-6 pt-5">
              <label className="block">
                <span className="sr-only">Tapacanto del trabajo</span>
                <input
                  value={canto}
                  onChange={(e) => setCanto(e.target.value)}
                  placeholder="Tapacanto: blanco 0,45 mm — vacío si no lleva"
                  className="h-11 w-full rounded-lg border border-linea bg-background px-3 text-base"
                />
              </label>
            </div>

            <div className="@container min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-6 pb-5 pt-1">
              {/* Encabezado de la planilla: una sola vez, no repetido por fila. */}
              <div className={`sticky top-0 z-10 hidden bg-background py-2 text-sm font-semibold text-muted-foreground ${columnas}`}>
                <span>Pieza</span>
                <span>Largo</span>
                <span>Ancho</span>
                <span>Cant.</span>
                <span className="text-center">Canto</span>
                <span className="text-center">Veta</span>
                <span />
              </div>

              <div className="divide-y divide-linea">
                {piezas.map((p, i) => (
                  <div key={i} className={`flex flex-wrap items-center gap-2 py-2 ${columnas}`}>
                    <input
                      value={p.etiqueta}
                      onChange={(e) => cambiar(i, "etiqueta", e.target.value)}
                      aria-label={`Nombre de la pieza ${i + 1}`}
                      placeholder="Puerta, estante…"
                      className="h-11 w-full rounded-lg border border-linea bg-background px-2.5 text-base @2xl:w-auto"
                    />
                    <input
                      autoFocus={i === 0}
                      data-pieza="largo"
                      inputMode="numeric"
                      value={p.largo}
                      onChange={(e) => cambiar(i, "largo", e.target.value)}
                      aria-label={`Largo de la pieza ${i + 1}, en mm`}
                      placeholder="Largo"
                      className="tabular h-11 w-[calc(33%-6px)] rounded-lg border border-linea bg-background px-2.5 text-base @2xl:w-auto"
                    />
                    <input
                      inputMode="numeric"
                      value={p.ancho}
                      onChange={(e) => cambiar(i, "ancho", e.target.value)}
                      aria-label={`Ancho de la pieza ${i + 1}, en mm`}
                      placeholder="Ancho"
                      className="tabular h-11 w-[calc(33%-6px)] rounded-lg border border-linea bg-background px-2.5 text-base @2xl:w-auto"
                    />
                    <input
                      inputMode="numeric"
                      value={p.cantidad}
                      onChange={(e) => cambiar(i, "cantidad", e.target.value)}
                      aria-label={`Cantidad de la pieza ${i + 1}`}
                      className="tabular h-11 w-[calc(33%-6px)] rounded-lg border border-linea bg-background px-2.5 text-base @2xl:w-auto"
                    />
                    {/* El canto se toca en el dibujo de la pieza, lado por
                        lado, como en el sitio: dos desplegables «largo: 1»
                        no se leían de un vistazo. */}
                    <div className="flex justify-center">
                      <SelectorDeCanto
                        chico
                        largo={Number(p.largo) || 0}
                        ancho={Number(p.ancho) || 0}
                        lados={{
                          arriba: p.cantoLargo >= 1,
                          abajo: p.cantoLargo >= 2,
                          izquierda: p.cantoAncho >= 1,
                          derecha: p.cantoAncho >= 2,
                        }}
                        alCambiar={(lados) => {
                          const { cantoLargo, cantoAncho } = contarCanto(lados);
                          setPiezas((previas) =>
                            previas.map((x, j) => (j === i ? { ...x, cantoLargo, cantoAncho } : x)),
                          );
                        }}
                      />
                    </div>
                    <div className="flex justify-center">
                      <button
                        type="button"
                        onClick={() => cambiar(i, "veta", !p.veta)}
                        aria-pressed={p.veta}
                        aria-label={`Respeta la veta, pieza ${i + 1}`}
                        className={`h-10 rounded-lg px-3 text-[14.5px] font-medium ${
                          p.veta ? "boton-accion" : "border border-linea text-muted-foreground hover:bg-hundida"
                        }`}
                      >
                        Veta
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setPiezas((previas) => (previas.length === 1 ? [vacia()] : previas.filter((_, j) => j !== i)))
                      }
                      aria-label={`Quitar la pieza ${i + 1}`}
                      className="ml-auto flex h-10 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive @2xl:ml-0"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={sumarPieza}
                className="mt-2 inline-flex h-11 items-center gap-1.5 rounded-lg px-3 text-base font-medium text-acento-texto hover:bg-hundida"
              >
                <Plus className="h-4 w-4" />
                Agregar medida
                <kbd className="rounded border border-linea px-1.5 py-0.5 text-xs text-muted-foreground">Enter</kbd>
              </button>
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto bg-hundida/40 px-6 py-5">
            {validas.length > 0 ? (
              <PlanoEditable plano={plano} fijadas={fijadas} onFijadas={setFijadas} />
            ) : (
              <div className="flex h-full min-h-[240px] items-center justify-center rounded-xl border border-dashed">
                <span className="tabular text-base text-muted-foreground">
                  {placaLargo} × {placaAncho} mm
                </span>
              </div>
            )}

            {plano.noEntran.length > 0 && (
              <p className="estado-problema mt-3 rounded-lg bg-[var(--estado-fondo)] px-4 py-3 text-base font-medium">
                {plano.noEntran.length === 1
                  ? "Una pieza no entra en la placa"
                  : `${plano.noEntran.length} piezas no entran en la placa`}
                : {plano.noEntran.map((x) => `${x.largoMm} × ${x.anchoMm}`).join(", ")}.
              </p>
            )}

            {plano.pasadasCobrables > 0 && precioPorPasada === 0 && (
              <p className="estado-espera mt-3 rounded-lg bg-[var(--estado-fondo)] px-3 py-2 text-base">
                Esta placa no tiene tarifa de corte: las pasadas no se cobran (Cortes → Tarifas).
              </p>
            )}
          </div>
        </div>

        {/* La cuenta y las salidas abajo y fijas: el total se ve mientras se
            tipea, y no hay que bajar para encontrar el botón. */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-linea bg-background px-6 py-4">
          <dl className="tabular mr-auto flex flex-wrap gap-x-5 gap-y-1 text-base">
            <div>
              <dt className="inline text-muted-foreground">Placas </dt>
              <dd className="inline font-semibold">{plano.placas.length}</dd>
            </div>
            <div>
              <dt className="inline text-muted-foreground">Pasadas </dt>
              <dd className="inline font-semibold">{plano.pasadasCobrables}</dd>
            </div>
            <div>
              <dt className="inline text-muted-foreground">Canto </dt>
              <dd className="inline font-semibold">{metrosCanto.toFixed(2).replace(".", ",")} m</dd>
            </div>
            {validas.length > 0 && plano.noEntran.length === 0 && (
              <div title={[
                plano.placasEnteras > 0 ? `Placas: ${moneda.format(subtotalPlacas)}` : "",
                subtotalCorte > 0 ? `Corte: ${moneda.format(subtotalCorte)}` : "",
                subtotalCanto > 0 ? `Tapacanto: ${moneda.format(subtotalCanto)}` : "",
              ].filter(Boolean).join(" · ")}>
                <dt className="inline text-muted-foreground">Total </dt>
                <dd className="inline text-xl font-bold">{moneda.format(total)}</dd>
              </div>
            )}
          </dl>

          {errorPdf && <span className="estado-problema text-sm font-medium">{errorPdf}</span>}

          <button
            type="button"
            onClick={descargarPlano}
            disabled={plano.placas.length === 0 || plano.noEntran.length > 0 || calculando || bajando}
            className="inline-flex h-12 items-center gap-2 rounded-lg border border-linea px-4 text-base font-medium hover:bg-hundida disabled:opacity-50"
          >
            {bajando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Descargar plano
          </button>
          <button
            type="button"
            onClick={onCerrar}
            className="h-12 rounded-lg border border-linea px-4 text-base font-medium hover:bg-hundida"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!sePuede}
            onClick={aceptar}
            className="inline-flex h-12 items-center gap-2 rounded-lg boton-accion px-5 text-base font-semibold disabled:opacity-50"
          >
            Agregar a la venta
            <kbd className="rounded border border-current px-1.5 py-0.5 text-xs font-medium opacity-70">Ctrl + Enter</kbd>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
