import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { BudgetProvider } from "@/lib/budget-context";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Maderera Juan B. Justo | Desde 1981 en Mar del Plata",
  description:
    "Maderera líder en Mar del Plata. Techos, placas, pisos, molduras, ferretería, decks, construcción en seco y más. Presupuestos sin cargo.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <TooltipProvider>
          <BudgetProvider>
            <Navbar />
            <main className="flex-1">{children}</main>
            <Footer />
            <WhatsAppButton />
          </BudgetProvider>
        </TooltipProvider>
      </body>
    </html>
  );
}
