import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Quiénes Somos - Desde 1981 | Maderera Juan B. Justo",
  description:
    "Empresa familiar fundada en 1981 en Mar del Plata. Más de 40 años proveyendo madera de calidad. Marca propia Moldava con distribución nacional.",
  keywords: [
    "maderera juan b justo historia",
    "moldava molduras",
    "empresa madera mar del plata",
    "maderera desde 1981",
  ],
};

export default function NosotrosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
