"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Truck, MapPin, Clock, Package, Check, ChevronRight, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { pedidos as initialPedidos, type PedidoEstado, type Pedido } from "@/lib/dashboard-data";

const estadoConfig: Record<string, { bg: string; label: string; icon: React.ElementType }> = {
  preparando: { bg: "bg-yellow-500/15 text-yellow-400", label: "Preparando", icon: Package },
  listo: { bg: "bg-blue-500/15 text-blue-400", label: "Listo para retiro", icon: Check },
  "en-camino": { bg: "bg-brand-orange/15 text-brand-orange", label: "En camino", icon: Truck },
  entregado: { bg: "bg-green-500/15 text-green-400", label: "Entregado", icon: Check },
};

const nextEstado: Record<string, PedidoEstado> = {
  preparando: "listo",
  listo: "en-camino",
  "en-camino": "entregado",
};

export default function AdminPedidosPage() {
  const [estados, setEstados] = useState<Record<string, PedidoEstado>>({});
  const [pedidosList, setPedidosList] = useState<Pedido[]>(initialPedidos);
  const [newOpen, setNewOpen] = useState(false);
  const [newCliente, setNewCliente] = useState("");
  const [newItems, setNewItems] = useState("");
  const [newTotal, setNewTotal] = useState("");
  const [newTipo, setNewTipo] = useState<"retiro" | "entrega">("retiro");
  const [newSucursal, setNewSucursal] = useState("Central");

  const getEstado = (id: string, original: PedidoEstado) => estados[id] || original;

  const handleNewPedido = () => {
    const id = `PED-${1206 + pedidosList.length - initialPedidos.length}`;
    const now = new Date();
    const fecha = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/2026 ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const newPedido: Pedido = {
      id, fecha, cliente: newCliente, items: newItems, total: newTotal || "$0",
      estado: "preparando", sucursal: newSucursal, tipo: newTipo,
    };
    setPedidosList((prev) => [newPedido, ...prev]);
    toast.success("Pedido registrado", { description: `${id} — ${newCliente}` });
    setNewOpen(false); setNewCliente(""); setNewItems(""); setNewTotal("");
  };

  const avanzarEstado = (id: string, estadoActual: PedidoEstado) => {
    const next = nextEstado[estadoActual];
    if (!next) return;
    setEstados((prev) => ({ ...prev, [id]: next }));
    toast.success(`Pedido ${id}: ${estadoConfig[next].label}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl font-bold">Pedidos y Entregas</h1>
          <p className="text-sm text-white/40">Seguimiento de pedidos en curso</p>
        </motion.div>
        <Button className="bg-brand-orange hover:bg-brand-orange-dark text-white rounded-lg" onClick={() => setNewOpen(true)}>
          <Plus className="h-4 w-4 mr-2" /> Nuevo Pedido
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Preparando", value: pedidosList.filter((p) => getEstado(p.id, p.estado) === "preparando").length, color: "text-yellow-400" },
          { label: "Listos", value: pedidosList.filter((p) => getEstado(p.id, p.estado) === "listo").length, color: "text-blue-400" },
          { label: "En Camino", value: pedidosList.filter((p) => getEstado(p.id, p.estado) === "en-camino").length, color: "text-brand-orange" },
          { label: "Entregados Hoy", value: pedidosList.filter((p) => getEstado(p.id, p.estado) === "entregado").length, color: "text-green-400" },
        ].map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
            <Card className="bg-white/[0.03] border-white/5">
              <CardContent className="p-4 text-center">
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-[10px] text-white/40 uppercase tracking-wider mt-1">{s.label}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Pedidos cards */}
      <div className="space-y-3">
        {pedidosList.map((pedido, i) => {
          const estado = getEstado(pedido.id, pedido.estado);
          const config = estadoConfig[estado];
          const canAdvance = estado !== "entregado";
          return (
            <motion.div
              key={pedido.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Card className="bg-white/[0.03] border-white/5 hover:bg-white/[0.05] transition-colors">
                <CardContent className="p-5">
                  <div className="flex items-start gap-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${config.bg}`}>
                      <config.icon className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-sm font-bold text-white">{pedido.cliente}</p>
                        <Badge className={`border-0 text-[10px] ${config.bg}`}>{config.label}</Badge>
                        <Badge className="border-0 bg-white/5 text-white/40 text-[10px]">
                          {pedido.tipo === "entrega" ? "Entrega" : "Retiro en sucursal"}
                        </Badge>
                      </div>
                      <p className="text-sm text-white/60 mb-2">{pedido.items}</p>
                      <div className="flex items-center gap-4 text-xs text-white/40">
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {pedido.fecha}</span>
                        <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {pedido.sucursal}</span>
                        {pedido.direccion && <span className="flex items-center gap-1"><Truck className="h-3 w-3" /> {pedido.direccion}</span>}
                      </div>
                    </div>
                    <div className="text-right shrink-0 flex flex-col items-end gap-2">
                      <div>
                        <p className="text-sm font-mono font-bold text-white">{pedido.total}</p>
                        <p className="text-[10px] text-white/30 font-mono">{pedido.id}</p>
                      </div>
                      {canAdvance && (
                        <Button
                          size="sm"
                          className="bg-brand-orange hover:bg-brand-orange-dark text-white text-xs h-7 rounded-lg"
                          onClick={() => avanzarEstado(pedido.id, estado)}
                        >
                          {nextEstado[estado] && estadoConfig[nextEstado[estado]].label}
                          <ChevronRight className="h-3 w-3 ml-1" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {/* Timeline */}
                  <div className="flex items-center gap-1 mt-4 ml-14">
                    {["preparando", "listo", pedido.tipo === "entrega" ? "en-camino" : null, "entregado"].filter(Boolean).map((step, idx, arr) => {
                      const allEstados = ["preparando", "listo", "en-camino", "entregado"];
                      const currentIdx = allEstados.indexOf(estado);
                      const stepIdx = allEstados.indexOf(step!);
                      const isDone = stepIdx <= currentIdx;
                      return (
                        <div key={step} className="flex items-center gap-1 flex-1">
                          <div className={`w-2 h-2 rounded-full shrink-0 transition-colors duration-300 ${isDone ? "bg-brand-orange" : "bg-white/10"}`} />
                          {idx < arr.length - 1 && <div className={`h-0.5 flex-1 rounded transition-colors duration-300 ${isDone ? "bg-brand-orange" : "bg-white/10"}`} />}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>

      {/* New Pedido Dialog */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="bg-[#18181b] border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5 text-brand-orange" />
              Nuevo Pedido
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label className="text-xs text-white/60">Cliente</Label>
              <Input value={newCliente} onChange={(e) => setNewCliente(e.target.value)} placeholder="Nombre del cliente" className="bg-white/5 border-white/10 text-white placeholder:text-white/30" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-white/60">Detalle de items</Label>
              <Input value={newItems} onChange={(e) => setNewItems(e.target.value)} placeholder="Ej: 12 placas melamina + corte" className="bg-white/5 border-white/10 text-white placeholder:text-white/30" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-xs text-white/60">Monto</Label>
                <Input value={newTotal} onChange={(e) => setNewTotal(e.target.value)} placeholder="$0" className="bg-white/5 border-white/10 text-white placeholder:text-white/30 font-mono" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-white/60">Tipo</Label>
                <Select value={newTipo} onValueChange={(v) => v && setNewTipo(v as "retiro" | "entrega")}>
                  <SelectTrigger className="bg-white/5 border-white/10 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="retiro">Retiro en sucursal</SelectItem>
                    <SelectItem value="entrega">Entrega a domicilio</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-white/60">Sucursal</Label>
              <Select value={newSucursal} onValueChange={(v) => v && setNewSucursal(v)}>
                <SelectTrigger className="bg-white/5 border-white/10 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Central">Casa Central</SelectItem>
                  <SelectItem value="Aserradero">Aserradero</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button className="w-full bg-brand-orange hover:bg-brand-orange-dark text-white" disabled={!newCliente || !newItems} onClick={handleNewPedido}>
              <Plus className="h-4 w-4 mr-2" /> Registrar Pedido
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
