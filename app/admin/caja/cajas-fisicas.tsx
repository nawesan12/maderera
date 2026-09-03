"use client";

import { useState, useTransition } from "react";
import { Loader2, Monitor, Plus } from "lucide-react";
import { haceCuanto } from "@/lib/formato";
import { crearCaja, darDeBajaCaja, type EstadoCajas } from "./actions";

interface CajaFisica {
  id: string;
  codigo: string;
  nombre: string | null;
  sucursal: string | null;
  activo: boolean;
  ultimaVezAt: Date | null;
  pendientes: number;
}

/**
 * Las máquinas que venden en el mostrador.
 *
 * Está acá y no en una pantalla propia porque se mira en el mismo momento que
 * el cierre: cuando la caja no cierra, la primera pregunta es si alguna máquina
 * tiene ventas colgadas. Tenerlo a dos pantallas de distancia lo volvería algo
 * que nadie chequea.
 */
export function CajasFisicas({
  cajas,
  sucursales,
}: {
  cajas: CajaFisica[];
  sucursales: { id: string; nombre: string }[];
}) {
  const [abierto, setAbierto] = useState(false);
  const [estado, setEstado] = useState<EstadoCajas>({});
  const [enCurso, empezar] = useTransition();

  const [codigo, setCodigo] = useState("");
  const [nombre, setNombre] = useState("");
  const [branchId, setBranchId] = useState(sucursales[0]?.id ?? "");

  function guardar() {
    empezar(async () => {
      const resultado = await crearCaja({ codigo, nombre, branchId });
      setEstado(resultado);
      if (resultado.ok) {
        setCodigo("");
        setNombre("");
        setAbierto(false);
      }
    });
  }

  return (
    <section className="tarjeta overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-linea px-5 py-3.5">
        <div>
          <h2 className="text-base font-semibold">Cajas del mostrador</h2>
          <p className="text-sm text-muted-foreground">
            Las máquinas que pueden cobrar sin internet. El código sale impreso
            en el ticket mientras no hay conexión.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAbierto((v) => !v)}
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-linea px-3.5 text-sm font-medium transition-colors hover:bg-hundida"
        >
          <Plus className="h-4 w-4" />
          Agregar
        </button>
      </header>

      {abierto && (
        <div className="border-b border-linea bg-hundida px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="text-sm font-medium">Código</span>
              <input
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.toUpperCase())}
                placeholder="CAJA1"
                maxLength={20}
                className="mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Nombre (opcional)</span>
              <input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="La del fondo"
                maxLength={80}
                className="mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
              />
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
          </div>

          <button
            type="button"
            onClick={guardar}
            disabled={enCurso}
            className="mt-3 inline-flex h-11 items-center gap-2 rounded-lg bg-accion px-4 text-base font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {enCurso && <Loader2 className="h-4 w-4 animate-spin" />}
            Crear la caja
          </button>
        </div>
      )}

      {(estado.error || estado.ok) && (
        <p
          className={`px-5 py-2.5 text-sm ${estado.error ? "text-saldo-debe" : "text-saldo-favor"}`}
        >
          {estado.error ?? estado.ok}
        </p>
      )}

      {cajas.length === 0 ? (
        <p className="px-5 py-10 text-center text-base text-muted-foreground">
          Todavía no hay ninguna caja dada de alta. Sin caja, el mostrador puede
          leer sin internet pero no cobrar: la venta necesita un número que el
          cliente se pueda llevar escrito.
        </p>
      ) : (
        <ul className="divide-y divide-linea">
          {cajas.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                  c.activo
                    ? "bg-hundida text-muted-foreground"
                    : "bg-muted text-muted-foreground opacity-50"
                }`}
              >
                <Monitor className="h-4.5 w-4.5" />
              </span>

              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold">
                  {c.codigo}
                  {c.nombre && (
                    <span className="ml-2 font-normal text-muted-foreground">
                      {c.nombre}
                    </span>
                  )}
                  {!c.activo && (
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      (dada de baja)
                    </span>
                  )}
                </p>
                <p className="text-sm text-muted-foreground">
                  {c.sucursal ?? "Sin sucursal"} ·{" "}
                  {c.ultimaVezAt
                    ? `se conectó ${haceCuanto(new Date(c.ultimaVezAt))}`
                    : "nunca se vinculó"}
                </p>
              </div>

              {c.pendientes > 0 && (
                <span className="estado-espera inline-flex shrink-0 items-center rounded-lg bg-[var(--estado-fondo)] px-2.5 py-1 text-sm font-semibold">
                  {c.pendientes} sin subir
                </span>
              )}

              {c.activo && (
                <button
                  type="button"
                  onClick={() =>
                    empezar(async () => setEstado(await darDeBajaCaja(c.id)))
                  }
                  disabled={enCurso}
                  className="inline-flex h-10 shrink-0 items-center rounded-lg border border-linea px-3.5 text-sm font-medium transition-colors hover:bg-hundida disabled:opacity-60"
                >
                  Dar de baja
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
