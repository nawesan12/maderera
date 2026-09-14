"use client";

import { useActionState, useId, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Confirmar } from "@/components/admin/confirmar";
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
  const [aviso, setAviso] = useState<{ texto: string; mal: boolean } | null>(
    null,
  );
  const [confirmando, setConfirmando] = useState(false);

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

  function alternar() {
    empezar(async () => {
      const r = await alternarVendedor(vendedor.id);
      setConfirmando(false);
      if (r.error) {
        setAviso({ texto: r.error, mal: true });
        return;
      }
      // El éxito va por aviso global y no acá al lado: la fila se muda de
      // "Activos" a "Inactivos", el componente se vuelve a montar y cualquier
      // mensaje propio se pierde antes de que alguien lo lea.
      toast.success(
        vendedor.activo
          ? `${vendedor.nombre} queda desactivado. Sus clientes siguen asignados a él.`
          : `${vendedor.nombre} vuelve a estar activo.`,
      );
    });
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
              {/* El conteo era texto muerto: la pregunta que sigue a "3
                  clientes asignados" es siempre "¿cuáles?". */}
              <Link
                href={`/admin/clientes?vendedor=${vendedor.id}`}
                className="font-medium hover:text-brand-orange hover:underline"
              >
                <span className="tabular">{vendedor.clientes}</span>{" "}
                {vendedor.clientes === 1
                  ? "cliente asignado"
                  : "clientes asignados"}
              </Link>
            </>
          )}
        </p>
      </div>

      <button
        type="button"
        onClick={() => setEditando(true)}
        className="h-11 rounded-lg border px-3.5 text-base font-medium transition-colors hover:bg-muted"
      >
        Editar
      </button>
      <button
        type="button"
        disabled={cambiando}
        onClick={() => (vendedor.activo ? setConfirmando(true) : alternar())}
        className="inline-flex h-11 items-center gap-1.5 rounded-lg border px-3.5 text-base font-medium transition-colors hover:bg-muted disabled:opacity-60"
      >
        {cambiando && <Loader2 className="h-4 w-4 animate-spin" />}
        {vendedor.activo ? "Desactivar" : "Reactivar"}
      </button>

      {aviso && (
        <p
          className="flex w-full items-start gap-1.5 text-base font-medium text-destructive"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{aviso.texto}</span>
        </p>
      )}

      <Confirmar
        abierto={confirmando}
        alCerrar={() => setConfirmando(false)}
        titulo={`Desactivar a ${vendedor.nombre}`}
        detalle={
          vendedor.clientes > 0
            ? `Deja de ofrecerse al asignar clientes y al armar papeles. Sus ${vendedor.clientes} ${
                vendedor.clientes === 1 ? "cliente sigue asignado" : "clientes siguen asignados"
              } a él, y los presupuestos y pedidos viejos lo siguen mostrando. Se puede reactivar cuando quieras.`
            : "Deja de ofrecerse al asignar clientes y al armar papeles. Se puede reactivar cuando quieras."
        }
        confirmar="Sí, desactivarlo"
        pendiente={cambiando}
        alConfirmar={alternar}
      />
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
          className="mt-1 h-11 w-full rounded-lg border bg-background px-3 text-base"
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
          className="mt-1 h-11 rounded-lg border bg-background px-2.5 text-base"
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
        className="inline-flex h-11 items-center gap-2 rounded-lg bg-brand-orange px-4 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
      >
        {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
        {vendedor ? "Guardar" : "Agregar"}
      </button>

      {vendedor && (
        <button
          type="button"
          onClick={alGuardar}
          className="h-11 rounded-lg border px-3.5 text-base font-medium transition-colors hover:bg-muted"
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
