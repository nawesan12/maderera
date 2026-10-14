import type { Metadata } from "next";
import { metadatosDePagina } from "@/lib/seo";

export const metadata: Metadata = {
  ...metadatosDePagina({
    titulo: "Stock por sucursal",
    descripcion:
      "Consultá qué hay disponible en Casa Central y en el Aserradero antes de ir: maderas, placas, molduras y ferretería, con el stock al día.",
    ruta: "/stock",
  }),
  keywords: [
    "stock madera mar del plata",
    "disponibilidad productos maderera",
    "stock sucursales",
  ],
};

export default function StockLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
