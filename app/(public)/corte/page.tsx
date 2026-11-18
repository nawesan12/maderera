import type { Metadata } from "next";
import { DatosEstructurados } from "@/components/datos-estructurados";
import { metadatosDePagina, migasJsonLd } from "@/lib/seo";
import Link from "next/link";
import { placasCortablesPublicas, tapacantosDelCatalogo } from "@/lib/dal/cortes-publico";
import { anchoDeSierra } from "@/lib/dal/sierra";
import { VistaDeCorteDeQuienMira } from "./vista";
import { preciosDePlacas } from "@/lib/dal/visitante";
import { listarSucursalesPublicas } from "@/lib/dal/envios";
import { DONDE_SE_CORTA } from "@/lib/sucursales";

export const metadata: Metadata = {
  ...metadatosDePagina({
    titulo: "Corte de placas a medida en Mar del Plata",
    descripcion:
      `Armá tu despiece en milímetros, elegí el canto de cada pieza y mirá cómo entra en la placa. Melamina, MDF, fenólicos y tableros cortados ${DONDE_SE_CORTA.frase}.`,
    ruta: "/corte",
  }),
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
   * A precio de público, y por eso esta pantalla se puede armar de antemano.
   *
   * El armador es la pantalla más pesada del sitio y la que más CPU consume por
   * visita; que además se armara de nuevo cada vez, solo para saber qué lista
   * de precios corresponde, era pagar dos veces. El precio del profesional
   * llega aparte, en la misma respuesta: ver `VistaDeCorteDeQuienMira`.
   */
  const [placas, sierra, sucursales, tapacantos] = await Promise.all([
    placasCortablesPublicas(),
    anchoDeSierra(),
    listarSucursalesPublicas(),
    tapacantosDelCatalogo(),
  ]);

  return (
    <div className="bg-sitio-alt">
      <DatosEstructurados
        datos={migasJsonLd([
          { nombre: "Inicio", ruta: "/" },
          { nombre: "Corte a medida", ruta: "/corte" },
        ])}
      />
      {/* El armador es una herramienta de trabajo: ocupa el ancho entero y el
          título va en su propia barra, junto a la cuenta del pedido. */}
      <div className="mx-auto max-w-[1680px] px-4 py-5 lg:px-6">
        {placas.length === 0 ? (
          <>
          <h1 className="text-[30px] font-bold tracking-[-0.03em]">Corte de placas a medida</h1>
          <p className="mt-4 rounded-xl superficie px-5 py-6 text-base">
            Por ahora el corte a medida se cotiza por WhatsApp o en el
            mostrador.{" "}
            <Link href="/contacto" className="font-medium underline underline-offset-2">
              Escribinos
            </Link>{" "}
            y te pasamos el precio con tu despiece.
          </p>
          </>
        ) : (
          <div>
            <VistaDeCorteDeQuienMira
              // Sin esperar: la pantalla sale armada y solo el precio espera.
              precios={preciosDePlacas()}
              placas={placas}
              tapacantos={tapacantos}
              anchoSierra={sierra}
              sucursales={sucursales.map((s) => ({ slug: s.slug, nombre: s.nombre, whatsapp: s.whatsapp }))}
            />
          </div>
        )}

      </div>
    </div>
  );
}
