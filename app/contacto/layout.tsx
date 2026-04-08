import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contacto | Maderera Juan B. Justo - Mar del Plata",
  description:
    "Contactanos por WhatsApp, teléfono, email o visitanos en nuestras sucursales. Casa Central: (0223) 474-3328. Aserradero: (0223) 483-0535.",
  keywords: [
    "contacto maderera mar del plata",
    "teléfono maderera juan b justo",
    "whatsapp maderera",
    "dirección maderera",
  ],
};

export default function ContactoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
