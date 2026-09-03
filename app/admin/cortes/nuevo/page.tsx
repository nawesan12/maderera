import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { listarSucursalesPublicas } from "@/lib/dal/envios";
import { requireStaff } from "@/lib/dal/session";
import { FormularioCorte } from "./formulario";

export const metadata = { title: "Nuevo corte" };

/**
 * Alta de una orden de corte.
 *
 * El tablero sabía mover órdenes y exportarlas al optimizador, pero ninguna
 * parte del sistema podía crear una: las que había las puso el sembrado de
 * datos de prueba.
 */
export default async function NuevoCortePage() {
  await requireStaff();
  const sucursales = await listarSucursalesPublicas();

  return (
    <div className="space-y-6">
      <Link
        href="/admin/cortes"
        className="inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-5 w-5" />
        Volver a cortes
      </Link>

      <div>
        <h1 className="text-3xl font-bold text-foreground">Nuevo corte</h1>
        <p className="mt-1 text-base text-muted-foreground">
          El despiece va en milímetros: son los números que después necesita el
          optimizador de la máquina.
        </p>
      </div>

      <FormularioCorte
        sucursales={sucursales.map((s) => ({ id: s.id, nombre: s.nombre }))}
      />
    </div>
  );
}
