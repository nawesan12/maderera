"use client";

import { useActionState, useState } from "react";
import {
  AlertCircle,
  Banknote,
  Check,
  CreditCard,
  Loader2,
  Upload,
} from "lucide-react";
import {
  pagarDeuda,
  subirComprobanteDeDeuda,
  type EstadoPago,
} from "@/app/(public)/pago-actions";
import { formatearMonto } from "@/lib/formato";
import type { DatosParaTransferir } from "@/lib/dal/pagos";

const inicial: EstadoPago = {};

/**
 * Pago online de la deuda de cuenta corriente (cláusula 1.6).
 *
 * El importe viene con el saldo total precargado pero se puede editar: los
 * pagos a cuenta son la norma en el rubro —se abona una parte y se sigue
 * comprando—, y obligar a cancelar todo haría que la gente no use el botón y
 * siga transfiriendo por afuera.
 *
 * El importe que se manda no decide nada por sí solo: el servidor lo vuelve a
 * validar contra el saldo real antes de abrir el cobro.
 */
export function PagarDeuda({
  saldo,
  banco,
  enVivo,
}: {
  saldo: number;
  banco: DatosParaTransferir | null;
  enVivo: boolean;
}) {
  const [pestana, setPestana] = useState<"online" | "transferencia">("online");
  const [estadoPago, accionPago, pagando] = useActionState(pagarDeuda, inicial);
  const [estadoComprobante, accionComprobante, subiendo] = useActionState(
    subirComprobanteDeDeuda,
    inicial,
  );

  if (saldo <= 0) return null;

  return (
    <section className="overflow-hidden rounded-xl border bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-5 py-3.5">
        <h2 className="font-medium">Cancelar tu saldo</h2>
        <p className="text-sm text-muted-foreground">
          Debés {formatearMonto(saldo)}
        </p>
      </div>

      <div className="flex gap-1 border-b px-5 pt-3">
        <Pestana
          activa={pestana === "online"}
          onClick={() => setPestana("online")}
          icono={CreditCard}
        >
          Pagar online
        </Pestana>
        <Pestana
          activa={pestana === "transferencia"}
          onClick={() => setPestana("transferencia")}
          icono={Banknote}
        >
          Transferencia
        </Pestana>
      </div>

      {pestana === "online" ? (
        <form action={accionPago} className="space-y-3 p-5">
          <label htmlFor="monto" className="block text-sm font-medium">
            Cuánto querés pagar
          </label>
          <div className="flex flex-wrap gap-3">
            <input
              id="monto"
              name="monto"
              inputMode="decimal"
              defaultValue={saldo.toFixed(2).replace(".", ",")}
              className="tabular h-11 min-w-[10rem] flex-1 rounded-lg border px-3 text-lg"
            />
            <button
              type="submit"
              disabled={pagando}
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-brand-orange px-5 font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
            >
              {pagando ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Abriendo el pago…
                </>
              ) : (
                "Pagar con Mercado Pago"
              )}
            </button>
          </div>

          {estadoPago.error && (
            <p className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {estadoPago.error}
            </p>
          )}

          <p className="text-sm text-muted-foreground">
            Podés pagar una parte. El saldo se actualiza apenas se acredita.
            {!enVivo &&
              " Por ahora los cobros están en modo de prueba: no se mueve plata."}
          </p>
        </form>
      ) : (
        <div className="space-y-4 p-5">
          {banco ? (
            <dl className="space-y-1.5 rounded-lg bg-sitio-alt p-4 text-sm">
              <Fila etiqueta="Titular" valor={banco.titular} />
              <Fila etiqueta="Banco" valor={banco.banco} />
              <Fila etiqueta="CBU" valor={banco.cbu} />
              <Fila etiqueta="Alias" valor={banco.alias} />
              <Fila etiqueta="CUIT" valor={banco.cuit} />
            </dl>
          ) : (
            <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
              Escribinos por WhatsApp y te pasamos los datos para transferir.
            </p>
          )}

          {estadoComprobante.ok ? (
            <p className="flex items-start gap-2 rounded-lg bg-brand-green/10 p-3 text-sm">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-green" />
              {estadoComprobante.ok}
            </p>
          ) : (
            <form action={accionComprobante} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="monto-transferencia"
                    className="block text-sm font-medium"
                  >
                    Importe transferido
                  </label>
                  <input
                    id="monto-transferencia"
                    name="monto"
                    inputMode="decimal"
                    defaultValue={saldo.toFixed(2).replace(".", ",")}
                    className="tabular mt-1 h-11 w-full rounded-lg border px-3 text-base"
                  />
                </div>
                <div>
                  <label
                    htmlFor="comprobante-deuda"
                    className="block text-sm font-medium"
                  >
                    Comprobante
                  </label>
                  <input
                    id="comprobante-deuda"
                    name="comprobante"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    required
                    className="mt-1 h-11 w-full rounded-lg border px-3 py-2 text-sm"
                  />
                </div>
              </div>

              {estadoComprobante.error && (
                <p className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  {estadoComprobante.error}
                </p>
              )}

              <button
                type="submit"
                disabled={subiendo}
                className="inline-flex h-11 items-center gap-2 rounded-lg border px-5 font-medium transition-colors hover:bg-muted disabled:opacity-60"
              >
                {subiendo ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                Informar el pago
              </button>

              <p className="text-sm text-muted-foreground">
                Lo imputamos a tu cuenta cuando lo verificamos contra el
                extracto.
              </p>
            </form>
          )}
        </div>
      )}
    </section>
  );
}

function Pestana({
  activa,
  onClick,
  icono: Icono,
  children,
}: {
  activa: boolean;
  onClick: () => void;
  icono: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activa}
      className={`-mb-px inline-flex items-center gap-2 border-b-2 px-3 pb-2.5 text-sm font-medium transition-colors ${
        activa
          ? "border-brand-orange text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icono className="h-4 w-4" />
      {children}
    </button>
  );
}

function Fila({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  if (!valor) return null;

  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{etiqueta}</dt>
      <dd className="tabular font-medium">{valor}</dd>
    </div>
  );
}
