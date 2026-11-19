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
 * sabía que se podía tocar (T4, hallazgo 22). Y el cuerpo de la pieza pone
 * o saca los cuatro lados de una vez, que es lo que más se pide.
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
        {/* El cuerpo de la pieza pone los lados que faltan o, si están
            todos, los saca. No lleva texto: una palabra adentro del dibujo
            se lee como el estado, y «Ninguno» sobre una pieza con los cuatro
            lados o «4 lados» en cada renglón vacío decían lo contrario de lo
            que había (comité de T4). El estado lo dicen las barras, y el
            cuerpo se tiñe cuando están todas. La acción va en el aria-label.

            En la planilla con el dedo (pointer-coarse) el cuerpo no se toca:
            queda entre franjas de 24 px y un toque que erraba un lado por
            poco prendía o borraba los cuatro sin que se viera. Ahí cada lado
            se toca solo. */}
        <button
          type="button"
          onClick={todosOninguno}
          aria-label={todos ? "Sacar el canto" : soloLargos ? "Poner canto en los dos largos" : "Poner canto en los 4 lados"}
          className={`absolute rounded-[3px] border transition-colors ${
            todos ? "border-accion/40 bg-accion/10" : "border-linea bg-sitio-alt hover:border-accion/40"
          } ${chico ? "pointer-coarse:pointer-events-none" : ""}`}
          style={{ left: 12, top: 12, width: anchoPx, height: altoPx }}
        />
        {/* Cada lado se toca en una franja centrada en el borde. En la
            planilla, de 20 px con mouse, para dejarle lugar al cuerpo, y de
            24 con el dedo, donde el cuerpo no se toca. */}
        {lado("arriba", "en el largo de arriba", chico ? "left-3 right-3 top-0.5 h-5 pointer-coarse:top-0 pointer-coarse:h-6" : "left-3 right-3 top-0 h-6", true)}
        {lado("abajo", "en el largo de abajo", chico ? "bottom-0.5 left-3 right-3 h-5 pointer-coarse:bottom-0 pointer-coarse:h-6" : "bottom-0 left-3 right-3 h-6", true)}
        {!soloLargos &&
          lado("izquierda", "en el ancho de la izquierda", chico ? "bottom-3 left-0.5 top-3 w-5 pointer-coarse:left-0 pointer-coarse:w-6" : "bottom-3 left-0 top-3 w-6", false)}
        {!soloLargos &&
          lado("derecha", "en el ancho de la derecha", chico ? "bottom-3 right-0.5 top-3 w-5 pointer-coarse:right-0 pointer-coarse:w-6" : "bottom-3 right-0 top-3 w-6", false)}
      </div>
    </div>
  );
}
