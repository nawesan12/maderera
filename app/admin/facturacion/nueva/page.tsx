import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { configuracionFiscalActual } from "@/lib/dal/admin/facturacion";
import type { CondicionIva } from "@/lib/fiscal/comprobantes";
import { FormularioFacturaManual } from "./formulario";

export const metadata: Metadata = { title: "Nueva factura" };

export default async function NuevaFacturaPage() {
  const emisor = await configuracionFiscalActual();

  return (
    <div className="space-y-5">
      <Link
        href="/admin/facturacion"
        className="inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-5 w-5" />
        Volver a facturación
      </Link>

      <EncabezadoPanel
        titulo="Nueva factura"
        detalle="Para la venta de mostrador que no pasó por un pedido."
      />

      {!emisor.cuit ? (
        <section className="tarjeta-atencion p-5">
          <h2 className="text-base font-medium">Falta cargar el CUIT</h2>
          <p className="mt-1 text-base text-muted-foreground">
            Sin los datos fiscales de la empresa no se puede emitir ningún
            comprobante.
          </p>
          <Link
            href="/admin/arca"
            className="mt-3 inline-flex h-10 items-center rounded-lg bg-brand-orange px-4 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark"
          >
            Cargar datos fiscales
          </Link>
        </section>
      ) : (
        <FormularioFacturaManual
          condicionEmisor={emisor.condicionIva as CondicionIva}
        />
      )}
    </div>
  );
}
