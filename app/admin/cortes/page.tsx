"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Scissors, Clock, AlertTriangle, Check, Package, Plus, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cortes as initialCortes, type CorteEstado, type Corte } from "@/lib/dashboard-data";

const estadoConfig: Record<string, { bg: string; label: string; icon: React.ElementType }> = {
  "en-cola": { bg: "bg-yellow-500/15 text-yellow-400", label: "En Cola", icon: Clock },
  "en-proceso": { bg: "bg-blue-500/15 text-blue-400", label: "En Proceso", icon: Scissors },
  terminado: { bg: "bg-green-500/15 text-green-400", label: "Terminado", icon: Check },
  retirado: { bg: "bg-white/5 text-white/40", label: "Retirado", icon: Package },
};

const nextEstado: Record<string, CorteEstado> = {
  "en-cola": "en-proceso",
  "en-proceso": "terminado",
  terminado: "retirado",
};

export default function AdminCortesPage() {
  const [cortesList, setCortesList] = useState<Corte[]>(initialCortes);
  const [estados, setEstados] = useState<Record<string, CorteEstado>>({});
  const [newOpen, setNewOpen] = useState(false);

  // New corte form
  const [cliente, setCliente] = useState("");
  const [placa, setPlaca] = useState("");
  const [piezas, setPiezas] = useState("1");
  const [sucursal, setSucursal] = useState("Central");
  const [notas, setNotas] = useState("");

  const getEstado = (id: string, original: CorteEstado) => estados[id] || original;

  const avanzar = (id: string, estado: CorteEstado) => {
    const next = nextEstado[estado];
    if (!next) return;
    setEstados((prev) => ({ ...prev, [id]: next }));
    toast.success(`Corte ${id}: ${estadoConfig[next].label}`);
  };

  const handleCreate = () => {
    const now = new Date();
    const fecha = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const newCorte: Corte = {
      id: `CRT-${459 + cortesList.length - initialCortes.length + 1}`,
      fecha,
      cliente,
      placa,
      piezas: parseInt(piezas) || 1,
      estado: "en-cola",
      sucursal,
      notas: notas || undefined,
    };
    setCortesList((prev) => [newCorte, ...prev]);
    toast.success("Corte registrado en cola", { description: `${placa} — ${cliente}` });
    setNewOpen(false);
    setCliente(""); setPlaca(""); setPiezas("1"); setNotas("");
  };

  const stats = {
    enCola: cortesList.filter((c) => getEstado(c.id, c.estado) === "en-cola").length,
    enProceso: cortesList.filter((c) => getEstado(c.id, c.estado) === "en-proceso").length,
    terminados: cortesList.filter((c) => getEstado(c.id, c.estado) === "terminado").length,
    retirados: cortesList.filter((c) => getEstado(c.id, c.estado) === "retirado").length,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl font-bold">Cola de Cortes</h1>
          <p className="text-sm text-white/40">Servicio de corte de placas a medida — Casa Central</p>
        </motion.div>
        <Button className="bg-brand-orange hover:bg-brand-orange-dark text-white rounded-lg" onClick={() => setNewOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Nuevo Corte
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "En Cola", value: stats.enCola, color: "text-yellow-400", accent: "border-l-2 border-l-yellow-400" },
          { label: "En Proceso", value: stats.enProceso, color: "text-blue-400", accent: "border-l-2 border-l-blue-400" },
          { label: "Terminados", value: stats.terminados, color: "text-green-400", accent: "border-l-2 border-l-green-400" },
          { label: "Retirados Hoy", value: stats.retirados, color: "text-white/40", accent: "border-l-2 border-l-white/20" },
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

      {/* Cortes queue */}
      <div className="space-y-3">
        {cortesList.map((corte, i) => {
          const estado = getEstado(corte.id, corte.estado);
          const config = estadoConfig[estado];
          const canAdvance = estado !== "retirado";
          return (
            <motion.div
              key={corte.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.04, 0.3) }}
            >
              <Card className="bg-white/[0.03] border-white/5 hover:bg-white/[0.05] transition-colors">
                <CardContent className="p-5">
                  <div className="flex items-start gap-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${config.bg}`}>
                      <config.icon className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <p className="text-sm font-bold text-white">{corte.cliente}</p>
                        <Badge className={`border-0 text-[10px] ${config.bg}`}>{config.label}</Badge>
                        {corte.notas && (
                          <Badge className="border-0 bg-yellow-500/10 text-yellow-400 text-[10px]">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            {corte.notas}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-white/60 mb-1">{corte.placa}</p>
                      <div className="flex items-center gap-4 text-xs text-white/40">
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {corte.fecha}</span>
                        <span>{corte.piezas} piezas</span>
                        <span>{corte.sucursal}</span>
                        <span className="font-mono text-white/30">{corte.id}</span>
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {canAdvance && nextEstado[estado] && (
                        <Button
                          size="sm"
                          className="bg-brand-orange hover:bg-brand-orange-dark text-white text-xs h-8 rounded-lg"
                          onClick={() => avanzar(corte.id, estado)}
                        >
                          {estadoConfig[nextEstado[estado]].label}
                          <ChevronRight className="h-3 w-3 ml-1" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>

      {/* New Corte Dialog */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="bg-[#18181b] border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Scissors className="h-5 w-5 text-brand-orange" />
              Nuevo Corte
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label className="text-xs text-white/60">Cliente</Label>
              <Input value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="Nombre del cliente" className="bg-white/5 border-white/10 text-white placeholder:text-white/30" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-white/60">Placa (tipo, espesor y cantidad)</Label>
              <Input value={placa} onChange={(e) => setPlaca(e.target.value)} placeholder="Ej: Melamina Blanca 18mm (x4)" className="bg-white/5 border-white/10 text-white placeholder:text-white/30" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-xs text-white/60">Cantidad de piezas</Label>
                <Input type="number" value={piezas} onChange={(e) => setPiezas(e.target.value)} min="1" className="bg-white/5 border-white/10 text-white" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-white/60">Sucursal</Label>
                <Select value={sucursal} onValueChange={(v) => v && setSucursal(v)}>
                  <SelectTrigger className="bg-white/5 border-white/10 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Central">Casa Central</SelectItem>
                    <SelectItem value="Aserradero">Aserradero</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-white/60">Notas (opcional)</Label>
              <Textarea value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Urgencia, detalles especiales..." rows={2} className="bg-white/5 border-white/10 text-white placeholder:text-white/30 resize-none" />
            </div>
            <Button
              className="w-full bg-brand-orange hover:bg-brand-orange-dark text-white"
              disabled={!cliente || !placa}
              onClick={handleCreate}
            >
              <Plus className="h-4 w-4 mr-2" /> Agregar a la Cola
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
