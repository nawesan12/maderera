import type { Metadata } from "next";
import { Suspense } from "react";
import { degradar } from "@/lib/degradar";
import { PanelNoDisponible } from "@/components/admin/panel-no-disponible";
import { ETIQUETA_ROL, inicioDelRol, puedeEntrar } from "@/lib/roles";
import { SaltarAlContenido } from "@/components/saltar-al-contenido";
import { headers } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { AdminSidebar } from "@/components/admin/sidebar";
import { AvisoSinAcceso } from "@/components/admin/aviso-sin-acceso";
import { rebote } from "@/components/admin/secciones";
import { BuscadorGlobal } from "@/components/admin/buscador-global";
import { TablasApilables } from "@/components/admin/tablas-apilables";
import { MenuUsuario } from "@/components/admin/menu-usuario";
import {
  ActivityBell,
  ActivityBellSkeleton,
} from "@/components/admin/activity-bell";
import { ThemeToggle } from "@/components/theme-toggle";
import { EnterAvanza } from "@/components/admin/enter-avanza";
import { AvisoDePedidosEnVivo } from "@/components/vivo/aviso-pedidos";
import { requireStaff } from "@/lib/dal/session";
import { conversacionesSinLeer } from "@/lib/dal/admin/whatsapp";
import { nombreDelCircuito } from "@/lib/dal/circuito";
import { ProveedorDelCircuito } from "@/components/admin/circuito";

/**
 * El panel se puede instalar.
 *
 * No es un capricho: en el teléfono, **el permiso de notificaciones de iPhone
 * solo existe si la aplicación está agregada a la pantalla de inicio**, y los
 * avisos de venta son justamente lo que la clienta pidió. El manifiesto se
 * declara acá y no en `app/manifest.ts` para que el sitio público no le ofrezca
 * a los clientes instalarse el panel de administración.
 */
export const metadata: Metadata = {
  manifest: "/admin/app.webmanifest",
  robots: { index: false, follow: false },
};

/*
 * Todo lo que cuelga de acá depende de quién entró: no hay navegación que se
 * pueda armar antes de leer la sesión. Con Cache Components, Next 16.4 valida
 * en desarrollo que cada navegación sea instantánea y marcaba casi todas las
 * pantallas («encountered uncached data during prerendering», con el overlay
 * encima). Es la salida que da su guía de autenticación
 * (node_modules/next/dist/docs/01-app/02-guides/authentication-with-cache-components.md):
 * este segmento puede esperar a la sesión. No cambia producción: la
 * validación corre solo en `next dev`, y la ruta sigue haciendo streaming
 * con su `<Suspense>` y su `loading.tsx`.
 */
export const instant = false;

/** Iniciales para el avatar: "Juan Pérez" -> "JP". */
function iniciales(nombre: string) {
  return nombre
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * El panel entero depende de quién entró, así que no tiene una parte que se
 * pueda armar de antemano.
 *
 * Con Cache Components, leer la sesión fuera de un `<Suspense>` frena el build:
 * Next exige decir qué se muestra mientras tanto. Lo que se muestra es la
 * silueta del panel —la columna del menú y la barra de arriba—, que es lo
 * mismo que se veía antes durante el instante en que se resolvía la sesión,
 * solo que ahora sale en el primer byte en vez de una página en blanco.
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<SiluetaDelPanel />}>
      <PanelConSesion>{children}</PanelConSesion>
    </Suspense>
  );
}

async function PanelConSesion({
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

  /*
   * La excepción del aserradero **acota, no habilita**: le abre la puerta de
   * `/admin/cortes` y después la lista decide igual que para todos. Cuando era
   * un `else if`, esa rama no consultaba `ACCESO` en absoluto y se llevaba
   * puesta `/admin/cortes/tarifas`, que está declarada solo para el admin
   * porque una tarifa de corte es un precio: fija cuánto entra por caja. El
   * operario de la seccionadora podía cambiarla.
   */
  if (
    usuario.staffRole === "aserradero" &&
    !ruta.startsWith("/admin/cortes") &&
    // La ayuda también, porque es de todo el personal y no estaba declarada en
    // `ACCESO`: la excepción se la llevaba puesta y el aserradero quedaba sin
    // poder abrir una guía. La 8 —"Cortes y WhatsApp"— está escrita para él.
    !ruta.startsWith("/admin/ayuda")
  ) {
    redirect(rebote("/taller", ruta));
  }

  if (ruta && !puedeEntrar(ruta, usuario.staffRole)) {
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
    // Con la ruta que no pudo abrir: el inicio avisa a qué no tiene acceso
    // (comité final, «Permisos»: el rebote no decía por qué).
    redirect(rebote(inicioDelRol(usuario.staffRole), ruta));
  }

  // El contador de conversaciones sin leer es un adorno del menú: si falla, el
  // panel tiene que abrirse igual y sin la pelotita.
  const [sinLeer, circuito] = await Promise.all([
    degradar("las conversaciones sin leer", conversacionesSinLeer, 0),
    // La palabra del circuito sin factura (H167); si falla, la de arranque.
    degradar("el nombre del circuito", nombreDelCircuito, "b" as const),
  ]);

  return (
    <div className="panel flex min-h-screen bg-background text-foreground">
      <SaltarAlContenido />
      {/* Enter pasa al campo siguiente en todas las pantallas de carga. Va
          una vez acá y no formulario por formulario: la regla es la misma en
          las veinte pantallas y repetirla garantizaba que tres quedaran
          distintas. Ver `lib/teclado/avance.ts`. */}
      <EnterAvanza />
      <TablasApilables />
      <AvisoDePedidosEnVivo />
      <Suspense fallback={null}>
        <AvisoSinAcceso />
      </Suspense>
      <AdminSidebar whatsappSinLeer={sinLeer} rol={usuario.staffRole} />
      {/* `min-w-0` no es decorativo: sin él este hijo de flex no baja del ancho
          de su contenido, así que el `overflow-x` del tablero no recorta nada y
          el documento entero se estira. Con el menú lateral fijo y la barra
          superior pegajosa, eso se ve como que el panel se desarma. */}
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="textura sticky top-0 z-30 flex h-[60px] items-center gap-2 border-b border-linea bg-background/90 px-4 backdrop-blur-lg sm:gap-4 lg:px-7">
          <div className="flex min-w-0 max-w-[420px] flex-1 items-center gap-3 pl-12 lg:pl-0">
            <BuscadorGlobal
              queBusca={usuario.staffRole === "aserradero" ? "Buscar corte o pedido…" : undefined}
            />
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3.5">
            {/* El interruptor de tema también acá: el único que había estaba en
                el navbar público, así que quien entraba al panel en modo oscuro
                no tenía desde dónde volver. */}
            {/* En el teléfono el buscador necesita ese lugar: el tema se cambia
                desde una pantalla ancha y queda guardado. */}
            <div className="hidden sm:block">
              <ThemeToggle />
            </div>
            {/* La actividad sale de la bitácora, que es del admin: para los
                otros roles la API da 403, y como el encabezado está en todas
                las pantallas, ese 403 tiraba abajo el panel entero. */}
            {puedeEntrar("/admin/bitacora", usuario.staffRole) && (
              <Suspense fallback={<ActivityBellSkeleton />}>
                <ActivityBell />
              </Suspense>
            )}
            <div className="border-l border-linea pl-2 sm:pl-3.5">
              <MenuUsuario
                nombre={usuario.name}
                iniciales={iniciales(usuario.name)}
                rol={ETIQUETA_ROL[usuario.staffRole!]}
                esAdmin={usuario.staffRole === "admin"}
              />
            </div>
          </div>
        </header>
        <main id="contenido" className="panel-fondo flex-1 px-4 py-[26px] pb-10 lg:px-7">
          {/*
           * El armazón del panel —menú, encabezado, campana— se sirve al
           * instante y la pantalla se completa cuando la base contesta.
           *
           * Antes cada pantalla del panel esperaba a sus consultas antes de
           * pintar nada: con una consulta lenta, la persona miraba una página
           * en blanco sin saber si había entrado. El menú aparece primero, que
           * además es lo que permite cambiar de sección sin esperar.
           */}
          <ProveedorDelCircuito nombre={circuito}>
            <Suspense fallback={<CargandoPantalla />}>{children}</Suspense>
          </ProveedorDelCircuito>
        </main>
      </div>
    </div>
  );
}

/** El armazón del panel antes de saber quién entró. */
function SiluetaDelPanel() {
  return (
    <div className="panel flex min-h-screen bg-background text-foreground" aria-busy="true">
      <span className="sr-only">Cargando el panel…</span>
      <div className="textura sticky top-0 hidden h-screen w-[244px] shrink-0 border-r border-sidebar-border bg-sidebar lg:block" />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <div className="h-[60px] border-b border-linea" />
        <div className="panel-fondo flex-1 px-4 py-[26px] lg:px-7">
          <CargandoPantalla />
        </div>
      </div>
    </div>
  );
}

/** Lo que se ve mientras la pantalla trae sus datos. */
function CargandoPantalla() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Cargando la pantalla…</span>
      <div className="h-8 w-56 animate-pulse rounded-lg bg-hundida" />
      <div className="h-[280px] animate-pulse rounded-xl bg-hundida" />
    </div>
  );
}
