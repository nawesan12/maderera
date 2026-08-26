"use client";

import { useActionState, useState } from "react";
import {
  AlertCircle,
  Banknote,
  Check,
  Clock,
  Copy,
  CreditCard,
  Loader2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatearPrecio } from "@/lib/formato";
import {
  pagarPedido,
  subirComprobante,
  type EstadoPago,
} from "@/app/(public)/pago-actions";
import type { DatosParaTransferir } from "@/lib/dal/pagos";

/**
 * El bloque de pago de la pantalla de confirmación del pedido.
 *
 * Antes decía "te pasamos el link por WhatsApp", que era la forma amable de
 * decir que no había forma de pagar. Ahora resuelve los tres caminos del
 * contrato: Mercado Pago, transferencia con comprobante y cuenta corriente.
 *
 * Cuando el cobro corre con el proveedor de demostración lo dice en la cara:
 * nadie tiene que descubrir a mitad de una prueba que ese pago no era real.
 */

export interface EstadoDelPago {
  estado: string;
  proveedor: string;
  monto: number;
  comprobanteUrl: string | null;
  motivoRechazo: string | null;
}

interface Props {
  numero: string;
  total: number;
  medioPago: string | null;
  estadoPago: string;
  cobro: EstadoDelPago | null;
  banco: DatosParaTransferir | null;
  enVivo: boolean;
}

const inicial: EstadoPago = {};

export function BloquePago({
  numero,
  total,
  medioPago,
  estadoPago,
  cobro,
  banco,
  enVivo,
}: Props) {
  if (estadoPago === "pagado") {
    return (
      <Card className="border-0 bg-brand-green/5 shadow-sm">
        <CardContent className="flex items-start gap-3 p-5">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-green">
            <Check className="h-4 w-4 text-white" strokeWidth={3} />
          </span>
          <div className="text-sm">
            <p className="font-semibold">Pago acreditado</p>
            <p className="text-muted-foreground">
              Recibimos {formatearPrecio(cobro?.monto ?? total)}. Ya estamos
              preparando tu pedido.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (cobro?.estado === "en_revision") {
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="flex items-start gap-3 p-5">
          <Clock className="mt-0.5 h-5 w-5 shrink-0 text-brand-orange" />
          <div className="text-sm">
            <p className="font-semibold">Estamos verificando tu pago</p>
            <p className="text-muted-foreground">
              Recibimos el comprobante. Apenas lo vemos en la cuenta te
              confirmamos y arrancamos con el pedido.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (medioPago === "cuenta_corriente") {
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="flex items-start gap-3 p-5">
          <Banknote className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="text-sm">
            <p className="font-semibold">Cargado a tu cuenta corriente</p>
            <p className="text-muted-foreground">
              Lo ves reflejado en el saldo de tu cuenta. Podés cancelarlo cuando
              quieras desde el portal.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (medioPago === "efectivo") {
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="flex items-start gap-3 p-5">
          <Banknote className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Abonás al retirar o cuando te lo entregamos.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (medioPago === "transferencia") {
    return (
      <TransferenciaBancaria numero={numero} total={total} banco={banco} />
    );
  }

  return (
    <PagoOnline
      numero={numero}
      total={total}
      enVivo={enVivo}
      rechazado={cobro?.estado === "rechazado"}
      motivo={cobro?.motivoRechazo ?? null}
    />
  );
}

function PagoOnline({
  numero,
  total,
  enVivo,
  rechazado,
  motivo,
}: {
  numero: string;
  total: number;
  enVivo: boolean;
  rechazado: boolean;
  motivo: string | null;
}) {
  const [estado, accion, pendiente] = useActionState(pagarPedido, inicial);

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-5">
        <div className="mb-4 flex items-center gap-3">
          <CreditCard className="h-5 w-5 shrink-0 text-brand-orange" />
          <div className="text-sm">
            <p className="font-semibold">Pagá con Mercado Pago</p>
            <p className="text-muted-foreground">
              Tarjeta, dinero en cuenta o efectivo en un punto de pago.
            </p>
          </div>
        </div>

        {rechazado && (
          <p className="mb-3 flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              El pago anterior no se aprobó
              {motivo ? ` (${motivo})` : ""}. Podés intentar de nuevo con otro
              medio.
            </span>
          </p>
        )}

        {estado.error && (
          <p className="mb-3 flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {estado.error}
          </p>
        )}

        <form action={accion}>
          <input type="hidden" name="numero" value={numero} />
          <Button
            type="submit"
            disabled={pendiente}
            className="h-12 w-full bg-brand-orange text-base text-white hover:bg-brand-orange-dark"
          >
            {pendiente ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Abriendo el pago…
              </>
            ) : (
              `Pagar ${formatearPrecio(total)}`
            )}
          </Button>
        </form>

        {!enVivo && (
          <p className="mt-3 text-xs text-muted-foreground">
            Los cobros están en modo de prueba: todavía no se cargaron las
            credenciales de Mercado Pago, así que no se mueve plata.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function TransferenciaBancaria({
  numero,
  total,
  banco,
}: {
  numero: string;
  total: number;
  banco: DatosParaTransferir | null;
}) {
  const [estado, accion, pendiente] = useActionState(subirComprobante, inicial);
  const [copiado, setCopiado] = useState<string | null>(null);

  async function copiar(valor: string, etiqueta: string) {
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado(etiqueta);
      setTimeout(() => setCopiado(null), 2000);
    } catch {
      // Sin portapapeles disponible, el dato igual está visible para copiarlo a mano.
    }
  }

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-5">
        <div className="mb-4 flex items-center gap-3">
          <Banknote className="h-5 w-5 shrink-0 text-brand-orange" />
          <div className="text-sm">
            <p className="font-semibold">
              Transferí {formatearPrecio(total)}
            </p>
            <p className="text-muted-foreground">
              Poné el número {numero} como referencia.
            </p>
          </div>
        </div>

        {banco ? (
          <dl className="mb-4 space-y-2 rounded-lg bg-brand-cream/60 p-4 text-sm">
            <Dato etiqueta="Titular" valor={banco.titular} />
            <Dato etiqueta="Banco" valor={banco.banco} />
            <Dato etiqueta="CUIT" valor={banco.cuit} />
            <Dato
              etiqueta="CBU"
              valor={banco.cbu}
              onCopiar={() => copiar(banco.cbu, "CBU")}
              copiado={copiado === "CBU"}
            />
            <Dato
              etiqueta="Alias"
              valor={banco.alias}
              onCopiar={() => copiar(banco.alias, "Alias")}
              copiado={copiado === "Alias"}
            />
            {banco.instrucciones && (
              <p className="pt-1 text-xs text-muted-foreground">
                {banco.instrucciones}
              </p>
            )}
          </dl>
        ) : (
          <p className="mb-4 rounded-lg bg-muted p-4 text-sm text-muted-foreground">
            Escribinos por WhatsApp y te pasamos los datos para transferir.
          </p>
        )}

        {estado.ok ? (
          <p className="flex items-start gap-2 rounded-lg bg-brand-green/10 p-3 text-sm">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-green" />
            {estado.ok}
          </p>
        ) : (
          <form action={accion} className="space-y-3">
            <input type="hidden" name="numero" value={numero} />

            <div>
              <Label htmlFor="comprobante" className="text-sm">
                Subí el comprobante
              </Label>
              <Input
                id="comprobante"
                name="comprobante"
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                required
                className="mt-1.5"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Imagen o PDF. Lo verificamos contra el extracto antes de
                confirmar.
              </p>
            </div>

            {estado.error && (
              <p className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {estado.error}
              </p>
            )}

            <Button
              type="submit"
              disabled={pendiente}
              className="w-full bg-brand-orange text-white hover:bg-brand-orange-dark"
            >
              {pendiente ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Subiendo…
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Informar el pago
                </>
              )}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function Dato({
  etiqueta,
  valor,
  onCopiar,
  copiado,
}: {
  etiqueta: string;
  valor: string;
  onCopiar?: () => void;
  copiado?: boolean;
}) {
  if (!valor) return null;

  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{etiqueta}</dt>
      <dd className="flex items-center gap-2 font-medium tabular">
        {valor}
        {onCopiar && (
          <button
            type="button"
            onClick={onCopiar}
            aria-label={`Copiar ${etiqueta}`}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground"
          >
            {copiado ? (
              <Check className="h-3.5 w-3.5 text-brand-green" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </dd>
    </div>
  );
}
