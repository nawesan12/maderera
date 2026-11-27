import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireStaffRole } from "@/lib/dal/session";
import { proveedoresParaElegir } from "@/lib/dal/admin/proveedores";
import { variantesParaPedir } from "@/lib/dal/admin/recepciones";
import { sucursalesParaGasto } from "@/lib/dal/admin/gastos";
import { FormularioOrden } from "./formulario";
import { costoPropuesto } from "../costos";

export const metadata: Metadata = { title: "Nueva orden de compra" };

export default async function NuevaOrdenPage({
  searchParams,
}: {
  /**
   * `sugeridos` llega del reporte de reposición, como `variantId:cantidad`
   * separados por coma. Es la acción que ese reporte pedía a gritos: decía qué
   * comprar y cuánto, y no dejaba hacer nada con eso.
   */
  searchParams: Promise<{ sugeridos?: string; proveedor?: string; sucursal?: string }>;
}) {
  await requireStaffRole("admin");

  const { sugeridos, proveedor, sucursal } = await searchParams;

  const pedidos = (sugeridos ?? "")
    .split(",")
    .map((par) => par.split(":"))
    .filter(([id, cant]) => id && Number(cant) > 0)
    .map(([id, cant]) => ({ variantId: id, cantidad: Math.round(Number(cant)) }));

  const [proveedores, sucursales, variantes] = await Promise.all([
    proveedoresParaElegir(),
    sucursalesParaGasto(),
    pedidos.length > 0
      ? variantesParaPedir(pedidos.map((p) => p.variantId), proveedor)
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
        costoUnitario: costoPropuesto(v.costoActual),
        alicuotaIva: v.alicuotaIva,
        ultimo: v.costoActual ? Number(v.costoActual) : null,
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
        {/* Nace en borrador: cuenta como "en camino" recién cuando se marca como enviada. */}
        <p className="mt-1 text-base text-muted-foreground">
          Los costos van <strong>netos</strong>.
        </p>
      </div>


      <FormularioOrden
        proveedores={proveedores}
        sucursales={sucursales.map((s) => ({ id: s.id, nombre: s.nombre, deLaSesion: s.deLaSesion }))}
        renglonesIniciales={renglones.length > 0 ? renglones : undefined}
        proveedorInicial={proveedores.some((p) => p.id === proveedor) ? proveedor : undefined}
        sucursalInicial={sucursales.some((x) => x.id === sucursal) ? sucursal : undefined}
      />
    </div>
  );
}
