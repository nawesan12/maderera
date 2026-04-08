import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Calculadora de Medidas | Maderera Juan B. Justo",
  description:
    "Calculá los materiales exactos para tu proyecto: techos, placas, pisos y decks. Herramienta gratuita online. Agregá resultados directo al presupuesto.",
  keywords: [
    "calculadora madera",
    "calcular materiales techo",
    "cuántas placas necesito",
    "calculadora pisos",
    "calculadora deck",
    "materiales construcción",
  ],
  openGraph: {
    title: "Calculadora de Medidas | Maderera Juan B. Justo",
    description:
      "Herramienta gratuita para calcular materiales de construcción. Techos, placas, pisos y decks.",
  },
};

export default function CalculadoraLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
