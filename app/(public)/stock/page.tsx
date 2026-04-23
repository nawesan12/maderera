"use client";

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Search, Warehouse, Building2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StockIndicator } from "@/components/stock-indicator";
import { products, categories } from "@/lib/products";

export default function StockPage() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("todos");

  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (category !== "todos" && p.category !== category) return false;
      if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [search, category]);

  const stockStats = useMemo(() => {
    const total = products.length;
    const bothInStock = products.filter((p) => p.stockCentral !== "sin-stock" && p.stockAserradero !== "sin-stock").length;
    const centralOnly = products.filter((p) => p.stockCentral !== "sin-stock" && p.stockAserradero === "sin-stock").length;
    const aserraderoOnly = products.filter((p) => p.stockCentral === "sin-stock" && p.stockAserradero !== "sin-stock").length;
    return { total, bothInStock, centralOnly, aserraderoOnly };
  }, []);

  return (
    <div className="min-h-screen">
      <div className="bg-brand-gray text-white py-12">
        <div className="container mx-auto px-4">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <div className="flex items-center gap-3 mb-2">
              <Warehouse className="h-8 w-8 text-brand-orange" />
              <h1 className="text-3xl font-bold">Stock entre Sucursales</h1>
            </div>
            <p className="text-white/70">
              Consultá la disponibilidad de productos en Casa Central y Aserradero.
            </p>
          </motion.div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: "Total productos", value: stockStats.total, color: "bg-brand-gray" },
            { label: "En ambas sucursales", value: stockStats.bothInStock, color: "bg-brand-green" },
            { label: "Solo Casa Central", value: stockStats.centralOnly, color: "bg-brand-orange" },
            { label: "Solo Aserradero", value: stockStats.aserraderoOnly, color: "bg-blue-500" },
          ].map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08, duration: 0.4 }}
            >
              <Card>
                <CardContent className="p-4 text-center">
                  <p className={`text-2xl font-bold text-foreground`}>{stat.value}</p>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex gap-3 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar producto..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={category} onValueChange={(v) => v && setCategory(v)}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todas las categorías</SelectItem>
              {categories.map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Stock table */}
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
                  {filtered.map((product) => (
                    <tr key={product.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="p-4">
                        <p className="text-sm font-medium">{product.name}</p>
                        {product.dimensions && (
                          <p className="text-xs text-muted-foreground">{product.dimensions[0]}</p>
                        )}
                      </td>
                      <td className="p-4">
                        <Badge variant="outline" className="text-xs">
                          {categories.find((c) => c.id === product.category)?.name || product.category}
                        </Badge>
                      </td>
                      <td className="p-4">
                        <div className="flex justify-center">
                          <StockBadge level={product.stockCentral} />
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex justify-center">
                          <StockBadge level={product.stockAserradero} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StockBadge({ level }: { level: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    alto: { bg: "bg-brand-green/10", text: "text-brand-green", label: "En stock" },
    medio: { bg: "bg-yellow-500/10", text: "text-yellow-600", label: "Limitado" },
    bajo: { bg: "bg-brand-red/10", text: "text-brand-red", label: "Poco" },
    "sin-stock": { bg: "bg-gray-100", text: "text-gray-400", label: "Sin stock" },
  };
  const { bg, text, label } = config[level] || config["sin-stock"];
  return (
    <Badge variant="secondary" className={`${bg} ${text} border-0 text-xs`}>
      {label}
    </Badge>
  );
}
