import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { obtenerCarrito } from "@/lib/dal/carrito";
import { listarSucursalesPublicas, listarZonasDeEnvio } from "@/lib/dal/envios";
import { getSession } from "@/lib/dal/session";
import {
  clienteDeLaSesion,
  creditoDisponible,
  misDirecciones,
} from "@/lib/dal/cuenta";
import { FormularioCheckout } from "./formulario";

export const metadata: Metadata = {
  title: "Finalizar compra",
  description: "Confirmá tu pedido en Maderera Juan B. Justo.",
  robots: { index: false, follow: false },
};

export default async function CheckoutPage() {
  const carrito = await obtenerCarrito();

  // Sin nada en el presupuesto no hay nada que confirmar.
  if (carrito.items.length === 0) redirect("/presupuesto");

  const [zonas, sucursales, sesion, cliente, credito, direcciones] =
    await Promise.all([
      listarZonasDeEnvio(),
      listarSucursalesPublicas(),
      getSession(),
      clienteDeLaSesion(),
      // Se consulta con el subtotal: el envío todavía no se eligió, así que el
      // margen que se muestra es el de antes del flete. La acción vuelve a
      // verificar con el total final.
      creditoDisponible(carrito.subtotal),
      misDirecciones(),
    ]);

  return (
    <div className="min-h-screen bg-brand-cream/30">
      <div className="bg-brand-gray py-10 text-white">
        <div className="contenedor">
          <Link
            href="/presupuesto"
            className="mb-3 inline-flex items-center gap-2 text-sm text-white/70 transition-colors hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver al presupuesto
          </Link>
          <h1 className="text-3xl font-bold">Finalizar compra</h1>
          <p className="text-white/70">
            Completá tus datos y elegí cómo lo querés recibir.
          </p>
        </div>
      </div>

      <div className="contenedor py-8">
        <FormularioCheckout
          items={carrito.items.map((i) => ({
            id: i.id,
            descripcion: i.descripcion,
            unidad: i.unidad,
            cantidad: i.cantidad,
            subtotal: i.subtotal,
          }))}
          subtotal={carrito.subtotal}
          zonas={zonas}
          sucursales={sucursales}
          datosIniciales={{
            nombre: cliente?.nombre ?? sesion?.name ?? "",
            email: cliente?.email ?? sesion?.email ?? "",
            telefono: cliente?.telefono ?? "",
          }}
          cuentaCorriente={{
            habilitado: credito.habilitado,
            disponible: credito.disponible,
            motivo: credito.motivo,
          }}
          direcciones={direcciones.map((d) => ({
            id: d.id,
            etiqueta: d.etiqueta,
            calle: d.calle,
            localidad: d.localidad,
            notas: d.notas,
            predeterminada: d.predeterminada,
          }))}
        />
      </div>
    </div>
  );
}
