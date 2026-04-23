"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Truck, MapPin, Clock, Package, Check, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { pedidos, type PedidoEstado } from "@/lib/dashboard-data";

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

  const getEstado = (id: string, original: PedidoEstado) => estados[id] || original;

  const avanzarEstado = (id: string, estadoActual: PedidoEstado) => {
    const next = nextEstado[estadoActual];
    if (!next) return;
    setEstados((prev) => ({ ...prev, [id]: next }));
    toast.success(`Pedido ${id}: ${estadoConfig[next].label}`);
  };

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold">Pedidos y Entregas</h1>
        <p className="text-sm text-white/40">Seguimiento de pedidos en curso</p>
      </motion.div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Preparando", value: pedidos.filter((p) => getEstado(p.id, p.estado) === "preparando").length, color: "text-yellow-400" },
          { label: "Listos", value: pedidos.filter((p) => getEstado(p.id, p.estado) === "listo").length, color: "text-blue-400" },
          { label: "En Camino", value: pedidos.filter((p) => getEstado(p.id, p.estado) === "en-camino").length, color: "text-brand-orange" },
          { label: "Entregados Hoy", value: pedidos.filter((p) => getEstado(p.id, p.estado) === "entregado").length, color: "text-green-400" },
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
        {pedidos.map((pedido, i) => {
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
    </div>
  );
}
