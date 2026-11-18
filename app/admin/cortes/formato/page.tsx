import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, TriangleAlert } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { listarPerfiles } from "@/lib/dal/admin/cortes-exportacion";
import { EditorDeFormato } from "./editor";

export const metadata: Metadata = { title: "Formato para la máquina" };

/**
 * Cómo se le arma el archivo al optimizador de la seccionadora.
 *
 * La pantalla existe porque **todavía no vimos un archivo real del taller**.
 * Acertarle al formato que importa el programa de la máquina es prueba y error:
 * se exporta, se importa, se mira qué quedó corrido, se corrige. Con eso escrito
 * en el código haría falta un deploy por intento.
 */
export default async function FormatoDeCortePage() {
  const perfiles = await listarPerfiles();

  return (
    <div className="space-y-6">
      <Link
        href="/admin/cortes"
        className="inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-5 w-5" />
        Volver a cortes
      </Link>

      <EncabezadoPanel
        titulo="Formato para la máquina"
      />

      <div className="flex items-start gap-3 rounded-lg border bg-muted/40 px-4 py-3">
        <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-brand-orange" />
        {/* El formato arranca siendo un CSV que abre en Excel y que casi cualquier
            optimizador importa mapeando las columnas a mano. Para dejarlo fino hace
            falta saber qué programa usa el taller (Cut Rite, Ardis, Corte Certo,
            Optimik…), su versión y un archivo de trabajo real para comparar; con eso
            se ajustan las columnas, el separador y la unidad hasta que entre limpio. */}
        <p className="text-base font-medium">
          Se ajusta contra la máquina, no de memoria.
        </p>
      </div>

      <EditorDeFormato perfiles={perfiles} />
    </div>
  );
}
