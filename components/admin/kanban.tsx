"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { claseDeFamilia } from "@/components/admin/etiqueta-estado";

/**
 * Tablero por estados.
 *
 * Un pedido y un corte no son una lista: son algo que avanza por etapas. Verlos
 * en columnas muestra de un vistazo dónde se está juntando el trabajo —seis
 * tarjetas apiladas en "Preparando" y ninguna en "Listo" dice algo que una tabla
 * ordenada por fecha esconde.
 */
export function Tablero({ children }: { children: React.ReactNode }) {
  return (
    <div className="-mx-4 mt-6 overflow-x-auto px-4 pb-2 lg:-mx-8 lg:px-8">
      {/*
        En pantalla ancha las columnas se reparten el espacio; cuando no entran,
        toman un ancho mínimo cómodo y el tablero scrollea en horizontal.
      */}
      <div className="grid auto-cols-[minmax(17rem,1fr)] grid-flow-col items-start gap-4">
        {children}
      </div>
    </div>
  );
}

/** Cuántas tarjetas se muestran antes de plegar el resto. */
const TOPE_VISIBLE = 8;

export function ColumnaTablero({
  titulo,
  cantidad,
  detalle,
  estado,
  vacio,
  children,
}: {
  titulo: string;
  cantidad: number;
  detalle?: string;
  /**
   * El estado que representa la columna. La franja de color sale de acá y no
   * como clase suelta: quien llama dice qué es la columna, no de qué color
   * pintarla, así que no hay forma de que dos pantallas la pinten distinto.
   */
  estado: string;
  vacio: string;
  children: React.ReactNode;
}) {
  const [expandida, setExpandida] = useState(false);

  const tarjetas = Array.isArray(children) ? children.flat() : [children];
  const hayDeMas = tarjetas.length > TOPE_VISIBLE;
  const visibles =
    hayDeMas && !expandida ? tarjetas.slice(0, TOPE_VISIBLE) : tarjetas;
  const ocultas = tarjetas.length - visibles.length;

  return (
    <section className="flex flex-col">
      <header className="tarjeta-cabecera rounded-t-xl bg-card px-4 pb-3 pt-3">
        <span
          className={`${claseDeFamilia(estado)} mb-3 block h-[3px] w-[34px] rounded-full bg-[var(--estado-acento)]`}
          aria-hidden="true"
        />
        <div className="flex items-baseline gap-2">
          <h2 className="text-base font-semibold">{titulo}</h2>
          <span className="tabular rounded-full bg-muted px-2 py-0.5 text-sm font-medium text-muted-foreground">
            {cantidad}
          </span>
        </div>
        {detalle && (
          <p className="tabular mt-0.5 text-sm text-muted-foreground">
            {detalle}
          </p>
        )}
      </header>

      {/*
        La columna scrollea sola en lugar de estirar la página: con cincuenta
        pedidos en una etapa, una columna infinita obliga a bajar hasta el fondo
        para ver qué hay en las otras, que es justo lo que el tablero venía a
        resolver.
      */}
      <div className="tarjeta-hundida max-h-[calc(100vh-19rem)] space-y-2.5 overflow-y-auto rounded-b-xl rounded-t-none p-2.5">
        {cantidad === 0 ? (
          <p className="px-2 py-8 text-center text-base text-muted-foreground">
            {vacio}
          </p>
        ) : (
          <>
            {visibles}

            {hayDeMas && !expandida && (
              <button
                onClick={() => setExpandida(true)}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed py-2.5 text-base text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
              >
                <ChevronDown className="h-4 w-4" />
                Ver {ocultas} más
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/** Tarjeta suelta dentro de una columna. */
export function TarjetaTablero({
  children,
  destacada = false,
}: {
  children: React.ReactNode;
  destacada?: boolean;
}) {
  return (
    // Columna flex para que la fila de botones quede siempre pegada al pie:
    // si sube o baja según cuánto texto tenga cada tarjeta, la columna se lee
    // desprolija y cuesta apuntar al botón correcto.
    <article
      className={`flex h-full flex-col p-3.5 ${
        destacada ? "tarjeta-atencion" : "tarjeta"
      }`}
    >
      {children}
    </article>
  );
}
