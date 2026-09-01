import Link from "next/link";
import Image from "next/image";

/**
 * 404 de raíz: direcciones que no coinciden con ninguna ruta.
 *
 * No hereda el layout público —Next la dibuja bajo el layout raíz—, así que no
 * tiene el menú ni el pie. En vez de armar un chrome a medida que después se
 * despegaría del real, se resuelve con lo mínimo y un camino de vuelta al
 * sitio, donde sí está toda la navegación.
 *
 * Las 404 que salen de una página pública —un producto dado de baja— caen en
 * `app/(public)/not-found.tsx`, que sí tiene el menú.
 */
export default function NoEncontradoRaiz() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-sitio-alt px-6 text-center">
      <Link href="/" className="flex items-center gap-2.5">
        <Image
          src="/cropped-icon-180x180.png"
          alt=""
          width={44}
          height={44}
          className="rounded-[11px]"
        />
        <span className="text-left leading-[1.1]">
          <span className="block text-[15px] font-bold tracking-tight">
            Maderera
          </span>
          <span className="block text-[11px] uppercase tracking-[0.11em] text-texto-3">
            Juan B. Justo
          </span>
        </span>
      </Link>

      <p className="tabular mt-10 text-[13px] font-bold uppercase tracking-[0.12em] text-acento-texto">
        Error 404
      </p>
      <h1 className="mt-2 text-[34px] font-bold tracking-[-0.03em]">
        Esta dirección no existe
      </h1>
      <p className="mt-2 max-w-md text-base text-texto-2">
        Puede que el enlace esté mal escrito o que la página se haya movido.
      </p>

      <Link
        href="/"
        className="mt-7 flex h-12 items-center rounded-[10px] bg-accion px-6 text-[15px] font-semibold text-white transition-colors hover:bg-accion-hover"
      >
        Ir al sitio
      </Link>
    </main>
  );
}
