import type { Metadata } from "next";
import { numeroWhatsapp } from "@/lib/whatsapp/enlace";
import { ProductCard } from "@/components/product-card";
import { complementosDelCarrito } from "@/lib/dal/catalog";
import { obtenerCarrito } from "@/lib/dal/carrito";
import { CarritoProvider } from "@/lib/carrito-context";
import { getSession } from "@/lib/dal/session";
import { clienteDeLaSesion } from "@/lib/dal/cuenta";
import { listarSucursalesPublicas } from "@/lib/dal/envios";
import { estadoProfesional } from "@/lib/dal/profesionales";
import { VistaPresupuesto } from "./vista";

export const metadata: Metadata = {
  title: "Tu presupuesto",
  description:
    "Armá tu presupuesto de materiales y pedilo por escrito. Te contestamos con el detalle y los precios cerrados.",
};

/**
 * El presupuesto en curso.
 *
 * La pantalla es de cliente —cantidades que suben y bajan al instante—, así que
 * acá solo se resuelve lo que necesita del servidor: las sucursales, los datos
 * de quien está mirando para no hacerle tipear lo que ya sabemos, y si le
 * corresponde la cola express.
 */
export default async function PresupuestoPage() {
  const [sucursales, sesion, cliente, profesional, carrito, whatsapp] =
    await Promise.all([
      listarSucursalesPublicas(),
      getSession(),
      clienteDeLaSesion(),
      estadoProfesional(),
      obtenerCarrito(),
      numeroWhatsapp(),
    ]);

  const complementos = await complementosDelCarrito(
    carrito.items
      .map((i) => i.variantId)
      .filter((id): id is string => id !== null),
  );

  return (
    // El presupuesto sí necesita el carrito entero y resuelto: es lo que la
    // pantalla muestra. Esta página es dinámica por eso mismo, así que lo lee
    // del servidor y lo baja por su cuenta, en vez de esperar a que el
    // navegador lo traiga como hace el resto del sitio.
    <CarritoProvider carrito={carrito}>
      <VistaPresupuesto
        sucursales={sucursales.map((s) => ({ id: s.id, nombre: s.nombre }))}
        contacto={{
          nombre: cliente?.nombre ?? sesion?.name,
          email: cliente?.email ?? sesion?.email,
          telefono: cliente?.telefono,
        }}
        esProfesional={profesional.aprobado}
        whatsapp={whatsapp}
      />

      {complementos.length > 0 && (
        <section className="contenedor pb-16">
          <div className="mb-5">
            <h2 className="text-xl font-bold">También vas a necesitar</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Lo que suele ir junto con lo que ya tenés en el presupuesto.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {complementos.map((p) => (
              <ProductCard key={p.id} product={p} whatsapp={whatsapp} />
            ))}
          </div>
        </section>
      )}
    </CarritoProvider>
  );
}
