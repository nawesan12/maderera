import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CircleAlert, CreditCard, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cobroSimulado } from "@/lib/dal/pagos";
import { formatearPrecio } from "@/lib/formato";
import { simularResultado } from "../actions";

export const metadata: Metadata = {
  title: "Pago de prueba",
  robots: { index: false, follow: false },
};

/**
 * Checkout de mentira.
 *
 * Ocupa el lugar del checkout de Mercado Pago mientras MJBJ no entregue sus
 * credenciales. Todo lo que hay alrededor —abrir el cobro, recibir el aviso,
 * acreditar, avisarle al cliente, conciliar en el panel— es el código real; lo
 * único simulado es esta pantalla.
 *
 * Está deliberadamente fea y llena de advertencias: que nadie la confunda con
 * una pasarela ni por un segundo.
 */
export default async function PagoDemoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const pago = await cobroSimulado(id);

  // `cobroSimulado` devuelve null si el cobro no es del proveedor demo: esta
  // pantalla no puede tocar un cobro real de Mercado Pago.
  if (!pago) notFound();

  const cerrado = pago.estado !== "iniciado" && pago.estado !== "pendiente";

  return (
    <div className="flex min-h-screen items-center justify-center bg-sitio-alt px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <ShieldOff className="mt-0.5 h-5 w-5 shrink-0" />
          <p>
            <strong className="block">Esto no es una pasarela de pago.</strong>
            No hay plata de por medio. La pantalla existe para probar el circuito
            de cobro completo hasta que estén cargadas las credenciales de
            Mercado Pago.
          </p>
        </div>

        <Card className="border-0 shadow-sm">
          <CardContent className="p-6">
            <div className="mb-5 flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-orange/10">
                <CreditCard className="h-5 w-5 text-brand-orange" />
              </span>
              <div>
                <p className="text-sm text-muted-foreground">{pago.concepto}</p>
                <p className="text-2xl font-bold tabular">
                  {formatearPrecio(pago.monto)}
                </p>
              </div>
            </div>

            {cerrado ? (
              <p className="flex items-start gap-2 rounded-lg bg-muted p-4 text-sm">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                Este cobro ya está {pago.estado}. No se puede volver a simular.
              </p>
            ) : (
              <div className="grid gap-3">
                <form action={simularResultado}>
                  <input type="hidden" name="pagoId" value={pago.id} />
                  <input type="hidden" name="decision" value="aprobar" />
                  <Button
                    type="submit"
                    className="h-12 w-full bg-brand-green text-base text-white hover:bg-brand-green/90"
                  >
                    Simular pago aprobado
                  </Button>
                </form>

                <form action={simularResultado}>
                  <input type="hidden" name="pagoId" value={pago.id} />
                  <input type="hidden" name="decision" value="rechazar" />
                  <Button
                    type="submit"
                    variant="outline"
                    className="h-12 w-full text-base"
                  >
                    Simular pago rechazado
                  </Button>
                </form>
              </div>
            )}
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Cobro {pago.id.slice(0, 8)} · proveedor de demostración
        </p>
      </div>
    </div>
  );
}
