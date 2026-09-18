"use client";

import { useMemo, useState } from "react";
import { Plus, Scissors, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PlanoEditable } from "@/components/cortes/plano-editable";
import {
  calcularPlanoDeCorte,
  type PiezaFijada,
} from "@/lib/cortes/plano";
import {
  fraccionDePlaca,
  medidaDePlaca,
  nombreDeLaMitad,
  type Mitad,
} from "@/lib/cortes/placa";
import { metrosDeTapacanto } from "@/lib/cortes/tarifa";
import { moneda } from "@/lib/formato";
import type { CorteDeMostrador } from "@/lib/mostrador/venta";
import type { LineaDeVenta } from "@/lib/mostrador/importes";

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
  anchoSierra,
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
  };
  /** Lo que se lleva el disco por pasada, de /admin/calculadoras. */
  anchoSierra: number;
  precioPorPasada: number;
  precioPorMetroCanto: number;
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

  const plano = useMemo(
    () =>
      calcularPlanoDeCorte({
        piezas: validas,
        placaLargo,
        placaAncho,
        anchoSierra,
        fijadas,
      }),
    [validas, placaLargo, placaAncho, anchoSierra, fijadas],
  );

  // La misma cuenta que la ficha del corte y la planilla del taller, que ya
  // está probada: no hay dos formas de medir un metro de tapacanto.
  const metrosCanto = useMemo(() => metrosDeTapacanto(validas), [validas]);

  // De media placa se cobra media placa: el plano ya trabaja sobre la medida
  // partida, así que lo único que cambia es el precio del material.
  const subtotalPlacas = plano.placasEnteras * placa.precio * fraccionDePlaca(mitad);
  const subtotalCorte = plano.pasadasCobrables * precioPorPasada;
  const subtotalCanto = Math.round(metrosCanto * precioPorMetroCanto * 100) / 100;
  const total = subtotalPlacas + subtotalCorte + subtotalCanto;

  const sePuede = validas.length > 0 && plano.noEntran.length === 0;

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
       * Media placa se cobra a mitad de precio, pero **descuenta una placa
       * entera del estante**: es lo que sale físicamente del depósito. El
       * pedazo que queda vuelve como retal, y de retales el sistema todavía no
       * lleva stock (ver `lib/cortes/plano.ts`).
       */
      lineas.push({
        variantId: placa.variantId,
        descripcion: mitad
          ? `${placa.descripcion} — ${nombreDeLaMitad(mitad).toLowerCase()}`
          : placa.descripcion,
        unidad: placa.unidad,
        cantidad: plano.placasEnteras,
        precioUnitario: placa.precio * fraccionDePlaca(mitad),
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

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && onCerrar()}>
      {/* `sm:max-w-*` y no `max-w-*`: el diálogo base trae `sm:max-w-md` y, al ser
          de otro breakpoint, no lo pisa una clase sin prefijo — el modal quedaba
          en 448 px con los campos apilándose de a uno. */}
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[min(1100px,95vw)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-bold tracking-tight">
            <Scissors className="h-5 w-5" />
            Corte a medida
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-base text-muted-foreground">
            {placa.descripcion} · {nombreDeLaMitad(mitad).toLowerCase()} de{" "}
            <span className="tabular">
              {placaLargo} × {placaAncho} mm
            </span>
            {medidaSupuesta && " (medida supuesta: la placa no la tiene cargada)"}
            {/* Los milímetros del disco, dichos. Estaban descontados desde
                siempre y en ninguna pantalla se veían, así que en el mostrador
                no se podía explicar por qué dos piezas de 900 no entran en
                una placa de 1830. */}
            {` · la sierra se lleva ${anchoSierra} mm por corte`}
          </p>

          {/* Media placa. Se vende, y no es lo mismo partirla a lo largo que
              al ancho: cambia qué piezas entran. */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-medium">De qué sale:</span>
            {([null, "largo", "ancho"] as const).map((m) => (
              <button
                key={m ?? "entera"}
                type="button"
                onClick={() => setMitad(m)}
                aria-pressed={mitad === m}
                className={`h-10 rounded-lg px-3 text-base font-medium transition-colors ${
                  mitad === m
                    ? "boton-accion"
                    : "border border-linea text-muted-foreground hover:bg-hundida"
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

          {mitad && placa.color && (
            <p className="tarjeta-atencion px-4 py-2.5 text-base">
              La placa es <strong>{placa.color}</strong>: fijate cómo corre el
              dibujo antes de partirla.
            </p>
          )}

          {/* Dos columnas en pantalla ancha: a la izquierda se carga, a la
              derecha se ve cómo va quedando. En el mostrador se tipea mirando
              el plano, no después. */}
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div
              className="space-y-2"
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                // Y no sigue viaje: los atajos de la venta de atrás no tienen
                // nada que hacer mientras se carga un despiece.
                e.stopPropagation();
                /*
                 * Enter es "otra medida" y Ctrl+Enter es "listo". Se tipea
                 * largo, ancho, cantidad y Enter, sin soltar el teclado en todo
                 * el despiece.
                 */
                if (e.ctrlKey || e.metaKey) {
                  if (sePuede) aceptar();
                  return;
                }
                sumarPieza();
              }}
            >
              {/* Encabezado de la grilla: una sola vez, no repetido por fila. */}
              <div className="hidden gap-2 px-3 text-sm text-muted-foreground sm:grid sm:grid-cols-[5.5rem_5.5rem_4.5rem_1fr]">
                <span>Largo (mm)</span>
                <span>Ancho (mm)</span>
                <span>Cantidad</span>
                <span>Etiqueta</span>
              </div>

              {piezas.map((p, i) => (
                <div
                  key={i}
                  className="space-y-2 rounded-lg border border-linea p-3"
                >
                  <div className="grid gap-2 sm:grid-cols-[5.5rem_5.5rem_4.5rem_1fr]">
                    <label className="contents sm:block">
                      <span className="text-sm text-muted-foreground sm:hidden">
                        Largo (mm)
                      </span>
                      <input
                        autoFocus={i === 0}
                        data-pieza="largo"
                        inputMode="numeric"
                        value={p.largo}
                        onChange={(e) => cambiar(i, "largo", e.target.value)}
                        className="tabular h-12 w-full rounded-lg border border-linea bg-background px-2.5 text-base"
                      />
                    </label>
                    <label className="contents sm:block">
                      <span className="text-sm text-muted-foreground sm:hidden">
                        Ancho (mm)
                      </span>
                      <input
                        inputMode="numeric"
                        value={p.ancho}
                        onChange={(e) => cambiar(i, "ancho", e.target.value)}
                        className="tabular h-12 w-full rounded-lg border border-linea bg-background px-2.5 text-base"
                      />
                    </label>
                    <label className="contents sm:block">
                      <span className="text-sm text-muted-foreground sm:hidden">
                        Cantidad
                      </span>
                      <input
                        inputMode="numeric"
                        value={p.cantidad}
                        onChange={(e) => cambiar(i, "cantidad", e.target.value)}
                        className="tabular h-12 w-full rounded-lg border border-linea bg-background px-2.5 text-base"
                      />
                    </label>
                    <label className="contents sm:block">
                      <span className="text-sm text-muted-foreground sm:hidden">
                        Etiqueta
                      </span>
                      <input
                        value={p.etiqueta}
                        onChange={(e) => cambiar(i, "etiqueta", e.target.value)}
                        placeholder="Puerta, estante…"
                        className="h-12 w-full rounded-lg border border-linea bg-background px-2.5 text-base"
                      />
                    </label>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <label className="flex items-center gap-2 text-base">
                      <input
                        type="checkbox"
                        checked={p.veta}
                        onChange={(e) => cambiar(i, "veta", e.target.checked)}
                        className="h-5 w-5"
                      />
                      Respeta la veta
                    </label>

                    {/* Los dos cantos juntos bajo un rótulo: como dos
                        etiquetas sueltas —"Canto largo", "Canto ancho"— la
                        fila se partía en dos y quedaba el doble de alta. */}
                    <span className="flex items-center gap-2 text-base">
                      <span className="text-muted-foreground">Canto</span>
                      <select
                        aria-label="Lados con canto en el largo"
                        value={p.cantoLargo}
                        onChange={(e) =>
                          cambiar(i, "cantoLargo", Number(e.target.value))
                        }
                        className="h-11 rounded-lg border border-linea bg-background px-2 text-base"
                      >
                        <option value={0}>largo: no</option>
                        <option value={1}>largo: 1</option>
                        <option value={2}>largo: 2</option>
                      </select>
                      <select
                        aria-label="Lados con canto en el ancho"
                        value={p.cantoAncho}
                        onChange={(e) =>
                          cambiar(i, "cantoAncho", Number(e.target.value))
                        }
                        className="h-11 rounded-lg border border-linea bg-background px-2 text-base"
                      >
                        <option value={0}>ancho: no</option>
                        <option value={1}>ancho: 1</option>
                        <option value={2}>ancho: 2</option>
                      </select>
                    </span>

                    {piezas.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setPiezas((previas) =>
                            previas.filter((_, j) => j !== i),
                          )
                        }
                        className="ml-auto inline-flex h-11 items-center gap-1.5 rounded-lg px-3 text-base text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-4 w-4" />
                        Quitar
                      </button>
                    )}
                  </div>
                </div>
              ))}

              <button
                type="button"
                onClick={sumarPieza}
                className="inline-flex h-12 items-center gap-1.5 rounded-lg border border-linea px-3.5 text-base font-medium hover:bg-hundida"
              >
                <Plus className="h-4 w-4" />
                Agregar medida
                <kbd className="rounded border border-linea px-1.5 py-0.5 text-xs text-muted-foreground">
                  Enter
                </kbd>
              </button>

              <label className="block pt-1">
                <span className="text-sm text-muted-foreground">
                  Tapacanto del trabajo
                </span>
                <input
                  value={canto}
                  onChange={(e) => setCanto(e.target.value)}
                  placeholder="Blanco 0,45 mm — vacío si no lleva"
                  className="mt-1 h-12 w-full rounded-lg border border-linea bg-background px-3 text-base"
                />
              </label>
            </div>

            <div className="space-y-4">
          {validas.length > 0 && (
            <PlanoEditable
              plano={plano}
              fijadas={fijadas}
              onFijadas={setFijadas}
            />
          )}

          {plano.noEntran.length > 0 && (
            <p className="estado-problema rounded-lg bg-[var(--estado-fondo)] px-4 py-3 text-base font-medium">
              {plano.noEntran.length === 1
                ? "Una pieza no entra en la placa"
                : `${plano.noEntran.length} piezas no entran en la placa`}
              . Revisá las medidas antes de cobrar.
            </p>
          )}

          {validas.length > 0 && plano.noEntran.length === 0 && (
            <div className="space-y-1.5 rounded-lg border border-linea bg-hundida p-4">
              {plano.placasEnteras > 0 && (
                <Renglon
                  que={`${plano.placasEnteras} ${
                    plano.placasEnteras === 1 ? "placa entera" : "placas enteras"
                  } × ${moneda.format(placa.precio)}`}
                  cuanto={subtotalPlacas}
                />
              )}
              {plano.pasadasCobrables > 0 && precioPorPasada > 0 && (
                <Renglon
                  que={`${plano.pasadasCobrables} ${
                    plano.pasadasCobrables === 1 ? "pasada" : "pasadas"
                  } × ${moneda.format(precioPorPasada)}`}
                  cuanto={subtotalCorte}
                />
              )}
              {subtotalCanto > 0 && (
                <Renglon
                  que={`${metrosCanto.toFixed(2).replace(".", ",")} m de tapacanto`}
                  cuanto={subtotalCanto}
                />
              )}
              <div className="flex items-baseline justify-between gap-4 border-t border-linea pt-2">
                <span className="text-base font-semibold">Total del corte</span>
                <span className="tabular text-2xl font-bold">
                  {moneda.format(total)}
                </span>
              </div>

              {plano.pasadasCobrables > 0 && precioPorPasada === 0 && (
                <p className="estado-espera rounded-lg bg-[var(--estado-fondo)] px-3 py-2 text-base">
                  No hay tarifa de corte cargada para esta placa, así que las
                  pasadas no se cobran. Se configura en Cortes → Tarifas.
                </p>
              )}
            </div>
          )}

              {validas.length === 0 && (
                <div className="rounded-xl border border-dashed px-5 py-10 text-center">
                  <p className="text-base font-medium">
                    El plano aparece al cargar la primera medida
                  </p>
                  <p className="mt-1 text-base text-muted-foreground">
                    Vas a ver cuántas placas hacen falta, si alguna conviene
                    venderla entera y cuánto sale.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-2 border-t border-linea pt-4">
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
              <kbd className="rounded border border-current px-1.5 py-0.5 text-xs font-medium opacity-70">
                Ctrl + Enter
              </kbd>
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Renglon({ que, cuanto }: { que: string; cuanto: number }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-base text-muted-foreground">{que}</span>
      <span className="tabular text-base">{moneda.format(cuanto)}</span>
    </div>
  );
}
