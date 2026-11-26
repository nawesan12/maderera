"use client";

import { useState, useTransition } from "react";
import { Loader2, Lock, LockOpen } from "lucide-react";
import { bloquearCuentaCorriente, cambiarPlazoDePago } from "../actions";

/**
 * El crédito de este cliente: a cuántos días paga y si tiene la cuenta abierta.
 *
 * Las dos cosas estaban fuera del alcance de cualquier pantalla: el plazo era
 * una constante global de 30 días y el corte de cuenta se hacía en papel. Con
 * esto, la cobranza puede decir a quién llamar primero —el atraso se mide contra
 * el plazo de cada uno— y quien atiende sabe por qué el sistema no lo deja
 * vender a cuenta.
 *
 * Va adentro de la tarjeta de la cuenta corriente (mes simulado: eran dos
 * tarjetas con el mismo título). El plazo y el bloqueo los cambia el admin
 * (Go lo exige): los demás los leen, no ven un campo que después falla. El
 * plazo se lee como una frase —«Paga a 30 días»— y el número es el campo.
 */
export function CreditoDelCliente({
  customerId,
  diasCredito,
  bloqueada,
  motivo,
  editable,
}: {
  customerId: string;
  diasCredito: number;
  bloqueada: boolean;
  motivo: string | null;
  /** Solo el admin cambia el plazo y bloquea. */
  editable: boolean;
}) {
  const [dias, setDias] = useState(String(diasCredito));
  const [texto, setTexto] = useState(motivo ?? "");
  const [aviso, setAviso] = useState<string | null>(null);
  const [trabajando, empezar] = useTransition();

  return (
    <div className="mt-4 space-y-4 border-t border-linea pt-4">
      {editable ? (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`plazo-${customerId}`} className="text-base">
            Paga a
          </label>
          <input
            id={`plazo-${customerId}`}
            type="number"
            inputMode="numeric"
            min="0"
            max="365"
            value={dias}
            onChange={(e) => setDias(e.target.value)}
            className="tabular h-10 w-20 rounded-lg bg-hundida px-2.5 text-right text-base"
          />
          <span className="text-base">días</span>
          {Number(dias) !== diasCredito && (
            <button
              type="button"
              disabled={trabajando}
              onClick={() =>
                empezar(async () => {
                  const r = await cambiarPlazoDePago(customerId, Number(dias));
                  setAviso(r.error ?? r.ok ?? null);
                })
              }
              className="boton-accion ml-auto inline-flex h-10 items-center gap-1.5 rounded-lg px-3.5 text-base font-medium disabled:opacity-60"
            >
              {trabajando && <Loader2 className="h-4 w-4 animate-spin" />}
              Guardar
            </button>
          )}
        </div>
      ) : (
        <p className="text-base">
          Paga a <span className="tabular font-semibold">{diasCredito}</span> días
        </p>
      )}

      {bloqueada ? (
        <div>
          <p className="flex items-center gap-2 text-base font-medium text-destructive">
            <Lock className="h-4 w-4" />
            Cuenta corriente bloqueada
          </p>
          {motivo && <p className="mt-1 text-base text-muted-foreground">{motivo}</p>}
          {editable && (
            <button
              type="button"
              disabled={trabajando}
              onClick={() =>
                empezar(async () => {
                  const r = await bloquearCuentaCorriente(customerId, false, "");
                  setAviso(r.error ?? r.ok ?? null);
                })
              }
              className="mt-3 inline-flex h-10 items-center gap-1.5 rounded-lg bg-hundida px-3.5 text-base font-medium transition-colors hover:bg-muted disabled:opacity-60"
            >
              <LockOpen className="h-4 w-4" />
              Volver a habilitarla
            </button>
          )}
        </div>
      ) : (
        editable && (
          // El motivo a todo el ancho y el botón abajo: lado a lado, en la
          // columna de 320 px el campo quedaba de 70 px.
          <div className="space-y-2">
            <input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Por qué se bloquea"
              aria-label="Por qué se bloquea la cuenta corriente"
              className="h-10 w-full rounded-lg bg-hundida px-3 text-base"
            />
            <button
              type="button"
              disabled={trabajando || texto.trim().length < 3}
              onClick={() =>
                empezar(async () => {
                  const r = await bloquearCuentaCorriente(customerId, true, texto);
                  setAviso(r.error ?? r.ok ?? null);
                })
              }
              className="inline-flex h-10 items-center gap-1.5 rounded-lg px-3.5 text-base font-medium text-destructive ring-1 ring-inset ring-destructive/40 transition-colors hover:bg-destructive/10 disabled:opacity-50"
            >
              <Lock className="h-4 w-4" />
              Bloquear la cuenta
            </button>
          </div>
        )
      )}

      {aviso && (
        <p role="status" className="text-sm text-muted-foreground">
          {aviso}
        </p>
      )}
    </div>
  );
}
