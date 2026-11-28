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
    <div className="@container mt-[18px] pb-1.5 pt-0.5">
      {/*
        Con lugar (1024 px de tablero, lo que pide el peor caso: cuatro
        columnas con trabajo de 240 px), una sola fila de izquierda a derecha
        como avanza el trabajo: la columna con tarjetas se lleva el ancho y la
        vacía se angosta (el peso lo pone cada columna). Repartido en partes
        iguales, las vacías ocupaban lo mismo que la llena.

        Sin ese lugar, dos por fila en orden (la tercera abajo de la primera),
        y en el teléfono una abajo de la otra. **Nunca de costado**: la regla
        del 18/11 vale también adentro de un bloque, y una tablet o una
        notebook con el menú abierto dejaban «Listos» detrás de un scroll sin
        ninguna señal. Se mide el tablero (`@container`) y no la pantalla,
        porque el menú lateral se come 244 px.
      */}
      <div className="grid items-start gap-3 @xl:grid-cols-2 @5xl:flex">
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
  tope = TOPE_VISIBLE,
  secundaria = false,
  largo = false,
  enDos = false,
  children,
}: {
  /**
   * Las tarjetas de a dos desde lg: la cola del taller sola en la pantalla
   * (M4-090: ocupaba 3/5 en una columna y el resto quedaba vacío).
   */
  enDos?: boolean;
  /**
   * Sin scroll propio: la columna crece con la página. En el taller la
   * columna de terminados cortaba la última tarjeta por la mitad (M2S4-040).
   */
  largo?: boolean;
  /**
   * Lo que ya pasó y se mira de reojo (los terminados del taller): con
   * tarjetas, más angosta que las columnas del trabajo. En el taller las tres
   * medían lo mismo y «Terminados» ocupaba tanto como la cola (H404).
   */
  secundaria?: boolean;
  titulo: string;
  cantidad: number;
  detalle?: string;
  /** Cuántas tarjetas se ven antes de «Ver N más». */
  tope?: number;
  /**
   * El estado que representa la columna. La franja de color sale de acá y no
   * como clase suelta: quien llama dice qué es la columna, no de qué color
   * pintarla, así que no hay forma de que dos pantallas la pinten distinto.
   */
  estado: string;
  children: React.ReactNode;
}) {
  const [expandida, setExpandida] = useState(false);

  const tarjetas = Array.isArray(children) ? children.flat() : [children];
  // Plegar una sola tarjeta no ahorra lugar: el botón ocupa casi lo mismo y
  // esconde un trabajo (mes simulado, M3S1-040).
  const hayDeMas = tarjetas.length > tope + 1;
  const visibles =
    hayDeMas && !expandida ? tarjetas.slice(0, tope) : tarjetas;
  const ocultas = tarjetas.length - visibles.length;

  return (
    // La pizarra del aserradero: el nombre de la etapa y, grande, cuánto hay
    // en ella. La raya de color aparece solo donde hay trabajo; vacía, la
    // columna queda baja y en gris (pedido de Nahuel, 18/11: «menos genérico»).
    // Vacía es solo el encabezado con el 0, angosta: el 0 ya dice que no hay
    // nada, y una caja con «Nada esperando» no agrega.
    <section
      className={`tarjeta-hundida flex min-w-0 flex-col overflow-hidden rounded-xl ${
        cantidad > 0
          ? secundaria
            ? "@5xl:min-w-[240px] @5xl:flex-[1.6_1_0%]"
            : "@5xl:min-w-[240px] @5xl:flex-[3_1_0%]"
          : "@5xl:min-w-[132px] @5xl:flex-[1_1_0%]"
      }`}
    >
      {/* Vacía y en el teléfono, un renglón: «0 Sin preparar» y «0
          Preparando» se llevaban media pantalla y el primer pedido para
          atender quedaba abajo (mes simulado). */}
      <header className={`sticky top-0 z-[2] px-3.5 pb-2 pt-3 ${cantidad > 0 ? "" : "@max-xl:py-2"}`}>
        <span
          className={`${claseDeFamilia(estado)} mb-2.5 block h-[3px] w-[34px] rounded-full ${
            cantidad > 0 ? "bg-[var(--estado-acento)]" : "bg-linea @max-xl:hidden"
          }`}
          aria-hidden="true"
        />
        {/* El título nunca se parte: si no entra al lado del número (la
            columna vacía y angosta), baja entero abajo del 0. */}
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span
            className={`tabular text-[28px] font-bold leading-none tracking-[-0.03em] ${
              cantidad > 0 ? "text-foreground" : "text-texto-3 @max-xl:text-lg"
            }`}
          >
            {cantidad}
          </span>
          <h2 className={`whitespace-nowrap text-[15px] font-semibold tracking-[-0.01em] ${cantidad > 0 ? "" : "text-texto-2"}`}>
            {titulo}
          </h2>
        </div>
        {/* En su renglón: al lado del título, «$ 1.234.567» no entraba y bajaba
            desordenado. */}
        {detalle && (
          <p className="tabular mt-1 whitespace-nowrap text-[13px] text-texto-2">
            {detalle}
          </p>
        )}
      </header>

      {/*
        En una fila (escritorio ancho) la columna scrollea sola en lugar de
        estirar la página: con cincuenta pedidos en una etapa, una columna
        infinita obliga a bajar hasta el fondo para ver qué hay en las otras.
        Apiladas (teléfono y tablet) no: un scroll dentro de otro mostraba una
        tarjeta y media y escondía «Ver N más» (mes simulado, H121 y H329).
        Para lo largo está el pliegue.
      */}
      {cantidad > 0 && (
        <div
          className={`${enDos ? "grid lg:grid-cols-2" : "flex flex-col"} gap-2.5 px-2.5 pb-2.5 ${largo ? "" : "@5xl:max-h-[calc(100vh-300px)] @5xl:overflow-y-auto"}`}
        >
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
        </div>
      )}
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
