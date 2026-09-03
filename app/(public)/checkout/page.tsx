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
import { enlaceWhatsapp } from "@/lib/whatsapp/enlace";
import { FormularioCheckout } from "./formulario";
import { ACotizar } from "./a-cotizar";

export const metadata: Metadata = {
  title: "Finalizar compra",
  description: "Confirmá tu pedido en Maderera Juan B. Justo.",
  robots: { index: false, follow: false },
};

export default async function CheckoutPage() {
  const carrito = await obtenerCarrito();

  // Sin nada en el presupuesto no hay nada que confirmar.
  if (carrito.items.length === 0) redirect("/presupuesto");

  // Los productos sin precio se separan **antes** de armar el formulario. La
  // acción que confirma el pedido los sigue rechazando —es la que decide, y no
  // puede confiar en que la pantalla haya filtrado—, pero nadie llega hasta ahí
  // para enterarse: si no hay nada con precio, esta página ni siquiera muestra
  // campos que completar.
  const aCotizar = carrito.items.filter(
    (i) => (i.precioActual ?? i.precioUnitario ?? 0) <= 0,
  );
  const conPrecio = carrito.items.filter(
    (i) => (i.precioActual ?? i.precioUnitario ?? 0) > 0,
  );

  const enlaceCotizacion =
    aCotizar.length > 0
      ? await enlaceWhatsapp(
          `Hola! Quisiera cotizar:\n${aCotizar
            .map(
              (i) =>
                `• ${i.descripcion} — ${i.cantidad} ${i.unidad.replace("_", " ")}`,
            )
            .join("\n")}`,
        )
      : "";

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
    <div className="min-h-screen bg-sitio-alt">
      {/* Sin banda oscura, igual que el presupuesto: el checkout es una sola
          tarea y un encabezado grande le saca lugar al formulario. */}
      <div className="contenedor pt-10">
        <Link
          href="/presupuesto"
          className="inline-flex items-center gap-2 text-sm text-texto-2 transition-colors hover:text-acento-texto"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver al presupuesto
        </Link>
        <h1 className="mt-3 text-[34px] font-bold tracking-[-0.03em]">
          Finalizar compra
        </h1>
        <p className="mt-1.5 text-base text-texto-2">
          Tus datos, cómo lo recibís y cómo pagás. Nada más.
        </p>
      </div>

      <div className="contenedor space-y-5 pb-[70px] pt-6">
        {aCotizar.length > 0 && (
          <div className="mx-auto max-w-[560px] lg:mx-0 lg:max-w-[560px]">
            <ACotizar
              items={aCotizar.map((i) => ({
                id: i.id,
                descripcion: i.descripcion,
                unidad: i.unidad,
                cantidad: i.cantidad,
              }))}
              enlace={enlaceCotizacion}
              hayOtros={conPrecio.length > 0}
            />
          </div>
        )}

        {conPrecio.length > 0 && (
        <FormularioCheckout
          // Solo los que tienen precio: el resumen de la derecha es lo que se
          // va a cobrar, y listar ahí un producto sin importe deja un total que
          // no cierra con lo que se ve.
          items={conPrecio.map((i) => ({
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
        )}
      </div>
    </div>
  );
}
