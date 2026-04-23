"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Users, Search, Phone, Mail, Building2, Plus, Eye, MessageCircle, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { clientes as initialClientes, type Cliente } from "@/lib/dashboard-data";

const estadoConfig: Record<string, string> = {
  activo: "bg-green-500/15 text-green-400",
  moroso: "bg-red-500/15 text-red-400",
  inactivo: "bg-white/5 text-white/30",
};

export default function AdminClientesPage() {
  const [clientesList, setClientesList] = useState<Cliente[]>(initialClientes);
  const [search, setSearch] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  // New client form
  const [nombre, setNombre] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [cuit, setCuit] = useState("");
  const [rubro, setRubro] = useState("");
  const [asesor, setAsesor] = useState("Martín");

  const filtered = clientesList.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return c.nombre.toLowerCase().includes(q) || c.empresa.toLowerCase().includes(q) || c.cuit.includes(q);
  });

  const detail = clientesList.find((c) => c.id === detailId);

  const handleCreate = () => {
    const newId = `C${String(clientesList.length + 1).padStart(3, "0")}`;
    const newCliente: Cliente = {
      id: newId,
      nombre,
      empresa,
      cuit,
      rubro,
      asesor,
      saldo: "$0",
      ultimaCompra: "—",
      totalCompras: "$0",
      estado: "activo",
    };
    setClientesList((prev) => [newCliente, ...prev]);
    toast.success("Cliente registrado", { description: `${nombre} — ${empresa}` });
    setNewOpen(false);
    setNombre(""); setEmpresa(""); setCuit(""); setRubro("");
  };

  const stats = {
    activos: clientesList.filter((c) => c.estado === "activo").length,
    morosos: clientesList.filter((c) => c.estado === "moroso").length,
    inactivos: clientesList.filter((c) => c.estado === "inactivo").length,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl font-bold">Clientes Profesionales</h1>
          <p className="text-sm text-white/40">{clientesList.length} clientes registrados</p>
        </motion.div>
        <Button className="bg-brand-orange hover:bg-brand-orange-dark text-white rounded-lg" onClick={() => setNewOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Nuevo Cliente
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Activos", value: stats.activos, color: "text-green-400", accent: "border-l-2 border-l-green-400" },
          { label: "Morosos", value: stats.morosos, color: "text-red-400", accent: "border-l-2 border-l-red-400" },
          { label: "Inactivos", value: stats.inactivos, color: "text-white/40", accent: "border-l-2 border-l-white/20" },
        ].map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
            <Card className={`bg-white/[0.03] border-white/5 ${s.accent}`}>
              <CardContent className="p-4">
                <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-[10px] text-white/40 uppercase tracking-wider mt-1">{s.label}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
        <Input
          placeholder="Buscar por nombre, empresa o CUIT..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10 bg-white/5 border-white/10 text-white placeholder:text-white/30"
        />
      </div>

      <Card className="bg-white/[0.03] border-white/5">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="text-left p-4 text-xs font-semibold text-white/40 uppercase tracking-wider">Cliente</th>
                  <th className="text-left p-4 text-xs font-semibold text-white/40 uppercase tracking-wider">CUIT</th>
                  <th className="text-left p-4 text-xs font-semibold text-white/40 uppercase tracking-wider">Rubro</th>
                  <th className="text-left p-4 text-xs font-semibold text-white/40 uppercase tracking-wider">Asesor</th>
                  <th className="text-right p-4 text-xs font-semibold text-white/40 uppercase tracking-wider">Total Compras</th>
                  <th className="text-right p-4 text-xs font-semibold text-white/40 uppercase tracking-wider">Saldo CC</th>
                  <th className="text-center p-4 text-xs font-semibold text-white/40 uppercase tracking-wider">Estado</th>
                  <th className="text-right p-4 text-xs font-semibold text-white/40 uppercase tracking-wider">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, i) => (
                  <motion.tr
                    key={c.id}
                    className="border-b border-white/5 hover:bg-white/[0.02] transition-colors cursor-pointer"
                    onClick={() => setDetailId(c.id)}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.03, 0.3) }}
                  >
                    <td className="p-4">
                      <p className="text-sm font-medium text-white">{c.nombre}</p>
                      <p className="text-[10px] text-white/40 flex items-center gap-1"><Building2 className="h-3 w-3" /> {c.empresa}</p>
                    </td>
                    <td className="p-4 text-xs font-mono text-white/50">{c.cuit}</td>
                    <td className="p-4 text-sm text-white/60">{c.rubro}</td>
                    <td className="p-4 text-sm text-white/60">{c.asesor}</td>
                    <td className="p-4 text-right text-sm font-mono font-bold text-white">{c.totalCompras}</td>
                    <td className="p-4 text-right">
                      <span className={`text-sm font-mono font-bold ${c.saldo.includes("-") ? "text-red-400" : "text-green-400"}`}>
                        {c.saldo}
                      </span>
                    </td>
                    <td className="p-4 text-center">
                      <Badge className={`border-0 text-[10px] capitalize ${estadoConfig[c.estado]}`}>{c.estado}</Badge>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex gap-1 justify-end">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-white/40 hover:text-white" onClick={(e) => { e.stopPropagation(); setDetailId(c.id); }}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-white/40 hover:text-white" onClick={(e) => { e.stopPropagation(); window.open(`https://wa.me/5492235903118?text=${encodeURIComponent(`Hola ${c.nombre}, desde Maderera JBJ...`)}`, "_blank"); }}>
                          <MessageCircle className="h-3.5 w-3.5" />
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
      <Dialog open={!!detailId} onOpenChange={() => setDetailId(null)}>
        <DialogContent className="bg-[#18181b] border-white/10 text-white max-w-md">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-brand-orange flex items-center justify-center">
                    <span className="text-sm font-bold">{detail.nombre.split(" ").map(n => n[0]).slice(0, 2).join("")}</span>
                  </div>
                  <div>
                    <p className="text-base">{detail.nombre}</p>
                    <p className="text-xs text-white/40 font-normal">{detail.empresa}</p>
                  </div>
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-2">
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "CUIT", value: detail.cuit },
                    { label: "Rubro", value: detail.rubro },
                    { label: "Asesor", value: detail.asesor },
                    { label: "Última compra", value: detail.ultimaCompra },
                  ].map((f) => (
                    <div key={f.label} className="p-3 rounded-lg bg-white/[0.03] border border-white/5">
                      <p className="text-[10px] text-white/40 uppercase tracking-wider mb-1">{f.label}</p>
                      <p className="text-sm font-medium">{f.value}</p>
                    </div>
                  ))}
                </div>
                <Separator className="bg-white/10" />
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-white/40 uppercase">Total compras</p>
                    <p className="text-2xl font-bold text-brand-orange">{detail.totalCompras}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-white/40 uppercase">Saldo CC</p>
                    <p className={`text-xl font-bold ${detail.saldo.includes("-") ? "text-red-400" : "text-green-400"}`}>
                      {detail.saldo}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button className="flex-1 bg-brand-orange hover:bg-brand-orange-dark text-white" onClick={() => { window.open(`https://wa.me/5492235903118?text=${encodeURIComponent(`Hola ${detail.nombre}...`)}`, "_blank"); }}>
                    <MessageCircle className="h-4 w-4 mr-2" /> Contactar
                  </Button>
                  <Button variant="outline" className="flex-1 border-white/10 text-white/60 hover:text-white" onClick={() => { toast.info("Historial de compras", { description: "Funcionalidad disponible con backend" }); }}>
                    <TrendingUp className="h-4 w-4 mr-2" /> Historial
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* New Client Dialog */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="bg-[#18181b] border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-brand-orange" />
              Nuevo Cliente
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2 col-span-2">
                <Label className="text-xs text-white/60">Nombre completo</Label>
                <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Arq. Juan López" className="bg-white/5 border-white/10 text-white placeholder:text-white/30" />
              </div>
              <div className="space-y-2 col-span-2">
                <Label className="text-xs text-white/60">Empresa</Label>
                <Input value={empresa} onChange={(e) => setEmpresa(e.target.value)} placeholder="Razón social o nombre comercial" className="bg-white/5 border-white/10 text-white placeholder:text-white/30" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-white/60">CUIT</Label>
                <Input value={cuit} onChange={(e) => setCuit(e.target.value)} placeholder="XX-XXXXXXXX-X" className="bg-white/5 border-white/10 text-white placeholder:text-white/30 font-mono" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-white/60">Rubro</Label>
                <Input value={rubro} onChange={(e) => setRubro(e.target.value)} placeholder="Ej: Carpintería" className="bg-white/5 border-white/10 text-white placeholder:text-white/30" />
              </div>
              <div className="space-y-2 col-span-2">
                <Label className="text-xs text-white/60">Asesor asignado</Label>
                <Select value={asesor} onValueChange={(v) => v && setAsesor(v)}>
                  <SelectTrigger className="bg-white/5 border-white/10 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Martín">Martín</SelectItem>
                    <SelectItem value="Diego">Diego</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button
              className="w-full bg-brand-orange hover:bg-brand-orange-dark text-white"
              disabled={!nombre || !empresa || !cuit}
              onClick={handleCreate}
            >
              <Plus className="h-4 w-4 mr-2" /> Registrar Cliente
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
