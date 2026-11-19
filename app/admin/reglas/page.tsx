import { EncabezadoPanel } from "@/components/admin/encabezado";
import { requireStaffRole } from "@/lib/dal/session";
import { ajuste } from "@/lib/dal/contenido";
import { Regla } from "./regla";

export const metadata = { title: "Reglas del negocio" };

/**
 * Las reglas que decide el dueño y no el sistema (migración 00104): cómo se
 * calcula la ganancia del mes y qué pasa al anular una factura de compra que
 * ya se pagó. Cada una arranca como funcionaba antes de existir esta
 * pantalla.
 */
export default async function ReglasPage() {
  await requireStaffRole("admin");
  const [gastos, descuento, anular, libre] = await Promise.all([
    ajuste("ganancia_gastos", "con_iva"),
    ajuste("ganancia_descuento", "no"),
    ajuste("anular_compra_con_pagos", "a_cuenta"),
    ajuste("descuento_sin_autorizacion_pct", "5"),
  ]);

  return (
    <div className="space-y-6">
      <EncabezadoPanel titulo="Reglas del negocio" />

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Ganancia del mes
        </h2>
        <div className="tarjeta divide-y">
          <Regla
            clave="ganancia_gastos"
            pregunta="Los gastos, ¿con IVA o sin IVA?"
            valor={gastos}
            opciones={[
              { valor: "con_iva", texto: "Con IVA" },
              { valor: "sin_iva", texto: "Sin IVA" },
            ]}
          />
          <Regla
            clave="ganancia_descuento"
            pregunta="¿Se resta de las ventas el descuento que se le hizo al pedido?"
            valor={descuento}
            opciones={[
              { valor: "si", texto: "Sí, se resta" },
              { valor: "no", texto: "No" },
            ]}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Mostrador
        </h2>
        <div className="tarjeta">
          {/* Pasado este porcentaje, lo que una venta queda por debajo de la
              lista (más el descuento tipeado) pide el PIN de un admin. */}
          <Regla
            clave="descuento_sin_autorizacion_pct"
            pregunta="Descuento sin autorización"
            valor={libre}
            opciones={[
              { valor: "0", texto: "Ninguno" },
              { valor: "5", texto: "Hasta 5 %" },
              { valor: "10", texto: "Hasta 10 %" },
            ]}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Compras
        </h2>
        <div className="tarjeta">
          <Regla
            clave="anular_compra_con_pagos"
            pregunta="Al anular una factura de compra que ya se pagó…"
            valor={anular}
            opciones={[
              { valor: "a_cuenta", texto: "Los pagos quedan a cuenta del proveedor" },
              { valor: "bloquear", texto: "No se puede: primero se anulan los pagos" },
            ]}
          />
        </div>
      </section>
    </div>
  );
}
