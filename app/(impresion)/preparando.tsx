import { Suspense } from "react";
import { notFound } from "next/navigation";
import { existe, type QueExiste } from "@/lib/dal/existencia";

/**
 * Lo que se ve mientras se arma una hoja para imprimir.
 *
 * Estaba en un `loading.tsx` del grupo, y con Cache Components eso envolvía
 * cada hoja en un `<Suspense>`: el esqueleto salía primero, con él el código
 * 200, y un id que no existe respondía 200 con la pantalla de no encontrado.
 */
function PreparandoLaHoja() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center p-8" aria-busy="true">
      <span className="text-base text-muted-foreground">Preparando la hoja…</span>
    </div>
  );
}

/**
 * Una hoja: primero si existe —desde la caché, antes de mandar nada—, después
 * el resto.
 *
 * Las hojas dependen de quién las pide —cada una verifica permisos por su
 * cuenta—, así que el resto va detrás de un `<Suspense>`: sin ese límite, el
 * build se niega a compilarlas. Lo único que se decide afuera es si el id
 * existe, que es lo que hace falta para que un 404 sea un 404. Ver
 * `lib/dal/existencia.ts`.
 */
export async function Hoja({
  que,
  params,
  children,
}: {
  que: QueExiste;
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}) {
  const { id } = await params;
  if (!(await existe(que, id))) notFound();

  return <Suspense fallback={<PreparandoLaHoja />}>{children}</Suspense>;
}

/**
 * Un uuid que no es de nadie, para el `generateStaticParams` de cada hoja.
 *
 * Con Cache Components, leer el parámetro de una ruta sin esa lista es un dato
 * por pedido, y obligaría a decidir el 404 detrás del `<Suspense>`. No se arma
 * ninguna hoja de antemano: la de muestra da 404 en el build.
 */
export const MUESTRA_DEL_BUILD = [{ id: "00000000-0000-0000-0000-000000000000" }];
