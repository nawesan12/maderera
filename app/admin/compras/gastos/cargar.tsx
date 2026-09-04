"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { cargarGasto, type EstadoGasto } from "./actions";

const CATEGORIAS = {
  flete: "Fletes",
  combustible: "Combustible",
  servicios: "Servicios",
  alquiler: "Alquiler",
  sueldos: "Sueldos",
  mantenimiento: "Mantenimiento",
  impuestos: "Impuestos",
  librería: "Librería",
  publicidad: "Publicidad",
  otros: "Otros",
};

/**
 * Anotar un gasto.
 *
 * La sucursal solo hace falta cuando se paga en efectivo, porque es lo que
 * decide **de qué cajón salió la plata**. Con transferencia el gasto sale del
 * banco y pedir la sucursal sería pedir un dato que después no significa nada.
 */
export function CargarGasto({
  sucursales,
  proveedores,
}: {
  sucursales: { id: string; nombre: string; conTurno: boolean }[];
  proveedores: { id: string; nombre: string }[];
}) {
  const router = useRouter();
  const [estado, setEstado] = useState<EstadoGasto>({});
  const [enCurso, empezar] = useTransition();

  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [categoria, setCategoria] = useState<keyof typeof CATEGORIAS>("flete");
  const [descripcion, setDescripcion] = useState("");
  const [importe, setImporte] = useState("");
  const [medio, setMedio] = useState("efectivo");
  const [branchId, setBranchId] = useState(sucursales[0]?.id ?? "");
  const [supplierId, setSupplierId] = useState("");

  const enEfectivo = medio === "efectivo";
  const sucursal = sucursales.find((s) => s.id === branchId);

  return (
    <section className="tarjeta space-y-4 p-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
          <span className="text-sm font-medium">Categoría</span>
          <select
            value={categoria}
            onChange={(e) =>
              setCategoria(e.target.value as keyof typeof CATEGORIAS)
            }
            className="mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
          >
            {Object.entries(CATEGORIAS).map(([valor, texto]) => (
              <option key={valor} value={valor}>
                {texto}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium">Importe</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={importe}
            onChange={(e) => setImporte(e.target.value)}
            className="tabular mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-right text-base"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium">Medio</span>
          <select
            value={medio}
            onChange={(e) => setMedio(e.target.value)}
            className="mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
          >
            <option value="efectivo">Efectivo</option>
            <option value="transferencia">Transferencia</option>
            <option value="debito">Débito</option>
            <option value="credito">Crédito</option>
            <option value="cheque">Cheque</option>
          </select>
        </label>

        <label className="block sm:col-span-2">
          <span className="text-sm font-medium">En qué se gastó</span>
          <input
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Flete a la obra de Alem"
            className="mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
          />
        </label>

        {enEfectivo && (
          <label className="block">
            <span className="text-sm font-medium">De qué caja salió</span>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
            >
              {sucursales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                  {s.conTurno ? "" : " · sin turno abierto"}
                </option>
              ))}
            </select>
            {sucursal && !sucursal.conTurno && (
              <span className="text-sm text-muted-foreground">
                El gasto se anota igual, pero no va a salir de ningún turno.
              </span>
            )}
          </label>
        )}

        <label className="block">
          <span className="text-sm font-medium">Proveedor (opcional)</span>
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className="mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
          >
            <option value="">—</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </label>
      </div>

      {(estado.error || estado.ok) && (
        <p
          className={`text-base ${estado.error ? "text-saldo-debe" : "text-saldo-favor"}`}
        >
          {estado.error ?? estado.ok}
        </p>
      )}
      {estado.aviso && (
        <p className="estado-espera rounded-lg bg-[var(--estado-fondo)] px-3 py-2 text-sm">
          {estado.aviso}
        </p>
      )}

      <div className="flex justify-end border-t border-linea pt-4">
        <button
          type="button"
          onClick={() =>
            empezar(async () => {
              const r = await cargarGasto({
                fecha,
                categoria,
                descripcion,
                importe: Number(importe || 0),
                medio: medio as "efectivo",
                branchId: enEfectivo ? branchId : undefined,
                supplierId: supplierId || undefined,
              });
              setEstado(r);
              if (r.ok) {
                setDescripcion("");
                setImporte("");
                router.refresh();
              }
            })
          }
          disabled={enCurso || !descripcion.trim() || Number(importe || 0) <= 0}
          className="inline-flex h-12 items-center gap-2 rounded-xl bg-accion px-5 text-base font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {enCurso && <Loader2 className="h-4 w-4 animate-spin" />}
          Anotar el gasto
        </button>
      </div>
    </section>
  );
}
