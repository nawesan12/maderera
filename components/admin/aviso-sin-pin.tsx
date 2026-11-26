"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import { DialogoPin } from "./dialogo-pin";

/**
 * Ningún admin cargó su PIN: todo lo que lo pide en el mostrador —vender bajo
 * la lista, anular una venta ajena— queda trabado hasta que alguien lo cargue.
 *
 * Es una celda más de «Para hoy» (mes simulado, H067): iba como una franja
 * entre el selector de período y los números, lejos de lo que había que hacer
 * a la mañana. Toda la celda abre el diálogo; en lugar de la cifra, la llave.
 */
export function CeldaPin({
  texto,
  tieneClave,
  className,
}: {
  texto: string;
  tieneClave: boolean;
  className: string;
}) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className={`${className} text-left`}
      >
        <KeyRound className="h-8 w-8 text-acento-texto sm:h-11 sm:w-11" aria-hidden="true" />
        <span className="text-[15px] font-semibold leading-tight group-hover:underline sm:text-base">
          {texto}
        </span>
      </button>
      <DialogoPin abierto={abierto} alCerrar={() => setAbierto(false)} tieneClave={tieneClave} />
    </>
  );
}
