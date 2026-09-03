import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireStaffRole } from "@/lib/dal/session";
import { proveedoresParaElegir } from "@/lib/dal/admin/proveedores";
import { sucursalesConCaja } from "@/lib/mostrador/caja";
import { FormularioRecepcion } from "./formulario";

export const metadata: Metadata = { title: "Nueva recepción" };

export default async function NuevaRecepcionPage() {
  await requireStaffRole("admin");

  const [proveedores, sucursales] = await Promise.all([
    proveedoresParaElegir(),
    sucursalesConCaja(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/recepciones"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Recepciones
        </Link>
        <h1 className="mt-2 text-[26px] font-bold tracking-tight">
          Nueva recepción
        </h1>
        <p className="mt-1 text-base text-muted-foreground">
          Los costos van <strong>netos</strong>, como los factura el proveedor.
          Se guarda en borrador: el stock y el costo se mueven al confirmar.
        </p>
      </div>

      <FormularioRecepcion
        proveedores={proveedores}
        sucursales={sucursales.map((s) => ({ id: s.id, nombre: s.nombre }))}
      />
    </div>
  );
}
