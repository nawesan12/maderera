import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { rubrosPorCategoria } from "@/lib/dal/admin/products";
import { ListaDeRubros } from "./lista";

export const metadata = { title: "Rubros" };

/**
 * Los rubros del catálogo.
 *
 * La clienta trajo los 43 con los que la ferretería ya trabajaba en el sitio
 * anterior. Antes de esto la subcategoría era un campo de texto en cada
 * producto: no se podía filtrar por ella desde el sitio, y bastaba una tilde de
 * diferencia para partir un rubro en dos.
 */
export default async function RubrosPage() {
  const categorias = await rubrosPorCategoria();

  return (
    <div className="space-y-6">
      <Link
        href="/admin/productos"
        className="inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-5 w-5" />
        Volver a productos
      </Link>

      <EncabezadoPanel
        titulo="Rubros"
        detalle="Los rubros de adentro de cada categoría. En el catálogo aparecen solo los que tienen productos cargados."
      />

      <ListaDeRubros categorias={categorias} />
    </div>
  );
}
