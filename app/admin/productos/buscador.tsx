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

export function BuscadorProductos({
  categorias,
  busquedaActual,
  categoriaActual,
}: {
  categorias: { slug: string; name: string }[];
  busquedaActual: string;
  categoriaActual: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [texto, setTexto] = useState(busquedaActual);

  function actualizar(cambios: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(cambios)) {
      if (!v || v === "todos") params.delete(k);
      else params.set(k, v);
    }
    startTransition(() =>
      router.replace(
        params.size > 0 ? `/admin/productos?${params}` : "/admin/productos",
        { scroll: false },
      ),
    );
  }

  useEffect(() => {
    if (texto === busquedaActual) return;
    const timer = setTimeout(() => actualizar({ buscar: texto }), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto]);

  return (
    <div className="flex gap-3">
      <div className="relative flex-1">
        <Search className="absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Filtrar esta lista…"
          className="h-11 pl-11"
          aria-label="Filtrar la lista"
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
        <SelectTrigger className="h-11 w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="todos">Todas las categorías</SelectItem>
          {categorias.map((c) => (
            <SelectItem key={c.slug} value={c.slug}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
