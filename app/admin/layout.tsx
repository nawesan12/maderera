import { Suspense } from "react";
import { AdminSidebar } from "@/components/admin/sidebar";
import { BuscadorGlobal } from "@/components/admin/buscador-global";
import { MenuUsuario } from "@/components/admin/menu-usuario";
import {
  ActivityBell,
  ActivityBellSkeleton,
} from "@/components/admin/activity-bell";
import { ThemeToggle } from "@/components/theme-toggle";
import { requireStaff } from "@/lib/dal/session";
import { conversacionesSinLeer } from "@/lib/dal/admin/whatsapp";

/** Iniciales para el avatar: "Juan Pérez" -> "JP". */
function iniciales(nombre: string) {
  return nombre
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase() ?? "")
    .join("");
}

const etiquetaRol = {
  admin: "Administración",
  vendedor: "Ventas",
  deposito: "Depósito",
} as const;

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // El proxy ya filtró a quien no tiene cookie, pero esta es la verificación que
  // cuenta: valida la sesión contra la base y exige rol de staff.
  const usuario = await requireStaff();
  const sinLeer = await conversacionesSinLeer();

  return (
    <div className="panel flex min-h-screen bg-background text-foreground">
      <AdminSidebar whatsappSinLeer={sinLeer} />
      <div className="flex min-h-screen flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-[60px] items-center gap-4 border-b border-linea bg-background/90 px-4 backdrop-blur-lg lg:px-7">
          <div className="flex max-w-[420px] flex-1 items-center gap-3 pl-12 lg:pl-0">
            <BuscadorGlobal />
          </div>
          <div className="ml-auto flex items-center gap-3.5">
            {/* El interruptor de tema también acá: el único que había estaba en
                el navbar público, así que quien entraba al panel en modo oscuro
                no tenía desde dónde volver. */}
            <ThemeToggle />
            <Suspense fallback={<ActivityBellSkeleton />}>
              <ActivityBell />
            </Suspense>
            <div className="border-l border-linea pl-3.5">
              <MenuUsuario
                nombre={usuario.name}
                iniciales={iniciales(usuario.name)}
                rol={etiquetaRol[usuario.staffRole!]}
              />
            </div>
          </div>
        </header>
        <main className="panel-fondo flex-1 px-4 py-[26px] pb-10 lg:px-7">
          {children}
        </main>
      </div>
    </div>
  );
}
