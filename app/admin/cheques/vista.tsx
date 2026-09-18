"use client";

import { useActionState, useId, useState, useTransition } from "react";
import { AlertTriangle, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Confirmar } from "@/components/admin/confirmar";
import { ETIQUETA_CIRCUITO } from "@/lib/circuito";
import {
  cambiarEstadoDeCheque,
  cargarCheque,
  type EstadoCheque,
} from "./actions";

const inicial: EstadoCheque = {};

/**
 * Qué botones ofrece cada estado. El resto de transiciones no existen.
 *
 * `anular` viaja aparte porque no es una operación más: no tiene vuelta —un
 * cheque anulado se queda sin botones para siempre— y estaba pegada a
 * "Depositar" con seis píxeles de por medio, en una pantalla que maneja plata.
 */
const ACCIONES: Record<string, { a: string; texto: string }[]> = {
  cartera: [
    { a: "depositado", texto: "Depositar" },
    { a: "rechazado", texto: "Rechazado" },
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

/** Desde qué estados se puede anular. Lo dice `TRANSICIONES` en `actions.ts`. */
const SE_PUEDE_ANULAR = ["cartera"];

export function AccionesDeCheque({
  id,
  estado,
  sentido,
  numero,
  importe,
}: {
  id: string;
  estado: string;
  sentido: string;
  numero: string;
  importe: number;
}) {
  const [pendiente, empezar] = useTransition();
  const [aviso, setAviso] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  const acciones = (ACCIONES[estado] ?? []).filter(
    // Depositar solo tiene sentido para los recibidos: un cheque propio ya
    // entregado lo deposita el proveedor, no nosotros.
    (a) => !(sentido === "entregado" && a.a === "depositado"),
  );
  const puedeAnular = SE_PUEDE_ANULAR.includes(estado);

  if (acciones.length === 0 && !puedeAnular) return null;

  function cambiar(a: string) {
    empezar(async () => {
      const r = await cambiarEstadoDeCheque(id, a);
      setConfirmando(false);
      if (r.error) {
        setAviso(r.error);
        return;
      }
      // El éxito va por aviso global: un cheque que se acredita o se anula se
      // muda a "Terminados", el componente se vuelve a montar y un mensaje
      // propio desaparece antes de que nadie lo lea. El error sí queda acá,
      // porque en ese caso la fila no se mueve.
      if (r.ok) toast.success(r.ok);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        {acciones.map((accion) => (
          <button
            key={accion.a}
            type="button"
            disabled={pendiente}
            onClick={() => cambiar(accion.a)}
            className="h-11 rounded-lg border border-linea px-3.5 text-base font-medium transition-colors hover:bg-muted disabled:opacity-50"
          >
            {accion.texto}
          </button>
        ))}

        {puedeAnular && (
          <>
            {acciones.length > 0 && (
              <span aria-hidden="true" className="h-7 w-px bg-linea" />
            )}
            <button
              type="button"
              disabled={pendiente}
              onClick={() => setConfirmando(true)}
              className="h-11 rounded-lg px-3.5 text-base font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
            >
              Anular
            </button>
          </>
        )}
      </div>

      {aviso && (
        <p className="estado-problema flex max-w-72 items-start gap-1.5 text-right text-base font-medium">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{aviso}</span>
        </p>
      )}

      <Confirmar
        abierto={confirmando}
        alCerrar={() => setConfirmando(false)}
        titulo={`Anular el cheque ${numero}`}
        detalle={`Son ${importe.toLocaleString("es-AR", {
          style: "currency",
          currency: "ARS",
          maximumFractionDigits: 0,
        })}. Un cheque anulado no vuelve a la cartera ni se puede depositar después: queda así para siempre.`}
        confirmar="Sí, anularlo"
        cancelar="No, dejarlo como está"
        peligro
        pendiente={pendiente}
        alConfirmar={() => cambiar("anulado")}
      />
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
  const [tipo, setTipo] = useState("fisico");
  const [circuito, setCircuito] = useState("blanco");
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
                value={tipo}
                onChange={(e) => {
                  setTipo(e.target.value);
                  // El e-Cheq solo va por el circuito de facturas.
                  if (e.target.value === "echeq") setCircuito("blanco");
                }}
                className="mt-1 h-11 w-full rounded-lg border bg-background px-3 text-base"
              >
                <option value="fisico">Físico</option>
                <option value="echeq">e-Cheq</option>
              </select>
            </label>

            {/* Por qué circuito va. Antes no se preguntaba y todo lo cargado a
                mano quedaba en «Facturas», así que los dos totales de la
                cartera no eran los de nadie. */}
            <label className="block">
              <span className="text-base font-medium">Circuito</span>
              <select
                name="circuito"
                value={circuito}
                onChange={(e) => setCircuito(e.target.value)}
                disabled={tipo === "echeq"}
                className="mt-1 h-11 w-full rounded-lg border bg-background px-3 text-base disabled:opacity-60"
              >
                <option value="blanco">{ETIQUETA_CIRCUITO.blanco}</option>
                <option value="negro">{ETIQUETA_CIRCUITO.negro}</option>
              </select>
              {tipo === "echeq" && (
                <span className="mt-1 block text-sm text-muted-foreground">
                  Un e-Cheq queda registrado en el banco: va siempre por
                  facturas.
                </span>
              )}
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
