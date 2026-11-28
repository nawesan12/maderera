"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil } from "lucide-react";
import { formatearMonto } from "@/lib/formato";
import { AnularConMotivo } from "../../anular-con-motivo";
import { anularFacturaDeCompra, aplicarNotaDeCredito } from "../actions";
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
            confirmar={factura.tipo.startsWith("nota_") ? "Anular la nota" : "Anular la factura"}
            anular={(motivo) => anularFacturaDeCompra(factura.id, factura.supplierId, motivo)}
            alTerminar={setResultado}
          />
        </div>
      )}
      {resultado && <p className="text-base text-saldo-favor">{resultado}</p>}
    </section>
  );
}

/** Aplicar la nota de crédito a favor a una factura con saldo del mismo proveedor. */
export function AplicarNota({
  nota,
  supplierId,
  facturas,
}: {
  nota: string;
  supplierId: string;
  facturas: { id: string; numero: string; saldo: number }[];
}) {
  const router = useRouter();
  const [factura, setFactura] = useState(facturas[0]?.id ?? "");
  const [error, setError] = useState("");
  const [enCurso, empezar] = useTransition();
  return (
    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
      <select
        value={factura}
        onChange={(e) => setFactura(e.target.value)}
        aria-label="Factura a la que se aplica"
        className="h-11 min-w-0 flex-1 rounded-lg border border-linea bg-card px-3 text-base sm:flex-none"
      >
        {facturas.map((f) => (
          <option key={f.id} value={f.id}>
            {f.numero} · quedan {formatearMonto(f.saldo)}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={enCurso || !factura}
        onClick={() =>
          empezar(async () => {
            const r = await aplicarNotaDeCredito(nota, supplierId, factura);
            setError(r.error ?? "");
            if (r.ok) router.refresh();
          })
        }
        className="boton-accion inline-flex h-11 items-center gap-2 rounded-xl px-5 text-base font-semibold disabled:opacity-50"
      >
        {enCurso && <Loader2 className="h-4 w-4 animate-spin" />}
        Aplicar
      </button>
      {error && (
        <p className="w-full text-base font-medium text-saldo-debe" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
