"use client";

import { useActionState, useState } from "react";
import { Check, Loader2, TriangleAlert, UserCheck, X } from "lucide-react";
import {
  aprobarSolicitud,
  rechazarSolicitud,
  type EstadoProfesionales,
} from "./actions";
import type { ListaAsignable } from "@/lib/dal/admin/profesionales";

const inicial: EstadoProfesionales = {};

const CONDICIONES = [
  { valor: "responsable_inscripto", texto: "Responsable inscripto" },
  { valor: "monotributista", texto: "Monotributista" },
  { valor: "exento", texto: "Exento" },
  { valor: "consumidor_final", texto: "Consumidor final" },
];

/**
 * Aprobar o rechazar una solicitud.
 *
 * Aprobar exige elegir la lista y el límite en el mismo formulario, sin un paso
 * intermedio: son las dos decisiones que hacen que el acceso signifique algo, y
 * separarlas dejaría profesionales aprobados viendo precios de público —el peor
 * resultado posible, porque parece que funciona—.
 */
export function ResolverSolicitud({
  id,
  nombre,
  listas,
  clienteExistente,
  cuit = null,
}: {
  id: string;
  nombre: string;
  listas: ListaAsignable[];
  clienteExistente: { id: string; nombre: string; condicionIva?: string | null } | null;
  /** El CUIT de la solicitud: decide qué condición frente al IVA se propone. */
  cuit?: string | null;
}) {
  const [estadoAprobar, aprobar, aprobando] = useActionState(
    aprobarSolicitud,
    inicial,
  );
  const [estadoRechazar, rechazar, rechazando] = useActionState(
    rechazarSolicitud,
    inicial,
  );
  const [modo, setModo] = useState<"cerrado" | "aprobar" | "rechazar">(
    "cerrado",
  );

  const profesional =
    listas.find((l) => !l.esGeneral && /profesional/i.test(l.nombre)) ??
    listas.find((l) => !l.esGeneral);
  // La condición frente al IVA la elige quien aprueba (M2S1-020, M3S2-092):
  // un CUIT 30/33/34 es de una sociedad (inscripta); uno de persona (20, 23,
  // 24, 27) puede ser monotributista o inscripto y no se supone; sin CUIT,
  // consumidor final.
  const digitos = (cuit ?? "").replace(/\D/g, "");
  // Si ya hay ficha con ese CUIT, la suya: la condición va con el CUIT
  // (recorrido, M4-073).
  const deLaFicha = CONDICIONES.find((c) => c.valor === clienteExistente?.condicionIva)?.valor;
  const condicionPropuesta =
    deLaFicha ??
    (digitos.length !== 11 ? "consumidor_final" : /^3[034]/.test(digitos) ? "responsable_inscripto" : "");
  const [limite, setLimite] = useState("0");

  if (modo === "cerrado") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setModo("aprobar")}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-accion px-3.5 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark"
        >
          <UserCheck className="h-5 w-5" />
          Habilitar
        </button>
        <button
          type="button"
          onClick={() => setModo("rechazar")}
          className="inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-base font-medium transition-colors hover:bg-muted"
        >
          <X className="h-5 w-5" />
          Rechazar
        </button>
      </div>
    );
  }

  if (modo === "aprobar") {
    return (
      <form action={aprobar} className="w-full space-y-3 rounded-lg border p-4">
        <input type="hidden" name="id" value={id} />

        <p className="text-base font-medium">Habilitar a {nombre}</p>

        {clienteExistente && (
          <p className="flex items-start gap-2 rounded-lg bg-brand-cream/60 p-3 text-base">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-green" />
            <span>
              {/* Si el correo coincide se usa esa; si no, se crea otra: el CUIT solo
                  no prueba que sea la misma persona. Las fichas se unen desde la ficha. */}
              Ya existe la ficha <strong>{clienteExistente.nombre}</strong> con ese
              CUIT. Se usa solo si coincide el correo.
            </span>
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`lista-${id}`} className="block text-base font-medium">
              Lista de precios
            </label>
            <select
              id={`lista-${id}`}
              name="priceListId"
              defaultValue={profesional?.id ?? ""}
              className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
            >
              <option value="">La general (sin diferencia)</option>
              {listas
                .filter((l) => !l.esGeneral)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.nombre}
                  </option>
                ))}
            </select>
          </div>

          <div>
            <label
              htmlFor={`limite-${id}`}
              className="block text-base font-medium"
            >
              Límite de cuenta corriente
            </label>
            <input
              id={`limite-${id}`}
              name="limiteCredito"
              inputMode="decimal"
              value={limite}
              onChange={(e) => setLimite(e.target.value)}
              className="tabular mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
            />
            <p className="mt-1 text-base text-muted-foreground">
              Cero deja la cuenta corriente sin habilitar.
            </p>
          </div>

          <div>
            <label htmlFor={`iva-${id}`} className="block text-base font-medium">
              Condición frente al IVA
            </label>
            <select
              id={`iva-${id}`}
              name="condicionIva"
              required
              defaultValue={condicionPropuesta}
              // Sin elegir, el Confirmar solo sacaba el globo del navegador,
              // que a 375 casi no se ve: queda en rojo (M4-073).
              className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base user-invalid:border-destructive user-invalid:ring-2 user-invalid:ring-destructive/30"
            >
              <option value="" disabled>
                Elegí una
              </option>
              {CONDICIONES.map((c) => (
                <option key={c.valor} value={c.valor}>
                  {c.texto}
                </option>
              ))}
            </select>
          </div>

          {/* El plazo va con el límite: sin él, la ficha decía «Paga a __
              días» (M2S1-137). */}
          {Number(limite.replace(/\D/g, "")) > 0 && (
            <div>
              <label htmlFor={`plazo-${id}`} className="block text-base font-medium">
                Paga a (días)
              </label>
              <input
                id={`plazo-${id}`}
                name="diasCredito"
                inputMode="numeric"
                maxLength={3}
                defaultValue="30"
                className="tabular mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
              />
            </div>
          )}
        </div>

        {estadoAprobar.error && (
          <p className="flex items-start gap-2 text-base text-destructive">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {estadoAprobar.error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={aprobando}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-accion px-4 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
          >
            {aprobando && <Loader2 className="h-4 w-4 animate-spin" />}
            Confirmar
          </button>
          <button
            type="button"
            onClick={() => setModo("cerrado")}
            className="inline-flex h-10 items-center rounded-lg border px-4 text-base font-medium transition-colors hover:bg-muted"
          >
            Cancelar
          </button>
          {/* Le llega un correo con los datos de su acceso. */}
        </div>
      </form>
    );
  }

  return (
    <form action={rechazar} className="w-full space-y-3 rounded-lg border p-4">
      <input type="hidden" name="id" value={id} />

      <label htmlFor={`motivo-${id}`} className="block text-base font-medium">
        Por qué se rechaza
      </label>
      <textarea
        id={`motivo-${id}`}
        name="motivo"
        rows={2}
        required
        placeholder="El CUIT no corresponde a una actividad del rubro."
        className="w-full rounded-lg border bg-background px-3 py-2 text-base"
      />
      <p className="text-base text-muted-foreground">Le llega tal cual por correo.</p>

      {estadoRechazar.error && (
        <p className="flex items-start gap-2 text-base text-destructive">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {estadoRechazar.error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={rechazando}
          className="inline-flex h-10 items-center gap-2 rounded-lg border px-4 text-base font-medium transition-colors hover:bg-muted disabled:opacity-60"
        >
          {rechazando && <Loader2 className="h-4 w-4 animate-spin" />}
          Rechazar
        </button>
        <button
          type="button"
          onClick={() => setModo("cerrado")}
          className="inline-flex h-10 items-center rounded-lg border px-4 text-base font-medium transition-colors hover:bg-muted"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
