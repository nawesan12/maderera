import { Skeleton } from "@/components/ui/skeleton";

/**
 * Esqueleto de `ProductCard`.
 *
 * Repite la silueta de la tarjeta real —mismo radio, mismo borde, mismos
 * bloques y la misma fila de acciones de 42px— para que la grilla no salte de
 * altura cuando llegan los datos.
 */
export function ProductCardSkeleton() {
  return (
    // La misma forma que la tarjeta en el teléfono (foto cuadrada de borde a
    // borde): si no, la página salta cuando llegan los productos.
    <div className="flex h-full flex-col overflow-hidden bg-card max-sm:ml-[calc(50%-50vw)] max-sm:w-screen sm:rounded-[14px] sm:superficie sm:shadow-[0_1px_2px_rgb(60_50_40_/_0.05)]">
      <Skeleton className="aspect-square rounded-none sm:aspect-[4/3]" />
      <div className="flex flex-1 flex-col gap-[13px] px-4 pb-4 pt-[15px]">
        <div className="flex flex-col gap-[3px]">
          <Skeleton className="h-[11px] w-20" />
          <Skeleton className="h-[19px] w-3/4" />
        </div>
        <div className="flex flex-col gap-1">
          <Skeleton className="h-[21px] w-28" />
          <Skeleton className="h-[11px] w-2/3" />
        </div>
        <div className="flex gap-[5px]">
          <Skeleton className="h-[23px] w-16 rounded-md" />
          <Skeleton className="h-[23px] w-20 rounded-md" />
        </div>
        <div className="mt-auto flex gap-2 border-t border-linea-tenue pt-3.5">
          <Skeleton className="h-[42px] flex-1 rounded-[9px]" />
          <Skeleton className="h-[42px] w-[42px] flex-none rounded-[9px]" />
        </div>
      </div>
    </div>
  );
}
