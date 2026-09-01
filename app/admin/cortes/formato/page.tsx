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
        detalle="Cómo sale el archivo con la lista de piezas que después se importa en el optimizador."
      />

      <div className="flex items-start gap-3 rounded-lg border bg-muted/40 px-4 py-3">
        <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-brand-orange" />
        <div className="space-y-2 text-base">
          <p>
            <strong>Esto se ajusta contra la máquina, no de memoria.</strong> El
            formato que sale de acá arranca siendo un CSV que abre en Excel y que
            casi cualquier optimizador importa mapeando las columnas a mano.
          </p>
          <p className="text-muted-foreground">
            Para dejarlo fino hace falta saber qué programa usa el taller (Cut
            Rite, Ardis, Corte Certo, Optimik…), su versión, y —sobre todo— tener
            un archivo de trabajo real de ellos para comparar. Con eso se ajustan
            acá las columnas, el separador y la unidad, y se prueba importando
            hasta que entre limpio.
          </p>
        </div>
      </div>

      <EditorDeFormato perfiles={perfiles} />
    </div>
  );
}
