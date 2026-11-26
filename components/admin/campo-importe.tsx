"use client";

import { useId, type InputHTMLAttributes } from "react";
import { importeDelCampo, importeIlegible, importeParaElCampo } from "@/lib/formato";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "inputMode" | "value" | "onChange"> & {
  valor: string;
  alCambiar: (texto: string) => void;
};

/**
 * El campo de plata del panel y del mostrador. `type="text"` con
 * `inputMode="decimal"`: con `type="number"` el navegador leía «15.000» como
 * 15 (y una persona en Argentina escribe así los miles). Se lee con
 * `importeDelCampo` y se precarga con `importeParaElCampo`.
 *
 * Si lo escrito no se entiende como importe, el campo queda marcado con
 * `aria-invalid` y lo dice abajo; el formulario usa `importeIlegible` para no
 * dejar mandar. Antes se tomaba como $0 sin avisar.
 */
export function CampoImporte({ valor, alCambiar, className = "", onBlur, ...resto }: Props) {
  const id = useId();
  const malo = importeIlegible(valor);
  return (
    <>
      <input
        {...resto}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={valor}
        onChange={(e) => alCambiar(e.target.value)}
        // Al salir, lo escrito se muestra como el resto de los importes:
        // «12000» quedaba al lado de «42.000».
        onBlur={(e) => {
          if (!malo && valor.trim()) {
            const prolijo = importeParaElCampo(importeDelCampo(valor));
            if (prolijo !== valor) alCambiar(prolijo);
          }
          onBlur?.(e);
        }}
        aria-invalid={malo || undefined}
        aria-describedby={malo ? id : resto["aria-describedby"]}
        className={className}
      />
      {malo && (
        <span id={id} role="alert" className="mt-1 block text-sm text-saldo-debe">
          No se entiende el importe
        </span>
      )}
    </>
  );
}
