"use client";

import { motion } from "framer-motion";
import { TrendingUp, ClipboardList, Package, Users, AlertTriangle, ArrowRight, Clock } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { kpis, ventasMensuales, presupuestos, pedidos, stockAlerts } from "@/lib/dashboard-data";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

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

const chartData = ventasMensuales.map((m) => ({
  mes: m.mes,
  "Casa Central": m.central / 1000000,
  Aserradero: m.aserradero / 1000000,
}));

const formatMillions = (value: number) => `$${value}M`;

export default function AdminDashboard() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-white/40">Resumen general del negocio — Abril 2026</p>
      </motion.div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Ventas del Mes", ...kpis.ventasMes, icon: TrendingUp, color: "text-green-400" },
          { label: "Presupuestos Pendientes", ...kpis.presupuestosPendientes, icon: ClipboardList, color: "text-yellow-400" },
          { label: "Productos Stock Bajo", ...kpis.productosStockBajo, icon: Package, color: "text-red-400" },
          { label: "Clientes Activos", ...kpis.clientesActivos, icon: Users, color: "text-blue-400" },
        ].map((kpi, i) => (
          <motion.div
            key={kpi.label}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.08, duration: 0.4 }}
          >
            <Card className="bg-white/[0.03] border-white/5">
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
          </motion.div>
        ))}
      </div>

      {/* Charts + Alerts row */}
      <div className="grid lg:grid-cols-3 gap-4">
        {/* Ventas chart - Recharts */}
        <motion.div
          className="lg:col-span-2"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.5 }}
        >
          <Card className="bg-white/[0.03] border-white/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-white">Ventas Últimos 6 Meses</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={chartData} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis
                    dataKey="mes"
                    tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 12 }}
                    axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={formatMillions}
                    tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={50}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1a1a1a",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: "12px",
                      fontSize: "12px",
                    }}
                    labelStyle={{ color: "rgba(255,255,255,0.7)" }}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    formatter={(value: any) => `$${Number(value).toFixed(1)}M`}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: "12px", color: "rgba(255,255,255,0.5)" }}
                    iconType="circle"
                    iconSize={8}
                  />
                  <Bar
                    dataKey="Casa Central"
                    fill="#e87c3e"
                    radius={[4, 4, 0, 0]}
                    animationDuration={1200}
                    animationBegin={200}
                  />
                  <Bar
                    dataKey="Aserradero"
                    fill="#4a9a6e"
                    radius={[4, 4, 0, 0]}
                    animationDuration={1200}
                    animationBegin={400}
                  />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>

        {/* Stock alerts */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.5 }}
        >
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
              {stockAlerts.slice(0, 5).map((alert, i) => (
                <motion.div
                  key={`${alert.producto}-${alert.sucursal}`}
                  className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.02] border border-white/5"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.5 + i * 0.06 }}
                >
                  <div>
                    <p className="text-xs font-medium text-white">{alert.producto}</p>
                    <p className="text-[10px] text-white/40">{alert.sucursal}</p>
                  </div>
                  <Badge className="bg-red-500/15 text-red-400 border-0 text-xs font-mono">
                    {alert.stock}/{alert.minimo}
                  </Badge>
                </motion.div>
              ))}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Tables row */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Recent presupuestos */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.5 }}
        >
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
                {presupuestos.slice(0, 5).map((p, i) => (
                  <motion.div
                    key={p.id}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-white/[0.02] transition-colors"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.6 + i * 0.05 }}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{p.cliente}</p>
                      <p className="text-[11px] text-white/40">{p.id} · {p.items} items</p>
                    </div>
                    <p className="text-sm font-mono font-bold text-white">{p.total}</p>
                    <Badge className={`border-0 text-[10px] capitalize ${estadoBadge[p.estado]}`}>
                      {p.estado}
                    </Badge>
                  </motion.div>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Recent pedidos */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55, duration: 0.5 }}
        >
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
                {pedidos.slice(0, 5).map((p, i) => (
                  <motion.div
                    key={p.id}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-white/[0.02] transition-colors"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.6 + i * 0.05 }}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{p.cliente}</p>
                      <p className="text-[11px] text-white/40 flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {p.fecha.split(" ")[1] || p.fecha} · {p.tipo === "entrega" ? "Entrega" : "Retiro"}
                      </p>
                    </div>
                    <Badge className={`border-0 text-[10px] capitalize ${estadoBadge[p.estado]}`}>
                      {p.estado.replace("-", " ")}
                    </Badge>
                  </motion.div>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
