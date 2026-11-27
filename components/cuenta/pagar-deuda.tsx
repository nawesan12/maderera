"use client";

import { useActionState, useRef, useState, useTransition, type FormEvent } from "react";
import { CampoArchivo } from "@/components/campo-archivo";
import { AlertCircle, Banknote, Check, Landmark, Loader2, ScrollText, Upload } from "lucide-react";
import {
  informarChequesDeDeuda,
  subirComprobanteDeDeuda,
  type EstadoPago,
} from "@/app/(public)/pago-actions";
import { sinRomper } from "@/lib/acciones/sin-romper";
import { CobroMultimedio } from "@/components/cobros/cobro-multimedio";
import { formatearMonto, importeParaElCampo } from "@/lib/formato";
import type { DatosParaTransferir } from "@/lib/dal/pagos";

const inicial: EstadoPago = {};
const subirDeDeuda = sinRomper(subirComprobanteDeDeuda);
const informarCheques = sinRomper(informarChequesDeDeuda);

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
export function PagarDeuda({
  saldo,
  propuesto,
  enRevision = 0,
  banco,
}: {
  saldo: number;
  /** Lo que se debe menos lo que ya está en revisión (importeAInformar). */
  propuesto: number | null;
  /** Lo informado que se está verificando: va junto a «Debés» (M2S3-033). */
  enRevision?: number;
  banco: DatosParaTransferir | null;
}) {
  // Sin a dónde transferir, la transferencia y el depósito no se ofrecen:
  // el recuadro mandaba a pedir el CBU por WhatsApp (mes simulado, M2S1-070
  // y M3S1-016). El panel le avisa a la casa que faltan.
  const [forma, setForma] = useState<Forma>(banco ? "transferencia" : "cheques");

  if (saldo <= 0) return null;

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-5 py-3.5">
        <h2 className="font-medium">Pagar tu cuenta</h2>
        <p className="text-sm text-muted-foreground">
          Debés <span className="tabular">{formatearMonto(saldo)}</span>
          {enRevision > 0 && (
            <>
              {" · "}
              <span className="tabular">{formatearMonto(enRevision)}</span> en revisión
            </>
          )}
        </p>
      </div>

      {/* Las tres entran a 375 px: se reparten el ancho, sin correrse de
          costado (H217). */}
      {banco && (
        <div className="flex border-b px-2 pt-3 sm:gap-1 sm:px-5">
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
      )}

      {forma === "cheques" ? (
        <Cheques saldo={propuesto ?? saldo} />
      ) : (
        <Comprobante key={forma} medio={forma} propuesto={propuesto} banco={banco} />
      )}
    </section>
  );
}

function Comprobante({
  medio,
  propuesto,
  banco,
}: {
  medio: "transferencia" | "deposito";
  propuesto: number | null;
  banco: DatosParaTransferir | null;
}) {
  const [estado, accion] = useActionState(subirDeDeuda, inicial);
  const [subiendo, empezar] = useTransition();
  const formulario = useRef<HTMLFormElement>(null);

  // Con `onSubmit` y no con `action`: con `action`, React vacía el formulario
  // al volver, y un error se llevaba el importe y el archivo elegido (H076).
  function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const datos = new FormData(e.currentTarget);
    empezar(() => accion(datos));
  }

  // Go frenó un pago igual al que ya está en revisión, o uno que pasa lo que
  // se debe (H385): se manda el mismo formulario, confirmado.
  function confirmar() {
    if (!formulario.current) return;
    const datos = new FormData(formulario.current);
    datos.set("confirmar", "1");
    empezar(() => accion(datos));
  }

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
      ) : null}

      {estado.ok ? (
        <p className="flex items-start gap-2 rounded-lg bg-brand-green/10 p-3 text-sm">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-green" />
          {estado.ok}
        </p>
      ) : (
        <form ref={formulario} onSubmit={enviar} className="space-y-3">
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
                defaultValue={propuesto === null ? "" : importeParaElCampo(propuesto)}
                className="tabular mt-1 h-11 w-full rounded-lg border px-3 text-base"
              />
            </div>
            <div>
              <label htmlFor={`comprobante-${medio}`} className="block text-sm font-medium">
                {medio === "deposito" ? "Foto de la boleta de depósito" : "Comprobante"}
              </label>
              <CampoArchivo
                id={`comprobante-${medio}`}
                name="comprobante"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                required
                className="mt-1 w-full"
              />
            </div>
          </div>

          {estado.error && (
            <p className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {estado.error}
            </p>
          )}

          {estado.confirmar && !subiendo && (
            <div role="alert" className="estado-espera flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[var(--estado-fondo)] p-3 text-sm">
              <span className="flex min-w-0 items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {estado.confirmar}
              </span>
              <button
                type="button"
                onClick={confirmar}
                className="inline-flex h-11 items-center rounded-lg bg-card px-4 font-medium text-foreground"
              >
                Sí, informarlo
              </button>
            </div>
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
  const [estado, accion, enviando] = useActionState(informarCheques, inicial);

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

      <CobroMultimedio aCobrar={saldo} medios={["cheque", "echeq"]} medioInicial="cheque" delCliente />

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
      className={`-mb-px inline-flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1.5 border-b-2 px-2 pb-2.5 text-sm font-medium transition-colors sm:flex-none sm:justify-start sm:gap-2 sm:px-3 ${
        activa
          ? "border-brand-orange text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icono className="hidden h-4 w-4 shrink-0 sm:block" />
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
