import { Suspense } from "react";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { ScrollToTop } from "@/components/scroll-to-top";
import { CarritoProvider } from "@/lib/carrito-context";
import { obtenerCarrito } from "@/lib/dal/carrito";
import { getSession } from "@/lib/dal/session";

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // El presupuesto se lee acá una sola vez y baja a toda la sección: así el
  // contador del menú y la página del presupuesto muestran siempre lo mismo.
  // La sesión va por el mismo camino: memoizada, y resuelta en el servidor para
  // que el menú no parpadee entre "Ingresar" y el nombre.
  const [carrito, sesion] = await Promise.all([obtenerCarrito(), getSession()]);

  return (
    <CarritoProvider carrito={carrito}>
      <Navbar
        sesion={
          sesion
            ? { nombre: sesion.name, esStaff: sesion.role === "staff" }
            : null
        }
      />
      <main className="flex-1">{children}</main>
      <Footer />
      <ScrollToTop />
      <Suspense fallback={null}>
        <WhatsAppButton />
      </Suspense>
    </CarritoProvider>
  );
}
