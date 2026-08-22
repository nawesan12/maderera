import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getSession } from "@/lib/dal/session";
import { FormularioIngreso } from "./formulario";

export const metadata: Metadata = {
  title: "Ingresar",
  description:
    "Entrá a tu cuenta de Maderera Juan B. Justo para ver tus pedidos, presupuestos y cuenta corriente.",
  robots: { index: false, follow: false },
};

export default async function IngresarPage({
  searchParams,
}: {
  searchParams: Promise<{ volver?: string }>;
}) {
  const { volver } = await searchParams;

  // Con la sesión abierta, esta pantalla no tiene sentido: va a donde
  // corresponda según quién sea.
  const sesion = await getSession();
  if (sesion) redirect(sesion.role === "staff" ? "/admin" : "/mi-cuenta");

  return (
    <main className="min-h-screen bg-brand-cream/40 flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-brand-orange"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver al sitio
        </Link>

        <div className="rounded-2xl border bg-white p-8 shadow-sm">
          <div className="mb-6 flex flex-col items-center text-center">
            <Image
              src="/cropped-icon-180x180.png"
              alt="Maderera Juan B. Justo"
              width={48}
              height={48}
              className="mb-4 rounded-xl"
            />
            <h1 className="text-xl font-semibold">Maderera Juan B. Justo</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Ingresá con tu cuenta para continuar
            </p>
          </div>

          <FormularioIngreso volver={volver} />

          <p className="mt-6 border-t pt-5 text-center text-sm text-muted-foreground">
            ¿Todavía no tenés cuenta?{" "}
            <Link
              href={
                volver
                  ? `/registro?volver=${encodeURIComponent(volver)}`
                  : "/registro"
              }
              className="font-medium text-brand-orange hover:underline"
            >
              Creala en un minuto
            </Link>
          </p>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          ¿Problemas para entrar? Escribinos al{" "}
          <a
            href="https://wa.me/542235903118"
            className="font-medium text-brand-orange hover:underline"
          >
            WhatsApp de Casa Central
          </a>
        </p>
      </div>
    </main>
  );
}
