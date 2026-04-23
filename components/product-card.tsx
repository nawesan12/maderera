"use client";

import Image from "next/image";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useBudget } from "@/lib/budget-context";
import { StockIndicator } from "@/components/stock-indicator";
import type { Product } from "@/lib/products";

export function ProductCard({ product }: { product: Product }) {
  const { addItem } = useBudget();

  return (
    <Link href={`/catalogo/${product.id}`} className="block">
    <Card className="group overflow-hidden hover:shadow-xl transition-all duration-500 border-0 shadow-sm bg-white">
      <div className="relative aspect-[4/3] overflow-hidden">
        <Image
          src={product.image}
          alt={product.name}
          fill
          className="object-cover group-hover:scale-110 transition-transform duration-700 ease-out"
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
        {product.featured && (
          <Badge className="absolute top-3 left-3 bg-brand-orange border-0 text-white text-[10px] font-bold uppercase tracking-wider">
            Destacado
          </Badge>
        )}
        {product.priceRange && (
          <div className="absolute top-3 right-3 bg-white/90 backdrop-blur-sm rounded-lg px-2.5 py-1">
            <span className="text-xs font-bold text-brand-gray">{product.priceRange}</span>
          </div>
        )}
        {/* Quick add overlay */}
        <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          <Button
            size="sm"
            className="bg-brand-orange hover:bg-brand-orange-dark text-white rounded-full h-9 w-9 p-0 shadow-lg"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              addItem({
                name: product.name,
                quantity: 1,
                unit: product.unit,
                category: product.category,
              });
            }}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <CardContent className="p-4">
        <p className="text-[10px] text-brand-orange font-bold uppercase tracking-wider mb-1">
          {product.subcategory || product.category}
        </p>
        <h3 className="font-semibold text-sm mb-2 line-clamp-1 group-hover:text-brand-orange transition-colors">{product.name}</h3>
        <p className="text-xs text-muted-foreground mb-3 line-clamp-2 leading-relaxed">
          {product.description}
        </p>

        {product.dimensions && (
          <div className="flex flex-wrap gap-1 mb-3">
            {product.dimensions.slice(0, 2).map((dim) => (
              <span key={dim} className="text-[10px] font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded">
                {dim}
              </span>
            ))}
            {product.dimensions.length > 2 && (
              <span className="text-[10px] font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded">
                +{product.dimensions.length - 2}
              </span>
            )}
          </div>
        )}

        <div className="flex items-center gap-3 mb-3">
          <StockIndicator level={product.stockCentral} label="Central" />
          <StockIndicator level={product.stockAserradero} label="Aserradero" />
        </div>

        <Button
          variant="outline"
          size="sm"
          className="w-full text-xs rounded-lg hover:bg-brand-orange hover:text-white hover:border-brand-orange transition-all font-medium"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            addItem({
              name: product.name,
              quantity: 1,
              unit: product.unit,
              category: product.category,
            });
          }}
        >
          <Plus className="h-3 w-3 mr-1" />
          Agregar a presupuesto
        </Button>
      </CardContent>
    </Card>
    </Link>
  );
}
