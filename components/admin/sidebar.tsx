"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  ClipboardList,
  Truck,
  Users,
  FileText,
  Scissors,
  Building2,
  ExternalLink,
  Menu,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

const navItems = [
  { href: "/admin", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/admin/stock", icon: Package, label: "Stock", badge: "18" },
  { href: "/admin/presupuestos", icon: ClipboardList, label: "Presupuestos", badge: "23" },
  { href: "/admin/pedidos", icon: Truck, label: "Pedidos", badge: "3" },
  { href: "/admin/clientes", icon: Users, label: "Clientes" },
  { href: "/admin/facturacion", icon: FileText, label: "Facturación", badge: "4" },
  { href: "/admin/cortes", icon: Scissors, label: "Cortes", badge: "2" },
  { href: "/admin/sucursales", icon: Building2, label: "Sucursales" },
];

export function AdminSidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navContent = (
    <>
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
              onClick={() => setMobileOpen(false)}
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
                    isActive ? "bg-white/20 text-white" : "bg-brand-orange/15 text-brand-orange"
                  }`}
                >
                  {item.badge}
                </Badge>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="p-3 border-t border-white/5">
        <Link
          href="/"
          onClick={() => setMobileOpen(false)}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-white/40 hover:text-white hover:bg-white/5 transition-all"
        >
          <ExternalLink className="h-4 w-4" />
          Ver sitio público
        </Link>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="lg:hidden fixed top-3 left-3 z-50 bg-brand-orange text-white w-10 h-10 rounded-xl flex items-center justify-center shadow-lg"
      >
        {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/60 z-40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar - desktop always visible, mobile slide-in */}
      <aside
        className={`w-64 bg-[#0f0f12] border-r border-white/5 flex flex-col h-screen fixed lg:sticky top-0 z-40 transition-transform duration-300 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        {/* Logo */}
        <div className="p-5 border-b border-white/5">
          <Link href="/admin" className="flex items-center gap-3" onClick={() => setMobileOpen(false)}>
            <Image src="/cropped-icon-180x180.png" alt="MJBJ" width={36} height={36} className="rounded-lg" />
            <div>
              <p className="font-bold text-white text-sm leading-tight">MJBJ Admin</p>
              <p className="text-[10px] text-white/40 leading-tight">Panel de Control</p>
            </div>
          </Link>
        </div>
        {navContent}
      </aside>
    </>
  );
}
