import Link from "next/link";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import {
  listarCategoriasAdmin,
  listarRubrosAdmin,
  imputacionesUsadas,
  atributosUsados,
  obtenerProductoAdmin,
} from "@/lib/dal/admin/products";
import { esUuid } from "@/lib/uuid";
import { listarSucursales } from "@/lib/dal/admin/inventory";
import { FormularioProducto, type ProductoForm } from "../formulario";

export default async function NuevoProductoPage({
  searchParams,
}: {
  searchParams: Promise<{ copiar?: string; guardado?: string }>;
}) {
  const { copiar, guardado } = await searchParams;
  const [categorias, rubros, imputaciones, atributos, original, todas] = await Promise.all([
    listarCategoriasAdmin(),
    listarRubrosAdmin(),
    imputacionesUsadas(),
    atributosUsados(),
    copiar && esUuid(copiar) ? obtenerProductoAdmin(copiar) : null,
    listarSucursales(),
  ]);
  // Las columnas de stock: las sucursales activas de la base, en su orden.
  const sucursales = todas
    .filter((s) => s.active)
    .map((s) => ({ id: s.id, slug: s.slug, nombre: s.name }));

  /*
   * Duplicar: el mismo producto con sus medidas y precios, para cargar el
   * que es casi igual (otra línea de colores, otro espesor). Lo que identifica
   * a cada medida —código y código de barras— y el stock arrancan vacíos.
   */
  const copia: ProductoForm | null = original
    ? {
        name: `${original.name} (copia)`,
        slug: "",
        categoryId: original.categoryId,
        subcategory: original.subcategory ?? "",
        subcategoryId: original.subcategoryId ?? "",
        description: original.description,
        brand: original.brand ?? "",
        unit: original.unit,
        formaDeVenta: original.formaDeVenta,
        precioMediaPct: String(original.precioMediaPct),
        alicuotaIva: String(Number(original.alicuotaIva ?? 21)),
        recargoElaboracionPct: original.recargoElaboracionPct ? String(Number(original.recargoElaboracionPct)) : "",
        imputacion: original.imputacion ?? "",
        usos: original.usos ?? "",
        cuidados: original.cuidados ?? "",
        featured: false,
        aPedido: original.aPedido,
        active: original.active,
        imagen: "",
        variantes: original.variantes.map((v) => ({
          ...v,
          id: undefined,
          sku: "",
          codigoBarras: "",
          // El stock arranca en cero; los mínimos se copian.
          stocks: Object.fromEntries(
            v.stocks.map((st) => [st.sucursal, { stock: 0, minimo: st.minimo }]),
          ),
        })),
      }
    : null;

  return (
    <div className="space-y-6">
      <Link
        href="/admin/productos"
        className="inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-5 w-5" />
        Volver a productos
      </Link>

      {guardado && (
        <p
          role="status"
          className="estado-ok flex items-center gap-2 rounded-lg bg-[var(--estado-fondo)] px-4 py-3 text-base text-[var(--estado-tinta)]"
        >
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          Guardado. Va el siguiente.
        </p>
      )}

      <h1 className="text-3xl font-bold text-foreground">
        {copia ? `Copia de ${original?.name}` : "Nuevo producto"}
      </h1>

      <FormularioProducto
        key={copiar ?? guardado ?? "nuevo"}
        categorias={categorias}
        rubros={rubros}
        imputaciones={imputaciones}
        atributos={atributos}
        sucursales={sucursales}
        inicial={copia ?? {
          name: "",
          slug: "",
          categoryId: categorias[0]?.id ?? "",
          subcategory: "",
          subcategoryId: "",
          description: "",
          brand: "",
          unit: "unidad",
          formaDeVenta: "entera",
          precioMediaPct: "50",
          alicuotaIva: "21",
          recargoElaboracionPct: "",
          imputacion: "",
          usos: "",
          cuidados: "",
          featured: false,
          aPedido: false,
          active: true,
          imagen: "",
          variantes: [],
        }}
      />
    </div>
  );
}
