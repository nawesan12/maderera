"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export function BuscadorCortes({ busquedaActual }: { busquedaActual: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [texto, setTexto] = useState(busquedaActual);

  useEffect(() => {
    if (texto === busquedaActual) return;
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (texto) params.set("buscar", texto);
      else params.delete("buscar");
      startTransition(() =>
        router.replace(
          params.size > 0 ? `/admin/cortes?${params}` : "/admin/cortes",
          { scroll: false },
        ),
      );
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto]);

  return (
    <div className="relative max-w-xl">
      <Search className="absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Buscar por número, cliente o material…"
        className="h-11 pl-11"
        aria-label="Buscar cortes"
      />
    </div>
  );
}
