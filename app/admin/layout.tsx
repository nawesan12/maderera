import { Suspense } from "react";
import { degradar } from "@/lib/degradar";
import { PanelNoDisponible } from "@/components/admin/panel-no-disponible";
import { inicioDelRol, puedeEntrar } from "@/lib/roles";
import { SaltarAlContenido } from "@/components/saltar-al-contenido";
import { headers } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
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
  aserradero: "Aserradero",
} as const;

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // El proxy ya filtró a quien no tiene cookie, pero esta es la verificación que
  // cuenta: valida la sesión contra la base y exige rol de staff.
  /*
   * `requireStaff` decide acceso, así que no se degrada: si no se puede saber
   * quién entró, no se dibuja el panel. Pero se atrapa igual, y por una razón
   * concreta: un error en un layout no lo agarra el `error.tsx` de su carpeta,
   * sube hasta el global y reemplaza el documento entero por una pantalla sin
   * marca ni forma de volver. Se comprobó apagando la base. Atrapándolo acá se
   * falla igual de cerrado —no se muestra ni un dato— pero con una pantalla que
   * explica y deja reintentar.
   *
   * La redirección de quien no tiene permiso viaja como excepción de Next, así
   * que se relanza con `unstable_rethrow`: tragarla sí sería un agujero. Esa es
   * la forma pública de hacerlo y cubre todas las excepciones de control de
   * Next, no solo la redirección.
   */
  let usuario: Awaited<ReturnType<typeof requireStaff>>;
  try {
    usuario = await requireStaff();
  } catch (error) {
    unstable_rethrow(error);
    console.error("[panel] no se pudo resolver quién entró:", error);
    return <PanelNoDisponible />;
  }

  /*
   * El aserradero tiene su propia pantalla y no navega el panel, con una
   * excepción: todo lo que cuelga de `/admin/cortes` sí es suyo —la ficha de un
   * trabajo y la pantalla de formato para la máquina—. Justamente el formato se
   * ajusta a prueba y error parado frente a la seccionadora, así que dejarlo
   * afuera de eso sería trabarlo en la única tarea para la que esa pantalla
   * existe.
   */
  const ruta = (await headers()).get("x-ruta") ?? "";

  if (usuario.staffRole === "aserradero") {
    if (!ruta.startsWith("/admin/cortes")) redirect("/taller");
  } else if (ruta && !puedeEntrar(ruta, usuario.staffRole)) {
    /*
     * El control va acá y no en cada página, y sale de la misma lista que filtra
     * el menú. Antes solo filtraba el menú: Precios, ARCA, Cobros y Caja se
     * escondían de quien no era admin y se abrían igual tecleando la dirección.
     * Un vendedor podía cambiar precios. Esconder no es controlar.
     *
     * Que sea un solo lugar es lo que evita que vuelva a pasar: una pantalla
     * nueva no puede quedar con una regla en el menú y otra en la página,
     * porque hay una sola regla.
     */
    redirect(inicioDelRol(usuario.staffRole));
  }

  // El contador de conversaciones sin leer es un adorno del menú: si falla, el
  // panel tiene que abrirse igual y sin la pelotita.
  const sinLeer = await degradar(
    "las conversaciones sin leer",
    conversacionesSinLeer,
    0,
  );

  return (
    <div className="panel flex min-h-screen bg-background text-foreground">
      <SaltarAlContenido />
      <AdminSidebar whatsappSinLeer={sinLeer} rol={usuario.staffRole} />
      {/* `min-w-0` no es decorativo: sin él este hijo de flex no baja del ancho
          de su contenido, así que el `overflow-x` del tablero no recorta nada y
          el documento entero se estira. Con el menú lateral fijo y la barra
          superior pegajosa, eso se ve como que el panel se desarma. */}
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
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
        <main id="contenido" className="panel-fondo flex-1 px-4 py-[26px] pb-10 lg:px-7">
          {children}
        </main>
      </div>
    </div>
  );
}
