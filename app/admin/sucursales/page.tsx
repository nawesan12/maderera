"use client";

import { motion } from "framer-motion";
import { Building2, TrendingUp, Package, Truck, Scissors, Users, DollarSign, MapPin, Phone, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { sucursalMetricas } from "@/lib/dashboard-data";

export default function AdminSucursalesPage() {
  const sucursales = [
    { ...sucursalMetricas.central, color: "brand-orange", address: "Av. Juan B. Justo 4153", phone: "(0223) 474-3328", hours: "Lun-Vie 8-16hs | Sáb 8-12hs" },
    { ...sucursalMetricas.aserradero, color: "brand-green", address: "Canosa N°61", phone: "(0223) 483-0535", hours: "Lun-Vie 8-16hs | Sáb 8-12hs" },
  ];

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-semibold tracking-tight">Sucursales</h1>
        <p className="text-base text-muted-foreground">Resumen comparativo en tiempo real</p>
      </motion.div>

      <div className="grid lg:grid-cols-2 gap-6">
        {sucursales.map((suc, si) => (
          <motion.div
            key={suc.nombre}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: si * 0.1, duration: 0.5 }}
          >
            <Card className="bg-card border-border overflow-hidden">
              <div className={`p-5 ${suc.color === "brand-orange" ? "bg-gradient-to-r from-brand-orange/15 to-transparent" : "bg-gradient-to-r from-brand-green/15 to-transparent"} border-b border-border`}>
                <div className="flex items-center gap-3">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${suc.color === "brand-orange" ? "bg-brand-orange" : "bg-brand-green"} shadow-lg`}>
                    <Building2 className="h-6 w-6 text-foreground" />
                  </div>
                  <div className="flex-1">
                    <h2 className="text-xl font-bold text-foreground">{suc.nombre}</h2>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground mt-0.5">
                      <span className="flex items-center gap-1"><MapPin className="h-4 w-4" /> {suc.address}</span>
                    </div>
                  </div>
                  <Badge className={`border-0 text-sm ${suc.color === "brand-orange" ? "bg-brand-orange/20 text-brand-orange" : "bg-brand-green/20 text-brand-green"}`}>
                    Abierto
                  </Badge>
                </div>
              </div>
              <CardContent className="p-5">
                {/* Contact info */}
                <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
                  <span className="flex items-center gap-1"><Phone className="h-4 w-4" /> {suc.phone}</span>
                  <span className="flex items-center gap-1"><Clock className="h-4 w-4" /> {suc.hours}</span>
                </div>

                <Separator className="bg-muted mb-4" />

                {/* Metrics grid */}
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { icon: DollarSign, label: "Ventas Hoy", value: suc.ventasHoy, color: "text-green-700" },
                    { icon: Truck, label: "Pedidos Hoy", value: suc.pedidosHoy, color: "text-blue-700" },
                    { icon: Scissors, label: "Cortes en Cola", value: suc.cortesEnCola, color: suc.cortesEnCola > 0 ? "text-amber-700" : "text-muted-foreground" },
                    { icon: Users, label: "Clientes Atendidos", value: suc.clientesAtendidos, color: "text-brand-orange" },
                    { icon: Package, label: "Valor Stock", value: suc.stockValor, color: "text-foreground" },
                    { icon: Package, label: "Stock Bajo", value: suc.productosStockBajo, color: suc.productosStockBajo > 5 ? "text-red-700" : "text-amber-700" },
                  ].map((metric, i) => (
                    <motion.div
                      key={metric.label}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: si * 0.1 + i * 0.04 + 0.2 }}
                      className="p-3 rounded-xl bg-card border border-border hover:bg-muted/60 transition-colors"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <metric.icon className="h-5 w-5 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground uppercase tracking-wider">{metric.label}</p>
                      </div>
                      <p className={`text-xl font-bold ${metric.color}`}>{metric.value}</p>
                    </motion.div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
