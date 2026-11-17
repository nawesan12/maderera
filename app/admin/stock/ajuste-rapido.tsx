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
  branchSlug,
  sucursal,
  unidad,
  largoMm,
  actual,
}: {
  variantId: string;
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
        if (resultado.ok) toast.success(resultado.ok);
        alTerminar?.();
        router.refresh();
      }
    });
  }

  // La placa se ajusta de a media: es lo que queda cuando se vende una.
  const paso = unidad === "placa" ? 0.5 : 1;
  const nombrePaso = paso === 1 ? "uno" : "media";

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => ajustar(-paso)}
        disabled={pendiente}
        className="flex h-9 min-w-9 items-center justify-center rounded-md border px-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        aria-label={`Restar ${nombrePaso} en ${sucursal}`}
      >
        <Minus className="h-4 w-4" />
        {paso !== 1 && <span className="tabular text-sm">½</span>}
      </button>
      <button
        onClick={() => ajustar(paso)}
        disabled={pendiente}
        className="flex h-9 min-w-9 items-center justify-center rounded-md border px-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        aria-label={`Sumar ${nombrePaso} en ${sucursal}`}
      >
        {pendiente ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Plus className="h-4 w-4" />
        )}
        {paso !== 1 && <span className="tabular text-sm">½</span>}
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
const MOTIVOS: { valor: MotivoDeAjuste; texto: string }[] = [
  { valor: "ingreso", texto: "Ingreso" },
  { valor: "rotura", texto: "Rotura" },
  { valor: "devolucion", texto: "Devolución" },
  { valor: "otro", texto: "Otro" },
];

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
  const [motivo, setMotivo] = useState<MotivoDeAjuste>("ingreso");
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

  function cargar(signo: 1 | -1) {
    if (cantidad <= 0 || decimalMal) return;
    onCargar(signo * cantidad, listo, { motivo: signo === 1 && motivo === "rotura" ? "otro" : motivo });
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
      <PopoverContent align="start" className="w-80 gap-3 p-4">
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
              if (e.key === "Enter") {
                e.preventDefault();
                if (modo === "contar") contar();
                else cargar(e.shiftKey ? -1 : 1);
              }
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
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Por qué">
              {MOTIVOS.map((m) => (
                <button
                  key={m.valor}
                  type="button"
                  role="radio"
                  aria-checked={motivo === m.valor}
                  onClick={() => setMotivo(m.valor)}
                  className={`h-8 rounded-full px-3 text-sm ${
                    motivo === m.valor ? "bg-foreground text-background" : "bg-hundida text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m.texto}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => cargar(-1)}
                disabled={pendiente || cantidad <= 0 || decimalMal}
                className="h-10 rounded-md border text-base transition-colors hover:bg-muted disabled:opacity-50"
              >
                Restar
              </button>
              <button
                type="button"
                onClick={() => cargar(1)}
                disabled={pendiente || cantidad <= 0 || decimalMal}
                className="h-10 rounded-md bg-accion text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-50"
              >
                {pendiente ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Sumar"}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">Enter suma · Mayús + Enter resta</p>
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
