"use client";

import { Users, Search, Phone, Mail, Building2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { clientes } from "@/lib/dashboard-data";

const estadoConfig: Record<string, string> = {
  activo: "bg-green-500/15 text-green-400",
  moroso: "bg-red-500/15 text-red-400",
  inactivo: "bg-white/5 text-white/30",
};

export default function AdminClientesPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Clientes Profesionales</h1>
          <p className="text-sm text-white/40">{clientes.length} clientes registrados</p>
        </div>
        <Button className="bg-brand-orange hover:bg-brand-orange-dark text-white rounded-lg">
          <Users className="h-4 w-4 mr-2" />
          Nuevo Cliente
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Activos", value: clientes.filter((c) => c.estado === "activo").length, color: "text-green-400" },
          { label: "Morosos", value: clientes.filter((c) => c.estado === "moroso").length, color: "text-red-400" },
          { label: "Inactivos", value: clientes.filter((c) => c.estado === "inactivo").length, color: "text-white/40" },
        ].map((s) => (
          <Card key={s.label} className="bg-white/[0.03] border-white/5">
            <CardContent className="p-4 text-center">
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-[10px] text-white/40 uppercase tracking-wider mt-1">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
        <Input placeholder="Buscar por nombre, empresa o CUIT..." className="pl-10 bg-white/5 border-white/10 text-white placeholder:text-white/30" />
      </div>

      <Card className="bg-white/[0.03] border-white/5">
        <CardContent className="p-0">
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
              </tr>
            </thead>
            <tbody>
              {clientes.map((c) => (
                <tr key={c.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors cursor-pointer">
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
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
