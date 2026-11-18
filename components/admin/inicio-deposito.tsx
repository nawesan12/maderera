import Link from "next/link";
import { AccionesCorte } from "@/app/admin/cortes/acciones";
import { AccionesPedido } from "@/app/admin/pedidos/acciones";
import { Vacio } from "@/components/admin/vacio";
import { RefrescarSolo } from "@/components/admin/refrescar-solo";
import { listarCortes } from "@/lib/dal/admin/cortes";
import { listarPedidos } from "@/lib/dal/admin/ventas";
import { paraPreparar } from "@/lib/inicio";
import { formatearDecimal } from "@/lib/unidades";

/** Cuántos renglones muestra cada lista antes del «Ver los N». */
const TOPE = 5;

/**
 * Lo que el depósito hace en la mañana, en la primera pantalla: la cola de
 * corte y los pedidos para preparar, con el botón de la acción en el renglón.
 *
 * Con solo las cifras de «Para hoy» había que entrar a cada pantalla para
 * saber qué hacer; con renglones que llevan a la ficha, eran dos toques para
 * empezar un corte. Son las mismas llamadas de Cortes y Pedidos, que el
 * depósito ya tiene: no hay ruta nueva. **No lleva importes**: el renglón
 * del pedido se arma sin el total (`paraPreparar`).
 */
export async function InicioDelDeposito() {
  const [cola, pedidos] = await Promise.all([
    listarCortes({ estado: "en-cola" }),
    listarPedidos({ vista: "tablero" }),
  ]);
  const preparar = paraPreparar(pedidos, TOPE);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <RefrescarSolo />
      <Lista titulo="La cola" total={cola.length} href="/admin/cortes">
        {cola.length === 0 ? (
          <Vacio titulo="Nada en la cola" />
        ) : (
          <ul className="divide-y divide-linea-suave">
            {cola.slice(0, TOPE).map((c, i) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                <span
                  className="tabular flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-hundida text-base font-semibold text-texto-2"
                  aria-label={`Puesto ${i + 1} en la cola`}
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/admin/cortes/${c.id}`}
                    className="block truncate text-base font-semibold hover:underline"
                  >
                    {c.cliente}
                  </Link>
                  <p className="truncate text-sm text-texto-2">
                    <span className="tabular whitespace-nowrap">
                      {c.placas} {c.placas === 1 ? "placa" : "placas"} ·{" "}
                      {formatearDecimal(c.metrosCuadrados, 2, { fijo: true })} m²
                    </span>{" "}
                    · {c.material}
                  </p>
                </div>
                <div className="shrink-0">
                  <AccionesCorte id={c.id} estado={c.estado} urgente={c.urgente} soloMaquina />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Lista>

      <Lista titulo="Para preparar" total={preparar.total} href="/admin/pedidos">
        {preparar.total === 0 ? (
          <Vacio titulo="Nada para preparar" />
        ) : (
          <ul className="divide-y divide-linea-suave">
            {preparar.renglones.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 items-baseline gap-2">
                    <Link
                      href={`/admin/pedidos/${p.id}`}
                      className="codigo shrink-0 whitespace-nowrap hover:underline"
                    >
                      {p.numero}
                    </Link>
                    <span className="truncate text-base font-semibold">{p.cliente}</span>
                  </p>
                  <p className="truncate text-sm text-texto-2">
                    {p.tipoEntrega === "retiro"
                      ? "Retira"
                      : `Envío${p.zonaEnvio ? ` · ${p.zonaEnvio}` : ""}`}
                  </p>
                </div>
                <div className="shrink-0">
                  <AccionesPedido
                    id={p.id}
                    estado={p.estado}
                    estadoPago={p.estadoPago}
                    tipoEntrega={p.tipoEntrega}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Lista>
    </div>
  );
}

function Lista({
  titulo,
  total,
  href,
  children,
}: {
  titulo: string;
  total: number;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <h2 className="text-[17px] font-bold tracking-tight">{titulo}</h2>
        {/* Con más de cinco se dice cuántos son: si no, parece que hay cinco. */}
        {total > TOPE && (
          <Link
            href={href}
            className="tabular inline-flex min-h-11 items-center text-base font-medium text-acento-texto hover:underline"
          >
            Ver los {total}
          </Link>
        )}
      </div>
      <div className="tarjeta overflow-hidden">{children}</div>
    </section>
  );
}

/** El lugar de las dos listas mientras llegan. */
export function InicioDelDepositoCargando() {
  return (
    <div className="grid gap-6 lg:grid-cols-2" aria-busy="true" aria-live="polite">
      <span className="sr-only">Trayendo la cola y los pedidos…</span>
      {[0, 1].map((i) => (
        <div key={i} className="h-[260px] animate-pulse rounded-xl bg-hundida" />
      ))}
    </div>
  );
}
