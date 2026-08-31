import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { PestanasAcceso } from "@/components/pestanas-acceso";
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
    <main className="min-h-screen bg-sitio-alt flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-[460px]">
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-brand-orange"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver al sitio
        </Link>

        <div className="rounded-2xl border border-linea bg-card px-[30px] py-7 shadow-[0_1px_2px_rgb(60_50_40_/_0.05)]">
          <PestanasAcceso activa="ingresar" volver={volver} />

          <div className="mb-5 mt-[22px] flex items-center gap-3">
            <Image
              src="/cropped-icon-180x180.png"
              alt=""
              width={40}
              height={40}
              className="rounded-[10px]"
            />
            <div>
              <h1 className="text-2xl font-bold tracking-[-0.025em]">
                Entrá a tu cuenta
              </h1>
              <p className="mt-0.5 text-[15px] text-texto-2">
                Para seguir pedidos, presupuestos y tu cuenta corriente.
              </p>
            </div>
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
