"use client";

import { useActionState, useTransition, type FormEvent } from "react";
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
  fijos,
  pedirCambio,
}: {
  nombre: string;
  telefono: string;
  razonSocial: string;
  cuit: string;
  condicionIva: string;
  /**
   * Ya facturó o mueve cuenta corriente: lo fiscal decide el tipo de factura
   * y lo cambia la casa (mes simulado, H079). Se muestra, no se edita.
   */
  fijos: boolean;
  /** WhatsApp para pedir el cambio, con el mensaje armado. */
  pedirCambio: string;
}) {
  const [estado, accion, guardando] = useActionState(
    guardarMisDatos,
    estadoInicial,
  );
  const [enviando, empezar] = useTransition();
  const pendiente = guardando || enviando;

  // Con `action`, React vacía el formulario al volver: un CUIT mal tipeado
  // se perdía y el campo volvía al anterior junto con el error. Con
  // `onSubmit` queda lo que escribió, para corregirlo (mes simulado).
  function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const datos = new FormData(e.currentTarget);
    empezar(() => accion(datos));
  }

  return (
    <form onSubmit={enviar} className="space-y-6">
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
            />
          </div>
        </div>
      </section>

      {fijos ? (
        <section className="rounded-xl border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">Datos para facturar</h2>
            <a
              href={pedirCambio}
              target="_blank"
              rel="noopener noreferrer"
              className="-my-2 inline-flex min-h-11 items-center text-sm font-medium text-acento-texto hover:underline"
            >
              Pedir un cambio
            </a>
          </div>
          <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-3">
            {[
              ["Razón social", razonSocial || "—"],
              ["CUIT", cuit || "—"],
              [
                "Condición frente al IVA",
                CONDICIONES.find((c) => c.valor === condicionIva)?.texto ??
                  condicionIva,
              ],
            ].map(([etiqueta, valor]) => (
              <div key={etiqueta} className="min-w-0">
                <dt className="text-sm text-muted-foreground">{etiqueta}</dt>
                {/* La letra del texto: en monoespaciada la razón social
                    parecía código (M3S1-047). Solo el CUIT va en cifras
                    tabulares. */}
                <dd className={`mt-0.5 font-medium [overflow-wrap:anywhere] ${etiqueta === "CUIT" ? "tabular" : ""}`}>
                  {valor}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : (
        <section className="rounded-xl border bg-card p-5">
          <h2 className="font-medium">Datos para facturar</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Con esto emitimos tu comprobante. Si comprás como consumidor final,
            no hace falta que completes el CUIT.
          </p>

          <div className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="razonSocial">Razón social</Label>
                <Input
                  id="razonSocial"
                  name="razonSocial"
                  defaultValue={razonSocial}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cuit">CUIT</Label>
                <Input
                  id="cuit"
                  name="cuit"
                  defaultValue={cuit}
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
      )}

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
          className="flex items-center gap-2 estado-ok rounded-lg bg-[var(--estado-fondo)] px-3.5 py-2.5 text-sm"
        >
          <Check className="h-4 w-4 shrink-0" />
          {estado.ok}
        </p>
      )}

      <button
        type="submit"
        disabled={pendiente}
        className="inline-flex h-11 items-center gap-2 rounded-lg bg-accion px-5 font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
      >
        {pendiente && <Loader2 className="h-4 w-4 animate-spin" />}
        Guardar cambios
      </button>
    </form>
  );
}
