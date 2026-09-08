import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  listarCategoriasAdmin,
  listarRubrosAdmin,
} from "@/lib/dal/admin/products";
import { FormularioProducto } from "../formulario";

export default async function NuevoProductoPage() {
  const [categorias, rubros] = await Promise.all([
    listarCategoriasAdmin(),
    listarRubrosAdmin(),
  ]);

  return (
    <div className="space-y-6">
      <Link
        href="/admin/productos"
        className="inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-5 w-5" />
        Volver a productos
      </Link>

      <h1 className="text-3xl font-bold text-foreground">Nuevo producto</h1>

      <FormularioProducto
        categorias={categorias}
        rubros={rubros}
        inicial={{
          name: "",
          slug: "",
          categoryId: categorias[0]?.id ?? "",
          subcategory: "",
          subcategoryId: "",
          description: "",
          brand: "",
          unit: "unidad",
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
