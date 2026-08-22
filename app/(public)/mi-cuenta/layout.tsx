import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { verifySession } from "@/lib/dal/session";
import { clienteDeLaSesion, resumenCuenta } from "@/lib/dal/cuenta";
import { formatearMonto } from "@/lib/formato";
import { NavegacionCuenta } from "./navegacion";
import { BotonSalir } from "./salir";

export const metadata: Metadata = {
  title: { default: "Mi cuenta", template: "%s · Mi cuenta" },
  robots: { index: false, follow: false },
};

export default async function CuentaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // `verifySession()` está memoizada: las páginas la vuelven a pedir a través
  // del DAL sin que eso cueste otra consulta.
  const sesion = await verifySession();
  const [cliente, resumen] = await Promise.all([
    clienteDeLaSesion(),
    resumenCuenta(),
  ]);

  const operaACuenta = resumen.limiteCredito > 0 || resumen.saldo !== 0;
  const primerNombre = sesion.name.trim().split(/\s+/)[0];

  return (
    <div className="min-h-screen bg-brand-cream/30">
      <div className="container mx-auto max-w-6xl px-4 py-8 lg:py-10">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Hola,</p>
            <h1 className="text-3xl font-bold tracking-tight">
              {primerNombre}
              {cliente?.tipo === "profesional" && (
                <span className="ml-3 align-middle rounded-full bg-brand-orange/12 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-brand-orange-dark">
                  Profesional
                </span>
              )}
            </h1>
          </div>
          <BotonSalir />
        </header>

        {sesion.role === "staff" && (
          <p className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-brand-orange/30 bg-brand-orange/[0.07] px-4 py-3 text-sm">
            <ShieldCheck className="h-4 w-4 shrink-0 text-brand-orange-dark" />
            Estás con una cuenta del equipo. Esta es la vista del cliente.
            <Link
              href="/admin"
              className="font-medium text-brand-orange-dark underline underline-offset-2"
            >
              Ir al panel
            </Link>
          </p>
        )}

        <div className="grid gap-6 lg:grid-cols-[15rem_1fr] lg:gap-8">
          <aside className="lg:sticky lg:top-6 lg:self-start">
            <NavegacionCuenta
              pedidosEnCurso={resumen.pedidosEnCurso}
              presupuestosAResponder={resumen.presupuestosAResponder}
              operaACuenta={operaACuenta}
              saldo={
                operaACuenta && (
                  <div className="mt-4 hidden rounded-xl border bg-white p-4 lg:block">
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      Tu saldo
                    </p>
                    <p
                      className={`tabular mt-1 text-2xl font-semibold ${
                        resumen.saldo > 0
                          ? "text-brand-orange-dark"
                          : resumen.saldo < 0
                            ? "text-green-700"
                            : ""
                      }`}
                    >
                      {formatearMonto(Math.abs(resumen.saldo))}
                    </p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {resumen.saldo > 0
                        ? "Pendiente de pago"
                        : resumen.saldo < 0
                          ? "A tu favor"
                          : "Sin deuda"}
                    </p>
                  </div>
                )
              }
            />
          </aside>

          <div className="min-w-0">{children}</div>
        </div>
      </div>
    </div>
  );
}
