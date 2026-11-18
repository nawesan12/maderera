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
    <div className="mt-[18px] pb-1.5 pt-0.5">
      {/*
        Las columnas se reparten el ancho y, cuando no entran, bajan a la fila
        siguiente; en el teléfono quedan una abajo de la otra. Antes el tablero
        se corría de costado, y en el celular eso era ver una columna y media.
      */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,268px),1fr))] items-start gap-3">
        {children}
      </div>
    </div>
  );
}

/** Cuántas tarjetas se muestran antes de plegar el resto. */
const TOPE_VISIBLE = 6;

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
    // La pizarra del aserradero: el nombre de la etapa y, grande, cuánto hay
    // en ella. La raya de color aparece solo donde hay trabajo; vacía, la
    // columna queda baja y en gris (pedido de Nahuel, 18/11: «menos genérico»).
    <section className="tarjeta-hundida flex flex-col overflow-hidden rounded-xl">
      <header className="sticky top-0 z-[2] px-3.5 pb-2 pt-3">
        <span
          className={`${claseDeFamilia(estado)} mb-2.5 block h-[3px] w-[34px] rounded-full ${
            cantidad > 0 ? "bg-[var(--estado-acento)]" : "bg-linea"
          }`}
          aria-hidden="true"
        />
        <div className="flex items-baseline gap-2.5">
          <span
            className={`tabular text-[28px] font-bold leading-none tracking-[-0.03em] ${
              cantidad > 0 ? "text-foreground" : "text-texto-3"
            }`}
          >
            {cantidad}
          </span>
          <h2 className={`text-[15px] font-semibold tracking-[-0.01em] ${cantidad > 0 ? "" : "text-texto-2"}`}>
            {titulo}
          </h2>
          {detalle && (
            <span className="tabular ml-auto text-[13px] text-texto-2">
              {detalle}
            </span>
          )}
        </div>
      </header>

      {/*
        La columna scrollea sola en lugar de estirar la página: con cincuenta
        pedidos en una etapa, una columna infinita obliga a bajar hasta el fondo
        para ver qué hay en las otras, que es justo lo que el tablero venía a
        resolver.
      */}
      <div className="flex max-h-[calc(100vh-300px)] flex-col gap-2.5 overflow-y-auto px-2.5 pb-2.5">
        {cantidad === 0 ? (
          <p className="px-1 pb-2 text-sm text-texto-3">
            {vacio}
          </p>
        ) : (
          <>
            {visibles}

            {hayDeMas && !expandida && (
              <button
                onClick={() => setExpandida(true)}
                className="flex h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-linea text-sm text-texto-2 transition-colors hover:bg-card hover:text-foreground"
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
