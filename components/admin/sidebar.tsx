"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  ClipboardList,
  Truck,
  Users,
  Scissors,
  Building2,
  ExternalLink,
  Bell,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

const navItems = [
  { href: "/admin", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/admin/stock", icon: Package, label: "Stock", badge: "18" },
  { href: "/admin/presupuestos", icon: ClipboardList, label: "Presupuestos", badge: "23" },
  { href: "/admin/pedidos", icon: Truck, label: "Pedidos", badge: "3" },
  { href: "/admin/clientes", icon: Users, label: "Clientes" },
  { href: "/admin/cortes", icon: Scissors, label: "Cortes", badge: "2" },
  { href: "/admin/sucursales", icon: Building2, label: "Sucursales" },
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-[#0f0f12] border-r border-white/5 flex flex-col h-screen sticky top-0">
      {/* Logo */}
      <div className="p-5 border-b border-white/5">
        <Link href="/admin" className="flex items-center gap-3">
          <Image
            src="/cropped-icon-180x180.png"
            alt="MJBJ"
            width={36}
            height={36}
            className="rounded-lg"
          />
          <div>
            <p className="font-bold text-white text-sm leading-tight">MJBJ Admin</p>
            <p className="text-[10px] text-white/40 leading-tight">Panel de Control</p>
          </div>
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        <p className="text-[10px] font-bold text-white/30 uppercase tracking-[0.15em] px-3 pt-3 pb-2">
          General
        </p>
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all ${
                isActive
                  ? "bg-brand-orange text-white font-semibold shadow-lg shadow-brand-orange/20"
                  : "text-white/50 hover:text-white hover:bg-white/5"
              }`}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              <span className="flex-1">{item.label}</span>
              {item.badge && (
                <Badge
                  className={`text-[10px] px-1.5 py-0 h-5 font-bold border-0 ${
                    isActive
                      ? "bg-white/20 text-white"
                      : "bg-brand-orange/15 text-brand-orange"
                  }`}
                >
                  {item.badge}
                </Badge>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="p-3 border-t border-white/5">
        <Link
          href="/"
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-white/40 hover:text-white hover:bg-white/5 transition-all"
        >
          <ExternalLink className="h-4 w-4" />
          Ver sitio público
        </Link>
      </div>
    </aside>
  );
}
