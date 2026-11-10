"use client";

import { useActionState } from "react";
import {
  Check,
  Landmark,
  Loader2,
  MessageSquareText,
  TriangleAlert,
} from "lucide-react";
import { Hoja, Seccion } from "@/components/admin/formulario";
import { guardarDatosBancarios, type EstadoAccionPago } from "./actions";
import type { DatosBancariosDelPanel } from "@/lib/dal/admin/pagos";

const inicial: EstadoAccionPago = {};

/**
 * Datos bancarios para las transferencias.
 *
 * Viven en la base y no en variables de entorno porque el alias de una cuenta
 * lo cambia el contador, no el programador, y no debería hacer falta un deploy
 * para eso. El CBU se valida por largo: uno mal tipeado manda la plata de un
 * cliente a otra cuenta, y eso no vuelve.
 */
export function FormularioBanco({
  datos,
}: {
  datos: DatosBancariosDelPanel | null;
}) {
  const [estado, accion, guardando] = useActionState(
    guardarDatosBancarios,
    inicial,
  );

  return (
    <section className="space-y-4">
      <h2 className="text-base font-medium">Datos para transferencias</h2>

      <form action={accion} className="space-y-4">
        <Hoja>
          <Seccion titulo="Cuenta" icono={Landmark}>
            <Campo
              nombre="titular"
              etiqueta="Titular"
              valor={datos?.titular}
              placeholder="Maderera Juan B. Justo SRL"
            />
            <Campo
              nombre="banco"
              etiqueta="Banco"
              valor={datos?.banco}
              placeholder="Banco Nación"
            />
            <Campo
              nombre="cuit"
              etiqueta="CUIT"
              valor={datos?.cuit}
              placeholder="30-12345678-9"
            />
            <Campo
              nombre="alias"
              etiqueta="Alias"
              valor={datos?.alias}
              placeholder="MADERERA.JBJ.MDP"
            />
            <div className="md:col-span-2">
              <Campo
                nombre="cbu"
                etiqueta="CBU"
                valor={datos?.cbu}
                placeholder="22 dígitos"
              />
            </div>
          </Seccion>
          <Seccion
            titulo="Para el cliente"
            icono={MessageSquareText}
            columnas={1}
          >
            <div>
              <label
                htmlFor="instrucciones"
                className="block text-base font-medium"
              >
                Aclaración para el cliente
              </label>
              <textarea
                id="instrucciones"
                name="instrucciones"
                rows={2}
                defaultValue={datos?.instrucciones ?? ""}
                placeholder="Mandanos el comprobante y preparamos el pedido."
                className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-base"
              />
            </div>
          </Seccion>
        </Hoja>

        {estado.error && (
          <p className="flex items-start gap-2 text-base text-destructive">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {estado.error}
          </p>
        )}

        {estado.ok && (
          <p className="flex items-center gap-2 text-base text-muted-foreground">
            <Check className="h-4 w-4 text-brand-green" />
            {estado.ok}
          </p>
        )}

        <div>
          <button
            type="submit"
            disabled={guardando}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-accion px-4 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
          >
            {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
            Guardar
          </button>
        </div>
      </form>
    </section>
  );
}

function Campo({
  nombre,
  etiqueta,
  valor,
  placeholder,
}: {
  nombre: string;
  etiqueta: string;
  valor?: string | null;
  placeholder?: string;
}) {
  return (
    <div>
      <label htmlFor={nombre} className="block text-base font-medium">
        {etiqueta}
      </label>
      <input
        id={nombre}
        name={nombre}
        defaultValue={valor ?? ""}
        placeholder={placeholder}
        className="tabular mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
      />
    </div>
  );
}
