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
  anulado,
}: {
  id: string;
  supplierId: string;
  titulo: string;
  detalle: string;
  /**
   * Ya anulado, queda solo la respuesta de Go. Se monta igual: si la ficha lo
   * sacaba al anular, el router.refresh lo desmontaba y se perdía el aviso de
   * los certificados posteriores (mes 23, M2S2-013).
   */
  anulado: boolean;
}) {
  const [resultado, setResultado] = useState("");
  if (anulado && !resultado) return null;
  return (
    <div className="flex flex-col items-end gap-2">
      {!anulado && (
        <AnularConMotivo
          titulo={titulo}
          detalle={detalle}
          confirmar="Anular el pago"
          anular={(motivo) => anularPago(id, supplierId, motivo)}
          alTerminar={setResultado}
        />
      )}
      {resultado && (
        <p role="status" className="max-w-md text-right text-base text-saldo-favor">
          {resultado}
        </p>
      )}
    </div>
  );
}
