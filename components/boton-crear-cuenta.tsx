"use client";

import Link from "next/link";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEstado } from "@/lib/estado-context";

/**
 * «Crear una cuenta», solo para quien no entró.
 *
 * Decide en el navegador y no en el servidor: preguntar por la sesión del lado
 * del servidor obligaba a rearmar la portada entera en cada visita —y a tocar
 * la base— para esconder un botón.
 *
 * Mientras no se sabe, se muestra. Es el lado seguro de los dos: a quien ya
 * tiene cuenta le sobra un botón por un instante; esconderlo por las dudas se
 * lo escondería para siempre a quien todavía no la tiene, que es justo a quien
 * la clienta quiere captar.
 */
export function BotonCrearCuenta() {
  const { sesion } = useEstado();
  if (sesion) return null;

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
