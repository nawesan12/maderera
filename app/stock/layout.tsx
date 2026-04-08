import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Stock entre Sucursales | Maderera Juan B. Justo",
  description:
    "Consultá la disponibilidad de productos en tiempo real en Casa Central y Aserradero. Más de 200 productos con stock visible por sucursal.",
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
