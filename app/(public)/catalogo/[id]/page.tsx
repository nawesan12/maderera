"use client";

import { use } from "react";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Plus,
  MessageCircle,
  Ruler,
  Layers,
  Package,
  ChevronRight,
  Tag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useBudget } from "@/lib/budget-context";
import { StockIndicator } from "@/components/stock-indicator";
import { ProductCard } from "@/components/product-card";
import { products, categories } from "@/lib/products";

const fadeUp = {
  initial: { opacity: 0, y: 30 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] as const },
};

export default function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const product = products.find((p) => p.id === id);

  if (!product) return notFound();

  const { addItem } = useBudget();
  const category = categories.find((c) => c.id === product.category);
  const related = products
    .filter((p) => p.category === product.category && p.id !== product.id)
    .slice(0, 4);

  const whatsappMessage = encodeURIComponent(
    `Hola! Me interesa el producto: ${product.name}. ¿Podrían darme más información?`
  );

  return (
    <div className="min-h-screen bg-brand-cream/30">
      {/* Breadcrumb */}
      <div className="bg-white border-b">
        <div className="container mx-auto px-4 py-3">
          <nav className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/" className="hover:text-brand-orange transition-colors">
              Inicio
            </Link>
            <ChevronRight className="h-3 w-3" />
            <Link
              href="/catalogo"
              className="hover:text-brand-orange transition-colors"
            >
              Catálogo
            </Link>
            <ChevronRight className="h-3 w-3" />
            {category && (
              <>
                <Link
                  href={`/catalogo?category=${product.category}`}
                  className="hover:text-brand-orange transition-colors"
                >
                  {category.name}
                </Link>
                <ChevronRight className="h-3 w-3" />
              </>
            )}
            <span className="text-foreground font-medium truncate">
              {product.name}
            </span>
          </nav>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        {/* Back button */}
        <Link href="/catalogo">
          <Button
            variant="ghost"
            size="sm"
            className="mb-6 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Volver al catálogo
          </Button>
        </Link>

        {/* Product main section */}
        <div className="grid lg:grid-cols-2 gap-10 mb-16">
          {/* Image */}
          <motion.div {...fadeUp}>
            <Card className="overflow-hidden border-0 shadow-lg">
              <div className="relative aspect-[4/3]">
                <Image
                  src={product.image}
                  alt={product.name}
                  fill
                  className="object-cover"
                  sizes="(max-width: 1024px) 100vw, 50vw"
                  priority
                />
                {product.featured && (
                  <Badge className="absolute top-4 left-4 bg-brand-orange border-0 text-white font-bold uppercase tracking-wider">
                    Destacado
                  </Badge>
                )}
              </div>
            </Card>
          </motion.div>

          {/* Details */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
            className="space-y-6"
          >
            <div>
              <Badge
                variant="secondary"
                className="bg-brand-orange/10 text-brand-orange border-0 font-bold text-xs uppercase tracking-wider mb-3"
              >
                {product.subcategory || category?.name || product.category}
              </Badge>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">
                {product.name}
              </h1>
              <p className="text-muted-foreground text-base leading-relaxed">
                {product.description}
              </p>
            </div>

            {/* Price */}
            {product.priceRange && (
              <div className="flex items-center gap-3 bg-brand-cream rounded-2xl p-5">
                <Tag className="h-5 w-5 text-brand-orange" />
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                    Rango de precio
                  </p>
                  <p className="text-2xl font-bold text-brand-gray">
                    {product.priceRange}
                  </p>
                </div>
              </div>
            )}

            {/* Stock */}
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3">
                Disponibilidad por sucursal
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <Card className="border-0 shadow-sm">
                  <CardContent className="p-4">
                    <p className="text-xs font-semibold mb-2">Casa Central</p>
                    <StockIndicator
                      level={product.stockCentral}
                      label="Stock"
                    />
                  </CardContent>
                </Card>
                <Card className="border-0 shadow-sm">
                  <CardContent className="p-4">
                    <p className="text-xs font-semibold mb-2">Aserradero</p>
                    <StockIndicator
                      level={product.stockAserradero}
                      label="Stock"
                    />
                  </CardContent>
                </Card>
              </div>
            </div>

            <Separator />

            {/* Specs */}
            {(product.dimensions || product.thickness || product.materials) && (
              <div className="space-y-4">
                <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                  Especificaciones
                </h3>

                {product.dimensions && (
                  <div className="flex items-start gap-3">
                    <Ruler className="h-4 w-4 text-brand-orange mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs font-semibold mb-1.5">Dimensiones</p>
                      <div className="flex flex-wrap gap-1.5">
                        {product.dimensions.map((dim) => (
                          <span
                            key={dim}
                            className="text-xs font-mono bg-muted px-2.5 py-1 rounded-lg"
                          >
                            {dim}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {product.thickness && (
                  <div className="flex items-start gap-3">
                    <Layers className="h-4 w-4 text-brand-orange mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs font-semibold mb-1.5">Espesores</p>
                      <div className="flex flex-wrap gap-1.5">
                        {product.thickness.map((t) => (
                          <span
                            key={t}
                            className="text-xs font-mono bg-muted px-2.5 py-1 rounded-lg"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {product.materials && (
                  <div className="flex items-start gap-3">
                    <Package className="h-4 w-4 text-brand-orange mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs font-semibold mb-1.5">Materiales</p>
                      <div className="flex flex-wrap gap-1.5">
                        {product.materials.map((m) => (
                          <span
                            key={m}
                            className="text-xs font-mono bg-muted px-2.5 py-1 rounded-lg"
                          >
                            {m}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Unit */}
            <p className="text-xs text-muted-foreground">
              Unidad de venta:{" "}
              <span className="font-semibold text-foreground">
                {product.unit}
              </span>
            </p>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <Button
                className="flex-1 bg-brand-orange hover:bg-brand-orange-dark text-white rounded-full h-13 font-semibold text-base shadow-lg shadow-brand-orange/20"
                onClick={() =>
                  addItem({
                    name: product.name,
                    quantity: 1,
                    unit: product.unit,
                    category: product.category,
                  })
                }
              >
                <Plus className="h-5 w-5 mr-2" />
                Agregar a presupuesto
              </Button>
              <a
                href={`https://wa.me/5492235903118?text=${whatsappMessage}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button
                  variant="outline"
                  className="w-full rounded-full h-13 font-medium text-base"
                >
                  <MessageCircle className="h-5 w-5 mr-2" />
                  Consultar
                </Button>
              </a>
            </div>
          </motion.div>
        </div>

        {/* Related products */}
        {related.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold tracking-tight">
                Productos relacionados
              </h2>
              <Link href={`/catalogo?category=${product.category}`}>
                <Button
                  variant="ghost"
                  className="text-brand-orange hover:text-brand-orange-dark"
                >
                  Ver todos
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </Link>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {related.map((p, i) => (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.08, duration: 0.5 }}
                >
                  <ProductCard product={p} />
                </motion.div>
              ))}
            </div>
          </motion.section>
        )}
      </div>
    </div>
  );
}
