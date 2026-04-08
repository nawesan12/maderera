"use client";

import { Scissors, Clock, AlertTriangle, Check, Package } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cortes } from "@/lib/dashboard-data";

const estadoConfig: Record<string, { bg: string; label: string; icon: React.ElementType }> = {
  "en-cola": { bg: "bg-yellow-500/15 text-yellow-400", label: "En Cola", icon: Clock },
  "en-proceso": { bg: "bg-blue-500/15 text-blue-400", label: "En Proceso", icon: Scissors },
  terminado: { bg: "bg-green-500/15 text-green-400", label: "Terminado", icon: Check },
  retirado: { bg: "bg-white/5 text-white/40", label: "Retirado", icon: Package },
};

export default function AdminCortesPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Cola de Cortes</h1>
          <p className="text-sm text-white/40">Servicio de corte de placas a medida — Casa Central</p>
        </div>
        <Button className="bg-brand-orange hover:bg-brand-orange-dark text-white rounded-lg">
          <Scissors className="h-4 w-4 mr-2" />
          Nuevo Corte
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "En Cola", value: cortes.filter((c) => c.estado === "en-cola").length, color: "text-yellow-400" },
          { label: "En Proceso", value: cortes.filter((c) => c.estado === "en-proceso").length, color: "text-blue-400" },
          { label: "Terminados", value: cortes.filter((c) => c.estado === "terminado").length, color: "text-green-400" },
          { label: "Retirados Hoy", value: cortes.filter((c) => c.estado === "retirado").length, color: "text-white/40" },
        ].map((s) => (
          <Card key={s.label} className="bg-white/[0.03] border-white/5">
            <CardContent className="p-4 text-center">
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-[10px] text-white/40 uppercase tracking-wider mt-1">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Cortes queue */}
      <div className="space-y-3">
        {cortes.map((corte) => {
          const config = estadoConfig[corte.estado];
          return (
            <Card key={corte.id} className="bg-white/[0.03] border-white/5 hover:bg-white/[0.05] transition-colors">
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${config.bg}`}>
                    <config.icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
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
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {corte.estado === "en-cola" && (
                      <Button size="sm" className="bg-blue-500 hover:bg-blue-600 text-white text-xs h-8">
                        Iniciar Corte
                      </Button>
                    )}
                    {corte.estado === "en-proceso" && (
                      <Button size="sm" className="bg-green-500 hover:bg-green-600 text-white text-xs h-8">
                        Marcar Terminado
                      </Button>
                    )}
                    {corte.estado === "terminado" && (
                      <Button size="sm" variant="outline" className="border-white/10 text-white/50 text-xs h-8">
                        Marcar Retirado
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
