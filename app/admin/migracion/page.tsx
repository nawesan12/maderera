import { DatabaseZap } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { fechaHora } from "@/components/admin/formato";
import { requireStaffRole } from "@/lib/dal/session";
import {
  estadoDelSistema,
  historialDeMigraciones,
} from "@/lib/dal/admin/migracion";
import { AsistenteMigracion } from "./asistente";

export const metadata = { title: "Migración de datos · Panel" };

const ETIQUETA_ENTIDAD = {
  clientes: "Clientes",
  productos: "Productos y medidas",
  stock: "Existencias",
  saldos: "Saldos de cuenta corriente",
} as const;

const ETIQUETA_ESTADO = {
  en_curso: "Quedó a medias",
  completada: "Terminada",
  interrumpida: "Se interrumpió",
} as const;

export default async function MigracionPage() {
  // La migración reescribe cartera, catálogo y saldos: es de administración.
  // Se verifica acá y de nuevo en cada acción, porque el que escribe es el
  // servidor y no esta pantalla.
  await requireStaffRole("admin");

  const [estado, historial] = await Promise.all([
    estadoDelSistema(),
    historialDeMigraciones(),
  ]);

  return (
    <div>
      <EncabezadoPanel
        titulo="Migración de datos"
        detalle="Traer clientes, catálogo, existencias y saldos desde el sistema anterior"
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Dato
          titulo="Clientes"
          valor={estado.clientes}
          detalle={`${estado.clientesMigrados.toLocaleString("es-AR")} con código del sistema anterior`}
        />
        <Dato
          titulo="Medidas en el catálogo"
          valor={estado.medidas}
          detalle="Cada código de artículo es una medida"
        />
        <Dato
          titulo="Medidas con existencia"
          valor={estado.conExistencia}
          detalle="Con stock cargado mayor a cero"
        />
        <Dato
          titulo="Saldos iniciales"
          valor={estado.saldosMigrados}
          detalle="Cuentas corrientes ya migradas"
        />
      </div>

      <div className="mt-6 grid gap-6 2xl:grid-cols-[1fr_360px]">
        <div className="rounded-xl border bg-card p-5">
          <AsistenteMigracion />
        </div>

        <aside>
          <p className="mb-2 text-base font-semibold">Corridas anteriores</p>

          {historial.length === 0 ? (
            <div className="rounded-xl border border-dashed py-10 text-center">
              <DatabaseZap className="mx-auto mb-2 h-7 w-7 text-muted-foreground" />
              <p className="text-base font-medium">Todavía no se migró nada</p>
              <p className="mt-1 px-6 text-base text-muted-foreground">
                Cada corrida queda registrada acá con lo que entró y lo que
                quedó afuera.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {historial.map((corrida) => (
                <div key={corrida.id} className="rounded-xl border bg-card p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-base font-medium">
                      {ETIQUETA_ENTIDAD[corrida.entidad]}
                    </p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-sm font-medium ${
                        corrida.estado === "completada"
                          ? "bg-muted text-muted-foreground"
                          : "bg-brand-orange/15 text-brand-orange-dark"
                      }`}
                    >
                      {ETIQUETA_ESTADO[corrida.estado]}
                    </span>
                  </div>

                  <p className="mt-0.5 truncate text-sm text-muted-foreground">
                    {corrida.archivo}
                  </p>

                  <p className="tabular mt-1.5 text-base">
                    {corrida.creados.toLocaleString("es-AR")} creados ·{" "}
                    {corrida.actualizados.toLocaleString("es-AR")} actualizados
                    {corrida.conError > 0 && (
                      <span className="text-brand-orange-dark">
                        {" "}
                        · {corrida.conError.toLocaleString("es-AR")} afuera
                      </span>
                    )}
                  </p>

                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {fechaHora.format(corrida.createdAt)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function Dato({
  titulo,
  valor,
  detalle,
}: {
  titulo: string;
  valor: number;
  detalle: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-base text-muted-foreground">{titulo}</p>
      <p className="tabular text-3xl font-semibold">
        {valor.toLocaleString("es-AR")}
      </p>
      <p className="mt-0.5 text-sm text-muted-foreground">{detalle}</p>
    </div>
  );
}
