import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { asc } from "drizzle-orm";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { db } from "@/lib/db";
import { paymentDiscounts } from "@/lib/db/schema";
import { requireStaffRole } from "@/lib/dal/session";
import { EditorDeDescuento } from "./editor";
import { MEDIOS } from "./medios";

export const metadata: Metadata = { title: "Descuentos por forma de pago" };

/**
 * El descuento por pagar de contado.
 *
 * Existía en la cabeza del mostrador y se tipeaba a mano en cada venta, así
 * que dos vendedores podían dar dos números distintos por la misma compra y no
 * quedaba registrado como regla de nadie.
 */
export default async function FormasDePagoPage() {
  await requireStaffRole("admin");

  const escalones = await db
    .select()
    .from(paymentDiscounts)
    .orderBy(asc(paymentDiscounts.medio), asc(paymentDiscounts.desdeMonto));

  const nombreDeMedio = (valor: string) =>
    MEDIOS.find((m) => m.valor === valor)?.etiqueta ?? valor;

  return (
    <div className="space-y-6">
      <Link
        href="/admin/precios"
        className="inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-5 w-5" />
        Volver a precios
      </Link>

      <EncabezadoPanel
        titulo="Descuentos por forma de pago"
        detalle="Lo que se descuenta según cómo paga el cliente, en la tienda y en el mostrador."
      />

      <div className="rounded-xl border bg-muted/40 p-5 text-base">
        <p>
          <strong>Es una escala, no un porcentaje único.</strong> Gana el
          escalón de monto más alto que la compra alcanza: con uno desde cero al
          10 % y otro desde $500.000 al 15 %, una compra de $600.000 lleva el
          15 %.
        </p>
        <p className="mt-2">
          El descuento va sobre la mercadería, <strong>no sobre el flete</strong>
          : descontarle un 10 % al envío sería regalar plata que se le paga a un
          tercero.
        </p>
        <p className="mt-2 text-muted-foreground">
          En el mostrador, si el vendedor escribe un descuento a mano, ese gana.
          Nunca se suman los dos.
        </p>
      </div>

      <div className="space-y-4">
        {escalones.map((escalon) => (
          <div key={escalon.id} className="space-y-2">
            <p className="text-base font-semibold">
              {nombreDeMedio(escalon.medio)}
              <span className="ml-2 font-normal text-muted-foreground">
                {Number(escalon.porcentaje)}% desde $
                {Number(escalon.desdeMonto).toLocaleString("es-AR")}
                {!escalon.activo && " · no se aplica"}
              </span>
            </p>
            <EditorDeDescuento
              descuento={{
                id: escalon.id,
                medio: escalon.medio,
                desdeMonto: escalon.desdeMonto,
                porcentaje: escalon.porcentaje,
                etiqueta: escalon.etiqueta,
                activo: escalon.activo,
              }}
            />
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <h2 className="text-base font-semibold">Agregar un escalón</h2>
        <EditorDeDescuento descuento={null} />
      </div>
    </div>
  );
}
