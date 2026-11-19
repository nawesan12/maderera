"use client";

/**
 * «¿Están en mm?», en el lugar del botón que manda el corte.
 *
 * Aparece cuando todas las piezas miden menos de 10 cm de cada lado
 * (`medidasSospechosas`): lo más probable es que se hayan cargado en
 * centímetros. Es una pregunta con dos salidas y no un texto que explique, y
 * va donde está el dedo —en el botón que se acaba de tocar—, no en un cartel
 * aparte. El foco cae en «Corregir»: si se aprieta Enter por costumbre, lo que
 * pasa es lo seguro.
 */
export function PreguntaMm({
  onSi,
  onCorregir,
  className = "",
}: {
  onSi: () => void;
  onCorregir: () => void;
  className?: string;
}) {
  return (
    <div role="group" aria-label="¿Las medidas están en milímetros?" className={`flex items-center gap-2 ${className}`}>
      <span className="text-base font-semibold">¿Están en mm?</span>
      <button
        type="button"
        onClick={onSi}
        className="h-12 rounded-lg border border-linea px-4 text-base font-medium transition-colors hover:bg-hundida"
      >
        Sí
      </button>
      <button
        type="button"
        autoFocus
        onClick={onCorregir}
        className="h-12 rounded-lg bg-accion px-4 text-base font-semibold text-white transition-colors hover:bg-accion-hover"
      >
        Corregir
      </button>
    </div>
  );
}
