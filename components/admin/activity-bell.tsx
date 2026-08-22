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
  presupuesto: "text-blue-700 bg-blue-500/10",
  pedido: "text-brand-orange bg-brand-orange/10",
  stock: "text-red-700 bg-red-500/10",
  cliente: "text-green-700 bg-green-500/10",
  corte: "text-amber-700 bg-yellow-500/10",
};

export function ActivityBell() {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger>
        <div className="relative text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
          <Bell className="h-5 w-5" />
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-brand-orange rounded-full text-[9px] font-bold flex items-center justify-center text-foreground">
            {activityFeed.length}
          </span>
        </div>
      </SheetTrigger>
      <SheetContent className="bg-card border-border text-foreground w-[380px]">
        <SheetHeader>
          <SheetTitle className="text-foreground flex items-center gap-2">
            <Bell className="h-5 w-5 text-brand-orange" />
            Actividad Reciente
          </SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-1 overflow-y-auto max-h-[calc(100vh-100px)]">
          {activityFeed.map((item, i) => {
            const Icon = iconMap[item.type] || Package;
            const color = colorMap[item.type] || "text-muted-foreground bg-muted";
            return (
              <div
                key={i}
                className="flex items-start gap-3 p-3 rounded-lg hover:bg-card transition-colors"
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${color}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground leading-relaxed">{item.message}</p>
                  <p className="text-sm text-muted-foreground mt-1">{item.time}</p>
                </div>
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
