"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, Trash2 } from "lucide-react";
import { formatearMonto } from "@/lib/formato";
import {
  buscarParaPedir,
  crearOrdenDeCompra,
  type EstadoOrden,
} from "../actions";

interface Hallazgo {
  variantId: string;
  producto: string | null;
  variante: string | null;
  sku: string | null;
  alicuotaIva: string;
  costoActual: string | null;
}

interface Linea {
  variantId: string;
  descripcion: string;
  cantidad: string;
  costoUnitario: string;
  alicuotaIva: string;
}

/**
 * La carga de una orden.
 *
 * El costo arranca en el último conocido: una orden se hace casi siempre a los
 * precios de la vez anterior, y lo que se corrige es la excepción. Tipear todo
 * de cero invita a equivocarse en lo que ya se sabía.
 */
export function FormularioOrden({
  proveedores,
  sucursales,
}: {
  proveedores: { id: string; nombre: string }[];
  sucursales: { id: string; nombre: string }[];
}) {
  const router = useRouter();
  const [estado, setEstado] = useState<EstadoOrden>({});
  const [enCurso, empezar] = useTransition();

  const [supplierId, setSupplierId] = useState(proveedores[0]?.id ?? "");
  const [branchId, setBranchId] = useState(sucursales[0]?.id ?? "");
  const [fechaPrometida, setFecha] = useState("");
  const [notas, setNotas] = useState("");
  const [lineas, setLineas] = useState<Linea[]>([]);

  const [texto, setTexto] = useState("");
  const [hallazgos, setHallazgos] = useState<Hallazgo[]>([]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (texto.trim().length < 2) {
        setHallazgos([]);
        return;
      }
      void buscarParaPedir(texto).then(setHallazgos);
    }, 250);
    return () => clearTimeout(t);
  }, [texto]);

  function agregar(h: Hallazgo) {
    setLineas((prev) =>
      prev.some((l) => l.variantId === h.variantId)
        ? prev
        : [
            ...prev,
            {
              variantId: h.variantId,
              descripcion: [h.producto, h.variante].filter(Boolean).join(" "),
              cantidad: "1",
              costoUnitario: h.costoActual ?? "",
              alicuotaIva: h.alicuotaIva,
            },
          ],
    );
    setTexto("");
    setHallazgos([]);
  }

  function cambiar(i: number, campo: keyof Linea, valor: string) {
    setLineas((prev) => prev.map((l, j) => (i === j ? { ...l, [campo]: valor } : l)));
  }

  const neto = lineas.reduce(
    (t, l) => t + Number(l.cantidad || 0) * Number(l.costoUnitario || 0),
    0,
  );

  const listo =
    supplierId !== "" &&
    branchId !== "" &&
    lineas.length > 0 &&
    lineas.every((l) => Number(l.cantidad) > 0 && l.costoUnitario !== "");

  return (
    <div className="space-y-4">
      <section className="tarjeta grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="text-sm font-medium">Proveedor</span>
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className="mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
          >
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium">Entrega en</span>
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
          >
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium">Fecha prometida</span>
          <input
            type="date"
            value={fechaPrometida}
            onChange={(e) => setFecha(e.target.value)}
            className="tabular mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium">Notas</span>
          <input
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            className="mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
          />
        </label>
      </section>

      <section className="tarjeta overflow-hidden">
        <div className="border-b border-linea p-4">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Buscar qué pedir…"
              className="h-12 w-full rounded-lg border border-linea bg-background pl-9 pr-3 text-base"
            />
          </label>

          {hallazgos.length > 0 && (
            <ul className="mt-2 divide-y divide-linea rounded-lg border border-linea">
              {hallazgos.map((h) => (
                <li key={h.variantId}>
                  <button
                    type="button"
                    onClick={() => agregar(h)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-hundida"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-base">
                        {h.producto} {h.variante}
                      </span>
                      <span className="tabular block text-sm text-muted-foreground">
                        {h.sku}
                      </span>
                    </span>
                    <span className="tabular shrink-0 text-sm text-muted-foreground">
                      {h.costoActual
                        ? formatearMonto(Number(h.costoActual))
                        : "sin costo"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {lineas.length === 0 ? (
          <p className="px-5 py-10 text-center text-base text-muted-foreground">
            Buscá arriba qué pedirle al proveedor.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-base">
              <thead>
                <tr className="border-b border-linea text-left text-sm uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5 font-semibold">Mercadería</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Cant.</th>
                  <th className="px-4 py-2.5 text-right font-semibold">
                    Costo neto
                  </th>
                  <th className="px-4 py-2.5 text-right font-semibold">
                    Subtotal
                  </th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-linea">
                {lineas.map((l, i) => (
                  <tr key={l.variantId}>
                    <td className="px-4 py-2.5">{l.descripcion}</td>
                    <td className="px-4 py-2.5 text-right">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={l.cantidad}
                        onChange={(e) => cambiar(i, "cantidad", e.target.value)}
                        className="tabular h-10 w-24 rounded-lg border border-linea bg-background px-2 text-right text-base"
                      />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={l.costoUnitario}
                        onChange={(e) =>
                          cambiar(i, "costoUnitario", e.target.value)
                        }
                        className="tabular h-10 w-32 rounded-lg border border-linea bg-background px-2 text-right text-base"
                      />
                    </td>
                    <td className="tabular px-4 py-2.5 text-right font-semibold">
                      {formatearMonto(
                        Number(l.cantidad || 0) * Number(l.costoUnitario || 0),
                      )}
                    </td>
                    <td className="px-2 py-2.5">
                      <button
                        type="button"
                        onClick={() =>
                          setLineas((prev) => prev.filter((_, j) => j !== i))
                        }
                        className="rounded-lg p-2 text-muted-foreground hover:bg-hundida hover:text-foreground"
                        aria-label="Sacar el renglón"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="tarjeta flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <p className="text-sm text-muted-foreground">Neto de la orden</p>
          <p className="tabular text-2xl font-bold">{formatearMonto(neto)}</p>
        </div>

        <button
          type="button"
          onClick={() =>
            empezar(async () => {
              const r = await crearOrdenDeCompra({
                supplierId,
                branchId,
                fechaPrometida: fechaPrometida || undefined,
                notas,
                lineas: lineas.map((l) => ({
                  variantId: l.variantId,
                  descripcion: l.descripcion,
                  cantidad: Number(l.cantidad),
                  costoUnitario: Number(l.costoUnitario),
                  alicuotaIva: Number(l.alicuotaIva),
                })),
              });
              setEstado(r);
              if (r.id) router.push(`/admin/compras/ordenes/${r.id}`);
            })
          }
          disabled={enCurso || !listo}
          className="inline-flex h-12 items-center gap-2 rounded-xl bg-accion px-5 text-base font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {enCurso && <Loader2 className="h-4 w-4 animate-spin" />}
          Crear la orden
        </button>

        {estado.error && (
          <p className="w-full text-sm text-saldo-debe">{estado.error}</p>
        )}
      </section>
    </div>
  );
}
