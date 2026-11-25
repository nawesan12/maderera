import Link from "next/link";
import { Flame } from "lucide-react";
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
 *
 * **La cola tiene orden y la seccionadora es una sola.** Arriba va lo que
 * está en la máquina, con su «Marcar terminado»: sin eso, el corte empezado
 * desaparecía de la lista y para terminarlo había que ir a Cortes. «Empezar»
 * va solo en el primero y solo con la máquina libre; con un botón naranja en
 * cada renglón, la pantalla invitaba a empezar el tercero antes que el
 * primero. El urgente lleva la llama, como en la tarjeta del tablero.
 */
export async function InicioDelDeposito() {
  const [enLaMaquina, cola, pedidos] = await Promise.all([
    listarCortes({ estado: "en-proceso" }),
    listarCortes({ estado: "en-cola" }),
    listarPedidos({ vista: "tablero" }),
  ]);
  const preparar = paraPreparar(pedidos, TOPE);
  const maquinaLibre = enLaMaquina.length === 0;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <RefrescarSolo />
      <Lista titulo="La cola" total={cola.length} href="/admin/cortes">
        {enLaMaquina.map((c) => (
          <div
            key={c.id}
            className="flex items-center gap-3 border-b border-linea-suave bg-hundida/60 px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-acento-texto">En la máquina</p>
              <Link
                href={`/admin/cortes/${c.id}`}
                className="block truncate text-base font-semibold hover:underline"
              >
                {c.cliente}
              </Link>
            </div>
            <div className="shrink-0">
              <AccionesCorte id={c.id} estado={c.estado} urgente={c.urgente} soloMaquina />
            </div>
          </div>
        ))}
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
                  <p className="flex min-w-0 items-center gap-1.5">
                    {c.urgente && (
                      <Flame
                        className="h-4 w-4 shrink-0 text-brand-orange"
                        aria-label="Urgente"
                      />
                    )}
                    <Link
                      href={`/admin/cortes/${c.id}`}
                      className="truncate text-base font-semibold hover:underline"
                    >
                      {c.cliente}
                    </Link>
                  </p>
                  <p className="truncate text-sm text-texto-2">
                    <span className="tabular whitespace-nowrap">
                      {c.placas} {c.placas === 1 ? "placa" : "placas"} ·{" "}
                      {formatearDecimal(c.metrosCuadrados)} m²
                    </span>{" "}
                    · {c.material}
                  </p>
                </div>
                {i === 0 && maquinaLibre && (
                  <div className="shrink-0">
                    <AccionesCorte id={c.id} estado={c.estado} urgente={c.urgente} soloMaquina />
                  </div>
                )}
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
                    pedido={{ numero: p.numero, nombre: p.cliente }}
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
      <div className="mb-3.5 flex items-center justify-between gap-3">
        {/* La cifra va acá y no en «Para hoy»: la misma cuenta dos veces,
            una arriba de la otra, era medio scroll de más en el teléfono.
            El título es como los de las otras secciones del inicio («Para
            hoy», «Empezar algo»: Encabezado de app/admin/page.tsx), con su
            veta; eran dos estilos en la misma pantalla (comité final). */}
        <h2 className="flex items-center gap-2.5 text-[19px] font-bold tracking-tight">
          <span className="wood-divider w-8 shrink-0" aria-hidden="true" />
          {/* El título y la cifra en un solo span: sueltos, el gap del h2 los
              separaba y el «·» quedaba lejos del título y pegado a la cifra. */}
          <span>
            {titulo}
            {total > 0 && <span className="font-semibold tabular-nums text-texto-2"> · {total}</span>}
          </span>
        </h2>
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
