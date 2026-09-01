import { Suspense } from "react";
import { SaltarAlContenido } from "@/components/saltar-al-contenido";
import { enlaceWhatsapp } from "@/lib/whatsapp/enlace";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { ScrollToTop } from "@/components/scroll-to-top";
import { CarritoProvider } from "@/lib/carrito-context";
import { CARRITO_VACIO, obtenerCarrito } from "@/lib/dal/carrito";
import { getSession } from "@/lib/dal/session";
import { ajustesDelSitio } from "@/lib/dal/contenido";
import { listarSucursalesPublicas } from "@/lib/dal/envios";
import { DatosEstructurados } from "@/components/datos-estructurados";
import { organizacionJsonLd, sitioWebJsonLd } from "@/lib/seo";
import { degradar } from "@/lib/degradar";

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // El presupuesto se lee acá una sola vez y baja a toda la sección: así el
  // contador del menú y la página del presupuesto muestran siempre lo mismo.
  // La sesión va por el mismo camino: memoizada, y resuelta en el servidor para
  // que el menú no parpadee entre "Ingresar" y el nombre.
  //
  // Todo lo que es adorno del encabezado va envuelto en `degradar`: un error
  // acá adentro no lo agarra el `error.tsx` de esta carpeta —sube hasta el
  // global y reemplaza el documento entero—, así que el teléfono de la barra no
  // puede tener el poder de dejar el sitio sin marca ni navegación.
  //
  // La sesión también va envuelta, y no es una excepción a la regla de que lo
  // que decide acceso no se degrada: acá la sesión no decide nada. Se usa solo
  // para poner el nombre en el menú. Quién puede ver qué lo resuelve cada
  // página con su propio control, del lado del DAL. Si la lectura falla, el
  // menú dice "Ingresar", que es el lado seguro: muestra de menos, no de más.
  const [carrito, sesion, ajustes, sucursales, whatsapp] = await Promise.all([
    degradar("el presupuesto", obtenerCarrito, CARRITO_VACIO),
    degradar("la sesión del menú", getSession, null),
    degradar("los ajustes del sitio", ajustesDelSitio, {}),
    degradar("las sucursales", listarSucursalesPublicas, []),
    degradar("el enlace de WhatsApp", () => enlaceWhatsapp(), ""),
  ]);

  // El teléfono y el horario de la barra superior salen de la primera sucursal
  // publicada —Casa Central por orden— y no de una constante. Es la misma
  // fuente que usa el pie y la página de contacto; tenerlos escritos a mano era
  // cómo el sitio seguía mostrando un teléfono ya corregido en el panel.
  const principal = sucursales[0] ?? null;

  // La organización va en todas las páginas y no solo en la portada: las
  // ofertas de cada producto y las fichas de cada sucursal apuntan a este nodo
  // por `@id`, y una referencia a un nodo que no está en la página es una
  // advertencia en Search Console.
  const marcado = [
    organizacionJsonLd({
      descripcion:
        "Maderera en Mar del Plata desde 1981. Techos, placas, pisos, molduras Moldava, decks, construcción en seco y ferretería.",
      telefono: ajustes.whatsapp_principal ? `+${ajustes.whatsapp_principal}` : null,
      email: "info@mjbj.com.ar",
      redes: [
        "https://facebook.com/madererajbjusto",
        "https://instagram.com/madererajbjusto",
      ],
    }),
    sitioWebJsonLd(),
  ];

  return (
    <CarritoProvider carrito={carrito}>
      <SaltarAlContenido />
      <DatosEstructurados datos={marcado} />
      <Navbar
        sesion={
          sesion
            ? { nombre: sesion.name, esStaff: sesion.role === "staff" }
            : null
        }
        telefono={principal?.telefono}
        horario={principal?.horario}
      />
      <main id="contenido" className="flex-1">
        {children}
      </main>
      <Footer />
      <ScrollToTop />
      <Suspense fallback={null}>
        <WhatsAppButton enlace={`${whatsapp}?text=${encodeURIComponent("Hola! Quisiera consultar sobre...")}`} />
      </Suspense>
    </CarritoProvider>
  );
}
