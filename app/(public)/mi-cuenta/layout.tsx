import type { Metadata } from "next";
import { Suspense } from "react";
import { CargandoCuenta } from "./cargando";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { verifySession } from "@/lib/dal/session";
import { clienteDeLaSesion, resumenCuenta } from "@/lib/dal/cuenta";
import { formatearMonto } from "@/lib/formato";
import { distintivoDeLista, saludoDelCliente } from "@/lib/cuenta/portal";
import { NavegacionCuenta } from "./navegacion";
import { BotonSalir } from "./salir";

export const metadata: Metadata = {
  title: { default: "Mi cuenta", template: "%s · Mi cuenta" },
  robots: { index: false, follow: false },
};

/*
 * Todo lo que cuelga de acá depende de quién entró: no hay navegación que se
 * pueda armar antes de leer la sesión. Con Cache Components, Next 16.4 valida
 * en desarrollo que cada navegación sea instantánea y marcaba casi todas las
 * pantallas («encountered uncached data during prerendering», con el overlay
 * encima). Es la salida que da su guía de autenticación
 * (node_modules/next/dist/docs/01-app/02-guides/authentication-with-cache-components.md):
 * este segmento puede esperar a la sesión. No cambia producción: la
 * validación corre solo en `next dev`, y la ruta sigue haciendo streaming
 * con su `<Suspense>` y su `loading.tsx`.
 */
export const instant = false;

/**
 * Mi cuenta lee la sesión desde el layout, así que el layout pone su propio
 * `<Suspense>`: el grupo `(public)` ya no tiene un `loading.tsx` que lo cubra
 * (ver `components/sitio/cargando.tsx`).
 */
export default function CuentaLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<CargandoCuenta />}>
      <CuentaConSesion>{children}</CuentaConSesion>
    </Suspense>
  );
}

async function CuentaConSesion({
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
  const nombreDePila = saludoDelCliente(cliente?.nombre ?? sesion.name, cliente?.cuit);
  const distintivo = distintivoDeLista(cliente?.tipo, cliente?.lista);

  return (
    <div className="min-h-screen bg-sitio-alt" data-sin-flotante-en-celular>
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-8 lg:py-10">
        <header className="mb-4 flex flex-wrap items-end justify-between gap-x-5 gap-y-2 lg:mb-[26px]">
          <div>
            <p className="text-[15px] text-texto-3">Hola,</p>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-[26px] font-bold leading-[1.05] tracking-[-0.035em] [overflow-wrap:anywhere] sm:text-[38px]">
                {nombreDePila}
              </h1>
              {distintivo && (
                <span className="rounded-full bg-naranja-claro px-[11px] py-[5px] text-[11.5px] font-bold uppercase tracking-[0.09em] text-acento-sobre-claro">
                  {distintivo}
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

        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[236px_minmax(0,1fr)] lg:gap-[26px]">
          <aside className="min-w-0 lg:sticky lg:top-[88px] lg:self-start">
            <NavegacionCuenta
              pedidosEnCurso={resumen.pedidosEnCurso}
              presupuestosAResponder={resumen.presupuestosAResponder}
              operaACuenta={operaACuenta}
              saldo={
                operaACuenta && (
                  <div className="mt-4 hidden rounded-xl superficie p-4 lg:block">
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
