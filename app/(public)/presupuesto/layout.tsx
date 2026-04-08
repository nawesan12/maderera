import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Presupuesto Online Sin Cargo",
  description:
    "Armá tu lista de materiales y recibí un presupuesto sin cargo por email o WhatsApp. Retirá en Casa Central o Aserradero en Mar del Plata.",
  keywords: [
    "presupuesto madera",
    "presupuesto sin cargo",
    "materiales construcción mar del plata",
    "presupuesto online maderera",
  ],
  openGraph: {
    title: "Presupuesto Online Sin Cargo",
    description:
      "Presupuestos sin cargo para tu obra. Armá tu lista online y recibí respuesta en 24hs.",
  },
};

export default function PresupuestoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
