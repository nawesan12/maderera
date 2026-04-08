import { AdminSidebar } from "@/components/admin/sidebar";
import { Bell, Search } from "lucide-react";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="dark bg-[#09090b] min-h-screen flex text-white">
      <AdminSidebar />
      <div className="flex-1 flex flex-col min-h-screen">
        {/* Topbar */}
        <header className="h-14 border-b border-white/5 flex items-center justify-between px-6 bg-[#0f0f12]/80 backdrop-blur-sm sticky top-0 z-40">
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
              <input
                placeholder="Buscar..."
                className="bg-white/5 border border-white/10 rounded-lg pl-9 pr-4 py-1.5 text-sm text-white placeholder:text-white/30 w-64 focus:outline-none focus:border-brand-orange/50"
              />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button className="relative text-white/50 hover:text-white transition-colors">
              <Bell className="h-5 w-5" />
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-brand-orange rounded-full text-[9px] font-bold flex items-center justify-center text-white">
                5
              </span>
            </button>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-brand-orange flex items-center justify-center">
                <span className="text-xs font-bold text-white">MG</span>
              </div>
              <div className="text-right">
                <p className="text-xs font-medium text-white">Martín García</p>
                <p className="text-[10px] text-white/40">Administrador</p>
              </div>
            </div>
          </div>
        </header>
        {/* Content */}
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
