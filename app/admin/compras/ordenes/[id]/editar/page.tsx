import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { esUuid } from "@/lib/uuid";
import { requireStaffRole } from "@/lib/dal/session";
import { obtenerOrdenDeCompra } from "@/lib/dal/admin/ordenes-compra";
import { proveedoresParaElegir } from "@/lib/dal/admin/proveedores";
import { sucursalesParaGasto } from "@/lib/dal/admin/gastos";
import { variantesParaPedir } from "@/lib/dal/admin/recepciones";
import { importeParaElCampo } from "@/lib/formato";
import { FormularioOrden } from "../../nueva/formulario";

export const metadata: Metadata = { title: "Corregir la orden de compra" };

/**
 * La orden en borrador, para corregirla antes de mandarla (mes simulado,
 * H297: la única salida era anularla y rehacerla con otro número). Enviada
 * ya no se toca: el proveedor la tiene.
 */
export default async function EditarOrdenPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaffRole("admin");
  const { id } = await params;
  if (!esUuid(id)) notFound();
  const orden = await obtenerOrdenDeCompra(id);
  if (!orden) notFound();
  if (orden.estado !== "borrador") redirect(`/admin/compras/ordenes/${id}`);

  const [proveedores, sucursales, variantes] = await Promise.all([
    proveedoresParaElegir(),
    sucursalesParaGasto(),
    variantesParaPedir(orden.items.map((i) => i.variantId)),
  ]);
  const ultimo = new Map(variantes.map((v) => [v.variantId, v.costoActual ? Number(v.costoActual) : null]));

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/admin/compras/ordenes/${id}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {orden.numero}
        </Link>
        <h1 className="mt-2 text-[26px] font-bold tracking-tight">Corregir {orden.numero}</h1>
      </div>
      <FormularioOrden
        proveedores={proveedores}
        sucursales={sucursales.map((s) => ({ id: s.id, nombre: s.nombre, deLaSesion: s.deLaSesion }))}
        renglonesIniciales={orden.items.map((i) => ({
          variantId: i.variantId,
          descripcion: i.descripcion,
          cantidad: String(Number(i.cantidad)),
          costoUnitario: importeParaElCampo(i.costoUnitario),
          alicuotaIva: i.alicuotaIva,
          ultimo: ultimo.get(i.variantId) ?? null,
        }))}
        editar={{
          id,
          supplierId: orden.supplierId,
          branchId: orden.branchId,
          fechaPrometida: orden.fechaPrometida ? orden.fechaPrometida.toISOString().slice(0, 10) : "",
          notas: orden.notas ?? "",
        }}
      />
    </div>
  );
}
