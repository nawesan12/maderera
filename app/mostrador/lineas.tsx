"use client";

import { useEffect, useRef, useState } from "react";
import { Scissors, Trash2, X } from "lucide-react";
import {
  formatearMonto,
  formatearUnidad,
  importeDelCampo,
  importeIlegible,
  importeParaElCampo,
  unidadConcordada,
  unidadDeVenta,
} from "@/lib/formato";
import { admiteDecimales, formatearCantidad, pasoDeCantidad } from "@/lib/unidades";
import { cantidadDelRenglon, esLineaDelCorte, type LineaDeVenta } from "@/lib/mostrador/importes";
import { enfocar } from "./atajos";

/**
 * Agrega una línea, o suma la cantidad si esa medida ya está en la venta. La
 * placa de un corte no se toca: es de su plano, y sumarle una placa suelta
 * descuadra lo que se cobra del corte.
 */
export function sumar(lineas: LineaDeVenta[], nueva: LineaDeVenta): LineaDeVenta[] {
  const i = lineas.findIndex(
    (l) =>
      l.variantId &&
      l.variantId === nueva.variantId &&
      l.corteId == null &&
      (l.presentacion ?? null) === (nueva.presentacion ?? null),
  );
  if (i === -1) return [...lineas, nueva];

  const copia = [...lineas];
  copia[i] = { ...copia[i], cantidad: copia[i].cantidad + nueva.cantidad };
  return copia;
}


export function Lineas({
  lineas,
  sinCargo,
  onCambiar,
  onEditarCorte,
  onQuitarCorte,
  onLimpiar,
  onNoVaciar,
}: {
  lineas: LineaDeVenta[];
  /**
   * Los cortes que no cobran nada (sin tarifa y por debajo de media placa):
   * no tienen renglón, pero van al taller, y sin una fila no se podían
   * corregir ni sacar (revisión del carril F).
   */
  sinCargo: { id: string; descripcion: string }[];
  onCambiar: (l: LineaDeVenta[]) => void;
  /** Reabre el corte del renglón para corregirlo. */
  onEditarCorte: (corteId: string) => void;
  /** Saca el corte entero: un renglón suyo solo no cierra con el plano. */
  onQuitarCorte: (corteId: string) => void;
  onLimpiar: () => void;
  /** Se arrepintió de vaciar: el cursor vuelve al buscador. */
  onNoVaciar: () => void;
}) {
  if (lineas.length === 0 && sinCargo.length === 0) {
    return (
      <div className="flex min-h-40 flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-linea text-center">
        {/* Por nombre, por medida o pasando el código. Lo que no esté —un corte,
            un flete— se carga a mano desde el mismo buscador. */}
        <p className="text-lg font-medium text-muted-foreground">
          Buscá un producto para empezar la venta
        </p>
      </div>
    );
  }

  function cambiar(i: number, campo: "cantidad" | "precioUnitario", valor: number) {
    const copia = [...lineas];
    copia[i] = { ...copia[i], [campo]: valor };
    onCambiar(copia);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-linea bg-card">
      <div className="flex min-h-14 items-center justify-between border-b border-linea px-4 py-2">
        <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {lineas.length} {lineas.length === 1 ? "producto" : "productos"}
        </span>
        <Vaciar onVaciar={onLimpiar} onNoVaciar={onNoVaciar} />
      </div>

      {/* Los rótulos de las dos cajas, a la vista: eran iguales y sin
          nombre, y un Tab de más dejaba la placa a $3. */}
      {/* Alineados a la derecha, como los campos: cuando el renglón no
          entra, los campos bajan abajo del nombre y siguen debajo de su
          rótulo. */}
      <div className="flex items-center justify-end gap-3 px-4 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span className="w-20 text-right">Cant.</span>
        <span className="w-3" />
        <span className="w-28 text-right">Precio</span>
        <span className="w-28" />
        <span className="w-8" />
      </div>

      <ul className="min-h-0 flex-1 divide-y divide-linea overflow-y-auto">
        {lineas.map((l, i) => {
          // Cambiado a mano respecto de la lista: en naranja, con la lista
          // tachada al lado. Quien mira la pantalla ve qué se tocó.
          const tocado = l.precioLista != null && Math.abs(l.precioLista - l.precioUnitario) > 0.005;
          // Lo del corte se lee por su importe y se corrige reabriéndolo: Go
          // rechaza un corte que no cobra lo de su plano (comité final, A2).
          // La pasada suelta, sin corte atado, también: su cantidad es de
          // pasadas y su nombre, de piezas (ver esLineaDelCorte).
          // Solo lo atado a un corte: una «pasada» cargada a mano se ve con su
          // cantidad y su precio, como cualquier renglón a mano (revisión del
          // carril F; antes decía «del plano» y escondía las dos cosas).
          const corteId = l.corteId;
          const delCorte = corteId != null;
          return (
            /*
             * El nombre tiene todo el ancho que haga falta y no se corta: lo
             * que distingue una placa de otra es la medida y el espesor, que
             * van al final («Membran…», «MDF — 1830 x 2600mm …»; mes
             * simulado, H017 y H274). Si no entra al lado, los campos bajan.
             */
            <li key={`${l.variantId ?? "suelta"}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
              <span className="min-w-[14rem] flex-1 basis-[14rem]">
                <NombreDelRenglon descripcion={l.descripcion} />
                <span className="block text-sm text-muted-foreground">
                  {delCorte
                    ? esLineaDelCorte(l)
                      ? "del plano"
                      : // La media placa dice media placa, no «1 placa» (H035).
                        `${formatearCantidad(l.cantidad)} ${
                          l.presentacion ? (l.cantidad === 1 ? "media placa" : "medias placas") : unidadConcordada(l.cantidad, l.unidad, l.descripcion)
                        } · del plano`
                    : l.presentacion
                      ? "cada media placa"
                      : `por ${formatearUnidad(unidadDeVenta(l.unidad, l.descripcion))}`}
                </span>
              </span>

              <span className="ml-auto flex shrink-0 items-center gap-3">
              {delCorte ? (
                <span className="flex w-[14.25rem] shrink-0 justify-end">
                  {corteId != null && (
                    <button
                      type="button"
                      onClick={() => onEditarCorte(corteId)}
                      className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-linea px-3 text-base font-medium transition-colors hover:bg-hundida"
                    >
                      <Scissors className="h-4 w-4" />
                      Corregir
                    </button>
                  )}
                </span>
              ) : (
                <>
                  <label className="shrink-0">
                    <span className="sr-only">Cantidad de {l.descripcion}</span>
                    <input
                      type="number"
                      inputMode={l.variantId && !admiteDecimales(l.unidad) ? "numeric" : "decimal"}
                      min="0"
                      step={l.variantId ? pasoDeCantidad(l.unidad) : 0.01}
                      value={l.cantidad}
                      onChange={(e) => cambiar(i, "cantidad", cantidadDelRenglon(l, Number(e.target.value)))}
                      // La ruedita del mouse cambiaba el número sin que nadie lo
                      // notara: se suelta el foco y la página sigue scrolleando.
                      onWheel={(e) => e.currentTarget.blur()}
                      /* F2 cae en la cantidad de la última línea cargada, que es la
                         que se acaba de equivocar. Las de más arriba se corrigen con
                         el mouse o con Tab. */
                      data-foco={i === lineas.length - 1 ? "cantidad" : undefined}
                      onKeyDown={(e) => {
                        // Corregida la cantidad, el foco vuelve solo al buscador:
                        // lo que sigue es cargar el próximo producto.
                        if (e.key === "Enter" || e.key === "Escape") {
                          // Ctrl+Enter no se cancela: sigue hasta la pantalla y
                          // cobra, con la cantidad ya corregida (se guardó al
                          // tipearla). Cancelada, el atajo la ignoraba.
                          if (!(e.key === "Enter" && (e.ctrlKey || e.metaKey))) e.preventDefault();
                          enfocar("buscador");
                        }
                      }}
                      className="tabular h-11 w-20 rounded-lg border border-linea bg-background px-2.5 text-right text-base"
                    />
                  </label>

                  <span className="w-3 text-center text-muted-foreground">×</span>

                  <label className="relative shrink-0">
                    <span className="sr-only">Precio de {l.descripcion}</span>
                    <PrecioDelRenglon
                      valor={l.precioUnitario}
                      alCambiar={(n) => cambiar(i, "precioUnitario", n)}
                      aria-describedby={tocado ? `lista-${i}` : undefined}
                      className={`tabular h-11 w-28 rounded-lg border bg-background px-2.5 text-right text-base ${
                        tocado ? "border-brand-orange font-semibold text-brand-orange" : "border-linea"
                      }`}
                    />
                    {tocado && (
                      <span
                        id={`lista-${i}`}
                        className="tabular absolute -bottom-4 right-1 text-xs text-muted-foreground line-through"
                      >
                        {formatearMonto(l.precioLista!)}
                      </span>
                    )}
                  </label>
                </>
              )}

              <span className="tabular w-28 shrink-0 text-right text-lg font-semibold">
                {formatearMonto(l.cantidad * l.precioUnitario)}
              </span>

              <button
                onClick={() =>
                  corteId != null ? onQuitarCorte(corteId) : onCambiar(lineas.filter((_, j) => j !== i))
                }
                aria-label={corteId != null ? `Quitar el corte de ${l.descripcion}` : `Quitar ${l.descripcion}`}
                className="w-8 shrink-0 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-hundida hover:text-foreground"
              >
                <Trash2 className="h-4 w-4" />
              </button>
              </span>
            </li>
          );
        })}
        {sinCargo.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
            <span className="min-w-[14rem] flex-1 basis-[14rem]">
              <NombreDelRenglon descripcion={`Corte de ${c.descripcion}`} />
              <span className="block text-sm text-muted-foreground">sin cargo · va al taller</span>
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-3">
            <span className="flex w-[14.25rem] shrink-0 justify-end">
              <button
                type="button"
                onClick={() => onEditarCorte(c.id)}
                className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-linea px-3 text-base font-medium transition-colors hover:bg-hundida"
              >
                <Scissors className="h-4 w-4" />
                Corregir
              </button>
            </span>
            <span className="tabular w-28 shrink-0 text-right text-lg font-semibold">{formatearMonto(0)}</span>
            <button
              onClick={() => onQuitarCorte(c.id)}
              aria-label={`Quitar el corte de ${c.descripcion}`}
              className="w-8 shrink-0 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-hundida hover:text-foreground"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Si «Vaciar» se desarma porque el foco se fue. Solo cuando se fue a otro
 * elemento: Safari (Mac y iPad) no le da foco a un botón al tocarlo, y el
 * blur de «No» llega sin destino justo cuando se aprieta el «Vaciar» rojo.
 * Desarmar ahí lo hacía desaparecer antes del clic, y la venta no se vaciaba
 * nunca. Un toque afuera lo desarma por su lado (pointerdown en el documento).
 */
export function desarmaAlPerderFoco(
  grupo: { contains(n: unknown): boolean },
  destino: unknown,
): boolean {
  return destino != null && !grupo.contains(destino);
}

/** Lo que el «Vaciar» de la pregunta no cuenta: el segundo toque de un toque repetido. */
export const GUARDA_DE_VACIAR_MS = 700;

/**
 * «Vaciar», en dos pasos y en el mismo lugar.
 *
 * Un toque tiraba la venta entera (T4, hallazgo 20). El primero pregunta, ahí
 * mismo, con dos botones del tamaño de los demás; el segundo vacía. Sin
 * temporizador: una pregunta que se va sola es mala con el teclado, y con la
 * cola enfrente nadie la lee a tiempo. Se desarma con Esc, con «No», al irse
 * el foco a otro elemento y con un toque afuera: un Enter que caiga después
 * en el botón no puede vaciar.
 *
 * «No» queda donde estaba «Vaciar» y el rojo a su izquierda: el que toca, no
 * ve reacción y vuelve a tocar en el mismo lugar cae en lo seguro. Y el rojo
 * no cuenta durante GUARDA_DE_VACIAR_MS, por el doble toque que igual lo
 * alcance.
 *
 * Los dos botones no toman el foco con el mouse (preventDefault en el
 * mousedown): el foco se queda en «No» y el blur no desarma en pleno clic.
 *
 * Se eligió esto antes que un «Deshacer»: deshacer obliga a guardar y
 * devolver los dieciséis estados de la venta, y es fácil devolver la mitad.
 */
function Vaciar({ onVaciar, onNoVaciar }: { onVaciar: () => void; onNoVaciar: () => void }) {
  const [armado, setArmado] = useState(false);
  const desde = useRef(0);
  const grupo = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!armado) return;
    function afuera(e: PointerEvent) {
      if (grupo.current && !grupo.current.contains(e.target as Node)) setArmado(false);
    }
    document.addEventListener("pointerdown", afuera);
    return () => document.removeEventListener("pointerdown", afuera);
  }, [armado]);

  function armar() {
    desde.current = Date.now();
    setArmado(true);
  }

  function no() {
    setArmado(false);
    onNoVaciar();
  }

  if (!armado) {
    return (
      <button
        type="button"
        onClick={armar}
        className="inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-hundida hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
        Vaciar
      </button>
    );
  }

  return (
    <div
      ref={grupo}
      role="group"
      aria-label="¿Vaciar la venta?"
      className="flex items-center gap-2"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          no();
        }
      }}
      onBlur={(e) => {
        if (desarmaAlPerderFoco(e.currentTarget, e.relatedTarget)) setArmado(false);
      }}
    >
      <span className="text-base font-semibold">¿Vaciar?</span>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (Date.now() - desde.current < GUARDA_DE_VACIAR_MS) return;
          setArmado(false);
          onVaciar();
        }}
        className="h-10 rounded-lg bg-destructive px-4 text-base font-semibold text-white transition-colors hover:bg-destructive/90"
      >
        Vaciar
      </button>
      <button
        type="button"
        // El foco cae en «No»: un Enter de más deja la venta como estaba.
        autoFocus
        onMouseDown={(e) => e.preventDefault()}
        onClick={no}
        className="h-10 rounded-lg border border-linea px-4 text-base font-medium transition-colors hover:bg-hundida"
      >
        No
      </button>
    </div>
  );
}

/**
 * El precio a mano de un renglón. Texto y no `type="number"`: con number,
 * «15.000» se leía como $15 (se tipea como se escribe en Argentina). Lo que se
 * escribe se guarda aparte del número del renglón para no reformatearlo
 * mientras se tipea; si viene otro precio de afuera (la lista, el cliente que
 * cambió) se vuelve a mostrar ese. Lo que no se entiende queda marcado y, al
 * salir del campo, vuelve al último precio bueno: nunca pasa como $0.
 */
function PrecioDelRenglon({
  valor,
  alCambiar,
  className,
  ...resto
}: {
  valor: number;
  alCambiar: (n: number) => void;
  className: string;
  "aria-describedby"?: string;
}) {
  const [texto, setTexto] = useState(() => importeParaElCampo(valor));
  const [visto, setVisto] = useState(valor);
  if (valor !== visto) {
    setVisto(valor);
    setTexto(importeParaElCampo(valor));
  }
  const malo = importeIlegible(texto);
  return (
    <input
      {...resto}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={texto}
      aria-invalid={malo || undefined}
      onChange={(e) => {
        const t = e.target.value;
        setTexto(t);
        if (importeIlegible(t)) return;
        const n = importeDelCampo(t);
        setVisto(n);
        alCambiar(n);
      }}
      onBlur={() => {
        if (malo) setTexto(importeParaElCampo(valor));
      }}
      className={className}
    />
  );
}

/**
 * El nombre del renglón, con la medida siempre a la vista.
 *
 * Lo que distingue una placa de otra es la medida y el espesor, y van al
 * final del nombre («Placa de Yeso — Resistente humedad 1200 x 2400mm —
 * 12.5mm»). Con el nombre en dos renglones recortados, a 1280 se perdía el
 * espesor (mes simulado, H274). El producto va entero y baja de renglón si
 * no entra —recortado con «…», a 1280 no se sabía qué tornillo era—; lo que
 * sigue a la primera raya va entero, en su propio renglón.
 */
function NombreDelRenglon({ descripcion }: { descripcion: string }) {
  const corte = descripcion.indexOf(" — ");
  if (corte < 0) return <span className="block break-words text-base font-medium">{descripcion}</span>;
  return (
    <>
      <span className="block break-words text-base font-medium">
        {descripcion.slice(0, corte)}
      </span>
      <span className="block break-words text-base">{descripcion.slice(corte + 3).replaceAll(" — ", " · ")}</span>
    </>
  );
}
