"use client";

import { useActionState } from "react";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { guardarMisDatos, type EstadoAccion } from "../actions";

const estadoInicial: EstadoAccion = {};

const CONDICIONES = [
  { valor: "consumidor_final", texto: "Consumidor final" },
  { valor: "responsable_inscripto", texto: "Responsable inscripto" },
  { valor: "monotributista", texto: "Monotributista" },
  { valor: "exento", texto: "Exento" },
  { valor: "no_categorizado", texto: "No categorizado" },
];

export function FormularioDatos({
  nombre,
  telefono,
  razonSocial,
  cuit,
  condicionIva,
}: {
  nombre: string;
  telefono: string;
  razonSocial: string;
  cuit: string;
  condicionIva: string;
}) {
  const [estado, accion, pendiente] = useActionState(
    guardarMisDatos,
    estadoInicial,
  );

  return (
    <form action={accion} className="space-y-6">
      <section className="rounded-xl border bg-card p-5">
        <h2 className="mb-4 font-medium">Contacto</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="nombre">Nombre y apellido</Label>
            <Input
              id="nombre"
              name="nombre"
              defaultValue={nombre}
              autoComplete="name"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="telefono">Teléfono</Label>
            <Input
              id="telefono"
              name="telefono"
              type="tel"
              defaultValue={telefono}
              autoComplete="tel"
              placeholder="223 590-3118"
            />
          </div>
        </div>
      </section>

      <section className="rounded-xl border bg-card p-5">
        <h2 className="font-medium">Datos para facturar</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Con esto emitimos tu comprobante. Si comprás como consumidor final, no
          hace falta que completes el CUIT.
        </p>

        <div className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="razonSocial">Razón social</Label>
              <Input
                id="razonSocial"
                name="razonSocial"
                defaultValue={razonSocial}
                placeholder="Constructora del Sur S.R.L."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cuit">CUIT</Label>
              <Input
                id="cuit"
                name="cuit"
                defaultValue={cuit}
                placeholder="20-12345678-9"
                inputMode="numeric"
                className="tabular"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="condicionIva">Condición frente al IVA</Label>
            <select
              id="condicionIva"
              name="condicionIva"
              defaultValue={condicionIva}
              className="h-11 w-full rounded-lg border bg-card px-3 text-base sm:w-72"
            >
              {CONDICIONES.map((c) => (
                <option key={c.valor} value={c.valor}>
                  {c.texto}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {estado.error && (
        <p
          role="alert"
          className="flex items-center gap-2 rounded-lg bg-brand-red/10 px-3.5 py-2.5 text-sm text-brand-red"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          {estado.error}
        </p>
      )}

      {estado.ok && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-lg bg-green-50 px-3.5 py-2.5 text-sm text-green-900"
        >
          <Check className="h-4 w-4 shrink-0" />
          {estado.ok}
        </p>
      )}

      <button
        type="submit"
        disabled={pendiente}
        className="inline-flex h-11 items-center gap-2 rounded-lg bg-brand-orange px-5 font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
      >
        {pendiente && <Loader2 className="h-4 w-4 animate-spin" />}
        Guardar cambios
      </button>
    </form>
  );
}
