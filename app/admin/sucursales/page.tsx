"use client";

import { Building2, TrendingUp, Package, Truck, Scissors, Users, DollarSign } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { sucursalMetricas } from "@/lib/dashboard-data";

export default function AdminSucursalesPage() {
  const sucursales = [
    { ...sucursalMetricas.central, color: "brand-orange" },
    { ...sucursalMetricas.aserradero, color: "brand-green" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Sucursales</h1>
        <p className="text-sm text-white/40">Resumen comparativo en tiempo real</p>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {sucursales.map((suc) => (
          <Card key={suc.nombre} className="bg-white/[0.03] border-white/5 overflow-hidden">
            <div className={`p-5 ${suc.color === "brand-orange" ? "bg-brand-orange/10" : "bg-brand-green/10"} border-b border-white/5`}>
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${suc.color === "brand-orange" ? "bg-brand-orange" : "bg-brand-green"}`}>
                  <Building2 className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">{suc.nombre}</h2>
                  <p className="text-xs text-white/40">
                    {suc.nombre === "Casa Central" ? "Av. Juan B. Justo 4153" : "Canosa N°61"}
                  </p>
                </div>
              </div>
            </div>
            <CardContent className="p-5">
              <div className="grid grid-cols-2 gap-4">
                {[
                  { icon: DollarSign, label: "Ventas Hoy", value: suc.ventasHoy, color: "text-green-400" },
                  { icon: Truck, label: "Pedidos Hoy", value: suc.pedidosHoy, color: "text-blue-400" },
                  { icon: Scissors, label: "Cortes en Cola", value: suc.cortesEnCola, color: suc.cortesEnCola > 0 ? "text-yellow-400" : "text-white/40" },
                  { icon: Users, label: "Clientes Atendidos", value: suc.clientesAtendidos, color: "text-brand-orange" },
                  { icon: Package, label: "Valor Stock", value: suc.stockValor, color: "text-white" },
                  { icon: Package, label: "Stock Bajo", value: suc.productosStockBajo, color: suc.productosStockBajo > 5 ? "text-red-400" : "text-yellow-400" },
                ].map((metric) => (
                  <div key={metric.label} className="p-3 rounded-xl bg-white/[0.03] border border-white/5">
                    <div className="flex items-center gap-2 mb-2">
                      <metric.icon className="h-4 w-4 text-white/30" />
                      <p className="text-[10px] text-white/40 uppercase tracking-wider">{metric.label}</p>
                    </div>
                    <p className={`text-lg font-bold ${metric.color}`}>{metric.value}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
