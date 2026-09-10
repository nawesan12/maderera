"use client";

import { useActionState, useId, useState, useTransition } from "react";
import { Loader2, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  cambiarEstadoDeCheque,
  cargarCheque,
  type EstadoCheque,
} from "./actions";

const inicial: EstadoCheque = {};

/** Qué botones ofrece cada estado. El resto de transiciones no existen. */
const ACCIONES: Record<string, { a: string; texto: string }[]> = {
  cartera: [
    { a: "depositado", texto: "Depositar" },
    { a: "rechazado", texto: "Rechazado" },
    { a: "anulado", texto: "Anular" },
  ],
  depositado: [
    { a: "acreditado", texto: "Se acreditó" },
    { a: "rechazado", texto: "Rebotó" },
  ],
  entregado: [
    { a: "acreditado", texto: "Debitó" },
    { a: "rechazado", texto: "Rebotó" },
  ],
};

export function AccionesDeCheque({
  id,
  estado,
  sentido,
}: {
  id: string;
  estado: string;
  sentido: string;
}) {
  const [pendiente, empezar] = useTransition();
  const [aviso, setAviso] = useState<string | null>(null);

  const acciones = (ACCIONES[estado] ?? []).filter(
    // Un recibido en cartera no se "anula" con un botón al lado de depositar
    // sin más contexto; y depositar solo tiene sentido para los recibidos.
    (a) => !(sentido === "entregado" && a.a === "depositado"),
  );

  if (acciones.length === 0) return null;

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex gap-1.5">
        {acciones.map((accion) => (
          <button
            key={accion.a}
            type="button"
            disabled={pendiente}
            onClick={() =>
              empezar(async () => {
                const r = await cambiarEstadoDeCheque(id, accion.a);
                setAviso(r.error ?? r.ok ?? null);
              })
            }
            className="h-9 rounded-lg border px-3 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
          >
            {accion.texto}
          </button>
        ))}
      </div>
      {aviso && (
        <p className="max-w-64 text-right text-sm text-muted-foreground">
          {aviso}
        </p>
      )}
    </div>
  );
}

export function AltaDeCheque({
  clientes,
}: {
  clientes: { id: string; nombre: string }[];
}) {
  const [abierto, setAbierto] = useState(false);
  const [estado, guardar, guardando] = useActionState(
    async (previo: EstadoCheque, formData: FormData) => {
      const r = await cargarCheque(previo, formData);
      if (r.ok) setAbierto(false);
      return r;
    },
    inicial,
  );
  const [sentido, setSentido] = useState("recibido");
  const id = useId();

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogTrigger className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg boton-accion px-3 text-base font-medium transition-colors">
        <Plus className="h-5 w-5" />
        Cargar cheque
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Cargar un cheque</DialogTitle>
        </DialogHeader>

        <form action={guardar} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-base font-medium">Sentido</span>
              <select
                name="sentido"
                value={sentido}
                onChange={(e) => setSentido(e.target.value)}
                className="mt-1 h-11 w-full rounded-lg border bg-background px-3 text-base"
              >
                <option value="recibido">Recibido — nos lo dieron</option>
                <option value="entregado">Entregado — salió de acá</option>
              </select>
            </label>

            <label className="block">
              <span className="text-base font-medium">Tipo</span>
              <select
                name="tipo"
                defaultValue="fisico"
                className="mt-1 h-11 w-full rounded-lg border bg-background px-3 text-base"
              >
                <option value="fisico">Físico</option>
                <option value="echeq">e-Cheq</option>
              </select>
            </label>

            <label className="block">
              <span className="text-base font-medium">Número</span>
              <input
                name="numero"
                required
                className="tabular mt-1 h-11 w-full rounded-lg border bg-background px-3 text-base"
              />
            </label>

            <label className="block">
              <span className="text-base font-medium">Banco</span>
              <input
                name="banco"
                className="mt-1 h-11 w-full rounded-lg border bg-background px-3 text-base"
              />
            </label>

            <label className="block">
              <span className="text-base font-medium">Fecha de pago</span>
              <input
                id={`${id}-fecha`}
                name="fechaPago"
                type="date"
                required
                className="tabular mt-1 h-11 w-full rounded-lg border bg-background px-3 text-base"
              />
              <span className="mt-1 block text-sm text-muted-foreground">
                El 30/60/90. Es lo que ordena la cartera.
              </span>
            </label>

            <label className="block">
              <span className="text-base font-medium">Importe</span>
              <input
                name="importe"
                required
                inputMode="decimal"
                className="tabular mt-1 h-11 w-full rounded-lg border bg-background px-3 text-right text-base"
              />
            </label>

            {sentido === "recibido" && (
              <>
                <label className="block">
                  <span className="text-base font-medium">Quién lo entregó</span>
                  <select
                    name="customerId"
                    defaultValue=""
                    className="mt-1 h-11 w-full rounded-lg border bg-background px-3 text-base"
                  >
                    <option value="">Sin cliente asociado</option>
                    {clientes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nombre}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="text-base font-medium">Librador</span>
                  <input
                    name="librador"
                    placeholder="Quién lo firmó, si es de un tercero"
                    className="mt-1 h-11 w-full rounded-lg border bg-background px-3 text-base"
                  />
                </label>
              </>
            )}
          </div>

          <label className="block">
            <span className="text-base font-medium">Notas</span>
            <input
              name="notas"
              className="mt-1 h-11 w-full rounded-lg border bg-background px-3 text-base"
            />
          </label>

          {estado.error && (
            <p className="text-base text-destructive">{estado.error}</p>
          )}

          <button
            type="submit"
            disabled={guardando}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg boton-accion text-base font-medium"
          >
            {guardando && <Loader2 className="h-5 w-5 animate-spin" />}
            Guardar en la cartera
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
