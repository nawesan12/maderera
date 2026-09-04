"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { formatearMonto } from "@/lib/formato";
import { cargarSufrida, type EstadoSufrida } from "./actions";

const IMPUESTOS = {
  ganancias: "Ganancias",
  iva: "IVA",
  suss: "SUSS",
  iibb: "Ingresos Brutos",
};

/**
 * Carga de un certificado que trajo un cliente.
 *
 * El importe se pide aparte de la base y de la alícuota, y no se calcula: el
 * papel ya trae los tres números y lo que importa es cargar **lo que dice el
 * papel**. Si la cuenta del cliente no cierra con su certificado, el problema
 * es de él con el fisco, no nuestro.
 */
export function CargarSufrida({
  clientes,
}: {
  clientes: { id: string; nombre: string; cuit: string | null }[];
}) {
  const router = useRouter();
  const [estado, setEstado] = useState<EstadoSufrida>({});
  const [enCurso, empezar] = useTransition();

  const [customerId, setCustomerId] = useState(clientes[0]?.id ?? "");
  const [numero, setNumero] = useState("");
  const [impuesto, setImpuesto] = useState<keyof typeof IMPUESTOS>("ganancias");
  const [codigoRegimen, setCodigo] = useState("");
  const [base, setBase] = useState("");
  const [importe, setImporte] = useState("");
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [referencia, setReferencia] = useState("");

  const n = (v: string) => Number(v || 0);

  // La alícuota se deriva para mostrarla: es la verificación rápida de que los
  // tres números del papel son coherentes entre sí.
  const alicuota = n(base) > 0 ? (n(importe) / n(base)) * 100 : null;

  return (
    <section className="tarjeta space-y-4 p-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="text-sm font-medium">Cliente</span>
          <select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className="mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
          >
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium">Certificado n.º</span>
          <input
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            className="tabular mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium">Impuesto</span>
          <select
            value={impuesto}
            onChange={(e) =>
              setImpuesto(e.target.value as keyof typeof IMPUESTOS)
            }
            className="mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
          >
            {Object.entries(IMPUESTOS).map(([valor, texto]) => (
              <option key={valor} value={valor}>
                {texto}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium">Régimen</span>
          <input
            value={codigoRegimen}
            onChange={(e) => setCodigo(e.target.value)}
            placeholder="78"
            className="tabular mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium">Base</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={base}
            onChange={(e) => setBase(e.target.value)}
            className="tabular mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-right text-base"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium">Retenido</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={importe}
            onChange={(e) => setImporte(e.target.value)}
            className="tabular mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-right text-base"
          />
          {alicuota !== null && n(importe) > 0 && (
            <span className="text-sm text-muted-foreground">
              da {alicuota.toFixed(2)}%
            </span>
          )}
        </label>

        <label className="block">
          <span className="text-sm font-medium">Fecha</span>
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="tabular mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium">Comprobante</span>
          <input
            value={referencia}
            onChange={(e) => setReferencia(e.target.value)}
            placeholder="Factura sobre la que retuvieron"
            className="mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
          />
        </label>
      </div>

      {(estado.error || estado.ok) && (
        <p
          className={`text-base ${estado.error ? "text-saldo-debe" : "text-saldo-favor"}`}
        >
          {estado.error ?? estado.ok}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-linea pt-4">
        <p className="text-sm text-muted-foreground">
          {n(importe) > 0
            ? `La cuenta del cliente baja ${formatearMonto(n(importe))}.`
            : "El certificado salda deuda: no es un descuento."}
        </p>

        <button
          type="button"
          onClick={() =>
            empezar(async () => {
              const r = await cargarSufrida({
                customerId,
                numero,
                impuesto,
                codigoRegimen,
                base: n(base),
                alicuota: alicuota ?? undefined,
                importe: n(importe),
                fecha,
                referencia,
              });
              setEstado(r);
              if (r.ok) {
                setNumero("");
                setBase("");
                setImporte("");
                setReferencia("");
                router.refresh();
              }
            })
          }
          disabled={enCurso || !numero.trim() || n(importe) <= 0}
          className="inline-flex h-12 items-center gap-2 rounded-xl bg-accion px-5 text-base font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {enCurso && <Loader2 className="h-4 w-4 animate-spin" />}
          Cargar el certificado
        </button>
      </div>
    </section>
  );
}
