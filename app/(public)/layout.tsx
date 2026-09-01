import { Suspense } from "react";
import { enlaceWhatsapp } from "@/lib/whatsapp/enlace";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { ScrollToTop } from "@/components/scroll-to-top";
import { CarritoProvider } from "@/lib/carrito-context";
import { obtenerCarrito } from "@/lib/dal/carrito";
import { getSession } from "@/lib/dal/session";
import { ajustesDelSitio } from "@/lib/dal/contenido";
import { listarSucursalesPublicas } from "@/lib/dal/envios";
import { DatosEstructurados } from "@/components/datos-estructurados";
import { organizacionJsonLd, sitioWebJsonLd } from "@/lib/seo";

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const whatsapp = await enlaceWhatsapp();
  // El presupuesto se lee acá una sola vez y baja a toda la sección: así el
  // contador del menú y la página del presupuesto muestran siempre lo mismo.
  // La sesión va por el mismo camino: memoizada, y resuelta en el servidor para
  // que el menú no parpadee entre "Ingresar" y el nombre.
  const [carrito, sesion, ajustes, sucursales] = await Promise.all([
    obtenerCarrito(),
    getSession(),
    ajustesDelSitio(),
    listarSucursalesPublicas(),
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
      <main className="flex-1">{children}</main>
      <Footer />
      <ScrollToTop />
      <Suspense fallback={null}>
        <WhatsAppButton enlace={`${whatsapp}?text=${encodeURIComponent("Hola! Quisiera consultar sobre...")}`} />
      </Suspense>
    </CarritoProvider>
  );
}
