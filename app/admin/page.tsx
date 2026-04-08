"use client";

import { TrendingUp, TrendingDown, ClipboardList, Package, Users, AlertTriangle, ArrowRight, Clock } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { kpis, ventasMensuales, presupuestos, pedidos, stockAlerts } from "@/lib/dashboard-data";

const estadoBadge: Record<string, string> = {
  pendiente: "bg-yellow-500/15 text-yellow-400",
  revision: "bg-blue-500/15 text-blue-400",
  enviado: "bg-brand-orange/15 text-brand-orange",
  aceptado: "bg-green-500/15 text-green-400",
  rechazado: "bg-red-500/15 text-red-400",
  preparando: "bg-yellow-500/15 text-yellow-400",
  listo: "bg-blue-500/15 text-blue-400",
  "en-camino": "bg-brand-orange/15 text-brand-orange",
  entregado: "bg-green-500/15 text-green-400",
};

const maxVentas = Math.max(...ventasMensuales.map((m) => m.central + m.aserradero));

export default function AdminDashboard() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-white/40">Resumen general del negocio — Abril 2026</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Ventas del Mes", ...kpis.ventasMes, icon: TrendingUp, color: "text-green-400" },
          { label: "Presupuestos Pendientes", ...kpis.presupuestosPendientes, icon: ClipboardList, color: "text-yellow-400" },
          { label: "Productos Stock Bajo", ...kpis.productosStockBajo, icon: Package, color: "text-red-400" },
          { label: "Clientes Activos", ...kpis.clientesActivos, icon: Users, color: "text-blue-400" },
        ].map((kpi) => (
          <Card key={kpi.label} className="bg-white/[0.03] border-white/5">
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div className={`w-10 h-10 rounded-xl ${kpi.color} bg-current/10 flex items-center justify-center`}>
                  <kpi.icon className={`h-5 w-5 ${kpi.color}`} />
                </div>
                <Badge className={`border-0 text-xs font-mono ${kpi.trend === "up" && kpi.label.includes("Stock") ? "bg-red-500/15 text-red-400" : kpi.trend === "up" ? "bg-green-500/15 text-green-400" : "bg-green-500/15 text-green-400"}`}>
                  {kpi.change}
                </Badge>
              </div>
              <p className="text-2xl font-bold text-white">{kpi.value}</p>
              <p className="text-xs text-white/40 mt-1">{kpi.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts + Alerts row */}
      <div className="grid lg:grid-cols-3 gap-4">
        {/* Ventas chart */}
        <Card className="lg:col-span-2 bg-white/[0.03] border-white/5">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base text-white">Ventas Últimos 6 Meses</CardTitle>
              <div className="flex items-center gap-4 text-xs text-white/40">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-brand-orange" /> Central</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-brand-green" /> Aserradero</span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="flex items-end gap-3 h-48">
              {ventasMensuales.map((m) => (
                <div key={m.mes} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex flex-col gap-0.5" style={{ height: "180px" }}>
                    <div className="flex-1" />
                    <div
                      className="w-full bg-brand-orange rounded-t"
                      style={{ height: `${(m.central / maxVentas) * 100}%` }}
                    />
                    <div
                      className="w-full bg-brand-green rounded-t"
                      style={{ height: `${(m.aserradero / maxVentas) * 100}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-white/40 font-medium">{m.mes}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Stock alerts */}
        <Card className="bg-white/[0.03] border-white/5">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base text-white flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-400" />
                Stock Bajo
              </CardTitle>
              <Link href="/admin/stock" className="text-xs text-brand-orange hover:underline">Ver todo</Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {stockAlerts.slice(0, 5).map((alert) => (
              <div key={`${alert.producto}-${alert.sucursal}`} className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.02] border border-white/5">
                <div>
                  <p className="text-xs font-medium text-white">{alert.producto}</p>
                  <p className="text-[10px] text-white/40">{alert.sucursal}</p>
                </div>
                <Badge className="bg-red-500/15 text-red-400 border-0 text-xs font-mono">
                  {alert.stock}/{alert.minimo}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Tables row */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Recent presupuestos */}
        <Card className="bg-white/[0.03] border-white/5">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base text-white">Presupuestos Recientes</CardTitle>
              <Link href="/admin/presupuestos" className="text-xs text-brand-orange hover:underline flex items-center gap-1">
                Ver todos <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-white/5">
              {presupuestos.slice(0, 5).map((p) => (
                <div key={p.id} className="flex items-center gap-3 px-5 py-3 hover:bg-white/[0.02] transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{p.cliente}</p>
                    <p className="text-[11px] text-white/40">{p.id} · {p.items} items</p>
                  </div>
                  <p className="text-sm font-mono font-bold text-white">{p.total}</p>
                  <Badge className={`border-0 text-[10px] capitalize ${estadoBadge[p.estado]}`}>
                    {p.estado}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Recent pedidos */}
        <Card className="bg-white/[0.03] border-white/5">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base text-white">Pedidos del Día</CardTitle>
              <Link href="/admin/pedidos" className="text-xs text-brand-orange hover:underline flex items-center gap-1">
                Ver todos <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-white/5">
              {pedidos.slice(0, 5).map((p) => (
                <div key={p.id} className="flex items-center gap-3 px-5 py-3 hover:bg-white/[0.02] transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{p.cliente}</p>
                    <p className="text-[11px] text-white/40 flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {p.fecha.split(" ")[1] || p.fecha} · {p.tipo === "entrega" ? "Entrega" : "Retiro"}
                    </p>
                  </div>
                  <Badge className={`border-0 text-[10px] capitalize ${estadoBadge[p.estado]}`}>
                    {p.estado.replace("-", " ")}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
