"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { formatearMonto } from "@/lib/formato";
import {
  registrarMovimientoDeProveedor,
  type EstadoProveedor,
} from "../actions";

interface Movimiento {
  id: string;
  tipo: string;
  monto: number;
  detalle: string | null;
  referencia: string | null;
  createdAt: Date;
  saldo: number;
}

const TIPOS = {
  factura: "Factura",
  pago: "Pago",
  nota_credito: "Nota de crédito",
  nota_debito: "Nota de débito",
  ajuste: "Ajuste",
};

/**
 * El libro de la cuenta, con el saldo de cada renglón.
 *
 * El monto se carga siempre en positivo y el signo lo pone el tipo. Pedirle a
 * alguien que escriba "-45000" para anotar un pago es pedirle que se olvide el
 * menos una vez cada veinte, y esa vez la deuda del proveedor sube el doble en
 * vez de bajar.
 */
export function CuentaDelProveedor({
  supplierId,
  movimientos,
}: {
  supplierId: string;
  movimientos: Movimiento[];
}) {
  const router = useRouter();
  const [estado, setEstado] = useState<EstadoProveedor>({});
  const [enCurso, empezar] = useTransition();

  const [tipo, setTipo] = useState<keyof typeof TIPOS>("factura");
  const [monto, setMonto] = useState("");
  const [referencia, setReferencia] = useState("");
  const [detalle, setDetalle] = useState("");

  function anotar() {
    empezar(async () => {
      const resultado = await registrarMovimientoDeProveedor({
        supplierId,
        tipo,
        monto: Number(monto),
        referencia,
        detalle,
      });
      setEstado(resultado);
      if (resultado.ok) {
        setMonto("");
        setReferencia("");
        setDetalle("");
        router.refresh();
      }
    });
  }

  return (
    <section className="tarjeta overflow-hidden">
      <header className="border-b border-linea px-5 py-3.5">
        <h2 className="text-base font-semibold">Cuenta corriente</h2>
        <p className="text-sm text-muted-foreground">
          Positivo es lo que se le debe. El signo lo pone el tipo: el monto se
          carga siempre en positivo.
        </p>
      </header>

      <div className="grid gap-2 border-b border-linea bg-hundida px-5 py-4 sm:grid-cols-[auto_130px_150px_1fr_auto]">
        <select
          value={tipo}
          onChange={(e) => setTipo(e.target.value as keyof typeof TIPOS)}
          className="h-11 rounded-lg border border-linea bg-card px-3 text-base"
        >
          {Object.entries(TIPOS).map(([valor, texto]) => (
            <option key={valor} value={valor}>
              {texto}
            </option>
          ))}
        </select>

        <input
          type="number"
          min="0"
          step="0.01"
          value={monto}
          onChange={(e) => setMonto(e.target.value)}
          placeholder="Monto"
          className="tabular h-11 rounded-lg border border-linea bg-card px-3 text-right text-base"
        />

        <input
          value={referencia}
          onChange={(e) => setReferencia(e.target.value)}
          placeholder="0003-00001274"
          className="tabular h-11 rounded-lg border border-linea bg-card px-3 text-base"
        />

        <input
          value={detalle}
          onChange={(e) => setDetalle(e.target.value)}
          placeholder="Detalle (opcional)"
          className="h-11 min-w-0 rounded-lg border border-linea bg-card px-3 text-base"
        />

        <button
          type="button"
          onClick={anotar}
          disabled={enCurso || monto === "" || Number(monto) <= 0}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-accion px-4 text-base font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {enCurso && <Loader2 className="h-4 w-4 animate-spin" />}
          Anotar
        </button>
      </div>

      {(estado.error || estado.ok) && (
        <p
          className={`px-5 py-2.5 text-sm ${estado.error ? "text-saldo-debe" : "text-saldo-favor"}`}
        >
          {estado.error ?? estado.ok}
        </p>
      )}

      {movimientos.length === 0 ? (
        <p className="px-5 py-10 text-center text-base text-muted-foreground">
          Todavía no hay movimientos en esta cuenta.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-base">
            <thead>
              <tr className="border-b border-linea text-left text-sm uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-2.5 font-semibold">Fecha</th>
                <th className="px-5 py-2.5 font-semibold">Tipo</th>
                <th className="px-5 py-2.5 font-semibold">Comprobante</th>
                <th className="px-5 py-2.5 font-semibold">Detalle</th>
                <th className="px-5 py-2.5 text-right font-semibold">Monto</th>
                <th className="px-5 py-2.5 text-right font-semibold">Saldo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-linea">
              {movimientos.map((m) => (
                <tr key={m.id}>
                  <td className="tabular px-5 py-3 text-muted-foreground">
                    {new Date(m.createdAt).toLocaleDateString("es-AR", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "2-digit",
                    })}
                  </td>
                  <td className="px-5 py-3">
                    {TIPOS[m.tipo as keyof typeof TIPOS] ?? m.tipo}
                  </td>
                  <td className="tabular px-5 py-3 text-muted-foreground">
                    {m.referencia ?? "—"}
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {m.detalle ?? "—"}
                  </td>
                  <td
                    className={`tabular px-5 py-3 text-right font-semibold ${
                      m.monto > 0 ? "text-saldo-debe" : "text-saldo-favor"
                    }`}
                  >
                    {formatearMonto(m.monto)}
                  </td>
                  <td className="tabular px-5 py-3 text-right">
                    {formatearMonto(m.saldo)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
