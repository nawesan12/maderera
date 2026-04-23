"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Package, Search, ArrowLeftRight, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { products, categories } from "@/lib/products";
import { stockAlerts, transferencias } from "@/lib/dashboard-data";

const stockColor: Record<string, string> = {
  alto: "bg-green-500/15 text-green-400",
  medio: "bg-yellow-500/15 text-yellow-400",
  bajo: "bg-red-500/15 text-red-400",
  "sin-stock": "bg-white/5 text-white/30",
};

const stockLabel: Record<string, string> = {
  alto: "En stock",
  medio: "Limitado",
  bajo: "Bajo",
  "sin-stock": "Sin stock",
};

export default function AdminStockPage() {
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("todos");
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferProduct, setTransferProduct] = useState("");
  const [transferQty, setTransferQty] = useState("1");
  const [transferDir, setTransferDir] = useState("central-aserradero");

  const filtered = products.filter((p) => {
    if (cat !== "todos" && p.category !== cat) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const handleTransfer = () => {
    const product = transferProduct || "Producto seleccionado";
    const [from, to] = transferDir === "central-aserradero"
      ? ["Casa Central", "Aserradero"]
      : ["Aserradero", "Casa Central"];
    toast.success("Transferencia registrada", {
      description: `${transferQty}x ${product}: ${from} → ${to}`,
    });
    setTransferOpen(false);
    setTransferProduct("");
    setTransferQty("1");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl font-bold">Gestión de Stock</h1>
          <p className="text-sm text-white/40">Control de inventario entre sucursales</p>
        </motion.div>
        <Button
          className="bg-brand-orange hover:bg-brand-orange-dark text-white rounded-lg"
          onClick={() => setTransferOpen(true)}
        >
          <ArrowLeftRight className="h-4 w-4 mr-2" />
          Nueva Transferencia
        </Button>
      </div>

      {/* Alerts */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <Card className="bg-red-500/5 border-red-500/10">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-red-400 shrink-0" />
            <p className="text-sm text-red-300">
              <strong>{stockAlerts.length} productos</strong> con stock por debajo del mínimo.
            </p>
          </CardContent>
        </Card>
      </motion.div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
          <Input placeholder="Buscar producto..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10 bg-white/5 border-white/10 text-white placeholder:text-white/30" />
        </div>
        <div className="flex gap-1.5 overflow-x-auto">
          <Button size="sm" variant={cat === "todos" ? "default" : "outline"} className={cat === "todos" ? "bg-brand-orange text-white" : "border-white/10 text-white/50"} onClick={() => setCat("todos")}>Todos</Button>
          {categories.slice(0, 5).map((c) => (
            <Button key={c.id} size="sm" variant={cat === c.id ? "default" : "outline"} className={cat === c.id ? "bg-brand-orange text-white" : "border-white/10 text-white/50"} onClick={() => setCat(c.id)}>{c.name}</Button>
          ))}
        </div>
      </div>

      {/* Stock table */}
      <Card className="bg-white/[0.03] border-white/5">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="text-left p-4 text-xs font-semibold text-white/40 uppercase tracking-wider">Producto</th>
                  <th className="text-left p-4 text-xs font-semibold text-white/40 uppercase tracking-wider">Categoría</th>
                  <th className="text-center p-4 text-xs font-semibold text-white/40 uppercase tracking-wider">Casa Central</th>
                  <th className="text-center p-4 text-xs font-semibold text-white/40 uppercase tracking-wider">Aserradero</th>
                  <th className="text-right p-4 text-xs font-semibold text-white/40 uppercase tracking-wider">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((product, i) => (
                  <motion.tr
                    key={product.id}
                    className="border-b border-white/5 hover:bg-white/[0.02] transition-colors"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: Math.min(i * 0.02, 0.3) }}
                  >
                    <td className="p-4">
                      <p className="text-sm font-medium text-white">{product.name}</p>
                      {product.dimensions && <p className="text-[10px] text-white/30">{product.dimensions[0]}</p>}
                    </td>
                    <td className="p-4">
                      <Badge className="border-0 bg-white/5 text-white/50 text-[10px]">
                        {categories.find((c) => c.id === product.category)?.name}
                      </Badge>
                    </td>
                    <td className="p-4 text-center">
                      <Badge className={`border-0 text-xs font-medium ${stockColor[product.stockCentral]}`}>
                        {stockLabel[product.stockCentral]}
                      </Badge>
                    </td>
                    <td className="p-4 text-center">
                      <Badge className={`border-0 text-xs font-medium ${stockColor[product.stockAserradero]}`}>
                        {stockLabel[product.stockAserradero]}
                      </Badge>
                    </td>
                    <td className="p-4 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs border-white/10 text-white/50 hover:text-white h-7"
                        onClick={() => {
                          setTransferProduct(product.name);
                          setTransferOpen(true);
                        }}
                      >
                        <ArrowLeftRight className="h-3 w-3 mr-1" />
                        Transferir
                      </Button>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Transferencias recientes */}
      <Card className="bg-white/[0.03] border-white/5">
        <CardHeader>
          <CardTitle className="text-base text-white">Transferencias Recientes</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-white/5">
            {transferencias.map((t) => (
              <div key={t.id} className="flex items-center gap-4 px-5 py-3">
                <ArrowLeftRight className="h-4 w-4 text-brand-orange shrink-0" />
                <div className="flex-1">
                  <p className="text-sm text-white">{t.producto} <span className="text-white/40">x{t.cantidad}</span></p>
                  <p className="text-[11px] text-white/40">{t.origen} → {t.destino} · {t.fecha}</p>
                </div>
                <Badge className={`border-0 text-[10px] ${t.estado === "completado" ? "bg-green-500/15 text-green-400" : "bg-yellow-500/15 text-yellow-400"}`}>
                  {t.estado}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Transfer Dialog */}
      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="bg-[#18181b] border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowLeftRight className="h-5 w-5 text-brand-orange" />
              Nueva Transferencia
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label className="text-xs text-white/60">Producto</Label>
              <Input
                value={transferProduct}
                onChange={(e) => setTransferProduct(e.target.value)}
                placeholder="Nombre del producto"
                className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-white/60">Cantidad</Label>
              <Input
                type="number"
                value={transferQty}
                onChange={(e) => setTransferQty(e.target.value)}
                min="1"
                className="bg-white/5 border-white/10 text-white"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-white/60">Dirección</Label>
              <Select value={transferDir} onValueChange={(v) => v && setTransferDir(v)}>
                <SelectTrigger className="bg-white/5 border-white/10 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="central-aserradero">Casa Central → Aserradero</SelectItem>
                  <SelectItem value="aserradero-central">Aserradero → Casa Central</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              className="w-full bg-brand-orange hover:bg-brand-orange-dark text-white"
              onClick={handleTransfer}
              disabled={!transferProduct}
            >
              Confirmar Transferencia
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
