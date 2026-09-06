import type { Metadata } from "next";
import { Truck } from "lucide-react";
import { asc } from "drizzle-orm";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { db } from "@/lib/db";
import { shippingZones } from "@/lib/db/schema";
import { requireStaffRole } from "@/lib/dal/session";
import { formatearMonto } from "@/lib/formato";
import { EditorDeZona } from "./editor";

export const metadata: Metadata = { title: "Envíos" };

/**
 * Zonas de envío.
 *
 * Pantalla nueva: las zonas existían en el modelo y en el checkout, pero **no
 * se podían editar desde ningún lado**. Vivían en el script de siembra, así
 * que corregir una tarifa —o marcar que una zona se cotiza aparte— exigía
 * tocar código y volver a desplegar. Para un negocio cuyo flete se mueve con
 * el combustible, eso significa tenerlo mal todo el tiempo.
 *
 * Es de administración: una tarifa de envío es un precio, y quien atiende el
 * mostrador no tiene por qué poder cambiarla.
 */
export default async function AdminEnviosPage() {
  await requireStaffRole("admin");

  const zonas = await db
    .select()
    .from(shippingZones)
    .orderBy(asc(shippingZones.orden), asc(shippingZones.nombre));

  const aCotizar = zonas.filter((z) => z.activa && z.aCotizar).length;

  return (
    <div className="space-y-6">
      <EncabezadoPanel
        titulo="Envíos"
        detalle="Las zonas que se ofrecen en el checkout, con su costo y su plazo."
      />

      <div className="rounded-xl border bg-card p-5">
        <p className="flex items-start gap-2.5 text-base text-muted-foreground">
          <Truck className="mt-0.5 h-5 w-5 shrink-0 text-brand-orange" />
          <span>
            Hay <strong className="text-foreground">{zonas.filter((z) => z.activa).length}</strong>{" "}
            zonas activas
            {aCotizar > 0 && (
              <>
                {" "}
                y <strong className="text-foreground">{aCotizar}</strong> con el
                flete a cotizar
              </>
            )}
            . Lo que se cobra sale de acá: el checkout no calcula nada por su
            cuenta.
          </span>
        </p>
      </div>

      <div className="space-y-4">
        {zonas.map((zona) => (
          <div key={zona.id} className="space-y-2">
            <p className="text-base font-semibold">
              {zona.nombre}
              <span className="ml-2 font-normal text-muted-foreground">
                {zona.aCotizar
                  ? "a cotizar"
                  : formatearMonto(Number(zona.costo))}
                {!zona.activa && " · no se ofrece"}
              </span>
            </p>
            <EditorDeZona
              zona={{
                id: zona.id,
                nombre: zona.nombre,
                cobertura: zona.cobertura,
                demoraEstimada: zona.demoraEstimada,
                aCotizar: zona.aCotizar,
                costo: zona.costo,
                envioGratisDesde: zona.envioGratisDesde,
                orden: zona.orden,
                activa: zona.activa,
              }}
            />
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <h2 className="text-base font-semibold">Agregar una zona</h2>
        <EditorDeZona zona={null} />
      </div>
    </div>
  );
}
