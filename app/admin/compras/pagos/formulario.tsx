"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileCheck2, Loader2 } from "lucide-react";
import { formatearMonto } from "@/lib/formato";
import { pagarAProveedor, verAcumulado, type EstadoPago } from "./actions";

interface Proveedor {
  id: string;
  nombre: string;
  cuit: string | null;
  saldo: number;
}

interface Regimen {
  id: string;
  codigo: string;
  nombre: string;
  impuesto: string;
  alicuota: number;
  minimoNoImponible: number;
}

/**
 * Pagarle a un proveedor.
 *
 * Se carga **lo que se le imputa a la deuda**, no lo que sale del banco: lo
 * segundo lo calcula el sistema restando las retenciones. Pedir los dos números
 * invita a que no coincidan, y después no hay forma de saber cuál era el bueno.
 *
 * Las bases de retención arrancan en el importe del pago porque es el caso
 * normal —se retiene sobre lo que se paga— y se corrigen cuando el régimen mira
 * otra cosa, como el de IVA, que mira el IVA de la factura.
 */
export function FormularioPago({
  proveedores,
  regimenes,
}: {
  proveedores: Proveedor[];
  regimenes: Regimen[];
}) {
  const router = useRouter();
  const [estado, setEstado] = useState<EstadoPago>({});
  const [enCurso, empezar] = useTransition();

  const [supplierId, setSupplierId] = useState(proveedores[0]?.id ?? "");
  const [total, setTotal] = useState("");
  const [medio, setMedio] = useState("transferencia");
  const [referencia, setReferencia] = useState("");
  const [bases, setBases] = useState<Record<string, string>>({});

  /*
   * Lo ya retenido este mes a este proveedor, por régimen.
   *
   * Se muestra antes de pagar porque **es lo que explica por qué esta vez
   * retiene y la anterior no**: Ganancias mira el acumulado del mes, no cada
   * pago suelto. Sin esto a la vista, que no retenga parece un error del
   * sistema y alguien lo "corrige" a mano.
   */
  const [acumulado, setAcumulado] = useState<
    Record<string, { base: number; retenido: number }>
  >({});

  useEffect(() => {
    if (!supplierId) return;

    let vivo = true;
    void verAcumulado(supplierId).then((filas) => {
      if (!vivo) return;
      setAcumulado(
        Object.fromEntries(
          filas.map((f) => [
            f.codigoRegimen,
            { base: Number(f.base), retenido: Number(f.retenido) },
          ]),
        ),
      );
    });

    return () => {
      vivo = false;
    };
  }, [supplierId]);

  const proveedor = proveedores.find((p) => p.id === supplierId);
  const importe = Number(total || 0);

  if (proveedores.length === 0) {
    return (
      <p className="tarjeta px-5 py-8 text-center text-base text-muted-foreground">
        No hay proveedores con saldo pendiente.
      </p>
    );
  }

  return (
    <section className="tarjeta space-y-4 p-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="text-sm font-medium">Proveedor</span>
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className="mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
          >
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre} · debe {formatearMonto(p.saldo)}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium">Se le imputa</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            className="tabular mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-right text-base"
          />
          {proveedor && (
            <button
              type="button"
              onClick={() => setTotal(String(proveedor.saldo))}
              className="mt-1 text-sm text-muted-foreground underline"
            >
              Saldar todo: {formatearMonto(proveedor.saldo)}
            </button>
          )}
        </label>

        <label className="block">
          <span className="text-sm font-medium">Medio</span>
          <select
            value={medio}
            onChange={(e) => setMedio(e.target.value)}
            className="mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
          >
            <option value="transferencia">Transferencia</option>
            <option value="efectivo">Efectivo</option>
            <option value="cheque">Cheque</option>
            <option value="echeq">e-Cheq</option>
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium">Referencia</span>
          <input
            value={referencia}
            onChange={(e) => setReferencia(e.target.value)}
            placeholder="N.º de operación"
            className="mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
          />
        </label>
      </div>

      {regimenes.length > 0 && (
        <div className="border-t border-linea pt-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Retenciones a practicar
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Poné la base de cada régimen. El sistema mira el acumulado del mes:
            puede no retener aunque cargues una base, si todavía no llega al
            mínimo.
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {regimenes.map((r) => (
              <label key={r.id} className="block">
                <span className="text-sm font-medium">
                  {r.codigo} · {r.nombre}
                </span>
                <span className="block text-sm text-muted-foreground">
                  {r.alicuota}%
                  {r.minimoNoImponible > 0 &&
                    ` · mínimo ${formatearMonto(r.minimoNoImponible)} en el mes`}
                </span>
                {acumulado[r.codigo] && (
                  <span className="block text-sm text-muted-foreground">
                    Este mes ya lleva{" "}
                    {formatearMonto(acumulado[r.codigo].base)} de base y{" "}
                    {formatearMonto(acumulado[r.codigo].retenido)} retenidos.
                  </span>
                )}
                <div className="mt-1 flex gap-2">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={bases[r.id] ?? ""}
                    onChange={(e) =>
                      setBases((prev) => ({ ...prev, [r.id]: e.target.value }))
                    }
                    placeholder="Base"
                    className="tabular h-11 min-w-0 flex-1 rounded-lg border border-linea bg-card px-3 text-right text-base"
                  />
                  {importe > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setBases((prev) => ({ ...prev, [r.id]: String(importe) }))
                      }
                      className="h-11 shrink-0 rounded-lg border border-linea px-3 text-sm"
                    >
                      Todo
                    </button>
                  )}
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      {(estado.error || estado.ok) && (
        <p
          className={`text-base ${estado.error ? "text-saldo-debe" : "text-saldo-favor"}`}
        >
          {estado.error ?? estado.ok}
        </p>
      )}

      {estado.certificados && estado.certificados.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {estado.certificados.map((c) => (
            <li key={c.numero}>
              <a
                href={`/admin/compras/pagos/certificado/${c.numero}`}
                target="_blank"
                className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-linea px-3.5 text-sm font-medium hover:bg-hundida"
              >
                <FileCheck2 className="h-4 w-4" />
                {c.numero} · {formatearMonto(c.importe)}
              </a>
            </li>
          ))}
        </ul>
      )}

      <div className="flex justify-end border-t border-linea pt-4">
        <button
          type="button"
          onClick={() =>
            empezar(async () => {
              const r = await pagarAProveedor({
                supplierId,
                total: importe,
                medio: medio as "transferencia",
                referencia,
                retenciones: regimenes
                  .map((g) => ({
                    regimenId: g.id,
                    base: Number(bases[g.id] ?? 0),
                  }))
                  .filter((g) => g.base > 0),
              });
              setEstado(r);
              if (r.ok) {
                setTotal("");
                setReferencia("");
                setBases({});
                router.refresh();
              }
            })
          }
          disabled={enCurso || importe <= 0}
          className="inline-flex h-12 items-center gap-2 rounded-xl bg-accion px-5 text-base font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {enCurso && <Loader2 className="h-4 w-4 animate-spin" />}
          Registrar el pago
        </button>
      </div>
    </section>
  );
}
