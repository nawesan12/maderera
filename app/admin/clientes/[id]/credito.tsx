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
 */
export function CreditoDelCliente({
  customerId,
  diasCredito,
  bloqueada,
  motivo,
}: {
  customerId: string;
  diasCredito: number;
  bloqueada: boolean;
  motivo: string | null;
}) {
  const [dias, setDias] = useState(String(diasCredito));
  const [texto, setTexto] = useState(motivo ?? "");
  const [aviso, setAviso] = useState<string | null>(null);
  const [trabajando, empezar] = useTransition();

  return (
    <section className="tarjeta p-5">
      <h2 className="text-base font-medium">Cuenta corriente</h2>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-sm text-muted-foreground">Paga a</span>
          <span className="mt-1 flex items-center gap-2">
            <input
              type="number"
              min="0"
              max="365"
              value={dias}
              onChange={(e) => setDias(e.target.value)}
              className="tabular h-10 w-24 rounded-lg border border-linea bg-background px-2.5 text-right text-base"
            />
            <span className="text-base text-muted-foreground">días</span>
          </span>
        </label>

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
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-brand-orange px-3.5 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
          >
            {trabajando && <Loader2 className="h-4 w-4 animate-spin" />}
            Guardar el plazo
          </button>
        )}
      </div>

      <p className="mt-1 text-sm text-muted-foreground">
        Lo que pase de ese plazo cuenta como vencido y lo pone arriba en la lista
        de cobranza.
      </p>

      <div className="mt-4 border-t border-linea pt-4">
        {bloqueada ? (
          <>
            <p className="flex items-center gap-2 text-base font-medium">
              <Lock className="h-4 w-4 text-destructive" />
              La cuenta corriente está bloqueada
            </p>
            {motivo && (
              <p className="mt-1 text-base text-muted-foreground">{motivo}</p>
            )}
            <button
              type="button"
              disabled={trabajando}
              onClick={() =>
                empezar(async () => {
                  const r = await bloquearCuentaCorriente(customerId, false, "");
                  setAviso(r.error ?? r.ok ?? null);
                })
              }
              className="mt-3 inline-flex h-10 items-center gap-1.5 rounded-lg border border-linea px-3.5 text-base font-medium transition-colors hover:bg-hundida disabled:opacity-60"
            >
              <LockOpen className="h-4 w-4" />
              Volver a habilitarla
            </button>
          </>
        ) : (
          <>
            <p className="text-base">
              La cuenta está habilitada. Bloquearla impide venderle a cuenta
              hasta que alguien la vuelva a abrir —el mostrador no lo puede
              saltear—.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <input
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                placeholder="Por qué se bloquea"
                className="h-10 min-w-0 flex-1 rounded-lg border border-linea bg-background px-3 text-base"
              />
              <button
                type="button"
                disabled={trabajando || texto.trim().length < 3}
                onClick={() =>
                  empezar(async () => {
                    const r = await bloquearCuentaCorriente(
                      customerId,
                      true,
                      texto,
                    );
                    setAviso(r.error ?? r.ok ?? null);
                  })
                }
                className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-destructive/40 px-3.5 text-base font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
              >
                <Lock className="h-4 w-4" />
                Bloquear la cuenta
              </button>
            </div>
          </>
        )}

        {aviso && <p className="mt-2 text-sm text-muted-foreground">{aviso}</p>}
      </div>
    </section>
  );
}
