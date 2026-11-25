"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { formatearMonto } from "@/lib/formato";
import { AnularConMotivo } from "../../anular-con-motivo";
import { anularFacturaDeCompra } from "../actions";
import {
  CargarFactura,
  type FacturaParaCorregir,
  type ProveedorDeFactura,
} from "../cargar";

/**
 * Corregir o anular la factura.
 *
 * Corregir abre el mismo formulario del alta con lo cargado; anular pide el
 * motivo. El detalle de la anulación dice qué pasa con los pagos que ya se le
 * aplicaron, que es lo que no se ve desde acá.
 */
export function AccionesDeFactura({
  factura,
  titulo,
  total,
  pagado,
  proveedor,
  proveedores,
}: {
  factura: FacturaParaCorregir;
  titulo: string;
  total: number;
  pagado: number;
  proveedor: string;
  proveedores: ProveedorDeFactura[];
}) {
  const [corrigiendo, setCorrigiendo] = useState(false);
  const [resultado, setResultado] = useState("");

  return (
    <section className="space-y-4">
      {corrigiendo ? (
        <CargarFactura
          proveedores={proveedores}
          recepciones={[]}
          corregir={factura}
          alTerminar={() => setCorrigiendo(false)}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCorrigiendo(true)}
            className="tarjeta-hundida inline-flex h-11 items-center gap-2 rounded-xl px-4 text-base font-medium"
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
            Corregir
          </button>
          <AnularConMotivo
            titulo={`Anular la ${titulo} de ${formatearMonto(total)} de ${proveedor}`}
            detalle={
              pagado > 0.009
                ? `Sale del libro IVA y la cuenta de ${proveedor} vuelve a como estaba antes de cargarla. Los ${formatearMonto(pagado)} que ya se le pagaron quedan a cuenta, para aplicarlos a otra factura.`
                : `Sale del libro IVA y la cuenta de ${proveedor} vuelve a como estaba antes de cargarla. El número queda libre para cargar la correcta.`
            }
            confirmar="Anular la factura"
            anular={(motivo) => anularFacturaDeCompra(factura.id, factura.supplierId, motivo)}
            alTerminar={setResultado}
          />
        </div>
      )}
      {resultado && <p className="text-base text-saldo-favor">{resultado}</p>}
    </section>
  );
}
