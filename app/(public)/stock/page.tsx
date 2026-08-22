import { Suspense } from "react";
import { Building2, Warehouse } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FiltrosStock } from "@/components/catalogo/filtros-stock";
import { listarCategorias, listarProductos } from "@/lib/dal/catalog";
import type { StockLevel } from "@/lib/stock-level";

interface Params {
  cat?: string;
  buscar?: string;
}

const estilo: Record<StockLevel, { clase: string; texto: string }> = {
  alto: { clase: "bg-brand-green/15 text-brand-green", texto: "En stock" },
  medio: { clase: "bg-yellow-500/15 text-yellow-700", texto: "Stock limitado" },
  bajo: { clase: "bg-brand-red/15 text-brand-red", texto: "Poco stock" },
  "sin-stock": { clase: "bg-muted text-muted-foreground", texto: "Sin stock" },
};

function StockBadge({ level }: { level: StockLevel }) {
  const { clase, texto } = estilo[level];
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${clase}`}>
      {texto}
    </span>
  );
}

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;

  return (
    <div className="min-h-screen">
      <div className="bg-brand-gray text-white py-12">
        <div className="container mx-auto px-4">
          <div className="flex items-center gap-3 mb-2">
            <Warehouse className="h-8 w-8 text-brand-orange" />
            <h1 className="text-3xl font-bold">Stock entre Sucursales</h1>
          </div>
          <p className="text-white/70">
            Consultá la disponibilidad de productos en Casa Central y Aserradero.
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <Suspense fallback={<Skeleton className="h-24 w-full" />}>
          <Resumen />
        </Suspense>

        <Suspense fallback={<Skeleton className="mb-6 h-10 w-full" />}>
          <Filtros params={params} />
        </Suspense>

        <Suspense
          key={`${params.cat}-${params.buscar}`}
          fallback={<Skeleton className="h-96 w-full" />}
        >
          <Tabla params={params} />
        </Suspense>
      </div>
    </div>
  );
}

async function Resumen() {
  const productos = await listarProductos();

  const enAmbas = productos.filter(
    (p) => p.stockCentral !== "sin-stock" && p.stockAserradero !== "sin-stock",
  ).length;
  const soloCentral = productos.filter(
    (p) => p.stockCentral !== "sin-stock" && p.stockAserradero === "sin-stock",
  ).length;
  const soloAserradero = productos.filter(
    (p) => p.stockCentral === "sin-stock" && p.stockAserradero !== "sin-stock",
  ).length;

  const tarjetas = [
    { label: "Total productos", value: productos.length },
    { label: "En ambas sucursales", value: enAmbas },
    { label: "Solo Casa Central", value: soloCentral },
    { label: "Solo Aserradero", value: soloAserradero },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
      {tarjetas.map((t) => (
        <Card key={t.label}>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{t.value}</p>
            <p className="text-xs text-muted-foreground">{t.label}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

async function Filtros({ params }: { params: Params }) {
  const categorias = await listarCategorias();
  return (
    <FiltrosStock
      categorias={categorias.map((c) => ({ slug: c.slug, name: c.name }))}
      categoriaActual={params.cat ?? "todos"}
      busquedaActual={params.buscar ?? ""}
    />
  );
}

async function Tabla({ params }: { params: Params }) {
  const productos = await listarProductos({
    categoria: params.cat,
    busqueda: params.buscar,
  });

  if (productos.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center text-sm text-muted-foreground">
          No encontramos productos con ese criterio.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-4 text-sm font-semibold">Producto</th>
                <th className="text-left p-4 text-sm font-semibold">Categoría</th>
                <th className="text-center p-4 text-sm font-semibold">
                  <div className="flex items-center justify-center gap-1">
                    <Building2 className="h-4 w-4" />
                    Casa Central
                  </div>
                </th>
                <th className="text-center p-4 text-sm font-semibold">
                  <div className="flex items-center justify-center gap-1">
                    <Warehouse className="h-4 w-4" />
                    Aserradero
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {productos.map((producto) => (
                <tr
                  key={producto.id}
                  className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                >
                  <td className="p-4">
                    <p className="text-sm font-medium">{producto.name}</p>
                    {producto.labels[0] && (
                      <p className="text-xs text-muted-foreground">
                        {producto.labels[0]}
                      </p>
                    )}
                  </td>
                  <td className="p-4">
                    <Badge variant="outline" className="text-xs">
                      {producto.categoryName}
                    </Badge>
                  </td>
                  <td className="p-4">
                    <div className="flex justify-center">
                      <StockBadge level={producto.stockCentral} />
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="flex justify-center">
                      <StockBadge level={producto.stockAserradero} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
