import type { Metadata } from "next";
import { misDirecciones } from "@/lib/dal/cuenta";
import { GestorDirecciones } from "./gestor";

export const metadata: Metadata = { title: "Direcciones" };

export default async function DireccionesPage() {
  const direcciones = await misDirecciones();

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Mis direcciones</h1>
        <p className="mt-1 text-muted-foreground">
          Las guardás una vez y las elegís en el checkout, sin volver a
          tipearlas.
        </p>
      </header>

      <GestorDirecciones
        direcciones={direcciones.map((d) => ({
          id: d.id,
          etiqueta: d.etiqueta,
          calle: d.calle,
          localidad: d.localidad,
          codigoPostal: d.codigoPostal,
          notas: d.notas,
          predeterminada: d.predeterminada,
        }))}
      />
    </div>
  );
}
