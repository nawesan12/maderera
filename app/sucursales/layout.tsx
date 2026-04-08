import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sucursales en Mar del Plata | Maderera Juan B. Justo",
  description:
    "Dos sucursales en Mar del Plata: Casa Central en Av. Juan B. Justo 4153 y Aserradero en Canosa 61. Horarios, servicios y contacto directo.",
  keywords: [
    "maderera mar del plata",
    "sucursales maderera",
    "juan b justo 4153",
    "canosa 61",
    "madera mar del plata dirección",
  ],
  openGraph: {
    title: "Sucursales | Maderera Juan B. Justo - Mar del Plata",
    description:
      "Casa Central y Aserradero. Lunes a Viernes 8-16hs, Sábados 8-12hs.",
  },
};

export default function SucursalesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
