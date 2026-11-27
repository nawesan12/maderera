"use client";

import { useActionState, useTransition, type FormEvent } from "react";
import { AlertCircle, Check, Loader2, Upload } from "lucide-react";
import { subirComprobante, type EstadoPago } from "@/app/(public)/pago-actions";
import type { DatosParaTransferir } from "@/lib/dal/pagos";
import { DatosBancarios } from "@/components/pagos/datos-bancarios";
import { CampoArchivo } from "@/components/campo-archivo";
import { sinRomper } from "@/lib/acciones/sin-romper";
import { BotonWhatsapp } from "@/components/whatsapp/boton";

const inicial: EstadoPago = {};
const subir = sinRomper(subirComprobante);

/**
 * «Informar el pago» de un pedido por transferencia, en Mi cuenta.
 *
 * El cliente sin cuenta corriente no tenía dónde subir el comprobante de su
 * pedido: la tarjeta decía «te pasamos los datos por WhatsApp» y nada más
 * (mes simulado, H387). Es el mismo camino que la página del pedido
 * (`subirComprobante`): la sesión del dueño autoriza, sin token.
 *
 * El formulario se manda con `onSubmit` y no con `action`: con `action`,
 * React lo vacía al volver, y un error se llevaba el archivo elegido (H076).
 */
export function InformarTransferencia({
  numero,
  banco,
  pedirDatos,
}: {
  numero: string;
  banco: DatosParaTransferir | null;
  /**
   * WhatsApp para pedir la cuenta cuando la casa no cargó los datos
   * bancarios: sin esto el cliente no tenía adónde transferir (mes simulado).
   */
  pedirDatos: string;
}) {
  const [estado, accion] = useActionState(subir, inicial);
  const [enviando, empezar] = useTransition();

  function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const datos = new FormData(e.currentTarget);
    empezar(() => accion(datos));
  }

  if (estado.ok) {
    return (
      <p className="estado-ok mt-3 flex items-start gap-2 rounded-lg bg-[var(--estado-fondo)] p-3 text-sm">
        <Check className="mt-0.5 h-4 w-4 shrink-0" />
        {estado.ok}
      </p>
    );
  }

  return (
    <div className="mt-3 space-y-3">
      {!banco && (
        <BotonWhatsapp enlace={pedirDatos} variante="secundario" className="w-full">
          Pedir los datos de la cuenta
        </BotonWhatsapp>
      )}
      {banco && (
        <DatosBancarios banco={banco} />
      )}

      <form onSubmit={enviar} className="space-y-3">
        <input type="hidden" name="numero" value={numero} />
        <label
          className="block text-sm font-medium"
          htmlFor={`comprobante-${numero}`}
        >
          Comprobante
        </label>
        <CampoArchivo
          id={`comprobante-${numero}`}
          name="comprobante"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          required
        />
        {estado.error && (
          <p
            role="alert"
            className="estado-problema flex items-start gap-2 rounded-lg bg-[var(--estado-fondo)] p-3 text-sm"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {estado.error}
          </p>
        )}
        <button
          type="submit"
          disabled={enviando}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-accion px-5 font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
        >
          {enviando ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          Informar el pago
        </button>
      </form>
    </div>
  );
}
