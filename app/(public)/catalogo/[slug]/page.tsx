import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ChevronRight,
  MessageCircle,
  Ruler,
  Store,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProductCard } from "@/components/product-card";
import { GaleriaProducto } from "@/components/catalogo/galeria-producto";
import { SelectorVariante } from "@/components/catalogo/selector-variante";
import { obtenerProducto, productosRelacionados } from "@/lib/dal/catalog";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const producto = await obtenerProducto(slug);

  if (!producto) return { title: "Producto no encontrado" };

  return {
    title: producto.name,
    description: producto.description,
    openGraph: {
      title: producto.name,
      description: producto.description,
      images: producto.imagenes.slice(0, 1),
    },
  };
}

export default async function ProductoPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const producto = await obtenerProducto(slug);

  if (!producto) notFound();

  const relacionados = await productosRelacionados(
    producto.categorySlug,
    producto.slug,
  );

  const whatsapp = `https://wa.me/542235903118?text=${encodeURIComponent(
    `Hola! Me interesa: ${producto.name}. ¿Podrían darme más información?`,
  )}`;

  // Las medidas se arman de las variantes: si ninguna las tiene cargadas, la
  // ficha técnica no se muestra en lugar de quedar con guiones.
  const conMedidas = producto.variantes.filter(
    (v) => v.largoMm || v.anchoMm || v.espesorMm,
  );

  return (
    <div className="min-h-screen bg-brand-cream/30">
      {/* Breadcrumb */}
      <div className="border-b bg-white">
        <div className="container mx-auto px-4 py-3">
          <nav
            className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
            aria-label="Ubicación"
          >
            <Link href="/" className="transition-colors hover:text-brand-orange">
              Inicio
            </Link>
            <ChevronRight className="h-3 w-3" />
            <Link
              href="/catalogo"
              className="transition-colors hover:text-brand-orange"
            >
              Catálogo
            </Link>
            <ChevronRight className="h-3 w-3" />
            <Link
              href={`/catalogo?cat=${producto.categorySlug}`}
              className="transition-colors hover:text-brand-orange"
            >
              {producto.categoryName}
            </Link>
            <ChevronRight className="h-3 w-3" />
            <span className="font-medium text-foreground">{producto.name}</span>
          </nav>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <div className="grid gap-10 lg:grid-cols-2">
          <GaleriaProducto
            imagenes={producto.imagenes}
            nombre={producto.name}
            destacado={producto.featured}
          />

          <div>
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-brand-orange">
              {producto.subcategory ?? producto.categoryName}
            </p>
            <h1 className="text-3xl font-bold leading-tight">{producto.name}</h1>
            {producto.brand && (
              <p className="mt-1 text-sm text-muted-foreground">
                Marca <span className="font-medium">{producto.brand}</span>
              </p>
            )}
            <p className="mt-4 leading-relaxed text-muted-foreground">
              {producto.description}
            </p>

            <div className="mt-6">
              <SelectorVariante
                productName={producto.name}
                unit={producto.unit}
                variantes={producto.variantes}
                whatsapp={whatsapp}
              />
            </div>

            {/* Cómo lo recibe */}
            <ul className="mt-6 grid gap-2.5 sm:grid-cols-2">
              <li className="flex items-start gap-2.5 rounded-xl bg-white p-3.5 shadow-sm">
                <Store className="mt-0.5 h-5 w-5 shrink-0 text-brand-orange" />
                <span className="text-sm">
                  <span className="block font-medium">Retiro sin cargo</span>
                  <span className="text-muted-foreground">
                    En Casa Central o Aserradero
                  </span>
                </span>
              </li>
              <li className="flex items-start gap-2.5 rounded-xl bg-white p-3.5 shadow-sm">
                <Truck className="mt-0.5 h-5 w-5 shrink-0 text-brand-orange" />
                <span className="text-sm">
                  <span className="block font-medium">Envío a domicilio</span>
                  <span className="text-muted-foreground">
                    Mar del Plata y zona
                  </span>
                </span>
              </li>
            </ul>

            <a
              href={whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 block"
            >
              <Button variant="outline" className="w-full">
                <MessageCircle className="h-4 w-4" />
                Consultar por WhatsApp
              </Button>
            </a>
          </div>
        </div>

        {/* Ficha técnica */}
        {conMedidas.length > 0 && (
          <section className="mt-14">
            <h2 className="mb-4 flex items-center gap-2 text-xl font-bold">
              <Ruler className="h-5 w-5 text-brand-orange" />
              Medidas disponibles
            </h2>
            <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/40 text-left">
                    <th className="px-5 py-3 text-sm font-semibold">Medida</th>
                    <th className="px-4 py-3 text-right text-sm font-semibold">
                      Largo
                    </th>
                    <th className="px-4 py-3 text-right text-sm font-semibold">
                      Ancho
                    </th>
                    <th className="px-4 py-3 text-right text-sm font-semibold">
                      Espesor
                    </th>
                    <th className="px-5 py-3 text-sm font-semibold">Material</th>
                  </tr>
                </thead>
                <tbody>
                  {conMedidas.map((v) => (
                    <tr key={v.id} className="border-b last:border-0">
                      <td className="px-5 py-3 text-sm font-medium">
                        {v.label}
                      </td>
                      <td className="tabular px-4 py-3 text-right text-sm text-muted-foreground">
                        {v.largoMm ? `${v.largoMm} mm` : "—"}
                      </td>
                      <td className="tabular px-4 py-3 text-right text-sm text-muted-foreground">
                        {v.anchoMm ? `${v.anchoMm} mm` : "—"}
                      </td>
                      <td className="tabular px-4 py-3 text-right text-sm text-muted-foreground">
                        {v.espesorMm ? `${v.espesorMm} mm` : "—"}
                      </td>
                      <td className="px-5 py-3 text-sm text-muted-foreground">
                        {v.material ?? v.color ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Relacionados */}
        {relacionados.length > 0 && (
          <section className="mt-14">
            <div className="mb-5 flex items-baseline justify-between gap-4">
              <h2 className="text-xl font-bold">
                Otros productos de {producto.categoryName}
              </h2>
              <Link
                href={`/catalogo?cat=${producto.categorySlug}`}
                className="text-sm font-medium text-brand-orange hover:underline"
              >
                Ver todos
              </Link>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {relacionados.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
