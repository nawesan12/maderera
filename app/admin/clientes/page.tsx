import Link from "next/link";
import { Building2, Users } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { EtiquetaEstado } from "@/components/admin/etiqueta-estado";
import { GrupoListado } from "@/components/admin/grupo";
import {
  formatearCuit,
  haceCuanto,
  moneda,
  plural,
} from "@/components/admin/formato";
import {
  listarClientes,
  listarListasParaClientes,
  type ClienteListado,
} from "@/lib/dal/admin/clientes";
import { BuscadorClientes } from "./buscador";
import { DialogoCliente } from "./dialogo-cliente";

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ buscar?: string; tipo?: string }>;
}) {
  const params = await searchParams;

  const [clientes, listas] = await Promise.all([
    listarClientes({ busqueda: params.buscar, tipo: params.tipo }),
    listarListasParaClientes(),
  ]);

  // Quien debe plata va primero: es a quien hay que llamar.
  const conDeuda = clientes.filter((c) => c.saldo > 0);
  const alDia = clientes.filter((c) => c.saldo <= 0);
  const deudaTotal = conDeuda.reduce((s, c) => s + c.saldo, 0);

  return (
    <div>
      <EncabezadoPanel
        titulo="Clientes"
        detalle={
          conDeuda.length > 0
            ? `${plural(clientes.length, "cliente")} · ${moneda.format(deudaTotal)} por cobrar`
            : plural(clientes.length, "cliente")
        }
      >
        <DialogoCliente listas={listas} />
      </EncabezadoPanel>

      <BuscadorClientes
        busquedaActual={params.buscar ?? ""}
        tipoActual={params.tipo ?? "todos"}
      />

      {clientes.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed py-16 text-center">
          <Users className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-base font-medium">Ningún cliente coincide</p>
          <p className="mt-1 text-base text-muted-foreground">
            Probá con otro nombre, CUIT o rubro.
          </p>
        </div>
      ) : (
        <>
          <GrupoListado
            titulo="Con saldo pendiente"
            cantidad={conDeuda.length}
            detalle={
              conDeuda.length > 0 ? moneda.format(deudaTotal) : undefined
            }
            destacado
          >
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {conDeuda.map((c) => (
                <TarjetaCliente key={c.id} cliente={c} />
              ))}
            </div>
          </GrupoListado>

          <GrupoListado titulo="Al día" cantidad={alDia.length}>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {alDia.map((c) => (
                <TarjetaCliente key={c.id} cliente={c} />
              ))}
            </div>
          </GrupoListado>
        </>
      )}
    </div>
  );
}

/** Iniciales para el avatar: "Arq. Carolina Méndez" -> "CM". */
function iniciales(nombre: string) {
  return nombre
    .replace(/^(Arq\.|Ing\.|Sr\.|Sra\.|Dr\.)\s*/i, "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function TarjetaCliente({ cliente }: { cliente: ClienteListado }) {
  const excedido =
    cliente.limiteCredito > 0 && cliente.saldo > cliente.limiteCredito;
  const usoLimite =
    cliente.limiteCredito > 0
      ? Math.min((cliente.saldo / cliente.limiteCredito) * 100, 100)
      : 0;

  return (
    <article className="tarjeta tarjeta-activa flex flex-col p-4">
      <div className="flex items-start gap-3">
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-semibold ${
            cliente.tipo === "profesional"
              ? "bg-brand-orange/15 text-brand-orange-dark"
              : "bg-muted text-muted-foreground"
          }`}
          aria-hidden="true"
        >
          {iniciales(cliente.nombre)}
        </span>

        <div className="min-w-0 flex-1">
          <Link
            href={`/admin/clientes/${cliente.id}`}
            className="text-base font-medium leading-snug hover:text-brand-orange"
          >
            {cliente.nombre}
          </Link>
          {cliente.razonSocial && (
            <p className="flex items-center gap-1 truncate text-sm text-muted-foreground">
              <Building2 className="h-3.5 w-3.5 shrink-0" />
              {cliente.razonSocial}
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            {cliente.rubro ?? "Particular"}
          </p>
        </div>

        <EtiquetaEstado estado={cliente.estado} />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 border-t pt-3">
        <div>
          <dt className="text-sm text-muted-foreground">Saldo</dt>
          <dd
            className={`tabular text-base font-medium ${
              excedido ? "text-red-700" : cliente.saldo > 0 ? "" : "text-muted-foreground"
            }`}
          >
            {cliente.saldo > 0 ? moneda.format(cliente.saldo) : "Al día"}
          </dd>
        </div>
        <div className="text-right">
          <dt className="text-sm text-muted-foreground">Comprado</dt>
          <dd className="tabular text-base text-muted-foreground">
            {cliente.totalComprado > 0
              ? moneda.format(cliente.totalComprado)
              : "—"}
          </dd>
        </div>
      </dl>

      {cliente.limiteCredito > 0 && cliente.saldo > 0 && (
        <div className="mt-2.5">
          <div
            className="h-1.5 overflow-hidden rounded-full bg-muted"
            role="img"
            aria-label={`Usa el ${Math.round(usoLimite)}% de su límite`}
          >
            <div
              className={`h-full rounded-full ${
                excedido ? "bg-red-600" : "bg-brand-orange"
              }`}
              style={{ width: `${Math.max(usoLimite, 3)}%` }}
            />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {excedido
              ? `Excede el límite en ${moneda.format(cliente.saldo - cliente.limiteCredito)}`
              : `Límite ${moneda.format(cliente.limiteCredito)}`}
          </p>
        </div>
      )}

      <p className="mt-auto pt-3 text-sm text-muted-foreground">
        <span className="tabular">{formatearCuit(cliente.cuit)}</span>
        {" · "}
        {cliente.ultimaCompra
          ? `compró ${haceCuanto(cliente.ultimaCompra)}`
          : "sin compras"}
      </p>
    </article>
  );
}
