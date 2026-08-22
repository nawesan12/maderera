"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Filtros del consultor de stock. Como en el catálogo, escriben en la URL. */
export function FiltrosStock({
  categorias,
  categoriaActual,
  busquedaActual,
}: {
  categorias: { slug: string; name: string }[];
  categoriaActual: string;
  busquedaActual: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [texto, setTexto] = useState(busquedaActual);

  useEffect(() => setTexto(busquedaActual), [busquedaActual]);

  function actualizar(cambios: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [clave, valor] of Object.entries(cambios)) {
      if (!valor || valor === "todos") params.delete(clave);
      else params.set(clave, valor);
    }
    startTransition(() => {
      router.replace(params.size > 0 ? `/stock?${params}` : "/stock", {
        scroll: false,
      });
    });
  }

  useEffect(() => {
    if (texto === busquedaActual) return;
    const timer = setTimeout(() => actualizar({ buscar: texto }), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto]);

  return (
    <div className="flex gap-3 mb-6">
      <div className="flex-1 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar producto..."
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          className="pl-10"
          aria-label="Buscar producto"
        />
      </div>
      <Select
        value={categoriaActual}
        onValueChange={(v) => v && actualizar({ cat: v })}
        items={{
          todos: "Todas las categorías",
          ...Object.fromEntries(categorias.map((c) => [c.slug, c.name])),
        }}
      >
        <SelectTrigger className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="todos">Todas las categorías</SelectItem>
          {categorias.map((cat) => (
            <SelectItem key={cat.slug} value={cat.slug}>
              {cat.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
