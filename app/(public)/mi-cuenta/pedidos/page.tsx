import type { Metadata } from "next";
import Link from "next/link";
import { PackageOpen } from "lucide-react";
import { TarjetaPedido } from "@/components/cuenta/tarjeta-pedido";
import { misPedidos } from "@/lib/dal/cuenta";
import { formatearMonto, plural } from "@/lib/formato";

export const metadata: Metadata = { title: "Pedidos" };

export default async function MisPedidosPage() {
  const pedidos = await misPedidos();

  const enCurso = pedidos.filter(
    (p) => p.estado !== "entregado" && p.estado !== "cancelado",
  );
  const cerrados = pedidos.filter(
    (p) => p.estado === "entregado" || p.estado === "cancelado",
  );

  const totalComprado = pedidos
    .filter((p) => p.estado !== "cancelado")
    .reduce((s, p) => s + p.total, 0);

  if (pedidos.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed bg-white/60 px-6 py-16 text-center">
        <PackageOpen className="mx-auto h-10 w-10 text-muted-foreground/60" />
        <h1 className="mt-4 text-xl font-semibold">Todavía no hay pedidos</h1>
        <p className="mx-auto mt-1.5 max-w-sm text-muted-foreground">
          Cuando hagas tu primera compra vas a poder seguirla desde acá, etapa
          por etapa.
        </p>
        <Link
          href="/catalogo"
          className="mt-5 inline-flex h-11 items-center rounded-lg bg-brand-orange px-5 font-medium text-white transition-colors hover:bg-brand-orange-dark"
        >
          Ver el catálogo
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Mis pedidos</h1>
        <p className="text-sm text-muted-foreground">
          {plural(pedidos.length, "pedido")} ·{" "}
          <span className="tabular">{formatearMonto(totalComprado)}</span> en
          total
        </p>
      </header>

      {/* Lo abierto arriba y separado de lo cerrado: la pregunta del cliente
          siempre es por lo que todavía no llegó. */}
      {enCurso.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-baseline gap-2.5 text-lg font-semibold">
            En curso
            <span className="text-sm font-normal text-muted-foreground">
              {plural(enCurso.length, "pedido")}
            </span>
          </h2>
          <div className="space-y-3">
            {enCurso.map((pedido) => (
              <TarjetaPedido key={pedido.id} pedido={pedido} />
            ))}
          </div>
        </section>
      )}

      {cerrados.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-baseline gap-2.5 text-lg font-semibold">
            Anteriores
            <span className="text-sm font-normal text-muted-foreground">
              {plural(cerrados.length, "pedido")}
            </span>
          </h2>
          <div className="space-y-3">
            {cerrados.map((pedido) => (
              <TarjetaPedido key={pedido.id} pedido={pedido} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
