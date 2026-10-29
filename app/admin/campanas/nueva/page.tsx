import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { requireStaffRole } from "@/lib/dal/session";
import { RUBROS_CLIENTE } from "@/lib/rubros-cliente";
import { SEGMENTO_TODOS } from "@/lib/campanas/segmento";
import { estadoDeCampanas } from "@/lib/dal/admin/campanas";
import { EditorDeCampana } from "../editor";

export const metadata: Metadata = { title: "Nueva campaña" };

export default async function NuevaCampanaPage() {
  await requireStaffRole("admin");
  const { motivo } = await estadoDeCampanas();
  return (
    <div>
      <Link href="/admin/campanas" className="mb-3 inline-flex items-center gap-1.5 text-base text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Campañas
      </Link>
      <EncabezadoPanel titulo="Nueva campaña" detalle="Se guarda como borrador hasta que la envíes o la programes." />
      <EditorDeCampana
        inicial={{ asunto: "", adelanto: "", cuerpo: "", imagenUrl: "", botonTexto: "", botonUrl: "", segmento: SEGMENTO_TODOS }}
        rubros={RUBROS_CLIENTE.map((r) => ({ valor: r.valor, etiqueta: r.etiqueta }))}
        impedimento={motivo}
      />
    </div>
  );
}
