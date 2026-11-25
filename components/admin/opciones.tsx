"use client";

/**
 * Elegir una entre pocas opciones con botones grandes, todos a la vista: el
 * medio de pago, retiro o envío. Un desplegable esconde las opciones detrás
 * de un clic más, y quien atiende el mostrador tiene que poder elegir sin
 * leer una lista.
 */
export function Opciones<T extends string>({
  valor,
  alCambiar,
  opciones,
  etiqueta,
}: {
  valor: T | null;
  alCambiar: (v: T) => void;
  /** Una opción deshabilitada se ve y no se elige: dice sola que no corresponde. */
  opciones: { valor: T; texto: string; deshabilitada?: boolean }[];
  /** Para el lector de pantalla: qué se está eligiendo. */
  etiqueta: string;
}) {
  return (
    <div role="radiogroup" aria-label={etiqueta} className="flex flex-wrap gap-2">
      {opciones.map((o) => {
        const elegida = o.valor === valor;
        return (
          <button
            key={o.valor}
            type="button"
            role="radio"
            aria-checked={elegida}
            disabled={o.deshabilitada}
            onClick={() => alCambiar(o.valor)}
            className={`h-11 rounded-lg px-4 text-base font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              elegida ? "boton-accion" : "bg-hundida hover:bg-muted"
            }`}
          >
            {o.texto}
          </button>
        );
      })}
    </div>
  );
}

/** Los medios con que se cobra un pedido, en el orden en que más se usan. */
export const MEDIOS_DEL_PEDIDO = [
  { valor: "efectivo", texto: "Efectivo" },
  { valor: "transferencia", texto: "Transferencia" },
  { valor: "debito", texto: "Débito" },
  { valor: "credito", texto: "Crédito" },
  { valor: "mercado_pago", texto: "Mercado Pago" },
] as const;
