import { Suspense } from "react";
import { SaltarAlContenido } from "@/components/saltar-al-contenido";
import { enlaceWhatsapp } from "@/lib/whatsapp/enlace";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { ScrollToTop } from "@/components/scroll-to-top";
import { CarritoProvider } from "@/lib/carrito-context";
import { EstadoProvider } from "@/lib/estado-context";
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
  // **Este layout no lee ni la sesión ni el presupuesto, y es a propósito.**
  //
  // Leerlos significa leer cookies, y una página que lee cookies se arma en el
  // servidor en cada visita: no hay forma de guardarla en el CDN, porque el
  // resultado es distinto para cada persona. Eso valía para todo el sitio
  // —incluidas "Quiénes somos" y el blog, iguales para cualquiera— nada más que
  // porque el menú de arriba tenía que decir un nombre.
  //
  // Ahora el nombre y el contador los completa el navegador (`EstadoProvider`),
  // y solo cuando hay algo que completar. Lo que queda acá es lo que es igual
  // para todo el mundo, cacheado entre visitas: los datos del negocio, las
  // sucursales y el número de WhatsApp.
  //
  // Todo va envuelto en `degradar`: un error acá adentro no lo agarra el
  // `error.tsx` de esta carpeta —sube hasta el global y reemplaza el documento
  // entero—, así que el teléfono de la barra no puede tener el poder de dejar
  // el sitio sin marca ni navegación.
  const [ajustes, sucursales, whatsapp] = await Promise.all([
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
    <EstadoProvider>
    <CarritoProvider>
      <SaltarAlContenido />
      <DatosEstructurados datos={marcado} />
      <Navbar
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
    </EstadoProvider>
  );
}
