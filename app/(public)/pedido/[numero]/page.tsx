import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import {
  ArrowRight,
  Check,
  MessageCircle,
  Store,
  Truck,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { db } from "@/lib/db";
import { branches, orderItems, orders } from "@/lib/db/schema";
import { getSession } from "@/lib/dal/session";
import { formatearPrecio } from "@/lib/formato";

export const metadata: Metadata = {
  title: "Pedido confirmado",
  robots: { index: false, follow: false },
};

const PROXIMO_PASO: Record<string, string> = {
  mercado_pago:
    "Te mandamos el link de pago por WhatsApp para que lo abones cuando quieras.",
  transferencia:
    "Te pasamos los datos bancarios por WhatsApp. El pedido se prepara al acreditarse.",
  efectivo: "Abonás al retirar o cuando te lo entregamos.",
  cuenta_corriente: "Lo cargamos a tu cuenta corriente.",
};

export default async function PedidoConfirmadoPage({
  params,
}: {
  params: Promise<{ numero: string }>;
}) {
  const { numero } = await params;

  const [pedido] = await db
    .select({
      id: orders.id,
      numero: orders.numero,
      cliente: orders.contactoNombre,
      telefono: orders.contactoTelefono,
      tipoEntrega: orders.tipoEntrega,
      direccionEntrega: orders.direccionEntrega,
      zonaEnvio: orders.zonaEnvio,
      costoEnvio: orders.costoEnvio,
      subtotal: orders.subtotal,
      total: orders.total,
      medioPago: orders.medioPago,
      sucursal: branches.name,
      sucursalDireccion: branches.address,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .leftJoin(branches, eq(branches.id, orders.branchId))
    .where(eq(orders.numero, numero))
    .limit(1);

  if (!pedido) notFound();

  const [items, sesion] = await Promise.all([
    db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, pedido.id))
      .orderBy(orderItems.orden),
    getSession(),
  ]);

  const mensaje = encodeURIComponent(
    `Hola! Acabo de hacer el pedido ${pedido.numero} desde la web.`,
  );

  return (
    <div className="min-h-screen bg-brand-cream/30">
      <div className="container mx-auto max-w-2xl px-4 py-12">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-brand-green">
            <Check className="h-8 w-8 text-white" strokeWidth={3} />
          </div>
          <h1 className="text-3xl font-bold">Listo, recibimos tu pedido</h1>
          <p className="mt-2 text-muted-foreground">
            Guardá el número{" "}
            <span className="tabular font-semibold text-foreground">
              {pedido.numero}
            </span>
            . Te escribimos para coordinar.
          </p>
        </div>

        <Card className="border-0 shadow-sm">
          <CardContent className="p-6">
            <ul className="divide-y">
              {items.map((item) => (
                <li key={item.id} className="flex justify-between gap-4 py-3">
                  <span className="min-w-0">
                    <span className="tabular text-muted-foreground">
                      {Number(item.cantidad)}×
                    </span>{" "}
                    {item.descripcion}
                  </span>
                  <span className="tabular shrink-0">
                    {formatearPrecio(item.subtotal)}
                  </span>
                </li>
              ))}
            </ul>

            <dl className="space-y-2 border-t pt-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="tabular">{formatearPrecio(pedido.subtotal)}</dd>
              </div>
              {Number(pedido.costoEnvio) > 0 && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Envío</dt>
                  <dd className="tabular">
                    {formatearPrecio(pedido.costoEnvio)}
                  </dd>
                </div>
              )}
            </dl>

            <div className="mt-3 flex items-baseline justify-between border-t pt-3">
              <span className="font-semibold">Total</span>
              <span className="tabular text-2xl font-bold">
                {formatearPrecio(pedido.total)}
              </span>
            </div>
          </CardContent>
        </Card>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-5">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Entrega
              </h2>
              {pedido.tipoEntrega === "retiro" ? (
                <p className="flex items-start gap-2 text-sm">
                  <Store className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>
                    Retirás en {pedido.sucursal}
                    <span className="block text-muted-foreground">
                      {pedido.sucursalDireccion}
                    </span>
                  </span>
                </p>
              ) : (
                <p className="flex items-start gap-2 text-sm">
                  <Truck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>
                    {pedido.direccionEntrega}
                    <span className="block text-muted-foreground">
                      {pedido.zonaEnvio}
                    </span>
                  </span>
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardContent className="p-5">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Pago
              </h2>
              <p className="text-sm text-muted-foreground">
                {pedido.medioPago
                  ? PROXIMO_PASO[pedido.medioPago]
                  : "Coordinamos el pago por WhatsApp."}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Con sesión, el pedido ya vive en el portal y se puede seguir desde
            ahí. Sin sesión, crear la cuenta es justo lo que hace que este
            número no haya que anotarlo en un papel. */}
        {sesion ? (
          <Link href={`/mi-cuenta/pedidos/${pedido.numero}`}>
            <Card className="mt-4 border-0 shadow-sm transition-shadow hover:shadow-md">
              <CardContent className="flex items-center gap-3 p-5">
                <UserRound className="h-5 w-5 shrink-0 text-brand-orange" />
                <span className="flex-1 text-sm">
                  <span className="block font-medium">
                    Seguí este pedido desde tu cuenta
                  </span>
                  <span className="text-muted-foreground">
                    Te mostramos en qué etapa está hasta que lo tenés.
                  </span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
        ) : (
          <Card className="mt-4 border-0 shadow-sm">
            <CardContent className="flex flex-wrap items-center gap-4 p-5">
              <UserRound className="h-5 w-5 shrink-0 text-brand-orange" />
              <span className="min-w-[12rem] flex-1 text-sm">
                <span className="block font-medium">
                  Creá tu cuenta y seguí el pedido
                </span>
                <span className="text-muted-foreground">
                  Así no tenés que anotar el número ni llamar para preguntar.
                </span>
              </span>
              <Link href="/registro">
                <Button className="bg-brand-orange text-white hover:bg-brand-orange-dark">
                  Crear cuenta
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <a
            href={`https://wa.me/542235903118?text=${mensaje}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button className="bg-brand-green text-white hover:bg-brand-green/90">
              <MessageCircle className="h-4 w-4" />
              Escribirnos por WhatsApp
            </Button>
          </a>
          <Link href="/catalogo">
            <Button variant="outline">Seguir comprando</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
