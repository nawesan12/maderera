"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useEstado } from "@/lib/estado-context";

const CLASE =
  "mt-5 flex h-12 w-fit items-center rounded-[10px] bg-accion px-[22px] text-[15.5px] font-semibold text-white transition-colors hover:bg-accion-hover";

/**
 * La acción del bloque de profesionales de la portada. La portada sale igual
 * para todos, y al profesional ya adentro le ofrecía «Solicitar cuenta
 * profesional» (mes 23): con la sesión resuelta, lo lleva a su portal.
 */
export function BotonProfesional() {
  return (
    <Suspense fallback={<Boton profesional={false} />}>
      <BotonVigente />
    </Suspense>
  );
}

function BotonVigente() {
  const { sesion } = useEstado();
  return <Boton profesional={Boolean(sesion?.profesional)} />;
}

function Boton({ profesional }: { profesional: boolean }) {
  return (
    <Link href="/profesionales" className={CLASE}>
      {profesional ? "Ir a mi portal" : "Solicitar cuenta profesional"}
    </Link>
  );
}
