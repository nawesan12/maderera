import Link from "next/link";
import { CheckCircle2, FlaskConical, Settings2 } from "lucide-react";
import { haceCuanto } from "@/lib/formato";
import type { EstadoConexion } from "@/lib/whatsapp/tipos";

/**
 * Estado de la conexión con WhatsApp.
 *
 * En modo demostración el cartel es grande y no se puede cerrar, a propósito.
 * Que alguien crea que le avisó al cliente cuando el mensaje no salió de acá es
 * el peor error posible de esta pantalla: el cliente no viene, se enoja, y
 * nadie entiende por qué. Mientras el número no esté dado de alta en Meta, eso
 * tiene que estar dicho en cada pantalla.
 */
export function AvisoConexion({
  estado,
  compacto = false,
}: {
  estado: EstadoConexion;
  /** En el puesto de atención el cartel va en una línea: el alto es para los mensajes. */
  compacto?: boolean;
}) {
  if (compacto) {
    return <AvisoCompacto estado={estado} />;
  }

  if (estado.proveedor === "demo") {
    return (
      <section className="tarjeta-atencion flex flex-wrap items-start gap-x-4 gap-y-3 p-5">
        <FlaskConical className="mt-0.5 h-5 w-5 shrink-0 text-brand-orange" />

        <div className="min-w-[16rem] flex-1">
          <h2 className="text-base font-medium">Modo demostración</h2>
          <p className="mt-1 text-base text-muted-foreground">
            La bandeja funciona completa y guarda todo, pero{" "}
            <span className="font-medium text-foreground">
              los mensajes no salen a WhatsApp
            </span>
            . Para que salgan de verdad hay que dar de alta el número en la
            Cloud API de Meta: verificar la empresa, migrar el número y hacer
            aprobar los textos de los avisos.
          </p>
        </div>

        <Link
          href="/admin/whatsapp/configuracion"
          className="inline-flex h-10 items-center gap-2 rounded-lg border bg-white px-3.5 text-base font-medium transition-colors hover:bg-muted"
        >
          <Settings2 className="h-5 w-5" />
          Qué falta
        </Link>
      </section>
    );
  }

  if (!estado.conectado) {
    return (
      <section className="tarjeta-atencion flex flex-wrap items-center gap-x-4 gap-y-2 p-5">
        <div className="min-w-[16rem] flex-1">
          <h2 className="text-base font-medium text-red-700">
            WhatsApp desconectado
          </h2>
          <p className="mt-0.5 text-base text-muted-foreground">
            {estado.detalle ?? "No se puede enviar ni recibir en este momento."}
          </p>
        </div>
        <Link
          href="/admin/whatsapp/configuracion"
          className="inline-flex h-10 items-center gap-2 rounded-lg border bg-white px-3.5 text-base font-medium transition-colors hover:bg-muted"
        >
          <Settings2 className="h-5 w-5" />
          Revisar
        </Link>
      </section>
    );
  }

  return (
    <section className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border bg-card px-5 py-3.5">
      <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
      <p className="text-base">
        Conectado
        {estado.telefono && (
          <span className="tabular ml-2 text-muted-foreground">
            {estado.telefono}
          </span>
        )}
      </p>
      {estado.ultimaSenal && (
        <p className="ml-auto text-base text-muted-foreground">
          Último movimiento {haceCuanto(new Date(estado.ultimaSenal))}
        </p>
      )}
      <Link
        href="/admin/whatsapp/configuracion"
        className="ml-2 inline-flex h-10 items-center gap-2 rounded-lg px-3 text-base font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Settings2 className="h-5 w-5" />
        Avisos automáticos
      </Link>
    </section>
  );
}

/**
 * La misma información en una sola línea, para el puesto de atención.
 *
 * Ahí cada centímetro de alto es un mensaje más a la vista, pero el aviso de
 * demostración no se saca ni se puede cerrar: quien está contestando todo el
 * día tiene que saber en todo momento si lo que escribe está llegando.
 */
function AvisoCompacto({ estado }: { estado: EstadoConexion }) {
  if (estado.proveedor === "demo") {
    return (
      <p className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-brand-orange/35 bg-brand-orange/[0.07] px-3.5 py-2 text-base">
        <FlaskConical className="h-4 w-4 shrink-0 text-brand-orange" />
        <span className="font-medium">Modo demostración:</span>
        <span className="text-muted-foreground">
          se guarda todo, pero los mensajes no salen a WhatsApp.
        </span>
        <Link
          href="/admin/whatsapp/configuracion"
          className="font-medium text-brand-orange-dark underline underline-offset-2"
        >
          Qué falta
        </Link>
      </p>
    );
  }

  if (!estado.conectado) {
    return (
      <p className="estado-problema flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-[var(--estado-tinta)]/30 bg-[var(--estado-fondo)] px-3.5 py-2 text-base text-[var(--estado-tinta)]">
        <span className="font-medium">WhatsApp desconectado.</span>
        <span>{estado.detalle ?? "No se puede enviar ni recibir."}</span>
      </p>
    );
  }

  return (
    <p className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border bg-card px-3.5 py-2 text-base">
      <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
      Conectado
      {estado.telefono && (
        <span className="tabular text-muted-foreground">{estado.telefono}</span>
      )}
      {estado.ultimaSenal && (
        <span className="ml-auto text-muted-foreground">
          Último movimiento {haceCuanto(new Date(estado.ultimaSenal))}
        </span>
      )}
    </p>
  );
}
