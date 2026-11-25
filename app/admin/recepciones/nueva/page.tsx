import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireStaffRole } from "@/lib/dal/session";
import { proveedoresParaElegir } from "@/lib/dal/admin/proveedores";
import { sucursalesParaGasto } from "@/lib/dal/admin/gastos";
import { FormularioRecepcion } from "./formulario";

export const metadata: Metadata = { title: "Nueva recepción" };

/*
 * Los costos van netos, como los factura el proveedor. Se guarda en borrador:
 * el stock y el costo se mueven al confirmar. (Lo decía una bajada en la
 * pantalla; el porqué va acá, no ahí.)
 */
export default async function NuevaRecepcionPage() {
  await requireStaffRole("admin");

  const [proveedores, sucursales] = await Promise.all([
    proveedoresParaElegir(),
    sucursalesParaGasto(),
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
      </div>

      <FormularioRecepcion
        proveedores={proveedores}
        sucursales={sucursales.map((s) => ({ id: s.id, nombre: s.nombre, deLaSesion: s.deLaSesion }))}
      />
    </div>
  );
}
