"use client";

import { useState, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { ProductCard } from "@/components/product-card";
import { products, categories } from "@/lib/products";

export default function CatalogoPage() {
  return (
    <Suspense>
      <CatalogoContent />
    </Suspense>
  );
}

function CatalogoContent() {
  const searchParams = useSearchParams();
  const initialCat = searchParams.get("cat") || "todos";

  const [selectedCategory, setSelectedCategory] = useState(initialCat);
  const [searchQuery, setSearchQuery] = useState("");
  const [stockFilter, setStockFilter] = useState<string>("todos");

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (selectedCategory !== "todos" && p.category !== selectedCategory) return false;
      if (searchQuery && !p.name.toLowerCase().includes(searchQuery.toLowerCase()) && !p.description.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (stockFilter === "en-stock" && p.stockCentral === "sin-stock" && p.stockAserradero === "sin-stock") return false;
      if (stockFilter === "central" && p.stockCentral === "sin-stock") return false;
      if (stockFilter === "aserradero" && p.stockAserradero === "sin-stock") return false;
      return true;
    });
  }, [selectedCategory, searchQuery, stockFilter]);

  const FilterSidebar = () => (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold text-sm mb-3">Categorías</h3>
        <div className="space-y-1">
          <button
            onClick={() => setSelectedCategory("todos")}
            className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
              selectedCategory === "todos" ? "bg-brand-orange text-white" : "hover:bg-muted"
            }`}
          >
            Todos los productos
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors flex justify-between items-center ${
                selectedCategory === cat.id ? "bg-brand-orange text-white" : "hover:bg-muted"
              }`}
            >
              {cat.name}
              <Badge variant="secondary" className="text-xs">
                {products.filter((p) => p.category === cat.id).length}
              </Badge>
            </button>
          ))}
        </div>
      </div>
      <Separator />
      <div>
        <h3 className="font-semibold text-sm mb-3">Disponibilidad</h3>
        <Select value={stockFilter} onValueChange={(v) => v && setStockFilter(v)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            <SelectItem value="en-stock">Con stock</SelectItem>
            <SelectItem value="central">Stock en Casa Central</SelectItem>
            <SelectItem value="aserradero">Stock en Aserradero</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="bg-brand-gray text-white py-12">
        <div className="container mx-auto px-4">
          <h1 className="text-3xl font-bold mb-2">Catálogo de Productos</h1>
          <p className="text-white/70">
            Explorá nuestra línea completa de productos para construcción y carpintería.
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        {/* Search & filter bar */}
        <div className="flex gap-3 mb-8">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar productos..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            )}
          </div>
          <Sheet>
            <SheetTrigger className="lg:hidden inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground">
              <SlidersHorizontal className="h-4 w-4 mr-2" />
              Filtros
            </SheetTrigger>
            <SheetContent side="left" className="w-80">
              <div className="mt-8">
                <FilterSidebar />
              </div>
            </SheetContent>
          </Sheet>
        </div>

        {/* Active filters */}
        {(selectedCategory !== "todos" || stockFilter !== "todos") && (
          <div className="flex flex-wrap gap-2 mb-6">
            {selectedCategory !== "todos" && (
              <Badge variant="secondary" className="gap-1">
                {categories.find((c) => c.id === selectedCategory)?.name}
                <button onClick={() => setSelectedCategory("todos")}>
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}
            {stockFilter !== "todos" && (
              <Badge variant="secondary" className="gap-1">
                {stockFilter === "en-stock" ? "Con stock" : stockFilter === "central" ? "Casa Central" : "Aserradero"}
                <button onClick={() => setStockFilter("todos")}>
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}
          </div>
        )}

        <div className="flex gap-8">
          {/* Desktop sidebar */}
          <aside className="hidden lg:block w-64 shrink-0">
            <Card>
              <CardContent className="p-4">
                <FilterSidebar />
              </CardContent>
            </Card>
          </aside>

          {/* Products grid */}
          <div className="flex-1">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-muted-foreground">
                {filteredProducts.length} producto{filteredProducts.length !== 1 ? "s" : ""} encontrado{filteredProducts.length !== 1 ? "s" : ""}
              </p>
            </div>

            {filteredProducts.length > 0 ? (
              <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredProducts.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="p-12 text-center">
                  <p className="text-muted-foreground mb-4">
                    No se encontraron productos con los filtros seleccionados.
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSelectedCategory("todos");
                      setSearchQuery("");
                      setStockFilter("todos");
                    }}
                  >
                    Limpiar filtros
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
