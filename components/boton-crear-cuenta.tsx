"use client";

import { Suspense } from "react";
import Link from "next/link";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEstado } from "@/lib/estado-context";

/**
 * «Crear una cuenta», solo para quien no entró.
 *
 * Queda en la página armada de antemano y, para quien ya entró, el servidor lo
 * retira en la misma respuesta. Mientras no se sabe, se muestra: a quien ya
 * tiene cuenta le sobra un botón por un instante; esconderlo por las dudas se
 * lo escondería a quien todavía no la tiene, que es justo a quien la clienta
 * quiere captar.
 */
export function BotonCrearCuenta() {
  return (
    <Suspense fallback={<Boton />}>
      <BotonParaQuienMira />
    </Suspense>
  );
}

function BotonParaQuienMira() {
  const { sesion } = useEstado();
  if (sesion) return null;
  return <Boton />;
}

function Boton() {
  return (
    <Button
      render={<Link href="/registro" />}
      size="lg"
      className="h-14 rounded-full border-2 border-white/30 bg-white/10 px-8 text-base !text-white backdrop-blur-sm hover:bg-white/20"
    >
      <UserPlus className="mr-2 h-5 w-5" />
      Crear una cuenta
    </Button>
  );
}
