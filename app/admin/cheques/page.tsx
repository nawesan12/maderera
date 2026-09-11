import type { Metadata } from "next";
import Link from "next/link";
import { Banknote } from "lucide-react";
import { ETIQUETA_CIRCUITO } from "@/lib/db/schema/circuito";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { GrupoListado } from "@/components/admin/grupo";
import { fechaCorta, moneda, plural } from "@/components/admin/formato";
import { listarCheques, type ChequeListado } from "@/lib/dal/admin/cheques";
import { listarClientes } from "@/lib/dal/admin/clientes";
import { AccionesDeCheque, AltaDeCheque } from "./vista";

export const metadata: Metadata = { title: "Cheques" };

/** A partir de cuántos días un vencimiento deja de ser "ya". */
const DIAS_DE_AVISO = 7;

/**
 * La cartera de cheques, ordenada por lo que vence.
 *
 * "Mejor manejo de cheques: 30/60/90 días." La pregunta del lunes es qué hay
 * que depositar esta semana y cuánta plata está comprometida en cheques
 * entregados que todavía no debitaron. La pantalla contesta eso primero.
 */
export default async function ChequesPage() {
  const [filas, clientes] = await Promise.all([
    listarCheques(),
    listarClientes({}),
  ]);

  const ahora = new Date();
  const enDias = (fecha: Date) =>
    Math.ceil((fecha.getTime() - ahora.getTime()) / 86_400_000);

  const vivos = filas.filter((c) =>
    ["cartera", "depositado", "entregado"].includes(c.estado),
  );
  const terminados = filas.filter(
    (c) => !["cartera", "depositado", "entregado"].includes(c.estado),
  );

  const porVencer = vivos.filter((c) => enDias(c.fechaPago) <= DIAS_DE_AVISO);
  const recibidosVivos = vivos
    .filter((c) => c.sentido === "recibido")
    .reduce((s, c) => s + c.importe, 0);
  const entregadosVivos = vivos
    .filter((c) => c.sentido === "entregado")
    .reduce((s, c) => s + c.importe, 0);

  return (
    <div className="space-y-6">
      <EncabezadoPanel
        titulo="Cheques"
        detalle={
          vivos.length > 0
            ? `${moneda.format(recibidosVivos)} en cartera · ${moneda.format(entregadosVivos)} entregados sin debitar`
            : "Sin cheques en juego"
        }
      >
        <AltaDeCheque
          clientes={clientes.map((c) => ({ id: c.id, nombre: c.nombre }))}
        />
      </EncabezadoPanel>

      {porVencer.length > 0 && (
        <div className="rounded-xl border bg-card p-5">
          <p className="flex items-start gap-2.5 text-base">
            <Banknote className="mt-0.5 h-5 w-5 shrink-0 text-brand-orange" />
            <span>
              <strong>
                {plural(porVencer.length, "cheque vence", "cheques vencen")} en
                los próximos {DIAS_DE_AVISO} días
              </strong>{" "}
              por{" "}
              {moneda.format(porVencer.reduce((s, c) => s + c.importe, 0))}. Los
              recibidos hay que depositarlos; para los entregados tiene que
              estar la plata en la cuenta.
            </span>
          </p>
        </div>
      )}

      {filas.length === 0 ? (
        <div className="rounded-xl border border-dashed py-16 text-center">
          <Banknote className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-base font-medium">La cartera está vacía</p>
          <p className="mt-1 text-base text-muted-foreground">
            Los cheques que salgan en pagos a proveedores entran solos; los
            recibidos se cargan acá.
          </p>
        </div>
      ) : (
        <>
          <GrupoListado
            titulo="En juego"
            cantidad={vivos.length}
            detalle="Por vencimiento: lo más próximo arriba"
            destacado
          >
            {vivos.map((c) => (
              <Tarjeta key={c.id} cheque={c} dias={enDias(c.fechaPago)} />
            ))}
          </GrupoListado>

          <GrupoListado
            titulo="Terminados"
            cantidad={terminados.length}
            vacio={
              <p className="px-1 text-base text-texto-2">
                Ninguno acreditado ni rechazado todavía.
              </p>
            }
          >
            {terminados.map((c) => (
              <Tarjeta key={c.id} cheque={c} dias={null} apagado />
            ))}
          </GrupoListado>
        </>
      )}
    </div>
  );
}

const ESTADOS: Record<string, string> = {
  cartera: "En cartera",
  depositado: "Depositado",
  entregado: "Entregado",
  acreditado: "Acreditado",
  rechazado: "Rechazado",
  anulado: "Anulado",
};

function Tarjeta({
  cheque: c,
  dias,
  apagado = false,
}: {
  cheque: ChequeListado;
  dias: number | null;
  apagado?: boolean;
}) {
  const vencido = dias !== null && dias < 0;

  return (
    <article
      className={`tarjeta flex flex-wrap items-center gap-4 px-5 py-4 ${
        apagado ? "opacity-75" : ""
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <h3 className="tabular text-lg font-medium">{c.numero}</h3>
          <span
            className={`rounded-full px-2.5 py-1 text-sm font-medium ${
              c.sentido === "recibido"
                ? "bg-naranja-claro text-acento-sobre-claro"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {c.sentido === "recibido" ? "Recibido" : "Entregado"}
          </span>
          <span className="rounded-full bg-muted px-2.5 py-1 text-sm font-medium text-muted-foreground">
            {ESTADOS[c.estado] ?? c.estado}
            {c.tipo === "echeq" && " · e-Cheq"}
          </span>
          {/* El circuito, porque la cartera tiene que poder contestar "cuánto
              hay que cubrir esta semana" para cada uno por separado. */}
          <span className="rounded-full bg-chip px-2.5 py-1 text-sm font-medium text-texto-2">
            {ETIQUETA_CIRCUITO[c.circuito] ?? c.circuito}
          </span>
        </div>
        {/*
          De quién vino y a quién fue, enlazados.

          La pantalla no tenía un solo enlace, teniendo las dos puntas en la
          base. El momento en que hace falta es el peor posible: un cheque
          rebotado y alguien preguntando de qué cliente era.
        */}
        <p className="mt-1 text-base text-muted-foreground">
          {[c.banco, c.librador].filter(Boolean).join(" · ") ||
            "Sin datos del banco"}
          {c.cliente && (
            <>
              {" · de "}
              {c.customerId ? (
                <Link
                  href={`/admin/clientes/${c.customerId}`}
                  className="hover:text-brand-orange hover:underline"
                >
                  {c.cliente}
                </Link>
              ) : (
                c.cliente
              )}
            </>
          )}
          {c.proveedor && ` · entregado a ${c.proveedor}`}
          {c.notas && ` · ${c.notas}`}
        </p>
      </div>

      <div className="text-right">
        <p className="tabular text-xl font-semibold">{moneda.format(c.importe)}</p>
        <p
          className={`text-sm ${
            vencido
              ? "font-semibold text-brand-orange-dark"
              : dias !== null && dias <= 7
                ? "font-medium text-brand-orange-dark"
                : "text-muted-foreground"
          }`}
        >
          {fechaCorta.format(c.fechaPago)}
          {dias !== null &&
            (vencido
              ? " · ya se puede cobrar"
              : dias === 0
                ? " · hoy"
                : ` · en ${plural(dias, "día")}`)}
        </p>
      </div>

      {!apagado && <AccionesDeCheque id={c.id} estado={c.estado} sentido={c.sentido} />}
    </article>
  );
}
