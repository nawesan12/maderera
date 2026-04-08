import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Portal Profesionales",
  description:
    "Beneficios exclusivos para arquitectos, constructoras y carpinteros: precios especiales, cuenta corriente, presupuestos express y asesor dedicado.",
  keywords: [
    "maderera profesionales",
    "cuenta corriente maderera",
    "descuento constructora madera",
    "proveedor madera mar del plata",
  ],
};

export default function ProfesionalesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
