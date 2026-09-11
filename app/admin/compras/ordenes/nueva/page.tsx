import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireStaffRole } from "@/lib/dal/session";
import { proveedoresParaElegir } from "@/lib/dal/admin/proveedores";
import { variantesParaPedir } from "@/lib/dal/admin/recepciones";
import { sucursalesConCaja } from "@/lib/mostrador/caja";
import { importeParaEditar } from "@/lib/formato";
import { FormularioOrden } from "./formulario";

export const metadata: Metadata = { title: "Nueva orden de compra" };

export default async function NuevaOrdenPage({
  searchParams,
}: {
  /**
   * `sugeridos` llega del reporte de reposición, como `variantId:cantidad`
   * separados por coma. Es la acción que ese reporte pedía a gritos: decía qué
   * comprar y cuánto, y no dejaba hacer nada con eso.
   */
  searchParams: Promise<{ sugeridos?: string }>;
}) {
  await requireStaffRole("admin");

  const { sugeridos } = await searchParams;

  const pedidos = (sugeridos ?? "")
    .split(",")
    .map((par) => par.split(":"))
    .filter(([id, cant]) => id && Number(cant) > 0)
    .map(([id, cant]) => ({ variantId: id, cantidad: Math.round(Number(cant)) }));

  const [proveedores, sucursales, variantes] = await Promise.all([
    proveedoresParaElegir(),
    sucursalesConCaja(),
    pedidos.length > 0
      ? variantesParaPedir(pedidos.map((p) => p.variantId))
      : Promise.resolve([]),
  ]);

  /*
   * El orden lo manda el reporte, no la consulta: el de arriba es el que más
   * urge reponer, y esa prioridad se pierde si la orden los reordena por
   * nombre.
   */
  const renglones = pedidos.flatMap((p) => {
    const v = variantes.find((x) => x.variantId === p.variantId);
    if (!v) return [];
    return [
      {
        variantId: v.variantId,
        descripcion: [v.producto, v.variante].filter(Boolean).join(" "),
        cantidad: String(p.cantidad),
        costoUnitario: importeParaEditar(v.costoActual),
        alicuotaIva: v.alicuotaIva,
      },
    ];
  });

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/compras/ordenes"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Órdenes de compra
        </Link>
        <h1 className="mt-2 text-[26px] font-bold tracking-tight">
          Nueva orden de compra
        </h1>
        <p className="mt-1 text-base text-muted-foreground">
          Los costos van <strong>netos</strong>. Nace en borrador: cuenta como
          &quot;en camino&quot; recién cuando se marca como enviada.
        </p>
      </div>

      {renglones.length > 0 && (
        <p className="tarjeta-atencion px-4 py-3 text-base">
          Vienen <strong>{renglones.length}</strong> renglones del reporte de
          reposición, con la cantidad sugerida. Falta elegir el proveedor y
          revisar los costos.
        </p>
      )}

      <FormularioOrden
        proveedores={proveedores}
        sucursales={sucursales.map((s) => ({ id: s.id, nombre: s.nombre }))}
        renglonesIniciales={renglones.length > 0 ? renglones : undefined}
      />
    </div>
  );
}
