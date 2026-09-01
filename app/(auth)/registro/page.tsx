import type { Metadata } from "next";
import { enlaceWhatsapp } from "@/lib/whatsapp/enlace";
import Image from "next/image";
import Link from "next/link";
import { PestanasAcceso } from "@/components/pestanas-acceso";
import { redirect } from "next/navigation";
import { ArrowLeft, MapPin, PackageSearch, Receipt, Ruler } from "lucide-react";
import { getSession } from "@/lib/dal/session";
import { FormularioRegistro } from "./formulario";

export const metadata: Metadata = {
  title: "Crear cuenta",
  description:
    "Creá tu cuenta para seguir tus pedidos, ver tus presupuestos y tu cuenta corriente en Maderera Juan B. Justo.",
  robots: { index: false, follow: false },
};

/**
 * Lo que se gana creando la cuenta, en concreto.
 *
 * No son beneficios genéricos de e-commerce: son las cuatro cosas que este
 * portal hace de verdad, y cada una tiene su pantalla del otro lado.
 */
const VENTAJAS = [
  {
    icono: PackageSearch,
    titulo: "Seguí tu pedido",
    texto: "Mirá en qué anda sin llamar por teléfono, desde que entra hasta que lo retirás.",
  },
  {
    icono: Ruler,
    titulo: "Tus presupuestos, guardados",
    texto: "Los aceptás desde acá y pasan a pedido con los precios que te pasamos.",
  },
  {
    icono: Receipt,
    titulo: "Tu cuenta corriente",
    texto: "El saldo y cada movimiento, con el detalle de dónde salió cada cifra.",
  },
  {
    icono: MapPin,
    titulo: "Direcciones de obra",
    texto: "Se guardan una vez y no las volvés a tipear en cada compra.",
  },
];

export default async function RegistroPage({
  searchParams,
}: {
  searchParams: Promise<{ volver?: string }>;
}) {
  const whatsapp = await enlaceWhatsapp();
  const { volver } = await searchParams;

  // Quien ya entró no tiene nada que hacer acá.
  const sesion = await getSession();
  if (sesion) redirect(sesion.role === "staff" ? "/admin" : "/mi-cuenta");

  return (
    <main className="grid min-h-screen lg:grid-cols-[1fr_minmax(28rem,34rem)]">
      {/* Propuesta: solo en pantallas grandes, donde el espacio sobra. */}
      <section className="relative hidden flex-col justify-between overflow-hidden bg-brand-gray p-12 text-white lg:flex">
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(102deg, #fff 0 1px, transparent 1px 22px)",
          }}
        />

        <Link
          href="/"
          className="relative inline-flex items-center gap-2 text-sm text-white/70 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver al sitio
        </Link>

        <div className="relative max-w-md">
          <p className="text-sm font-medium uppercase tracking-[0.14em] text-brand-orange">
            Desde 1981 en Mar del Plata
          </p>
          <h2 className="mt-3 text-3xl font-bold leading-tight">
            Tu obra, ordenada en un solo lugar
          </h2>

          <ul className="mt-8 space-y-6">
            {VENTAJAS.map((v) => (
              <li key={v.titulo} className="flex gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-orange/15 text-brand-orange">
                  <v.icono className="h-5 w-5" />
                </span>
                <span>
                  <span className="block font-semibold">{v.titulo}</span>
                  <span className="mt-0.5 block text-sm leading-relaxed text-white/65">
                    {v.texto}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-sm text-white/50">
          Casa Central y Aserradero · Marca propia Moldava
        </p>
      </section>

      {/* Formulario */}
      <section className="flex flex-col justify-center bg-sitio-alt px-4 py-12 sm:px-8">
        <div className="mx-auto w-full max-w-[460px]">
          <Link
            href="/"
            className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-brand-orange lg:hidden"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver al sitio
          </Link>

          <div className="rounded-2xl border border-linea bg-card px-[30px] py-7 shadow-[0_1px_2px_rgb(60_50_40_/_0.05)]">
            <PestanasAcceso activa="registro" volver={volver} />

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
                  Creá tu cuenta
                </h1>
                <p className="mt-0.5 text-[15px] text-texto-2">
                  Con la cuenta web seguís tus pedidos y presupuestos.
                </p>
              </div>
            </div>

            <FormularioRegistro volver={volver} />

            <p className="mt-6 border-t pt-5 text-center text-sm text-muted-foreground">
              ¿Ya tenés cuenta?{" "}
              <Link
                href={
                  volver
                    ? `/ingresar?volver=${encodeURIComponent(volver)}`
                    : "/ingresar"
                }
                className="font-medium text-brand-orange hover:underline"
              >
                Ingresá
              </Link>
            </p>
          </div>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            ¿Comprás a cuenta corriente?{" "}
            <a
              href={whatsapp}
              className="font-medium text-brand-orange hover:underline"
            >
              Escribinos
            </a>{" "}
            y vinculamos tu cuenta del mostrador.
          </p>
        </div>
      </section>
    </main>
  );
}
