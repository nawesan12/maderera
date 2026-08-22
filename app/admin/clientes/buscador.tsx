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

const TIPOS = {
  todos: "Todos los clientes",
  profesional: "Profesionales",
  particular: "Particulares",
};

export function BuscadorClientes({
  busquedaActual,
  tipoActual,
}: {
  busquedaActual: string;
  tipoActual: string;
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
        params.size > 0 ? `/admin/clientes?${params}` : "/admin/clientes",
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
          placeholder="Buscar por nombre, empresa, CUIT o rubro…"
          className="h-11 pl-11"
          aria-label="Buscar clientes"
        />
      </div>
      <Select
        value={tipoActual}
        onValueChange={(v) => v && actualizar({ tipo: v })}
        items={TIPOS}
      >
        <SelectTrigger className="h-11 w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(TIPOS).map(([valor, texto]) => (
            <SelectItem key={valor} value={valor}>
              {texto}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
