import type { Metadata } from "next";
import Link from "next/link";
import { History, ShieldCheck } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { fechaHora, haceCuanto } from "@/lib/formato";
import {
  listarBitacora,
  opcionesDeBitacora,
  type AccionAuditoria,
} from "@/lib/dal/admin/auditoria";

export const metadata: Metadata = { title: "Bitácora" };

const ACCIONES: Record<AccionAuditoria, string> = {
  crear: "Alta",
  editar: "Edición",
  eliminar: "Baja",
  cambiar_estado: "Cambio de estado",
  cobrar: "Cobro",
  anular: "Anulación",
  importar: "Importación",
  exportar: "Exportación",
};

/** Lo que mueve plata o borra datos se marca: es lo que se busca al auditar. */
const DELICADAS = new Set<string>(["eliminar", "anular", "cobrar", "importar"]);

const PERIODOS = [
  { dias: 1, etiqueta: "Hoy" },
  { dias: 7, etiqueta: "7 días" },
  { dias: 30, etiqueta: "30 días" },
  { dias: 0, etiqueta: "Todo" },
];

/**
 * La bitácora del panel.
 *
 * No la pide el contrato: la pide trabajar de a varios sobre los mismos datos.
 * "El precio del fenólico está mal y yo no lo toqué" es una conversación que en
 * el sistema anterior terminaba en la memoria de cada uno.
 *
 * Los filtros van por URL y no por estado de cliente para que una consulta se
 * pueda pasar por WhatsApp tal como está: "mirá esto" con el enlace puesto.
 */
export default async function BitacoraPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const texto = (clave: string) => {
    const v = params[clave];
    return Array.isArray(v) ? v[0] : v;
  };

  const dias = texto("dias") !== undefined ? Number(texto("dias")) : 7;
  const entidad = texto("entidad") || undefined;
  const accion = (texto("accion") as AccionAuditoria | undefined) || undefined;
  const usuarioId = texto("usuario") || undefined;
  const buscar = texto("q") || undefined;
  const pagina = Math.max(1, Number(texto("pagina") ?? 1) || 1);
  const porPagina = 60;

  const [{ filas, total }, opciones] = await Promise.all([
    listarBitacora({
      dias: Number.isFinite(dias) ? dias : 7,
      entidad,
      accion,
      usuarioId,
      buscar,
      limite: porPagina,
      desplazamiento: (pagina - 1) * porPagina,
    }),
    opcionesDeBitacora(),
  ]);

  const paginas = Math.max(1, Math.ceil(total / porPagina));

  /** Arma un enlace conservando el resto de los filtros. */
  const conFiltro = (cambios: Record<string, string | undefined>) => {
    const url = new URLSearchParams();
    const base: Record<string, string | undefined> = {
      dias: String(dias),
      entidad,
      accion,
      usuario: usuarioId,
      q: buscar,
      ...cambios,
    };
    for (const [k, v] of Object.entries(base)) {
      if (v !== undefined && v !== "") url.set(k, v);
    }
    const cadena = url.toString();
    return cadena ? `/admin/bitacora?${cadena}` : "/admin/bitacora";
  };

  return (
    <div className="space-y-6">
      <EncabezadoPanel
        titulo="Bitácora"
        detalle="Quién hizo qué en el panel, y cuándo."
      />

      <form method="get" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="dias" value={dias} />

        <div className="min-w-[14rem] flex-1">
          <label htmlFor="q" className="block text-base font-medium">
            Buscar
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={buscar ?? ""}
            placeholder="Un nombre, un número de pedido…"
            className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
          />
        </div>

        <Selector
          id="entidad"
          etiqueta="Sobre qué"
          nombre="entidad"
          valor={entidad}
          opciones={opciones.entidades.map((e) => ({ valor: e, texto: e }))}
        />

        <Selector
          id="accion"
          etiqueta="Acción"
          nombre="accion"
          valor={accion}
          opciones={Object.entries(ACCIONES).map(([valor, texto]) => ({
            valor,
            texto,
          }))}
        />

        <Selector
          id="usuario"
          etiqueta="Quién"
          nombre="usuario"
          valor={usuarioId}
          opciones={opciones.personas.map((p) => ({
            valor: p.usuarioId!,
            texto: p.usuarioNombre,
          }))}
        />

        <button
          type="submit"
          className="h-10 rounded-lg border px-4 text-base font-medium transition-colors hover:bg-muted"
        >
          Filtrar
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        {PERIODOS.map((p) => (
          <Link
            key={p.dias}
            href={conFiltro({ dias: String(p.dias), pagina: undefined })}
            className={`h-9 rounded-lg px-3 text-base font-medium leading-9 transition-colors ${
              dias === p.dias
                ? "bg-brand-orange text-white"
                : "border hover:bg-muted"
            }`}
          >
            {p.etiqueta}
          </Link>
        ))}
        <span className="ml-auto text-base text-muted-foreground">
          {total === 0
            ? "Sin movimientos"
            : `${total.toLocaleString("es-AR")} ${total === 1 ? "movimiento" : "movimientos"}`}
        </span>
      </div>

      {filas.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-12 text-center text-base text-muted-foreground">
          <History className="mx-auto mb-2 h-6 w-6" />
          No hay movimientos registrados con estos filtros.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {filas.map((fila) => (
            <li key={fila.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3">
              <div className="min-w-[16rem] flex-1">
                <p className="text-base">{fila.descripcion}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {fila.usuarioNombre}
                  {fila.usuarioRol ? ` · ${fila.usuarioRol}` : ""} ·{" "}
                  <span className="tabular">
                    {fechaHora.format(new Date(fila.createdAt))}
                  </span>{" "}
                  ({haceCuanto(new Date(fila.createdAt))})
                </p>
              </div>

              <span
                className={`rounded-full px-2 py-0.5 text-sm font-medium ${
                  DELICADAS.has(fila.accion)
                    ? "bg-brand-orange/12 text-brand-orange-dark"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {ACCIONES[fila.accion as AccionAuditoria] ?? fila.accion}
              </span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-sm text-muted-foreground">
                {fila.entidad}
              </span>
            </li>
          ))}
        </ul>
      )}

      {paginas > 1 && (
        <nav className="flex items-center justify-between text-base">
          {pagina > 1 ? (
            <Link
              href={conFiltro({ pagina: String(pagina - 1) })}
              className="rounded-lg border px-3 py-2 font-medium hover:bg-muted"
            >
              Anterior
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground">
            Página {pagina} de {paginas}
          </span>
          {pagina < paginas ? (
            <Link
              href={conFiltro({ pagina: String(pagina + 1) })}
              className="rounded-lg border px-3 py-2 font-medium hover:bg-muted"
            >
              Siguiente
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}

      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        La bitácora no se edita ni se borra desde el panel. Guarda el nombre de
        quien actuó aunque después se dé de baja su usuario.
      </p>
    </div>
  );
}

function Selector({
  id,
  etiqueta,
  nombre,
  valor,
  opciones,
}: {
  id: string;
  etiqueta: string;
  nombre: string;
  valor?: string;
  opciones: { valor: string; texto: string }[];
}) {
  if (opciones.length === 0) return null;

  return (
    <div>
      <label htmlFor={id} className="block text-base font-medium">
        {etiqueta}
      </label>
      <select
        id={id}
        name={nombre}
        defaultValue={valor ?? ""}
        className="mt-1 h-10 rounded-lg border bg-background px-3 text-base"
      >
        <option value="">Todo</option>
        {opciones.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.texto}
          </option>
        ))}
      </select>
    </div>
  );
}
