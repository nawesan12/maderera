import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Catálogo de Productos",
  description:
    "Explorá nuestro catálogo completo: techos, placas, pisos, molduras, ferretería, decks, construcción en seco y cubiertas. Stock disponible en Mar del Plata.",
  keywords: [
    "madera mar del plata",
    "placas melamina",
    "tirantes pino",
    "machimbre",
    "fenólicos",
    "molduras",
    "decks",
    "construcción en seco",
    "maderera",
  ],
  openGraph: {
    title: "Catálogo de Productos",
    description:
      "Más de 200 productos para construcción y carpintería. Consultá stock en tiempo real entre sucursales.",
  },
};

export default function CatalogoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
