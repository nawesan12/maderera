"use client";

import { useActionState } from "react";
import {
  AtSign,
  CheckCircle,
  Loader2,
  Phone,
  Send,
  TriangleAlert,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BotonWhatsapp } from "@/components/whatsapp/boton";
import { enlaceDeConsulta } from "@/lib/catalogo/consulta";
import { MOTIVOS, textoDeContacto } from "@/lib/contacto/consulta";
import { enviarConsulta, type EstadoConsulta } from "./actions";

/**
 * Formulario de contacto.
 *
 * Es la única parte de la página que necesita JavaScript, así que es lo único
 * que baja al navegador: el resto —los datos de cada sucursal, los accesos
 * directos, el texto— se arma en el servidor.
 */

export function FormularioContacto({ whatsapp }: { whatsapp: string }) {
  const [estado, accion, enviando] = useActionState<EstadoConsulta, FormData>(
    enviarConsulta,
    {},
  );

  if (estado.ok) {
    return (
      <div className="rounded-2xl border bg-card p-10 text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-green">
          <CheckCircle className="h-8 w-8 text-white" />
        </div>
        <h2 className="mb-2 text-2xl font-bold">Consulta enviada</h2>
        <p className="text-muted-foreground">{estado.ok}</p>
      </div>
    );
  }

  // El error de Go va al lado de su campo. El de «contacto» es del par
  // WhatsApp/correo —falta uno de los dos— y va una sola vez, debajo de los
  // dos, enlazado a ambos con `aria-describedby`.
  const errorDe = (campo: string) => (estado.campo === campo ? estado.error : undefined);
  const errorDelPar = errorDe("contacto");
  const errorGeneral =
    estado.error && !["nombre", "telefono", "email", "contacto", "motivo", "mensaje"].includes(estado.campo ?? "")
      ? estado.error
      : undefined;
  const valor = (campo: string) => estado.valores?.[campo];
  const describe = (campo: string) =>
    [errorDe(campo) ? `error-${campo}` : null, errorDelPar ? "error-contacto" : null].filter(Boolean).join(" ") ||
    undefined;

  return (
    // `key`: con cada respuesta el formulario se arma de nuevo con lo que se
    // había escrito; React vacía los campos sin control al terminar la acción.
    <form key={JSON.stringify(estado.valores ?? {})} action={accion} className="space-y-5 rounded-2xl border bg-card p-6 sm:p-8">
      <div>
        <h2 className="text-2xl font-bold">Escribinos</h2>
      </div>

      <div className="space-y-2">
        <Label htmlFor="motivo">¿Sobre qué nos consultás?</Label>
        {/* Un <select> nativo: es un campo de seis opciones en un formulario
            público, y el nativo anda en cualquier teléfono sin JavaScript. */}
        <select
          id="motivo"
          name="motivo"
          required
          defaultValue={valor("motivo") || "presupuesto"}
          className="h-12 w-full rounded-xl border border-border/60 bg-background px-3 text-base focus:border-brand-orange focus:outline-none"
        >
          {MOTIVOS.map((motivo) => (
            <option key={motivo.valor} value={motivo.valor}>
              {motivo.etiqueta}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="nombre">Nombre completo</Label>
        <div className="relative">
          <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
          <Input
            id="nombre"
            name="nombre"
            required
            autoComplete="name"
            placeholder="Tu nombre"
            defaultValue={valor("nombre")}
            aria-invalid={errorDe("nombre") ? true : undefined}
            aria-describedby={errorDe("nombre") ? "error-nombre" : undefined}
            className="h-12 rounded-xl border-border/60 pl-10 focus:border-brand-orange"
          />
        </div>
        <ErrorDeCampo id="error-nombre" mensaje={errorDe("nombre")} />
      </div>

      {/* WhatsApp primero (hallazgo 47): es por donde contesta la gente de
          acá. Ninguno de los dos es obligatorio solo; alguno sí, y eso lo
          controla Go. */}
      <fieldset className="space-y-2">
        <legend className="sr-only">Cómo te contestamos</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="telefono">WhatsApp</Label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
              <Input
                id="telefono"
                name="telefono"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="223 15 123-4567"
                defaultValue={valor("telefono")}
                aria-invalid={errorDe("telefono") || errorDelPar ? true : undefined}
                aria-describedby={describe("telefono")}
                className="h-12 rounded-xl border-border/60 pl-10 focus:border-brand-orange"
              />
            </div>
            <ErrorDeCampo id="error-telefono" mensaje={errorDe("telefono")} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Correo</Label>
            <div className="relative">
              <AtSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="tu@correo.com"
                defaultValue={valor("email")}
                aria-invalid={errorDe("email") || errorDelPar ? true : undefined}
                aria-describedby={describe("email")}
                className="h-12 rounded-xl border-border/60 pl-10 focus:border-brand-orange"
              />
            </div>
            <ErrorDeCampo id="error-email" mensaje={errorDe("email")} />
          </div>
        </div>
        <ErrorDeCampo id="error-contacto" mensaje={errorDelPar} />
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor="mensaje">Mensaje</Label>
        <Textarea
          id="mensaje"
          name="mensaje"
          required
          rows={5}
          placeholder="Medidas, cantidades o el tipo de proyecto."
          defaultValue={valor("mensaje")}
          aria-invalid={errorDe("mensaje") ? true : undefined}
          aria-describedby={errorDe("mensaje") ? "error-mensaje" : undefined}
          className="resize-none rounded-xl border-border/60 focus:border-brand-orange"
        />
        <ErrorDeCampo id="error-mensaje" mensaje={errorDe("mensaje")} />
      </div>

      {errorGeneral && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl bg-naranja-claro p-3 text-sm text-acento-sobre-claro"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {errorGeneral}
        </p>
      )}

      {/* `sm:flex-1` y no `flex-1`: en fila reparte el ancho entre los dos
          botones, pero apilados en teléfono el eje principal es el vertical y
          `flex: 1 1 0%` les pone la altura de base en cero. Así el `h-12` se
          perdía y el botón de enviar quedaba en 22px de alto en el celular. En
          columna el ancho ya lo da el estirado del eje cruzado. */}
      <div className="flex flex-col gap-3 pt-1 sm:flex-row">
        <Button
          type="submit"
          disabled={enviando}
          className="h-11 rounded-[10px] bg-accion text-[15px] font-semibold text-white hover:bg-accion-hover sm:flex-1"
        >
          {enviando ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Send className="mr-2 h-4 w-4" />
          )}
          {enviando ? "Enviando…" : "Enviar consulta"}
        </Button>

        {/* Si el correo no salió, WhatsApp pasa a ser la acción principal y
            se abre con lo que ya escribió: no tiene que tipearlo de nuevo. */}
        <BotonWhatsapp
          enlace={(() => {
            const texto = estado.usarWhatsapp ? textoDeContacto(estado.valores) : null;
            return texto ? enlaceDeConsulta(whatsapp, texto) : `https://wa.me/${whatsapp}`;
          })()}
          variante={estado.usarWhatsapp ? "lleno" : "secundario"}
          className="sm:flex-1"
        >
          Prefiero WhatsApp
        </BotonWhatsapp>
      </div>
    </form>
  );
}

/** El error de un campo, debajo de él. `role="alert"` para que se anuncie al volver. */
function ErrorDeCampo({ id, mensaje }: { id: string; mensaje?: string }) {
  if (!mensaje) return null;
  return (
    <p id={id} role="alert" className="flex items-start gap-1.5 text-sm text-acento-texto">
      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      {mensaje}
    </p>
  );
}
