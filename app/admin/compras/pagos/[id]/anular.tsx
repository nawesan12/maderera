"use client";

import { useState } from "react";
import { AnularConMotivo } from "../../anular-con-motivo";
import { anularPago } from "../actions";

/**
 * Anular el pago, desde su ficha: el título nombra el pago con su monto y el
 * detalle dice, de lo que toca, solo lo que este pago tiene (certificados,
 * cheques, efectivo). Lo que contesta Go queda a la vista: si la caja no
 * tenía turno, dice que el efectivo que vuelve no entró a ninguno.
 */
export function AnularPago({
  id,
  supplierId,
  titulo,
  detalle,
}: {
  id: string;
  supplierId: string;
  titulo: string;
  detalle: string;
}) {
  const [resultado, setResultado] = useState("");
  return (
    <div className="flex flex-col items-end gap-2">
      <AnularConMotivo
        titulo={titulo}
        detalle={detalle}
        confirmar="Anular el pago"
        anular={(motivo) => anularPago(id, supplierId, motivo)}
        alTerminar={setResultado}
      />
      {resultado && <p className="max-w-md text-right text-base text-saldo-favor">{resultado}</p>}
    </div>
  );
}
