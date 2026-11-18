import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { datosDeEtiquetas } from "@/lib/dal/admin/products";
import { tienda } from "@/lib/dal/contenido";
import { leerPedidoDeEtiquetas } from "@/lib/etiquetas-de-medidas";
import { esUuid } from "@/lib/uuid";
import { ArmadorDeEtiquetas, type MedidaElegida } from "./armador";

/**
 * Elegir qué etiquetas imprimir: medidas sueltas o productos enteros, cuántas
 * de cada una, el formato y si llevan precio.
 *
 * Se llega desde Stock (una medida, `?m=`), desde la ficha de un producto
 * (todas sus medidas, `?producto=`) o desde el botón de Productos y Stock
 * (vacía, a buscar). La hoja que se imprime es otra página
 * (`/etiquetas-de-medidas`), sin el menú del panel.
 */
export default async function EtiquetasPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string | string[]; producto?: string | string[] }>;
}) {
  const params = await searchParams;
  const pedido = leerPedidoDeEtiquetas(params.m);
  const productos = (Array.isArray(params.producto) ? params.producto : [params.producto ?? ""])
    .flatMap((p) => p.split(","))
    .filter(esUuid)
    .slice(0, 50);

  const [datos, { activa }] = await Promise.all([
    pedido.length + productos.length > 0
      ? datosDeEtiquetas({ medidas: pedido.map((p) => p.id), productos })
      : Promise.resolve([]),
    tienda(),
  ]);

  const cantidad = new Map(pedido.map((p) => [p.id, p.cantidad]));
  const iniciales: MedidaElegida[] = datos.map((d) => ({
    id: d.variantId,
    producto: d.nombre,
    medida: d.medida,
    codigo: d.codigo,
    cantidad: cantidad.get(d.variantId) ?? 1,
  }));

  return (
    <div className="space-y-6">
      <Link
        href="/admin/stock"
        className="inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-5 w-5" />
        Volver a stock
      </Link>
      <EncabezadoPanel titulo="Etiquetas" />
      {/* El precio va por omisión solo con la tienda encendida: con la
          tienda apagada el sitio no muestra precios, y una etiqueta con
          precio en el estante sería la única parte que lo dice. */}
      <ArmadorDeEtiquetas iniciales={iniciales} conPrecioPorOmision={activa} />
    </div>
  );
}
