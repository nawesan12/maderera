"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import { DialogoPin } from "./dialogo-pin";

/**
 * Ningún admin cargó su PIN: todo lo que lo pide en el mostrador —vender bajo
 * la lista, anular una venta ajena— queda trabado hasta que alguien lo cargue.
 * Fijo en el inicio mientras dure, con el botón que lo carga ahí mismo.
 */
export function AvisoSinPin() {
  const [abierto, setAbierto] = useState(false);
  return (
    <div className="tarjeta-atencion flex flex-wrap items-center justify-between gap-3 px-5 py-4">
      <p className="flex items-center gap-2.5 text-base font-semibold">
        <KeyRound className="h-5 w-5 shrink-0 text-brand-orange" aria-hidden="true" />
        Cargá tu PIN de autorización
      </p>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="boton-accion inline-flex h-10 items-center rounded-lg px-4 text-base font-medium"
      >
        Cargar PIN
      </button>
      <DialogoPin abierto={abierto} alCerrar={() => setAbierto(false)} />
    </div>
  );
}
