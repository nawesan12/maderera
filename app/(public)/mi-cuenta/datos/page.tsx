import type { Metadata } from "next";
import { Mail } from "lucide-react";
import { verifySession } from "@/lib/dal/session";
import { clienteDeLaSesion } from "@/lib/dal/cuenta";
import { formatearCuit } from "@/lib/formato";
import { FormularioDatos } from "./formulario";

export const metadata: Metadata = { title: "Mis datos" };

export default async function MisDatosPage() {
  const [sesion, cliente] = await Promise.all([
    verifySession(),
    clienteDeLaSesion(),
  ]);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Mis datos</h1>
        <p className="mt-1 text-muted-foreground">
          Son los datos con los que te contactamos y con los que emitimos tus
          comprobantes.
        </p>
      </header>

      {/* El correo es la identidad de la cuenta y no se edita desde acá: es lo
          que valida el ingreso, y cambiarlo sin verificarlo dejaría a la
          persona afuera de su propia cuenta. */}
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
        <Mail className="h-4 w-4 shrink-0" />
        Ingresás con <span className="font-medium text-foreground">{sesion.email}</span>
        <span className="text-muted-foreground">
          · para cambiarlo, escribinos
        </span>
      </p>

      <FormularioDatos
        nombre={cliente?.nombre ?? sesion.name}
        telefono={cliente?.telefono ?? ""}
        razonSocial={cliente?.razonSocial ?? ""}
        cuit={
          cliente?.cuit ? formatearCuit(cliente.cuit) : ""
        }
        condicionIva={cliente?.condicionIva ?? "consumidor_final"}
      />
    </div>
  );
}
