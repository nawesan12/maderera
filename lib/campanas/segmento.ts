import { etiquetaDeRubro } from "@/lib/rubros-cliente";
import type { SegmentoCampana } from "@/lib/db/schema/campanas";

export const SEGMENTO_TODOS: SegmentoCampana = { tipo: "todos", rubros: [], actividad: null };

/** El segmento en castellano, para la lista y la confirmación de envío. */
export function describirSegmento(s: SegmentoCampana): string {
  const quienes =
    s.tipo === "profesional"
      ? "Profesionales"
      : s.tipo === "particular"
        ? "Particulares"
        : "Todos los clientes";
  const partes = [quienes];
  if (s.rubros.length > 0) {
    partes.push(`de ${s.rubros.map((r) => etiquetaDeRubro(r).toLowerCase()).join(", ")}`);
  }
  if (s.actividad) {
    const meses = `${s.actividad.meses} ${s.actividad.meses === 1 ? "mes" : "meses"}`;
    partes.push(
      s.actividad.tipo === "compraron"
        ? `que compraron en los últimos ${meses}`
        : `que no compran hace más de ${meses}`,
    );
  }
  return partes.join(" ") + " con correo";
}

/** Lo que llega del formulario, sano: rubros conocidos, meses entre 1 y 60. */
export function leerSegmento(datos: {
  tipo?: string | null;
  rubros?: string[];
  actividad?: string | null;
  meses?: string | number | null;
}, rubrosValidos: readonly string[]): SegmentoCampana {
  const tipo =
    datos.tipo === "particular" || datos.tipo === "profesional" ? datos.tipo : "todos";
  const rubros = [...new Set((datos.rubros ?? []).filter((r) => rubrosValidos.includes(r)))];
  const meses = Math.round(Number(datos.meses));
  const actividad =
    (datos.actividad === "compraron" || datos.actividad === "sinComprar") &&
    Number.isFinite(meses) &&
    meses >= 1 &&
    meses <= 60
      ? { tipo: datos.actividad as "compraron" | "sinComprar", meses }
      : null;
  return { tipo, rubros, actividad };
}
