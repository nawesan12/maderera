"use client";

/**
 * Qué lados de la pieza llevan tapacanto, tocándolos sobre el dibujo.
 *
 * Arriba y abajo son los dos lados del largo; izquierda y derecha, los del
 * ancho. Lo que se guarda es cuántos de cada medida (`cantoLargo`,
 * `cantoAncho`, de 0 a 2), que es lo que usan el motor, la planilla del
 * taller y las etiquetas: cuál de los dos largos es «el de arriba» lo decide
 * quien pega el canto.
 *
 * Son botones y no un dibujo con clics: cada lado se alcanza con el teclado y
 * se anuncia con su nombre y su estado.
 *
 * El lado sin canto va punteado y en el gris del texto, no en el de las
 * líneas: con el gris de las líneas no se distinguía de la pieza y nadie
 * sabía que se podía tocar (T4, hallazgo 22). Y abajo, un botón para los
 * cuatro lados de una vez, que es lo que más se pide.
 */
export interface LadosConCanto {
  arriba: boolean;
  abajo: boolean;
  izquierda: boolean;
  derecha: boolean;
}

export const SIN_CANTO: LadosConCanto = { arriba: false, abajo: false, izquierda: false, derecha: false };

export function contarCanto(l: LadosConCanto) {
  return {
    cantoLargo: Number(l.arriba) + Number(l.abajo),
    cantoAncho: Number(l.izquierda) + Number(l.derecha),
  };
}

export function SelectorDeCanto({
  largo,
  ancho,
  lados,
  alCambiar,
  soloLargos,
  chico,
  rotulo,
}: {
  largo: number;
  ancho: number;
  lados: LadosConCanto;
  alCambiar: (lados: LadosConCanto) => void;
  /** Las tiras: los cortes del ancho no llevan canto. */
  soloLargos?: boolean;
  /** En la planilla del armador: casi a altura fija, para que los renglones
   *  no cambien de alto según la forma de la pieza. */
  chico?: boolean;
  /** En el teléfono, «Canto» arriba, como las etiquetas chicas de las medidas. */
  rotulo?: boolean;
}) {
  // La pieza a escala, con un tope para que una tira de 2 m no quede como una
  // raya ni un cuadrado como una estampilla.
  const proporcion =
    largo > 0 && ancho > 0
      ? // En la planilla, a lo sumo 1,8: más finita, el cuerpo de la pieza
        // —que es el botón de los cuatro lados— no se podía tocar.
        Math.min(chico ? 1.8 : 2.6, Math.max(chico ? 1.5 : 1.1, largo / ancho))
      : 1.6;
  const anchoPx = chico ? 64 : 104;
  const altoPx = Math.round(anchoPx / proporcion);

  /*
   * Prendido, una barra llena; apagado, un borde punteado del mismo largo.
   * `horizontal` dice de qué lado va el borde.
   */
  const lado = (cual: keyof LadosConCanto, nombre: string, clase: string, horizontal: boolean) => (
    <button
      type="button"
      aria-pressed={lados[cual]}
      aria-label={`Canto ${nombre}`}
      onClick={() => alCambiar({ ...lados, [cual]: !lados[cual] })}
      className={`group absolute flex items-center justify-center ${clase}`}
    >
      <span
        className={`transition-colors ${
          lados[cual]
            ? `rounded-full bg-accion ${horizontal ? "h-[5px] w-full" : "h-full w-[5px]"}`
            : `border-dashed border-texto-3 group-hover:border-accion ${
                horizontal ? "h-0 w-full border-t-2" : "h-full w-0 border-l-2"
              }`
        }`}
      />
    </button>
  );

  const cuales: (keyof LadosConCanto)[] = soloLargos ? ["arriba", "abajo"] : ["arriba", "abajo", "izquierda", "derecha"];
  const todos = cuales.every((c) => lados[c]);

  function todosOninguno() {
    const nuevo = { ...lados };
    for (const c of cuales) nuevo[c] = !todos;
    alCambiar(nuevo);
  }

  return (
    <div className="flex shrink-0 flex-col items-center">
      {rotulo && <span className="mb-0.5 self-start text-xs text-texto-3 @2xl:sr-only">Canto</span>}
      <div className="relative shrink-0" style={{ width: anchoPx + 24, height: altoPx + 24 }}>
        {/* El cuerpo de la pieza es el botón de todos los lados, y dice lo
            que hace el próximo toque: si falta alguno, los pone todos; si
            están todos, los saca. Un «Todo / Nada» fijo no decía en qué
            estado estaba. Va adentro del dibujo para no cambiar el alto del
            renglón de la planilla. */}
        <button
          type="button"
          onClick={todosOninguno}
          className={`absolute flex items-center justify-center rounded-[3px] border border-linea bg-sitio-alt font-medium leading-none text-texto-2 transition-colors hover:text-foreground ${
            chico ? "text-[11px]" : "text-xs"
          }`}
          style={{ left: 12, top: 12, width: anchoPx, height: altoPx }}
        >
          {todos ? "Ninguno" : soloLargos ? "2 lados" : "4 lados"}
        </button>
        {/* Cada lado se toca en una franja centrada en el borde; en la
            planilla, de 20 px y no de 24, para dejarle lugar al cuerpo. */}
        {lado("arriba", "en el largo de arriba", chico ? "left-3 right-3 top-0.5 h-5" : "left-3 right-3 top-0 h-6", true)}
        {lado("abajo", "en el largo de abajo", chico ? "bottom-0.5 left-3 right-3 h-5" : "bottom-0 left-3 right-3 h-6", true)}
        {!soloLargos &&
          lado("izquierda", "en el ancho de la izquierda", chico ? "bottom-3 left-0.5 top-3 w-5" : "bottom-3 left-0 top-3 w-6", false)}
        {!soloLargos &&
          lado("derecha", "en el ancho de la derecha", chico ? "bottom-3 right-0.5 top-3 w-5" : "bottom-3 right-0 top-3 w-6", false)}
      </div>
    </div>
  );
}
