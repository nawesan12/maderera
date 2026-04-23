"use client";

import { useState } from "react";
import { Bell, ClipboardList, Package, AlertTriangle, Users, Scissors } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { activityFeed } from "@/lib/dashboard-data";

const iconMap: Record<string, React.ElementType> = {
  presupuesto: ClipboardList,
  pedido: Package,
  stock: AlertTriangle,
  cliente: Users,
  corte: Scissors,
};

const colorMap: Record<string, string> = {
  presupuesto: "text-blue-400 bg-blue-500/10",
  pedido: "text-brand-orange bg-brand-orange/10",
  stock: "text-red-400 bg-red-500/10",
  cliente: "text-green-400 bg-green-500/10",
  corte: "text-yellow-400 bg-yellow-500/10",
};

export function ActivityBell() {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger>
        <div className="relative text-white/50 hover:text-white transition-colors cursor-pointer">
          <Bell className="h-5 w-5" />
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-brand-orange rounded-full text-[9px] font-bold flex items-center justify-center text-white">
            {activityFeed.length}
          </span>
        </div>
      </SheetTrigger>
      <SheetContent className="bg-[#18181b] border-white/10 text-white w-[380px]">
        <SheetHeader>
          <SheetTitle className="text-white flex items-center gap-2">
            <Bell className="h-4 w-4 text-brand-orange" />
            Actividad Reciente
          </SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-1 overflow-y-auto max-h-[calc(100vh-100px)]">
          {activityFeed.map((item, i) => {
            const Icon = iconMap[item.type] || Package;
            const color = colorMap[item.type] || "text-white/50 bg-white/5";
            return (
              <div
                key={i}
                className="flex items-start gap-3 p-3 rounded-lg hover:bg-white/[0.03] transition-colors"
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${color}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-white/80 leading-relaxed">{item.message}</p>
                  <p className="text-[10px] text-white/30 mt-1">{item.time}</p>
                </div>
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
