"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, Trash2 } from "lucide-react";
import { formatearMonto } from "@/lib/formato";
import {
  buscarMercaderia,
  crearRecepcion,
  type EstadoRecepcion,
} from "../actions";

interface Hallazgo {
  variantId: string;
  producto: string | null;
  variante: string | null;
  sku: string | null;
  unidad: string;
  alicuotaIva: string;
  costoActual: string | null;
}

interface Linea {
  variantId: string;
  descripcion: string;
  unidad: string;
  cantidad: string;
  costoUnitario: string;
  alicuotaIva: string;
  /** A cuánto venía costando. Es contra esto que se mira el costo del remito. */
  costoActual: number | null;
}

/**
 * La carga de una recepción.
 *
 * Muestra el costo anterior de cada renglón al lado del que se está tipeando, y
 * eso no es decoración: un costo que se duplica de un remito al otro es casi
 * siempre un error de tipeo o una unidad distinta, y es infinitamente más
 * barato verlo acá que descubrirlo cuando el promedio ya se movió y no se puede
 * revertir.
 */
export function FormularioRecepcion({
  proveedores,
  sucursales,
}: {
  proveedores: { id: string; nombre: string }[];
  sucursales: { id: string; nombre: string }[];
}) {
  const router = useRouter();
  const [estado, setEstado] = useState<EstadoRecepcion>({});
  const [enCurso, empezar] = useTransition();

  const [supplierId, setSupplierId] = useState(proveedores[0]?.id ?? "");
  const [branchId, setBranchId] = useState(sucursales[0]?.id ?? "");
  const [numeroRemito, setNumeroRemito] = useState("");
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [gastos, setGastos] = useState("");
  const [notas, setNotas] = useState("");
  const [lineas, setLineas] = useState<Linea[]>([]);

  const [texto, setTexto] = useState("");
  const [hallazgos, setHallazgos] = useState<Hallazgo[]>([]);

  useEffect(() => {
    /*
     * Todo pasa dentro del temporizador, también el vaciado. Limpiar la lista
     * en el cuerpo del efecto sería escribir estado durante el pulso del
     * render, que dispara una cascada por cada tecla.
     */
    const t = setTimeout(() => {
      if (texto.trim().length < 2) {
        setHallazgos([]);
        return;
      }
      void buscarMercaderia(texto).then(setHallazgos);
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
              unidad: h.unidad,
              cantidad: "1",
              // Arranca en el costo que ya tenía: la mayoría de las veces el
              // remito repite el costo anterior, y lo que se corrige es la
              // excepción.
              costoUnitario: h.costoActual ?? "",
              alicuotaIva: h.alicuotaIva,
              costoActual: h.costoActual === null ? null : Number(h.costoActual),
            },
          ],
    );
    setTexto("");
    setHallazgos([]);
  }

  function cambiar(i: number, campo: keyof Linea, valor: string) {
    setLineas((prev) =>
      prev.map((l, j) => (i === j ? { ...l, [campo]: valor } : l)),
    );
  }

  const neto = lineas.reduce(
    (t, l) => t + Number(l.cantidad || 0) * Number(l.costoUnitario || 0),
    0,
  );
  const total = neto + Number(gastos || 0);

  function guardar() {
    empezar(async () => {
      const resultado = await crearRecepcion({
        supplierId,
        branchId,
        numeroRemito,
        fecha,
        gastos: Number(gastos || 0),
        notas,
        lineas: lineas.map((l) => ({
          variantId: l.variantId,
          cantidad: Number(l.cantidad),
          costoUnitario: Number(l.costoUnitario),
          alicuotaIva: Number(l.alicuotaIva),
        })),
      });
      setEstado(resultado);
      if (resultado.id) router.push(`/admin/recepciones/${resultado.id}`);
    });
  }

  const listo =
    supplierId !== "" &&
    branchId !== "" &&
    lineas.length > 0 &&
    lineas.every(
      (l) => Number(l.cantidad) > 0 && l.costoUnitario !== "" && Number(l.costoUnitario) >= 0,
    );

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
          <span className="text-sm font-medium">Sucursal</span>
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
          <span className="text-sm font-medium">Remito</span>
          <input
            value={numeroRemito}
            onChange={(e) => setNumeroRemito(e.target.value)}
            placeholder="0002-00034512"
            className="tabular mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium">Fecha de entrada</span>
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="tabular mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
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
              placeholder="Buscar mercadería por nombre, medida o SKU…"
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
                        ? `costaba ${formatearMonto(Number(h.costoActual))}`
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
            Buscá arriba lo que trajo el camión.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-base">
              <thead>
                <tr className="border-b border-linea text-left text-sm uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5 font-semibold">Mercadería</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Cant.</th>
                  <th className="px-4 py-2.5 text-right font-semibold">
                    Costo neto
                  </th>
                  <th className="px-4 py-2.5 text-right font-semibold">IVA</th>
                  <th className="px-4 py-2.5 text-right font-semibold">
                    Subtotal
                  </th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-linea">
                {lineas.map((l, i) => {
                  const nuevo = Number(l.costoUnitario || 0);
                  /*
                   * Un salto grande contra el costo anterior casi siempre es un
                   * error de tipeo o una unidad distinta. Avisarlo acá cuesta
                   * un cartel; descubrirlo después cuesta el promedio, que no
                   * se puede revertir.
                   */
                  const salto =
                    l.costoActual !== null &&
                    l.costoActual > 0 &&
                    nuevo > 0 &&
                    (nuevo / l.costoActual > 2 || nuevo / l.costoActual < 0.5);

                  return (
                    <tr key={l.variantId}>
                      <td className="px-4 py-2.5">
                        <span className="block">{l.descripcion}</span>
                        {l.costoActual !== null && (
                          <span className="tabular block text-sm text-muted-foreground">
                            venía a {formatearMonto(l.costoActual)}
                          </span>
                        )}
                        {salto && (
                          <span className="estado-espera block text-sm font-medium">
                            El costo cambió más del doble. ¿Es la misma unidad?
                          </span>
                        )}
                      </td>
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
                      <td className="px-4 py-2.5 text-right">
                        <select
                          value={l.alicuotaIva}
                          onChange={(e) =>
                            cambiar(i, "alicuotaIva", e.target.value)
                          }
                          className="tabular h-10 rounded-lg border border-linea bg-background px-2 text-base"
                        >
                          {["0.00", "10.50", "21.00", "27.00"].map((a) => (
                            <option key={a} value={a}>
                              {Number(a)}%
                            </option>
                          ))}
                        </select>
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
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="tarjeta grid gap-4 p-5 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium">Flete y otros gastos</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={gastos}
            onChange={(e) => setGastos(e.target.value)}
            className="tabular mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-right text-base"
          />
          <span className="text-sm text-muted-foreground">
            Netos. Se reparten entre los renglones en proporción a su valor.
          </span>
        </label>

        <label className="block">
          <span className="text-sm font-medium">Notas</span>
          <input
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            className="mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
          />
        </label>

        <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-3 border-t border-linea pt-4">
          <div>
            <p className="text-sm text-muted-foreground">Neto de la recepción</p>
            <p className="tabular text-2xl font-bold">
              {formatearMonto(total)}
            </p>
          </div>

          <button
            type="button"
            onClick={guardar}
            disabled={enCurso || !listo}
            className="inline-flex h-12 items-center gap-2 rounded-xl bg-accion px-5 text-base font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {enCurso && <Loader2 className="h-4 w-4 animate-spin" />}
            Guardar en borrador
          </button>
        </div>

        {estado.error && (
          <p className="sm:col-span-2 text-sm text-saldo-debe">{estado.error}</p>
        )}
      </section>
    </div>
  );
}
