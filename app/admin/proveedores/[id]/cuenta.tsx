"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, SlidersHorizontal } from "lucide-react";
import { formatearMonto, importeDelCampo, importeIlegible } from "@/lib/formato";
import { Opciones } from "@/components/admin/formulario";
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
  purchaseInvoiceId: string | null;
  supplierPaymentId: string | null;
}

const TIPOS: Record<string, string> = {
  factura: "Factura",
  pago: "Pago",
  nota_credito: "Nota de crédito",
  nota_debito: "Nota de débito",
  ajuste: "Ajuste",
};

/** A dónde lleva un movimiento: a la factura o al pago del que salió. */
function destino(m: Movimiento): string | null {
  if (m.purchaseInvoiceId) return `/admin/compras/facturas/${m.purchaseInvoiceId}`;
  if (m.supplierPaymentId) return `/admin/compras/pagos/${m.supplierPaymentId}`;
  return null;
}

/**
 * El libro de la cuenta, con el saldo de cada renglón.
 *
 * Cada renglón lleva a la factura o al pago del que salió (Go lo sabe desde
 * la 00101). Lo que se anota a mano es **solo un ajuste** —un saldo inicial,
 * una bonificación acordada, un redondeo— con su motivo. Bug arreglado: acá
 * se podía anotar una «Factura» o un «Pago» que no pasaba por compras ni por
 * el libro IVA: la deuda bajaba sin pago (ni retenciones, ni caja, ni
 * cheque) y subía sin crédito fiscal.
 *
 * El monto se carga siempre en positivo y el lado lo dice la opción. Pedirle
 * a alguien que escriba "-45000" es pedirle que se olvide el menos una vez
 * cada veinte, y esa vez la deuda sube el doble en vez de bajar.
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

  const [ajustando, setAjustando] = useState(false);
  const [sentido, setSentido] = useState<"sube" | "baja">("baja");
  const [monto, setMonto] = useState("");
  const [referencia, setReferencia] = useState("");
  const [detalle, setDetalle] = useState("");

  function anotar() {
    empezar(async () => {
      const resultado = await registrarMovimientoDeProveedor({
        supplierId,
        sentido,
        monto: importeDelCampo(monto),
        referencia,
        detalle,
      });
      setEstado(resultado);
      if (resultado.ok) {
        setMonto("");
        setReferencia("");
        setDetalle("");
        setAjustando(false);
        router.refresh();
      }
    });
  }

  return (
    <section className="tarjeta overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
        <h2 className="text-[19px] font-bold tracking-tight">Cuenta corriente</h2>
        {!ajustando && (
          <button
            type="button"
            onClick={() => setAjustando(true)}
            className="tarjeta-hundida inline-flex h-11 items-center gap-2 rounded-xl px-4 text-base font-medium"
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            Anotar un ajuste
          </button>
        )}
      </header>

      {ajustando && (
        <div className="tarjeta-hundida mx-5 mt-4 grid gap-4 rounded-xl p-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <Opciones
              nombre="ajuste-sentido"
              opciones={[
                { valor: "baja", texto: "Baja lo que le debemos" },
                { valor: "sube", texto: "Sube lo que le debemos" },
              ]}
              valor={sentido}
              alCambiar={(v) => setSentido(v as "sube" | "baja")}
              columnas={2}
            />
          </div>
          <label className="block">
            <span className="text-base font-medium">Monto</span>
            <input
              type="text"
              inputMode="decimal"
              value={monto}
              aria-invalid={importeIlegible(monto) || undefined}
              onChange={(e) => setMonto(e.target.value)}
              className="tabular mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-right text-base"
            />
          </label>
          <label className="block">
            <span className="text-base font-medium">Comprobante</span>
            <input
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
              className="tabular mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
            />
          </label>
          <label className="block md:col-span-2">
            <span className="text-base font-medium">Motivo</span>
            <input
              value={detalle}
              onChange={(e) => setDetalle(e.target.value)}
              className="mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2 md:col-span-2">
            <button
              type="button"
              onClick={anotar}
              disabled={enCurso || importeIlegible(monto) || !(importeDelCampo(monto) > 0) || detalle.trim() === ""}
              className="boton-accion inline-flex h-11 items-center gap-2 rounded-xl px-5 text-base font-semibold disabled:opacity-50"
            >
              {enCurso && <Loader2 className="h-4 w-4 animate-spin" />}
              Anotar
            </button>
            <button
              type="button"
              onClick={() => setAjustando(false)}
              className="tarjeta h-11 rounded-xl px-4 text-base font-medium"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {(estado.error || estado.ok) && (
        <p className={`px-5 pt-3 text-base ${estado.error ? "text-saldo-debe" : "text-saldo-favor"}`}>
          {estado.error ?? estado.ok}
        </p>
      )}

      {movimientos.length === 0 ? (
        <p className="px-5 py-10 text-center text-base text-muted-foreground">Sin movimientos</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] text-base">
            <thead>
              <tr className="border-b border-linea text-left text-sm uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-2.5 font-semibold">Fecha</th>
                <th className="px-5 py-2.5 font-semibold">Movimiento</th>
                <th className="px-5 py-2.5 font-semibold">Detalle</th>
                <th className="px-5 py-2.5 text-right font-semibold">Monto</th>
                <th className="px-5 py-2.5 text-right font-semibold">Saldo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-linea">
              {movimientos.map((m) => {
                const href = destino(m);
                const nombre = (
                  <>
                    <span className="block">{TIPOS[m.tipo] ?? m.tipo}</span>
                    {m.referencia && <span className="tabular block text-sm text-muted-foreground">{m.referencia}</span>}
                  </>
                );
                return (
                  <tr key={m.id}>
                    <td className="tabular px-5 py-3 text-muted-foreground">
                      {new Date(m.createdAt).toLocaleDateString("es-AR", {
                        timeZone: "America/Argentina/Buenos_Aires",
                        day: "2-digit",
                        month: "2-digit",
                        year: "2-digit",
                      })}
                    </td>
                    <td className="px-5 py-3">
                      {href ? (
                        <Link href={href} className="block font-medium hover:underline">
                          {nombre}
                        </Link>
                      ) : (
                        nombre
                      )}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{m.detalle ?? "—"}</td>
                    <td
                      className={`tabular px-5 py-3 text-right font-semibold ${
                        m.monto > 0 ? "text-saldo-debe" : "text-saldo-favor"
                      }`}
                    >
                      {formatearMonto(m.monto)}
                    </td>
                    <td className="tabular px-5 py-3 text-right">{formatearMonto(m.saldo)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
