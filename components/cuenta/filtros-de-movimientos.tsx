import Link from "next/link";
import type { FiltroDeMovimientos } from "@/lib/dal/historial-cliente";

const FILTROS: { valor: FiltroDeMovimientos; texto: string }[] = [
  { valor: "todo", texto: "Todo" },
  { valor: "compras", texto: "Compras" },
  { valor: "pagos", texto: "Pagos" },
  { valor: "cheques", texto: "Cheques" },
  { valor: "ajustes", texto: "Notas y ajustes" },
];

const PERIODOS = [
  { valor: "3m", texto: "3 meses" },
  { valor: "12m", texto: "Un año" },
  { valor: "todo", texto: "Desde el principio" },
];

export function esFiltro(valor: string | undefined): valor is FiltroDeMovimientos {
  return FILTROS.some((f) => f.valor === valor);
}

/**
 * Filtros de la línea de tiempo, como enlaces.
 *
 * Enlaces y no estado del navegador: el filtro queda en la dirección, así que
 * «mandame lo que ves» funciona copiando el link, y la página se arma en el
 * servidor sin JavaScript de por medio.
 */
export function FiltrosDeMovimientos({
  base,
  periodo,
  filtro,
}: {
  base: string;
  periodo: string;
  filtro: FiltroDeMovimientos;
}) {
  const href = (cambios: { periodo?: string; ver?: string }) => {
    const p = new URLSearchParams();
    const elPeriodo = cambios.periodo ?? periodo;
    const elFiltro = cambios.ver ?? filtro;
    if (elPeriodo !== "12m") p.set("periodo", elPeriodo);
    if (elFiltro !== "todo") p.set("ver", elFiltro);
    const q = p.toString();
    return q ? `${base}?${q}` : base;
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-linea px-5 py-3">
      <nav className="flex flex-wrap gap-1.5" aria-label="Qué movimientos ver">
        {FILTROS.map((f) => (
          <Link
            key={f.valor}
            href={href({ ver: f.valor })}
            scroll={false}
            aria-current={filtro === f.valor ? "true" : undefined}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              filtro === f.valor
                ? "bg-foreground text-background"
                : "bg-hundida text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.texto}
          </Link>
        ))}
      </nav>
      <nav className="flex flex-wrap gap-3 text-sm" aria-label="Período">
        {PERIODOS.map((p) => (
          <Link
            key={p.valor}
            href={href({ periodo: p.valor })}
            scroll={false}
            aria-current={periodo === p.valor ? "true" : undefined}
            className={
              periodo === p.valor
                ? "font-semibold text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }
          >
            {p.texto}
          </Link>
        ))}
      </nav>
    </div>
  );
}
