"use client";

import { ClipboardList, Search, Eye, MessageCircle, Download } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { presupuestos } from "@/lib/dashboard-data";

const estadoConfig: Record<string, { bg: string; label: string }> = {
  pendiente: { bg: "bg-yellow-500/15 text-yellow-400", label: "Pendiente" },
  revision: { bg: "bg-blue-500/15 text-blue-400", label: "En Revisión" },
  enviado: { bg: "bg-brand-orange/15 text-brand-orange", label: "Enviado" },
  aceptado: { bg: "bg-green-500/15 text-green-400", label: "Aceptado" },
  rechazado: { bg: "bg-red-500/15 text-red-400", label: "Rechazado" },
};

export default function AdminPresupuestosPage() {
  const stats = {
    total: presupuestos.length,
    pendientes: presupuestos.filter((p) => p.estado === "pendiente" || p.estado === "revision").length,
    aceptados: presupuestos.filter((p) => p.estado === "aceptado").length,
    montoTotal: "$22.405.000",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Presupuestos</h1>
        <p className="text-sm text-white/40">Gestión de presupuestos recibidos</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total", value: stats.total, color: "text-white" },
          { label: "Pendientes", value: stats.pendientes, color: "text-yellow-400" },
          { label: "Aceptados", value: stats.aceptados, color: "text-green-400" },
          { label: "Monto Total", value: stats.montoTotal, color: "text-brand-orange" },
        ].map((s) => (
          <Card key={s.label} className="bg-white/[0.03] border-white/5">
            <CardContent className="p-4 text-center">
              <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-[10px] text-white/40 uppercase tracking-wider mt-1">{s.label}</p>
            </CardContent>
          </Card>
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
                {presupuestos.map((p) => (
                  <tr key={p.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                    <td className="p-4 text-xs font-mono text-white/60">{p.id}</td>
                    <td className="p-4">
                      <p className="text-sm font-medium text-white">{p.cliente}</p>
                      <p className="text-[10px] text-white/40">{p.empresa}</p>
                    </td>
                    <td className="p-4 text-sm text-white/60">{p.fecha}</td>
                    <td className="p-4 text-center text-sm text-white/60">{p.items}</td>
                    <td className="p-4 text-right text-sm font-mono font-bold text-white">{p.total}</td>
                    <td className="p-4 text-center">
                      <Badge className={`border-0 text-[10px] ${estadoConfig[p.estado].bg}`}>
                        {estadoConfig[p.estado].label}
                      </Badge>
                    </td>
                    <td className="p-4 text-center text-xs text-white/50">{p.sucursal}</td>
                    <td className="p-4 text-right">
                      <div className="flex gap-1 justify-end">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-white/40 hover:text-white"><Eye className="h-3.5 w-3.5" /></Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-white/40 hover:text-white"><MessageCircle className="h-3.5 w-3.5" /></Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-white/40 hover:text-white"><Download className="h-3.5 w-3.5" /></Button>
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
  );
}
