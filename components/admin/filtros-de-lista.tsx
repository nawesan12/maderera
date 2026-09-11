"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

/**
 * El filtrado por URL que comparten los listados del panel.
 *
 * Había cinco `buscador.tsx` —clientes, cortes, pedidos, productos,
 * proveedores— con la misma función `actualizar` copiada, el mismo
 * `useTransition`, el mismo `setTimeout` de 350 ms y la misma línea de
 * `eslint-disable`. Cinco copias de una decisión son cinco lugares donde
 * corregirla; y hay una decisión real acá adentro que conviene tomar una
 * sola vez:
 *
 * - **`replace` y no `push`**: tipear en un buscador no es navegar. Con `push`,
 *   volver atrás desde una lista filtrada recorre letra por letra lo que se
 *   escribió.
 * - **`scroll: false`**: filtrar desde la mitad de una lista larga no tiene por
 *   qué devolverte arriba.
 * - **El valor neutro se borra del URL** en vez de escribirse. Así
 *   `/admin/clientes` y `/admin/clientes?tipo=todos` son la misma dirección, y
 *   la que se comparte es la corta.
 * - **La página vuelve a 1 con cada cambio.** El "ver más" acumula páginas en
 *   el URL, y sin esto cambiar de filtro arrastraba el número: ya pasó una vez
 *   en el catálogo público.
 */
export function useFiltrosDeLista({
  ruta,
  busquedaActual = "",
  claveBusqueda = "buscar",
  neutros = ["todos", "todas"],
}: {
  ruta: string;
  busquedaActual?: string;
  /** Cómo se llama el parámetro del texto en el URL. Proveedores usa `q`. */
  claveBusqueda?: string;
  /** Valores que significan "sin filtro" y por eso no se escriben en el URL. */
  neutros?: string[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pendiente, startTransition] = useTransition();
  const [texto, setTexto] = useState(busquedaActual);

  function actualizar(cambios: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [clave, valor] of Object.entries(cambios)) {
      if (!valor || neutros.includes(valor)) params.delete(clave);
      else params.set(clave, valor);
    }
    params.delete("pagina");

    startTransition(() =>
      router.replace(params.size > 0 ? `${ruta}?${params}` : ruta, {
        scroll: false,
      }),
    );
  }

  // El retardo es para no pedir una consulta por tecla. 350 ms es el punto
  // donde deja de sentirse que el teclado va adelante de la pantalla.
  useEffect(() => {
    if (texto === busquedaActual) return;
    const reloj = setTimeout(() => actualizar({ [claveBusqueda]: texto }), 350);
    return () => clearTimeout(reloj);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto]);

  return { texto, setTexto, actualizar, pendiente };
}

/** El campo de búsqueda, con la lupa adentro. */
export function CampoDeBusqueda({
  valor,
  alEscribir,
  placeholder,
  etiqueta,
  className = "",
}: {
  valor: string;
  alEscribir: (v: string) => void;
  placeholder: string;
  /** Lo que oye quien usa lector de pantalla. */
  etiqueta: string;
  className?: string;
}) {
  return (
    <div className={`relative min-w-64 flex-1 ${className}`}>
      <Search
        className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        type="search"
        value={valor}
        onChange={(e) => alEscribir(e.target.value)}
        placeholder={placeholder}
        className="h-11 pl-11"
        aria-label={etiqueta}
      />
    </div>
  );
}

/**
 * Un filtro de pocas opciones, como botones.
 *
 * Va como botones y no como desplegable cuando las opciones son dos o tres y
 * conviene ver cuál está puesta sin abrir nada. Con más opciones, un `Select`.
 */
export function BotonesDeFiltro({
  opciones,
  actual,
  alElegir,
  etiqueta,
}: {
  opciones: { valor: string; texto: string }[];
  actual: string;
  alElegir: (valor: string) => void;
  etiqueta: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={etiqueta}>
      {opciones.map((o) => {
        const activa = actual === o.valor;
        return (
          <button
            key={o.valor}
            type="button"
            onClick={() => alElegir(o.valor)}
            aria-pressed={activa}
            className={`h-10 rounded-lg px-3 text-base font-medium transition-colors ${
              activa
                ? "boton-accion"
                : "border border-linea text-muted-foreground hover:bg-hundida hover:text-foreground"
            }`}
          >
            {o.texto}
          </button>
        );
      })}
    </div>
  );
}
