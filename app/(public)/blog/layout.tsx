import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Blog - Tips y Novedades",
  description:
    "Guías, tips y novedades sobre madera, construcción y carpintería. Aprendé a elegir materiales, optimizar cortes y más.",
  keywords: [
    "blog madera",
    "tips construcción",
    "guía machimbre",
    "elegir madera techo",
    "optimizar cortes placas",
  ],
};

export default function BlogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
