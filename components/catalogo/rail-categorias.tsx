import Link from "next/link";

export interface CategoriaDelRail {
  slug: string;
  name: string;
  productCount: number;
}

/**
 * La barra de categorías, arriba del catálogo.
 *
 * **Existe para que el catálogo no se sienta otro sitio.** La portada abre con
 * las ocho categorías en tarjetas grandes; después, al entrar a una, esa
 * navegación desaparecía y quedaba una grilla con un panel lateral que en el
 * teléfono ni siquiera se ve. Se sentía como haber salido de la tienda y
 * entrado a un listado.
 *
 * Acá la navegación **sigue estando y muestra dónde está parado**: la
 * categoría activa queda marcada y las otras siete a un toque. Es la misma
 * lista de la portada, en la forma que corresponde a una pantalla donde el
 * protagonista son los productos.
 *
 * Se desplaza de costado en el teléfono, con anclaje, y envuelve en pantalla
 * grande: ocho chips no entran en 375 px sin apilarse en cuatro filas.
 */
export function RailDeCategorias({
  categorias,
  activa,
}: {
  categorias: CategoriaDelRail[];
  /** Slug de la categoría actual, o "todos". */
  activa: string;
}) {
  const todas = [
    { slug: "todos", name: "Todo el catálogo", productCount: 0 },
    ...categorias,
  ];

  return (
    <nav
      aria-label="Categorías"
      className="-mx-4 mb-5 overflow-x-auto px-4 [-ms-overflow-style:none] [scrollbar-width:none] lg:mx-0 lg:px-0 [&::-webkit-scrollbar]:hidden"
    >
      <ul className="flex snap-x gap-2 lg:flex-wrap">
        {todas.map((categoria) => {
          const esActiva = categoria.slug === activa;

          return (
            <li key={categoria.slug} className="snap-start">
              <Link
                href={
                  categoria.slug === "todos"
                    ? "/catalogo"
                    : `/catalogo?cat=${categoria.slug}`
                }
                prefetch={false}
                aria-current={esActiva ? "page" : undefined}
                className={`inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-[14.5px] font-medium transition-colors ${
                  esActiva
                    ? "border-accion bg-accion text-white"
                    : "border-linea bg-card text-texto-2 hover:bg-muted"
                }`}
              >
                {categoria.name}
                {categoria.productCount > 0 && (
                  <span
                    className={`tabular text-[12.5px] ${
                      esActiva ? "text-white/70" : "text-texto-3"
                    }`}
                  >
                    {categoria.productCount}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
