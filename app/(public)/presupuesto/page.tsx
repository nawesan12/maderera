import type { Metadata } from "next";
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
  const [sucursales, sesion, cliente, profesional] = await Promise.all([
    listarSucursalesPublicas(),
    getSession(),
    clienteDeLaSesion(),
    estadoProfesional(),
  ]);

  return (
    <VistaPresupuesto
      sucursales={sucursales.map((s) => ({ id: s.id, nombre: s.nombre }))}
      contacto={{
        nombre: cliente?.nombre ?? sesion?.name,
        email: cliente?.email ?? sesion?.email,
        telefono: cliente?.telefono,
      }}
      esProfesional={profesional.aprobado}
    />
  );
}
