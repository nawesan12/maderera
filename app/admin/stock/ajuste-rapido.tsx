"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Minus, Plus, Ruler } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  admiteDecimales,
  formatearCantidad,
  formatearLargo,
  formatearUnidadPlural,
  leerCantidad,
  metrosDePiezas,
} from "@/lib/unidades";
import { formatearUnidad } from "@/lib/formato";
import { avisoDelAjuste, MOTIVOS_QUE_RESTAN, MOTIVOS_QUE_SUMAN, teclaDelAjuste } from "@/lib/stock-ajuste";
import { ajustarStock, type MotivoDeAjuste } from "./ajuste-actions";

/**
 * Suma o resta stock sin salir del listado.
 *
 * Llegó mercadería o se rompió una placa: son correcciones de todos los días.
 * Obligar a abrir la ficha del producto para cambiar un número es lo que hace
 * que el inventario del sistema se despegue del real.
 *
 * Todo se carga también con un número, no solo lo que se mide: con un botón
 * de a uno no se cargan 28,8 metros de zócalo, y tampoco 200 bisagras (eran
 * 200 clics). El metro lineal se carga **por piezas**, que es como se cuenta
 * al descargar el camión: «doce de 2,40» y el sistema guarda los metros
 * (pedido del 30/9/2026). Y está «Contar», que deja el número que se contó
 * en el estante, con el motivo de cada ajuste en el libro de movimientos.
 */
export function AjusteRapido({
  variantId,
  producto,
  branchSlug,
  sucursal,
  unidad,
  largoMm,
  actual,
}: {
  variantId: string;
  /** El nombre de la fila, para el aviso: con dos ajustes seguidos se deshacía el que no era. */
  producto: string;
  branchSlug: string;
  sucursal: string;
  unidad: string;
  largoMm: number | null;
  /** Lo que dice el sistema que hay, para mostrarlo al contar. */
  actual: number;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();

  function ajustar(
    cantidad: number,
    alTerminar?: () => void,
    extra?: { contado?: number; motivo?: MotivoDeAjuste },
  ) {
    startTransition(async () => {
      const resultado = await ajustarStock(variantId, branchSlug, cantidad, extra);
      if (resultado.error) toast.error(resultado.error);
      else {
        if (resultado.ok) avisarConDeshacer(resultado.ok, cantidad, extra);
        alTerminar?.();
        router.refresh();
      }
    });
  }

  /*
   * Cada ajuste se puede deshacer desde el aviso (T4, hallazgo 21).
   *
   * Deshacer **no borra** el movimiento: asienta el inverso con motivo
   * «Corrección», y el libro dice las dos cosas, que es lo que pasó. Diez
   * segundos y no los seis de siempre: el que ajusta suele estar atendiendo a
   * alguien. Sirve una sola vez —un doble toque no asienta dos inversos— y,
   * si en el medio se vendió y el inverso dejaría el stock en negativo, lo
   * que vuelve es el error de Go, a la vista.
   *
   * Un conteo no se deshace: su inverso sería «volver a contar lo de antes»,
   * y si en el medio se vendió algo, eso pisaría la venta con un número viejo
   * de la pantalla. Se cuenta de nuevo.
   */
  function avisarConDeshacer(
    mensaje: string,
    cantidad: number,
    extra?: { contado?: number; motivo?: MotivoDeAjuste },
  ) {
    const titulo = avisoDelAjuste(producto, mensaje);
    if (extra?.contado !== undefined || cantidad === 0) {
      toast.success(titulo);
      return;
    }
    let usado = false;
    toast.success(titulo, {
      duration: 10_000,
      classNames: { title: "text-base", actionButton: "!h-10 !px-4 !text-base !font-semibold" },
      action: {
        label: "Deshacer",
        onClick: () => {
          if (usado) return;
          usado = true;
          startTransition(async () => {
            const r = await ajustarStock(variantId, branchSlug, -cantidad, { motivo: "correccion" });
            if (r.error) toast.error(r.error, { duration: 10_000 });
            else {
              if (r.ok) toast.success(avisoDelAjuste(producto, r.ok));
              router.refresh();
            }
          });
        },
      },
    });
  }

  // La placa se ajusta de a media: es lo que queda cuando se vende una.
  const paso = unidad === "placa" ? 0.5 : 1;
  const nombrePaso = paso === 1 ? "uno" : "media";

  // De 44 px y separados: de 36 y pegados, el + caía en el − con el dedo.
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => ajustar(-paso)}
        disabled={pendiente}
        className="flex h-11 min-w-11 items-center justify-center gap-1 rounded-md border px-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        aria-label={`Restar ${nombrePaso} en ${sucursal}`}
      >
        <Minus className="h-4 w-4" />
        {paso !== 1 && <span className="text-sm">media</span>}
      </button>
      <button
        onClick={() => ajustar(paso)}
        disabled={pendiente}
        className="flex h-11 min-w-11 items-center justify-center gap-1 rounded-md border px-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        aria-label={`Sumar ${nombrePaso} en ${sucursal}`}
      >
        {pendiente ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Plus className="h-4 w-4" />
        )}
        {paso !== 1 && <span className="text-sm">media</span>}
      </button>

      <CargaPorMedida
        unidad={unidad}
        largoMm={unidad === "metro_lineal" ? largoMm : null}
        sucursal={sucursal}
        actual={actual}
        pendiente={pendiente}
        onCargar={ajustar}
      />
    </div>
  );
}

/**
 * Carga de una cantidad medida, sumando o restando.
 *
 * Con largo de pieza ofrece primero las piezas: el número que se tipea es el
 * que se contó, y la cuenta a metros la hace el sistema a la vista. Se puede
 * pasar a metros sueltos para un recorte que no es una pieza entera.
 */
function CargaPorMedida({
  unidad,
  largoMm,
  sucursal,
  actual,
  pendiente,
  onCargar,
}: {
  unidad: string;
  largoMm: number | null;
  sucursal: string;
  actual: number;
  pendiente: boolean;
  onCargar: (
    cantidad: number,
    alTerminar?: () => void,
    extra?: { contado?: number; motivo?: MotivoDeAjuste },
  ) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [porPiezas, setPorPiezas] = useState(Boolean(largoMm));
  const [texto, setTexto] = useState("");
  // Sumar y restar, o contar: dejar el número que hay en el estante.
  const [modo, setModo] = useState<"mover" | "contar">("mover");
  const enteros = !admiteDecimales(unidad);

  const valor = leerCantidad(texto);
  const cantidad =
    !Number.isFinite(valor) || valor <= 0
      ? 0
      : porPiezas && largoMm
        ? metrosDePiezas(valor, largoMm)
        : valor;

  const abreviatura = formatearUnidad(unidad);
  const largoTexto = largoMm ? formatearLargo(largoMm) : null;

  const decimalMal = enteros && cantidad > 0 && !Number.isInteger(cantidad);
  const listo = () => {
    setTexto("");
    setAbierto(false);
  };

  const sePuedeMover = !pendiente && cantidad > 0 && !decimalMal;

  function cargar(signo: 1 | -1, motivo: MotivoDeAjuste) {
    if (!sePuedeMover) return;
    onCargar(signo * cantidad, listo, { motivo });
  }

  function contar() {
    if (!Number.isFinite(cantidad) || cantidad < 0 || decimalMal || (texto.trim() === "" )) return;
    onCargar(0, listo, { contado: cantidad, motivo: "conteo" });
  }

  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger
        className="flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label={`Cargar una cantidad en ${sucursal}`}
      >
        <Ruler className="h-4 w-4" />
        Cargar
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] gap-3 p-4">
        <p className="text-base font-medium">
          {sucursal} · hay <span className="tabular">{formatearCantidad(actual)}</span>
        </p>

        <div className="flex rounded-md bg-hundida p-0.5 text-sm" role="group">
          <button
            type="button"
            onClick={() => setModo("mover")}
            aria-pressed={modo === "mover"}
            className={`flex-1 rounded px-2 py-1.5 ${modo === "mover" ? "bg-card font-medium shadow-sm" : "text-muted-foreground"}`}
          >
            Sumar o restar
          </button>
          <button
            type="button"
            onClick={() => setModo("contar")}
            aria-pressed={modo === "contar"}
            className={`flex-1 rounded px-2 py-1.5 ${modo === "contar" ? "bg-card font-medium shadow-sm" : "text-muted-foreground"}`}
          >
            Contar
          </button>
        </div>

        {largoMm ? (
          <div className="flex rounded-md border p-0.5 text-sm" role="group">
            <button
              type="button"
              onClick={() => setPorPiezas(true)}
              aria-pressed={porPiezas}
              className={`flex-1 rounded px-2 py-1.5 ${porPiezas ? "bg-muted font-medium" : "text-muted-foreground"}`}
            >
              Piezas de {largoTexto}
            </button>
            <button
              type="button"
              onClick={() => setPorPiezas(false)}
              aria-pressed={!porPiezas}
              className={`flex-1 rounded px-2 py-1.5 ${!porPiezas ? "bg-muted font-medium" : "text-muted-foreground"}`}
            >
              Metros sueltos
            </button>
          </div>
        ) : null}

        <label className="block text-sm text-muted-foreground">
          {/* «Cuántos unidades» no concuerda: la etiqueta nombra la unidad
              sin el cuántos/cuántas. */}
          {modo === "contar"
            ? porPiezas && largoMm
              ? "Piezas que hay"
              : `Lo que hay, en ${formatearUnidadPlural(unidad)}`
            : porPiezas && largoMm
              ? "Piezas"
              : `Cantidad, en ${formatearUnidadPlural(unidad)}`}
          <input
            autoFocus
            inputMode="decimal"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              // La regla, con su prueba, en `teclaDelAjuste`.
              const accion = teclaDelAjuste(e, modo);
              if (accion === null) return;
              e.preventDefault();
              if (accion === "contar") contar();
              else if (accion === "ingreso") cargar(1, "ingreso");
            }}
            className="tabular mt-1 block h-11 w-full rounded-md border bg-background px-3 text-lg text-foreground"
            placeholder={porPiezas && largoMm ? "12" : enteros ? "200" : "3,5"}
          />
        </label>

        <p className="tabular min-h-6 text-base" aria-live="polite">
          {decimalMal ? (
            <span className="text-destructive">Va sin decimales: se cuenta por {formatearUnidadPlural(unidad)}.</span>
          ) : cantidad > 0 || (modo === "contar" && texto.trim() !== "" && cantidad === 0) ? (
            <>
              {modo === "contar" ? "Queda en " : "= "}
              <strong>{formatearCantidad(cantidad)} {abreviatura}</strong>
              {porPiezas && largoMm ? (
                <span className="text-muted-foreground">
                  {" "}
                  ({formatearCantidad(valor)} × {largoTexto})
                </span>
              ) : null}
              {modo === "contar" && cantidad !== actual && (
                <span className="text-muted-foreground">
                  {" "}
                  · {cantidad > actual ? "sobran" : "faltan"} {formatearCantidad(Math.abs(cantidad - actual))}
                </span>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">
              {Number.isFinite(valor) || texto === "" ? " " : "Eso no es un número."}
            </span>
          )}
        </p>

        {modo === "mover" ? (
          <>
            {/* Sin cantidad los chips están apagados: tocar «Rotura» antes de
                poner el número no puede descontar nada. */}
            <div className="space-y-2">
              <FilaDeMotivos signo={1} motivos={MOTIVOS_QUE_SUMAN} habilitado={sePuedeMover} pendiente={pendiente} onElegir={cargar} />
              <FilaDeMotivos signo={-1} motivos={MOTIVOS_QUE_RESTAN} habilitado={sePuedeMover} pendiente={pendiente} onElegir={cargar} />
            </div>
          </>
        ) : (
          <button
            type="button"
            onClick={contar}
            disabled={pendiente || texto.trim() === "" || cantidad < 0 || decimalMal}
            className="h-10 rounded-md bg-accion text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-50"
          >
            {pendiente ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Dejar este número"}
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Una fila de motivos: el signo adelante y un chip por motivo, que ejecuta. */
function FilaDeMotivos({
  signo,
  motivos,
  habilitado,
  pendiente,
  onElegir,
}: {
  signo: 1 | -1;
  motivos: { valor: MotivoDeAjuste; texto: string }[];
  habilitado: boolean;
  pendiente: boolean;
  onElegir: (signo: 1 | -1, motivo: MotivoDeAjuste) => void;
}) {
  const Signo = signo === 1 ? Plus : Minus;
  return (
    <div className="flex items-center gap-2" role="group" aria-label={signo === 1 ? "Suma" : "Resta"}>
      <Signo className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      {motivos.map((m, i) => (
        <button
          key={m.valor}
          type="button"
          onClick={() => onElegir(signo, m.valor)}
          disabled={!habilitado}
          className={`inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-md text-base font-medium transition-colors disabled:opacity-40 ${
            signo === 1 && i === 0
              ? "bg-accion text-white hover:bg-brand-orange-dark"
              : "border hover:bg-muted"
          }`}
        >
          {pendiente && signo === 1 && i === 0 ? <Loader2 className="h-4 w-4 animate-spin" /> : m.texto}
          {signo === 1 && i === 0 && !pendiente && (
            <kbd className="rounded border border-current px-1 text-[11px] font-medium opacity-70">Enter</kbd>
          )}
        </button>
      ))}
    </div>
  );
}
