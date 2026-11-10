"use client";

import { useActionState, useId } from "react";
import {
  ArrowRightLeft,
  Banknote,
  BookUser,
  CreditCard,
  Loader2,
  Percent,
  Power,
  Smartphone,
  Wallet,
} from "lucide-react";
import {
  Hoja,
  Interruptor,
  Opciones,
  Seccion,
} from "@/components/admin/formulario";
import { guardarDescuentoDePago, type EstadoDescuento } from "./actions";
import { MEDIOS } from "./medios";

const inicial: EstadoDescuento = {};

const ICONO_MEDIO = {
  transferencia: ArrowRightLeft,
  efectivo: Banknote,
  debito: Wallet,
  credito: CreditCard,
  mercado_pago: Smartphone,
  cuenta_corriente: BookUser,
} as const;

export interface DescuentoEditable {
  id: string;
  medio: string;
  desdeMonto: string;
  porcentaje: string;
  etiqueta: string;
  activo: boolean;
}

export function EditorDeDescuento({
  descuento,
}: {
  descuento: DescuentoEditable | null;
}) {
  const [estado, guardar, guardando] = useActionState(
    guardarDescuentoDePago,
    inicial,
  );
  const id = useId();

  return (
    <form action={guardar} className="space-y-4">
      {descuento && <input type="hidden" name="id" value={descuento.id} />}

      <Hoja>
        <Seccion titulo="Forma de pago" icono={Wallet} columnas={1}>
          <Opciones
            nombre="medio"
            columnas={3}
            defecto={descuento?.medio ?? "transferencia"}
            opciones={MEDIOS.map((m) => ({
              valor: m.valor,
              texto: m.etiqueta,
              icono: ICONO_MEDIO[m.valor],
            }))}
          />
        </Seccion>

        <Seccion titulo="Descuento" icono={Percent} columnas={3}>
          <div>
            <label
              htmlFor={`${id}-desde`}
              className="block text-base font-medium"
            >
              Desde
            </label>
            <input
              id={`${id}-desde`}
              name="desdeMonto"
              defaultValue={descuento?.desdeMonto ?? "0"}
              placeholder="0"
              className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
            />
          </div>

          <div>
            <label
              htmlFor={`${id}-porcentaje`}
              className="block text-base font-medium"
            >
              Descuento (%)
            </label>
            <input
              id={`${id}-porcentaje`}
              name="porcentaje"
              required
              defaultValue={descuento?.porcentaje ?? ""}
              placeholder="10"
              className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
            />
          </div>

          <div>
            <label
              htmlFor={`${id}-etiqueta`}
              className="block text-base font-medium"
            >
              Cómo se lee
            </label>
            <input
              id={`${id}-etiqueta`}
              name="etiqueta"
              defaultValue={descuento?.etiqueta ?? ""}
              placeholder="10% por transferencia"
              className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
            />
          </div>

          <div className="md:col-span-3">
            <Interruptor
              nombre="activo"
              etiqueta="Se aplica"
              icono={Power}
              defecto={descuento?.activo ?? true}
            />
          </div>
        </Seccion>
      </Hoja>

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={guardando}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-accion px-4 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
        >
          {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
          {descuento ? "Guardar" : "Agregar escalón"}
        </button>

        {estado.error && (
          <p className="text-base text-destructive">{estado.error}</p>
        )}
        {estado.ok && (
          <p className="text-base text-muted-foreground">{estado.ok}</p>
        )}
      </div>
    </form>
  );
}
