"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { ClipboardList, Search, Eye, MessageCircle, Download, Check, X, Package, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { presupuestos, type PresupuestoEstado } from "@/lib/dashboard-data";

const estadoConfig: Record<string, { bg: string; label: string }> = {
  pendiente: { bg: "bg-yellow-500/15 text-yellow-400", label: "Pendiente" },
  revision: { bg: "bg-blue-500/15 text-blue-400", label: "En Revisión" },
  enviado: { bg: "bg-brand-orange/15 text-brand-orange", label: "Enviado" },
  aceptado: { bg: "bg-green-500/15 text-green-400", label: "Aceptado" },
  rechazado: { bg: "bg-red-500/15 text-red-400", label: "Rechazado" },
};

const mockItems = [
  { nombre: "Melamina Blanca 18mm", cantidad: 4, unidad: "placas", precio: "$185.000" },
  { nombre: "Corte a medida (12 piezas)", cantidad: 1, unidad: "servicio", precio: "$45.000" },
  { nombre: "Enchapado de cantos", cantidad: 24, unidad: "metros", precio: "$36.000" },
  { nombre: "Tornillos 4x40 (caja)", cantidad: 2, unidad: "cajas", precio: "$8.500" },
  { nombre: "Bisagra cierre suave", cantidad: 12, unidad: "unidades", precio: "$42.000" },
];

export default function AdminPresupuestosPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [estados, setEstados] = useState<Record<string, PresupuestoEstado>>({});
  const [newOpen, setNewOpen] = useState(false);
  const [newCliente, setNewCliente] = useState("");
  const [newEmpresa, setNewEmpresa] = useState("");
  const [newItems, setNewItems] = useState("5");
  const [newTotal, setNewTotal] = useState("");
  const [presupuestosList, setPresupuestosList] = useState(presupuestos);

  const getEstado = (p: typeof presupuestos[0]) => estados[p.id] || p.estado;
  const selected = presupuestosList.find((p) => p.id === selectedId);

  const changeEstado = (id: string, estado: PresupuestoEstado) => {
    setEstados((prev) => ({ ...prev, [id]: estado }));
    toast.success(`Presupuesto ${id} ${estadoConfig[estado].label.toLowerCase()}`);
  };

  const stats = {
    total: presupuestosList.length,
    pendientes: presupuestosList.filter((p) => getEstado(p) === "pendiente" || getEstado(p) === "revision").length,
    aceptados: presupuestosList.filter((p) => getEstado(p) === "aceptado").length,
    montoTotal: "$22.405.000",
  };

  const handleNewPresupuesto = () => {
    const id = `P-2026-${String(422 + presupuestosList.length - presupuestos.length).padStart(4, "0")}`;
    setPresupuestosList((prev) => [{
      id, fecha: "08/04/2026", cliente: newCliente, empresa: newEmpresa,
      items: parseInt(newItems) || 5, total: newTotal || "$0",
      estado: "pendiente" as PresupuestoEstado, sucursal: "Central", asesor: "Martín",
    }, ...prev]);
    toast.success("Presupuesto creado", { description: `${id} — ${newCliente}` });
    setNewOpen(false); setNewCliente(""); setNewEmpresa(""); setNewTotal("");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl font-bold">Presupuestos</h1>
          <p className="text-sm text-white/40">Gestión de presupuestos recibidos</p>
        </motion.div>
        <Button className="bg-brand-orange hover:bg-brand-orange-dark text-white rounded-lg" onClick={() => setNewOpen(true)}>
          <Plus className="h-4 w-4 mr-2" /> Nuevo Presupuesto
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total", value: stats.total, color: "text-white" },
          { label: "Pendientes", value: stats.pendientes, color: "text-yellow-400" },
          { label: "Aceptados", value: stats.aceptados, color: "text-green-400" },
          { label: "Monto Total", value: stats.montoTotal, color: "text-brand-orange" },
        ].map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
            <Card className="bg-white/[0.03] border-white/5">
              <CardContent className="p-4 text-center">
                <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-[10px] text-white/40 uppercase tracking-wider mt-1">{s.label}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
        <Input placeholder="Buscar por cliente, empresa o ID..." className="pl-10 bg-white/5 border-white/10 text-white placeholder:text-white/30" />
      </div>

      {/* Table */}
      <Card className="bg-white/[0.03] border-white/5">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="text-left p-4 text-xs font-semibold text-white/40 uppercase tracking-wider">ID</th>
                  <th className="text-left p-4 text-xs font-semibold text-white/40 uppercase tracking-wider">Cliente</th>
                  <th className="text-left p-4 text-xs font-semibold text-white/40 uppercase tracking-wider">Fecha</th>
                  <th className="text-center p-4 text-xs font-semibold text-white/40 uppercase tracking-wider">Items</th>
                  <th className="text-right p-4 text-xs font-semibold text-white/40 uppercase tracking-wider">Monto</th>
                  <th className="text-center p-4 text-xs font-semibold text-white/40 uppercase tracking-wider">Estado</th>
                  <th className="text-center p-4 text-xs font-semibold text-white/40 uppercase tracking-wider">Sucursal</th>
                  <th className="text-right p-4 text-xs font-semibold text-white/40 uppercase tracking-wider">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {presupuestosList.map((p, i) => (
                  <motion.tr
                    key={p.id}
                    className="border-b border-white/5 hover:bg-white/[0.02] transition-colors cursor-pointer"
                    onClick={() => setSelectedId(p.id)}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                  >
                    <td className="p-4 text-xs font-mono text-white/60">{p.id}</td>
                    <td className="p-4">
                      <p className="text-sm font-medium text-white">{p.cliente}</p>
                      <p className="text-[10px] text-white/40">{p.empresa}</p>
                    </td>
                    <td className="p-4 text-sm text-white/60">{p.fecha}</td>
                    <td className="p-4 text-center text-sm text-white/60">{p.items}</td>
                    <td className="p-4 text-right text-sm font-mono font-bold text-white">{p.total}</td>
                    <td className="p-4 text-center">
                      <Badge className={`border-0 text-[10px] ${estadoConfig[getEstado(p)].bg}`}>
                        {estadoConfig[getEstado(p)].label}
                      </Badge>
                    </td>
                    <td className="p-4 text-center text-xs text-white/50">{p.sucursal}</td>
                    <td className="p-4 text-right">
                      <div className="flex gap-1 justify-end">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-white/40 hover:text-white" onClick={(e) => { e.stopPropagation(); setSelectedId(p.id); }}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-white/40 hover:text-white" onClick={(e) => { e.stopPropagation(); window.open(`https://wa.me/5492235903118?text=${encodeURIComponent(`Hola ${p.cliente}, respecto al presupuesto ${p.id}...`)}`, "_blank"); }}>
                          <MessageCircle className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-white/40 hover:text-white" onClick={(e) => { e.stopPropagation(); toast.info("PDF generado correctamente", { description: `${p.id} - ${p.cliente}` }); }}>
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={!!selectedId} onOpenChange={() => setSelectedId(null)}>
        <DialogContent className="bg-[#18181b] border-white/10 text-white max-w-lg">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-3">
                  <ClipboardList className="h-5 w-5 text-brand-orange" />
                  Presupuesto {selected.id}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-5 mt-2">
                {/* Client info */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[10px] text-white/40 uppercase tracking-wider mb-1">Cliente</p>
                    <p className="text-sm font-semibold">{selected.cliente}</p>
                    <p className="text-xs text-white/50">{selected.empresa}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-white/40 uppercase tracking-wider mb-1">Detalles</p>
                    <p className="text-xs text-white/60">Fecha: {selected.fecha}</p>
                    <p className="text-xs text-white/60">Sucursal: {selected.sucursal}</p>
                    <p className="text-xs text-white/60">Asesor: {selected.asesor}</p>
                  </div>
                </div>

                <Separator className="bg-white/10" />

                {/* Items */}
                <div>
                  <p className="text-[10px] text-white/40 uppercase tracking-wider mb-3">Items del presupuesto</p>
                  <div className="space-y-2">
                    {mockItems.slice(0, selected.items > 5 ? 5 : selected.items).map((item, i) => (
                      <div key={i} className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.03] border border-white/5">
                        <div className="flex items-center gap-3">
                          <Package className="h-4 w-4 text-brand-orange shrink-0" />
                          <div>
                            <p className="text-xs font-medium">{item.nombre}</p>
                            <p className="text-[10px] text-white/40">{item.cantidad} {item.unidad}</p>
                          </div>
                        </div>
                        <p className="text-xs font-mono font-semibold">{item.precio}</p>
                      </div>
                    ))}
                    {selected.items > 5 && (
                      <p className="text-[10px] text-white/40 text-center">+{selected.items - 5} items más</p>
                    )}
                  </div>
                </div>

                <Separator className="bg-white/10" />

                {/* Total + Status */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-white/40 uppercase tracking-wider">Total</p>
                    <p className="text-2xl font-bold text-brand-orange">{selected.total}</p>
                  </div>
                  <Badge className={`border-0 text-xs px-3 py-1 ${estadoConfig[getEstado(selected)].bg}`}>
                    {estadoConfig[getEstado(selected)].label}
                  </Badge>
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <Button
                    className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                    onClick={() => { changeEstado(selected.id, "aceptado"); setSelectedId(null); }}
                  >
                    <Check className="h-4 w-4 mr-2" />
                    Aprobar
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 border-red-500/30 text-red-400 hover:bg-red-500/10"
                    onClick={() => { changeEstado(selected.id, "rechazado"); setSelectedId(null); }}
                  >
                    <X className="h-4 w-4 mr-2" />
                    Rechazar
                  </Button>
                  <Button
                    variant="outline"
                    className="border-white/10 text-white/60 hover:text-white"
                    onClick={() => {
                      window.open(`https://wa.me/5492235903118?text=${encodeURIComponent(`Hola ${selected.cliente}, respecto al presupuesto ${selected.id}...`)}`, "_blank");
                    }}
                  >
                    <MessageCircle className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* New Presupuesto Dialog */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="bg-[#18181b] border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-brand-orange" />
              Nuevo Presupuesto
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label className="text-xs text-white/60">Cliente</Label>
              <Input value={newCliente} onChange={(e) => setNewCliente(e.target.value)} placeholder="Nombre del cliente" className="bg-white/5 border-white/10 text-white placeholder:text-white/30" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-white/60">Empresa</Label>
              <Input value={newEmpresa} onChange={(e) => setNewEmpresa(e.target.value)} placeholder="Razón social" className="bg-white/5 border-white/10 text-white placeholder:text-white/30" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-xs text-white/60">Cantidad de items</Label>
                <Input type="number" value={newItems} onChange={(e) => setNewItems(e.target.value)} min="1" className="bg-white/5 border-white/10 text-white" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-white/60">Monto total</Label>
                <Input value={newTotal} onChange={(e) => setNewTotal(e.target.value)} placeholder="$0" className="bg-white/5 border-white/10 text-white placeholder:text-white/30 font-mono" />
              </div>
            </div>
            <Button className="w-full bg-brand-orange hover:bg-brand-orange-dark text-white" disabled={!newCliente} onClick={handleNewPresupuesto}>
              <Plus className="h-4 w-4 mr-2" /> Crear Presupuesto
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
