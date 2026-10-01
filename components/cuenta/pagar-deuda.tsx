"use client";

import { useActionState, useState } from "react";
import { AlertCircle, Banknote, Check, Landmark, Loader2, ScrollText, Upload } from "lucide-react";
import {
  informarChequesDeDeuda,
  subirComprobanteDeDeuda,
  type EstadoPago,
} from "@/app/(public)/pago-actions";
import { CobroMultimedio } from "@/components/cobros/cobro-multimedio";
import { formatearMonto } from "@/lib/formato";
import type { DatosParaTransferir } from "@/lib/dal/pagos";

const inicial: EstadoPago = {};

type Forma = "transferencia" | "deposito" | "cheques";

/**
 * Cómo paga el cliente su cuenta corriente.
 *
 * De la clienta (30/9/2026): «que el usuario pueda pagar su cuenta corriente
 * con cheques, y no pagar online, sino con transferencia o dinero en cuenta
 * nada más». Tres formas, ninguna online:
 *
 * - **Transferencia** y **depósito**: el cliente sube el comprobante, la casa
 *   lo verifica contra el extracto, y recién ahí baja la deuda y sale el
 *   recibo. Son dos pestañas y no una porque el recibo tiene que decir cuál.
 * - **Cheques**: los informa uno por uno —banco, número, fecha— y quedan «por
 *   recibir» hasta que alguien los tiene en mano y los acepta.
 *
 * El saldo a favor no es una forma de pago acá: ya descuenta solo de lo que se
 * debe. Se usa al comprar, y la pantalla lo dice.
 */
export function PagarDeuda({ saldo, banco }: { saldo: number; banco: DatosParaTransferir | null }) {
  const [forma, setForma] = useState<Forma>("transferencia");

  if (saldo <= 0) return null;

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-5 py-3.5">
        <h2 className="font-medium">Pagar tu cuenta</h2>
        <p className="text-sm text-muted-foreground">Debés {formatearMonto(saldo)}</p>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b px-5 pt-3">
        <Pestana activa={forma === "transferencia"} onClick={() => setForma("transferencia")} icono={Banknote}>
          Transferencia
        </Pestana>
        <Pestana activa={forma === "deposito"} onClick={() => setForma("deposito")} icono={Landmark}>
          Depósito
        </Pestana>
        <Pestana activa={forma === "cheques"} onClick={() => setForma("cheques")} icono={ScrollText}>
          Cheques
        </Pestana>
      </div>

      {forma === "cheques" ? (
        <Cheques saldo={saldo} />
      ) : (
        <Comprobante key={forma} medio={forma} saldo={saldo} banco={banco} />
      )}
    </section>
  );
}

function Comprobante({
  medio,
  saldo,
  banco,
}: {
  medio: "transferencia" | "deposito";
  saldo: number;
  banco: DatosParaTransferir | null;
}) {
  const [estado, accion, subiendo] = useActionState(subirComprobanteDeDeuda, inicial);

  return (
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
          Escribinos por WhatsApp y te pasamos los datos de la cuenta.
        </p>
      )}

      {estado.ok ? (
        <p className="flex items-start gap-2 rounded-lg bg-brand-green/10 p-3 text-sm">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-green" />
          {estado.ok}
        </p>
      ) : (
        <form action={accion} className="space-y-3">
          <input type="hidden" name="medio" value={medio} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`monto-${medio}`} className="block text-sm font-medium">
                {medio === "deposito" ? "Importe depositado" : "Importe transferido"}
              </label>
              <input
                id={`monto-${medio}`}
                name="monto"
                inputMode="decimal"
                defaultValue={saldo.toFixed(2).replace(".", ",")}
                className="tabular mt-1 h-11 w-full rounded-lg border px-3 text-base"
              />
            </div>
            <div>
              <label htmlFor={`comprobante-${medio}`} className="block text-sm font-medium">
                {medio === "deposito" ? "Foto de la boleta de depósito" : "Comprobante"}
              </label>
              <input
                id={`comprobante-${medio}`}
                name="comprobante"
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                required
                className="mt-1 h-11 w-full rounded-lg border px-3 py-2 text-sm"
              />
            </div>
          </div>

          {estado.error && (
            <p className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {estado.error}
            </p>
          )}

          <button
            type="submit"
            disabled={subiendo}
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-accion px-5 font-medium text-white transition-colors hover:bg-accion-hover disabled:opacity-60"
          >
            {subiendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Informar el pago
          </button>

          <p className="text-sm text-muted-foreground">
            Podés pagar una parte. Lo imputamos a tu cuenta cuando lo verificamos contra el
            extracto, y te mandamos el recibo por correo.
          </p>
        </form>
      )}
    </div>
  );
}

function Cheques({ saldo }: { saldo: number }) {
  const [estado, accion, enviando] = useActionState(informarChequesDeDeuda, inicial);

  if (estado.ok) {
    return (
      <p className="m-5 flex items-start gap-2 rounded-lg bg-brand-green/10 p-3 text-sm">
        <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-green" />
        {estado.ok}
      </p>
    );
  }

  return (
    <form action={accion} className="space-y-4 p-5">
      <p className="text-sm text-muted-foreground">
        Cargá cada cheque con su banco, número y fecha de pago, tal como figuran en el papel.
        Traelos al local o mandalos como e-Cheq: cuando los tengamos los aceptamos, baja tu
        saldo y te llega el recibo.
      </p>

      <CobroMultimedio aCobrar={saldo} medios={["cheque", "echeq"]} medioInicial="cheque" />

      {estado.error && (
        <p className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {estado.error}
        </p>
      )}

      <button
        type="submit"
        disabled={enviando}
        className="inline-flex h-11 items-center gap-2 rounded-lg bg-accion px-5 font-medium text-white transition-colors hover:bg-accion-hover disabled:opacity-60"
      >
        {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScrollText className="h-4 w-4" />}
        Informar los cheques
      </button>
    </form>
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
      className={`-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-3 pb-2.5 text-sm font-medium transition-colors ${
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
