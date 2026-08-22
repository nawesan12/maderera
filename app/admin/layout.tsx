import { AdminSidebar } from "@/components/admin/sidebar";
import { BuscadorGlobal } from "@/components/admin/buscador-global";
import { MenuUsuario } from "@/components/admin/menu-usuario";
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
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b bg-background/85 px-4 backdrop-blur lg:px-8">
          <div className="flex flex-1 items-center gap-3 pl-12 lg:pl-0">
            <BuscadorGlobal />
          </div>
          <MenuUsuario
            nombre={usuario.name}
            iniciales={iniciales(usuario.name)}
            rol={etiquetaRol[usuario.staffRole!]}
          />
        </header>
        <main className="panel-fondo flex-1 px-4 py-8 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
