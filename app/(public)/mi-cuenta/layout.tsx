import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { verifySession } from "@/lib/dal/session";
import { clienteDeLaSesion, resumenCuenta } from "@/lib/dal/cuenta";
import { formatearMonto, primerNombre } from "@/lib/formato";
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
  const nombreDePila = primerNombre(sesion.name);

  return (
    <div className="min-h-screen bg-sitio-alt">
      <div className="mx-auto px-6 max-w-6xl py-8 lg:py-10">
        <header className="mb-[26px] flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="text-[15px] text-texto-3">Hola,</p>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-[38px] font-bold leading-[1.05] tracking-[-0.035em]">
                {nombreDePila}
              </h1>
              {cliente?.tipo === "profesional" && (
                <span className="rounded-full bg-naranja-claro px-[11px] py-[5px] text-[11.5px] font-bold uppercase tracking-[0.09em] text-acento-sobre-claro">
                  Profesional
                </span>
              )}
            </div>
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

        <div className="grid gap-[26px] lg:grid-cols-[236px_minmax(0,1fr)]">
          <aside className="lg:sticky lg:top-[88px] lg:self-start">
            <NavegacionCuenta
              pedidosEnCurso={resumen.pedidosEnCurso}
              presupuestosAResponder={resumen.presupuestosAResponder}
              operaACuenta={operaACuenta}
              saldo={
                operaACuenta && (
                  <div className="mt-4 hidden rounded-xl border border-linea bg-card p-4 lg:block">
                    <p className="text-xs font-semibold uppercase tracking-[0.1em] text-texto-3">
                      Tu saldo
                    </p>
                    <p
                      className={`tabular mt-1 text-2xl font-semibold ${
                        resumen.saldo > 0
                          ? "text-saldo-debe"
                          : resumen.saldo < 0
                            ? "text-saldo-favor"
                            : "text-saldo-cero"
                      }`}
                    >
                      {formatearMonto(Math.abs(resumen.saldo))}
                    </p>
                    <p className="mt-0.5 text-sm text-texto-2">
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
