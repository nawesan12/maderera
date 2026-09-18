import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Ruler } from "lucide-react";
import { placasCortablesPublicas } from "@/lib/dal/cortes-publico";
import { parametrosDeCalculo } from "@/lib/dal/calculadora-parametros";
import { HORARIO_CORTES } from "@/lib/sucursales";
import { VistaDeCorte } from "./vista";

export const metadata: Metadata = {
  title: "Corte a Medida Online",
  description:
    "Armá tu despiece en milímetros, mirá cómo entra en la placa y comprá el corte hecho. Melamina, MDF, fenólicos y tableros, cortados en el aserradero.",
  keywords: [
    "corte a medida",
    "corte de melamina mar del plata",
    "despiece placas",
    "optimizador de corte",
  ],
};

/**
 * El corte a medida, para el cliente.
 *
 * **Por qué está abierto.** Lo pidió la clienta —"los clientes también tienen
 * que poder generar cortes, más simplificado, viendo el dibujito y pudiendo
 * comprarlo"— y la decisión de no pedir cuenta para *ver* es deliberada: el
 * dibujo y el precio son lo que trae gente al sitio. La cuenta se pide recién al
 * comprar, que es cuando hace falta saber a nombre de quién va el trabajo.
 *
 * Es la versión simplificada del alta del panel: la misma geometría, el mismo
 * precio y el mismo dibujo, pero sin acomodo a mano, sin elegir de qué placa
 * sale cada pieza y sin etiquetas por pieza. Lo que el cliente decide es qué
 * placa, qué medidas y si lleva tapacanto.
 *
 * El precio se calcula en el navegador para que se mueva con cada medida que se
 * tipea, y **se vuelve a calcular en el servidor al agregarlo al carrito**: ver
 * `agregarCorteAlCarrito`.
 */
export default async function CortePage() {
  /*
   * A precio de público, y por eso esta pantalla se puede cachear.
   *
   * El armador es la pantalla más pesada del sitio y la que más CPU consume por
   * visita; que además se armara de nuevo cada vez, solo para saber qué lista
   * de precios corresponde, era pagar dos veces. Al profesional se le corrige
   * el precio en el navegador: ver `VistaDeCorte`.
   */
  const [placas, parametros] = await Promise.all([
    placasCortablesPublicas(),
    parametrosDeCalculo(),
  ]);

  return (
    <div className="bg-sitio-alt">
      <div className="contenedor py-10">
        <div className="max-w-2xl">
          <p className="inline-flex items-center gap-2 rounded-full bg-naranja-claro px-3 py-1 text-[13px] font-semibold text-acento-sobre-claro">
            <Ruler className="h-4 w-4" />
            Corte a medida
          </p>
          <h1 className="mt-3 text-[34px] font-bold leading-[1.1] tracking-[-0.03em]">
            Pasá las medidas y mirá cómo entra en la placa
          </h1>
          <p className="mt-2.5 text-base leading-relaxed text-texto-2">
            Elegí la placa, cargá el despiece en milímetros y vas a ver el
            dibujo, cuántas placas hacen falta y cuánto sale, antes de comprar.
            El corte se hace en el aserradero: {HORARIO_CORTES}.
          </p>
        </div>

        {placas.length === 0 ? (
          <p className="mt-8 rounded-xl border border-linea bg-card px-5 py-6 text-base">
            Por ahora el corte a medida se cotiza por WhatsApp o en el
            mostrador.{" "}
            <Link href="/contacto" className="font-medium underline underline-offset-2">
              Escribinos
            </Link>{" "}
            y te pasamos el precio con tu despiece.
          </p>
        ) : (
          <div className="mt-8">
            <VistaDeCorte
              placas={placas}
              anchoSierra={parametros.anchoSierraMm}
            />
          </div>
        )}

        <p className="mt-8 text-sm text-texto-3">
          El plano es una propuesta: el patrón definitivo lo arma el optimizador
          del taller, y puede mejorarlo. Las medidas son en milímetros y el
          precio incluye IVA.{" "}
          <Link href="/calculadora" className="font-medium underline underline-offset-2">
            ¿No sabés cuánto material lleva?
            <ArrowRight className="ml-1 inline h-3.5 w-3.5" />
          </Link>
        </p>
      </div>
    </div>
  );
}
