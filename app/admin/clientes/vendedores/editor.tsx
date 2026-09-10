"use client";

import { useActionState, useId, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import type { VendedorConCartera } from "@/lib/dal/admin/vendedores";
import {
  alternarVendedor,
  guardarVendedor,
  type EstadoVendedor,
} from "./actions";

const inicial: EstadoVendedor = {};

const TIPOS = { salon: "De salón", calle: "De calle" } as const;

export function FilaDeVendedor({ vendedor }: { vendedor: VendedorConCartera }) {
  const [editando, setEditando] = useState(false);
  const [cambiando, empezar] = useTransition();
  const [aviso, setAviso] = useState<string | null>(null);

  if (editando) {
    return (
      <li className="py-3">
        <EditorDeVendedor
          vendedor={vendedor}
          alGuardar={() => setEditando(false)}
        />
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-base font-medium">{vendedor.nombre}</p>
        <p className="text-sm text-muted-foreground">
          {TIPOS[vendedor.tipo]}
          {vendedor.clientes > 0 && (
            <>
              {" · "}
              <span className="tabular">{vendedor.clientes}</span>{" "}
              {vendedor.clientes === 1 ? "cliente asignado" : "clientes asignados"}
            </>
          )}
        </p>
      </div>

      <button
        type="button"
        onClick={() => setEditando(true)}
        className="h-9 rounded-lg border px-3 text-sm font-medium transition-colors hover:bg-muted"
      >
        Editar
      </button>
      <button
        type="button"
        disabled={cambiando}
        onClick={() =>
          empezar(async () => {
            const r = await alternarVendedor(vendedor.id);
            setAviso(r.error ?? null);
          })
        }
        className="h-9 rounded-lg border px-3 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-60"
      >
        {cambiando ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : vendedor.activo ? (
          "Desactivar"
        ) : (
          "Reactivar"
        )}
      </button>
      {aviso && <p className="w-full text-sm text-destructive">{aviso}</p>}
    </li>
  );
}

export function EditorDeVendedor({
  vendedor,
  alGuardar,
}: {
  vendedor?: VendedorConCartera;
  alGuardar?: () => void;
}) {
  const [estado, guardar, guardando] = useActionState(
    async (previo: EstadoVendedor, formData: FormData) => {
      const r = await guardarVendedor(previo, formData);
      if (r.ok) alGuardar?.();
      return r;
    },
    inicial,
  );
  const id = useId();

  return (
    <form
      action={guardar}
      className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4"
    >
      {vendedor && <input type="hidden" name="id" value={vendedor.id} />}

      <div className="min-w-[220px] flex-1">
        <label htmlFor={`${id}-nombre`} className="block text-base font-medium">
          Nombre
        </label>
        <input
          id={`${id}-nombre`}
          name="nombre"
          required
          defaultValue={vendedor?.nombre ?? ""}
          placeholder="Gabriela"
          className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
        />
      </div>

      <div>
        <label htmlFor={`${id}-tipo`} className="block text-base font-medium">
          Tipo
        </label>
        <select
          id={`${id}-tipo`}
          name="tipo"
          defaultValue={vendedor?.tipo ?? "salon"}
          className="mt-1 h-10 rounded-lg border bg-background px-2.5 text-base"
        >
          {Object.entries(TIPOS).map(([valor, texto]) => (
            <option key={valor} value={valor}>
              {texto}
            </option>
          ))}
        </select>
      </div>

      <button
        type="submit"
        disabled={guardando}
        className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-orange px-4 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
      >
        {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
        {vendedor ? "Guardar" : "Agregar"}
      </button>

      {vendedor && (
        <button
          type="button"
          onClick={alGuardar}
          className="h-10 rounded-lg border px-3.5 text-base font-medium transition-colors hover:bg-muted"
        >
          Cancelar
        </button>
      )}

      {estado.error && (
        <p className="w-full text-base text-destructive">{estado.error}</p>
      )}
    </form>
  );
}
