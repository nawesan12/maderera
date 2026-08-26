import type { Metadata } from "next";
import Link from "next/link";
import { Calculator } from "lucide-react";
import { DatosEstructurados } from "@/components/datos-estructurados";
import { migasJsonLd } from "@/lib/seo";
import { Calculadoras } from "./calculadoras";

/**
 * Calculadora de materiales.
 *
 * La página era de cliente entera para poder usar los cuatro formularios. Lo
 * interactivo es solo la parte de abajo, así que ahora vive en su propia isla
 * (`calculadoras.tsx`) y todo lo demás —encabezado, texto, metadata, migas—
 * se arma en el servidor.
 *
 * No es una optimización de vitrina: esta es la página que más gente busca sin
 * conocer la maderera ("cuántas placas necesito"), y suele abrirse desde un
 * teléfono en una obra.
 */

export const metadata: Metadata = {
  title: "Calculadora de materiales",
  description:
    "Calculá los materiales exactos para tu proyecto: techos, placas, pisos y decks. Herramienta gratuita. Los resultados se agregan directo al presupuesto.",
  keywords: [
    "calculadora madera",
    "calcular materiales techo",
    "cuantas placas necesito",
    "calculadora pisos",
    "calculadora deck",
    "materiales construccion",
  ],
  alternates: { canonical: "/calculadora" },
  openGraph: {
    title: "Calculadora de materiales",
    description:
      "Herramienta gratuita para calcular materiales de construcción: techos, placas, pisos y decks.",
  },
};

export default function CalculadoraPage() {
  return (
    <div className="min-h-screen">
      <DatosEstructurados
        datos={migasJsonLd([
          { nombre: "Inicio", ruta: "/" },
          { nombre: "Calculadora de materiales", ruta: "/calculadora" },
        ])}
      />

      <section className="bg-brand-gray py-16">
        <div className="container mx-auto px-4">
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-brand-orange">
            <Calculator className="h-4 w-4" />
            Herramienta gratuita
          </p>
          <h1 className="mb-4 text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Calculadora de <span className="text-brand-orange">materiales</span>
          </h1>
          <p className="max-w-xl text-lg text-white/60">
            Ingresá las dimensiones de tu proyecto y obtené la lista exacta de
            materiales. Los resultados se agregan directo al presupuesto.
          </p>
        </div>
      </section>

      <Calculadoras />

      <section className="border-t bg-muted/30 py-12">
        <div className="container mx-auto max-w-3xl px-4">
          <h2 className="mb-3 text-xl font-semibold">
            Cómo usar los resultados
          </h2>
          <p className="text-muted-foreground">
            Los cálculos incluyen el desperdicio habitual de cada tipo de
            trabajo, así que el número que sale es el que hay que comprar, no el
            teórico. Aun así conviene revisarlo con quien va a hacer la obra:
            una pendiente distinta o un solape mayor cambian las cantidades.
          </p>
          <p className="mt-3 text-muted-foreground">
            Cuando tengas la lista armada, mandala como{" "}
            <Link href="/presupuesto" className="font-medium text-brand-orange hover:underline">
              pedido de presupuesto
            </Link>{" "}
            y te confirmamos precios y disponibilidad, o revisá primero el{" "}
            <Link href="/stock" className="font-medium text-brand-orange hover:underline">
              stock por sucursal
            </Link>
            .
          </p>
        </div>
      </section>
    </div>
  );
}
