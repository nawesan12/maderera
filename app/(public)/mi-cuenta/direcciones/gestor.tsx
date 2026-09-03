"use client";

import { useActionState, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  Check,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  borrarDireccion,
  guardarDireccion,
  type EstadoAccion,
} from "../actions";

export interface DireccionGuardada {
  id: string;
  etiqueta: string;
  calle: string;
  localidad: string;
  codigoPostal: string | null;
  notas: string | null;
  predeterminada: boolean;
}

const estadoInicial: EstadoAccion = {};

/**
 * Direcciones guardadas.
 *
 * El formulario se abre en el lugar de la tarjeta que se está editando en vez
 * de en una ventana aparte: así no se pierde de vista el resto de la lista, que
 * es justo lo que hace falta para no cargar dos veces la misma obra.
 */
export function GestorDirecciones({
  direcciones,
}: {
  direcciones: DireccionGuardada[];
}) {
  // null = nada abierto · "nueva" = alta · uuid = editando esa
  const [abierta, setAbierta] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <AnimatePresence initial={false}>
        {direcciones.map((direccion) =>
          abierta === direccion.id ? (
            <Formulario
              key={direccion.id}
              direccion={direccion}
              onCerrar={() => setAbierta(null)}
            />
          ) : (
            <Tarjeta
              key={direccion.id}
              direccion={direccion}
              onEditar={() => setAbierta(direccion.id)}
            />
          ),
        )}
      </AnimatePresence>

      {abierta === "nueva" ? (
        <Formulario onCerrar={() => setAbierta(null)} />
      ) : (
        <button
          type="button"
          onClick={() => setAbierta("nueva")}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-4 font-medium text-muted-foreground transition-colors hover:border-brand-orange/40 hover:bg-brand-orange/[0.03] hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
          Agregar una dirección
        </button>
      )}
    </div>
  );
}

function Tarjeta({
  direccion,
  onEditar,
}: {
  direccion: DireccionGuardada;
  onEditar: () => void;
}) {
  const [estado, accion, pendiente] = useActionState(
    borrarDireccion,
    estadoInicial,
  );

  return (
    <motion.article
      layout
      exit={{ opacity: 0, height: 0 }}
      className={`rounded-xl border bg-card p-5 ${
        direccion.predeterminada ? "border-brand-orange/40" : ""
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
            {direccion.etiqueta}
            {direccion.predeterminada && (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-orange/12 px-2 py-0.5 text-xs font-semibold text-brand-orange-dark">
                <Star className="h-3 w-3" />
                Principal
              </span>
            )}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {direccion.calle}, {direccion.localidad}
            {direccion.codigoPostal && ` (${direccion.codigoPostal})`}
          </p>
          {direccion.notas && (
            <p className="mt-1 text-sm text-muted-foreground">
              {direccion.notas}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onEditar}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Pencil className="h-4 w-4" />
            Editar
          </button>

          <form action={accion}>
            <input type="hidden" name="id" value={direccion.id} />
            <button
              type="submit"
              disabled={pendiente}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-700 disabled:opacity-60"
            >
              {pendiente ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              <span className="sr-only sm:not-sr-only">Borrar</span>
            </button>
          </form>
        </div>
      </div>

      {estado.error && (
        <p role="alert" className="mt-2 text-sm text-brand-red">
          {estado.error}
        </p>
      )}
    </motion.article>
  );
}

function Formulario({
  direccion,
  onCerrar,
}: {
  direccion?: DireccionGuardada;
  onCerrar: () => void;
}) {
  const [estado, accion, pendiente] = useActionState(
    guardarDireccion,
    estadoInicial,
  );

  // Guardó bien: se cierra sola. Dejarla abierta con los datos ya guardados
  // invita a apretar de nuevo y cargar la misma dirección dos veces.
  useEffect(() => {
    if (estado.ok) onCerrar();
  }, [estado.ok, onCerrar]);

  return (
    <motion.form
      layout
      action={accion}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4 rounded-xl border-2 border-brand-orange/35 bg-card p-5"
    >
      {direccion && <input type="hidden" name="id" value={direccion.id} />}

      <div className="flex items-center justify-between gap-4">
        <h3 className="font-medium">
          {direccion ? "Editar dirección" : "Nueva dirección"}
        </h3>
        <button
          type="button"
          onClick={onCerrar}
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Cancelar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="etiqueta">Nombre</Label>
          <Input
            id="etiqueta"
            name="etiqueta"
            defaultValue={direccion?.etiqueta}
            placeholder="Casa, Obra Alem 3400…"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="localidad">Localidad</Label>
          <Input
            id="localidad"
            name="localidad"
            defaultValue={direccion?.localidad ?? "Mar del Plata"}
            required
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
        <div className="space-y-2">
          <Label htmlFor="calle">Calle y altura</Label>
          <Input
            id="calle"
            name="calle"
            defaultValue={direccion?.calle}
            placeholder="Av. Juan B. Justo 3450"
            autoComplete="street-address"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="codigoPostal">Código postal</Label>
          <Input
            id="codigoPostal"
            name="codigoPostal"
            defaultValue={direccion?.codigoPostal ?? ""}
            placeholder="7600"
            inputMode="numeric"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="notas">Referencias para la entrega</Label>
        <Input
          id="notas"
          name="notas"
          defaultValue={direccion?.notas ?? ""}
          placeholder="Portón verde, entregar por el fondo"
        />
      </div>

      <label className="flex items-center gap-2.5 text-sm">
        <input
          type="checkbox"
          name="predeterminada"
          defaultChecked={direccion?.predeterminada}
          className="h-4 w-4 accent-[var(--brand-orange,#e2711d)]"
        />
        Usar esta dirección por defecto en el checkout
      </label>

      {estado.error && (
        <p
          role="alert"
          className="flex items-center gap-2 text-sm text-brand-red"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          {estado.error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pendiente}
          className="inline-flex h-11 items-center gap-2 rounded-lg bg-brand-orange px-5 font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
        >
          {pendiente ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          Guardar
        </button>
        <button
          type="button"
          onClick={onCerrar}
          className="inline-flex h-11 items-center rounded-lg border px-4 font-medium transition-colors hover:bg-muted"
        >
          Cancelar
        </button>
      </div>
    </motion.form>
  );
}
