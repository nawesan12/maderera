"use client";

import { useActionState, useEffect, useState } from "react";
import {
  AlertCircle,
  Building2,
  Check,
  Hash,
  ListOrdered,
  Loader2,
  Plus,
  Power,
  X,
} from "lucide-react";
import { Hoja, Interruptor, Seccion } from "@/components/admin/formulario";
import { guardarPuntoVenta, type EstadoFactura } from "../facturacion/actions";

const inicial: EstadoFactura = {};

export interface PuntoVentaListado {
  id: string;
  numero: number;
  nombre: string;
  activo: boolean;
  branchId: string | null;
  numeroInicial: number;
  sucursal: string | null;
}

/**
 * Alta y edición de puntos de venta.
 *
 * El número no es decorativo: es el que se habilitó en ARCA, y de él depende la
 * numeración de todos los comprobantes. Por eso el formulario lo dice
 * explícitamente en vez de dejarlo como un campo más.
 */
export function PuntosDeVenta({
  puntos,
  sucursales,
}: {
  puntos: PuntoVentaListado[];
  sucursales: { id: string; nombre: string }[];
}) {
  const [editando, setEditando] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {puntos.map((punto) =>
        editando === punto.id ? (
          <Formulario
            key={punto.id}
            punto={punto}
            sucursales={sucursales}
            onCerrar={() => setEditando(null)}
          />
        ) : (
          <article
            key={punto.id}
            className={punto.activo ? "tarjeta p-5" : "tarjeta-hundida p-5"}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="flex items-center gap-2.5 text-base font-medium">
                  <span className="tabular rounded-md bg-muted px-2 py-0.5">
                    {String(punto.numero).padStart(4, "0")}
                  </span>
                  {punto.nombre}
                  {!punto.activo && (
                    <span className="text-base font-normal text-muted-foreground">
                      inactivo
                    </span>
                  )}
                </p>
                <p className="mt-1 text-base text-muted-foreground">
                  {punto.sucursal
                    ? `Sucursal ${punto.sucursal}`
                    : "Para toda la empresa"}
                </p>
                {/* Sin el último número emitido, el primer comprobante sale
                    número 1 y pisa una serie que ARCA viene contando. Es lo
                    único de esta pantalla que no se puede corregir después. */}
                {punto.numeroInicial > 0 ? (
                  <p className="mt-1 text-base text-muted-foreground">
                    Sigue desde el{" "}
                    <span className="tabular">
                      {String(punto.numeroInicial).padStart(8, "0")}
                    </span>
                  </p>
                ) : (
                  <p className="mt-1 text-base text-[var(--estado-tinta,#8a5a08)]">
                    Falta el último número emitido en el sistema anterior
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => setEditando(punto.id)}
                className="inline-flex h-10 items-center rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
              >
                Editar
              </button>
            </div>
          </article>
        ),
      )}

      {editando === "nuevo" ? (
        <Formulario
          sucursales={sucursales}
          onCerrar={() => setEditando(null)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditando("nuevo")}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-4 text-base font-medium text-muted-foreground transition-colors hover:border-brand-orange/40 hover:bg-brand-orange/[0.03] hover:text-foreground"
        >
          <Plus className="h-5 w-5" />
          Agregar un punto de venta
        </button>
      )}
    </div>
  );
}

function Formulario({
  punto,
  sucursales,
  onCerrar,
}: {
  punto?: PuntoVentaListado;
  sucursales: { id: string; nombre: string }[];
  onCerrar: () => void;
}) {
  const [estado, accion, pendiente] = useActionState(
    guardarPuntoVenta,
    inicial,
  );

  useEffect(() => {
    if (estado.ok) onCerrar();
  }, [estado.ok, onCerrar]);

  return (
    <form action={accion} className="space-y-4">
      {punto && <input type="hidden" name="id" value={punto.id} />}

      <div className="flex items-center justify-between gap-4">
        <h3 className="text-base font-medium">
          {punto ? "Editar punto de venta" : "Nuevo punto de venta"}
        </h3>
        <button
          type="button"
          onClick={onCerrar}
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Cancelar"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <Hoja>
        <Seccion titulo="Punto de venta" icono={Hash}>
          <div>
            <label
              htmlFor="numero"
              className="mb-1.5 block text-base font-medium"
            >
              Número
            </label>
            <input
              id="numero"
              name="numero"
              required
              inputMode="numeric"
              defaultValue={punto?.numero}
              className="tabular h-10 w-full rounded-lg border bg-background px-3 text-base"
            />
          </div>

          <div>
            <label
              htmlFor="nombre"
              className="mb-1.5 block text-base font-medium"
            >
              Nombre
            </label>
            <input
              id="nombre"
              name="nombre"
              required
              defaultValue={punto?.nombre}
              placeholder="Casa Central"
              className="h-10 w-full rounded-lg border bg-background px-3 text-base"
            />
          </div>

          <p className="text-base text-muted-foreground md:col-span-2">
            El número tiene que ser el mismo que habilitaste en ARCA con
            modalidad Webservices. Si no coincide, los comprobantes se rechazan.
          </p>
        </Seccion>

        <Seccion titulo="Numeración" icono={ListOrdered} columnas={1}>
          <div>
            <label
              htmlFor="numeroInicial"
              className="mb-1.5 block text-base font-medium"
            >
              Último número emitido en el sistema anterior
            </label>
            <input
              id="numeroInicial"
              name="numeroInicial"
              type="number"
              min={0}
              defaultValue={punto?.numeroInicial ?? 0}
              className="h-10 w-full rounded-lg border bg-background px-3 text-base sm:w-56"
            />
            <p className="mt-1.5 text-base text-muted-foreground">
              El sistema numera desde el siguiente. Es lo que evita que el
              primer comprobante salga con el número 1 y choque con una serie
              que ARCA ya tiene registrada. Se saca del último comprobante
              emitido en Quality Software para este punto de venta; cero es
              correcto solo si el punto de venta es nuevo.
            </p>
          </div>
        </Seccion>

        <Seccion titulo="Dónde se usa" icono={Building2}>
          <div>
            <label
              htmlFor="branchId"
              className="mb-1.5 block text-base font-medium"
            >
              Sucursal
            </label>
            <select
              id="branchId"
              name="branchId"
              defaultValue={punto?.branchId ?? ""}
              className="h-10 w-full rounded-lg border bg-background px-2.5 text-base"
            >
              <option value="">Para toda la empresa</option>
              {sucursales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="self-end">
            <Interruptor
              nombre="activo"
              etiqueta="Activo"
              icono={Power}
              defecto={punto?.activo ?? true}
            />
          </div>
        </Seccion>
      </Hoja>

      {estado.error && (
        <p
          role="alert"
          className="flex items-center gap-2 text-base text-red-700"
        >
          <AlertCircle className="h-5 w-5 shrink-0" />
          {estado.error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pendiente}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-accion px-4 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
        >
          {pendiente ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Check className="h-5 w-5" />
          )}
          Guardar
        </button>
        <button
          type="button"
          onClick={onCerrar}
          className="inline-flex h-10 items-center rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
