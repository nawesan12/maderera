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
}: {
  largo: number;
  ancho: number;
  lados: LadosConCanto;
  alCambiar: (lados: LadosConCanto) => void;
  /** Las tiras: los cortes del ancho no llevan canto. */
  soloLargos?: boolean;
}) {
  // La pieza a escala, con un tope para que una tira de 2 m no quede como una
  // raya ni un cuadrado como una estampilla.
  const proporcion = largo > 0 && ancho > 0 ? Math.min(2.6, Math.max(1.1, largo / ancho)) : 1.6;
  const anchoPx = 104;
  const altoPx = Math.round(anchoPx / proporcion);

  const lado = (cual: keyof LadosConCanto, nombre: string, clase: string, barra: string) => (
    <button
      type="button"
      aria-pressed={lados[cual]}
      aria-label={`Canto ${nombre}`}
      onClick={() => alCambiar({ ...lados, [cual]: !lados[cual] })}
      className={`group absolute flex items-center justify-center ${clase}`}
    >
      <span
        className={`rounded-full transition-colors ${barra} ${
          lados[cual] ? "bg-accion" : "bg-linea group-hover:bg-accion/40"
        }`}
      />
    </button>
  );

  return (
    <div className="relative shrink-0" style={{ width: anchoPx + 24, height: altoPx + 24 }}>
      <div
        className="absolute rounded-[3px] border border-linea bg-sitio-alt"
        style={{ left: 12, top: 12, width: anchoPx, height: altoPx }}
      />
      {lado("arriba", "en el largo de arriba", "left-3 right-3 top-0 h-6", "h-[5px] w-full")}
      {lado("abajo", "en el largo de abajo", "bottom-0 left-3 right-3 h-6", "h-[5px] w-full")}
      {!soloLargos && lado("izquierda", "en el ancho de la izquierda", "bottom-3 left-0 top-3 w-6", "h-full w-[5px]")}
      {!soloLargos && lado("derecha", "en el ancho de la derecha", "bottom-3 right-0 top-3 w-6", "h-full w-[5px]")}
    </div>
  );
}
