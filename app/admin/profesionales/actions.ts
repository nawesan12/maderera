"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { and, count, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  accountMovements,
  customers,
  orders,
  priceLists,
  professionalApplications,
  profiles,
  quotes,
} from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { rolTrasAprobarProfesional } from "@/lib/roles";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";
import { parsearImporte } from "@/lib/formato";
import { variantesDeCuit } from "@/lib/cuit";
import { decidirFicha } from "@/lib/profesionales/fichas";
import { notificarResolucionProfesional } from "@/lib/notificaciones/profesionales";

export interface EstadoProfesionales {
  error?: string;
  ok?: string;
}

type Transaccion = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * ¿La ficha está vacía? Vacía quiere decir sin nada que se pierda al
 * archivarla: ni movimientos de cuenta corriente, ni pedidos, ni presupuestos.
 * Es la condición para unir dos fichas del mismo cliente sin pensarlo dos
 * veces.
 */
async function fichaSinHistoria(
  tx: Transaccion,
  customerId: string,
): Promise<boolean> {
  const cuantos = async (tabla: typeof accountMovements | typeof orders | typeof quotes) => {
    const [fila] = await tx
      .select({ n: count() })
      .from(tabla)
      .where(eq(tabla.customerId, customerId));

    return Number(fila?.n ?? 0);
  };

  const [movimientos, pedidos, presupuestos] = await Promise.all([
    cuantos(accountMovements),
    cuantos(orders),
    cuantos(quotes),
  ]);

  return movimientos === 0 && pedidos === 0 && presupuestos === 0;
}

function refrescar() {
  revalidatePath("/admin/profesionales");
  revalidatePath("/admin/clientes");
  revalidatePath("/profesionales");
}

/**
 * Aprueba una solicitud y habilita el acceso.
 *
 * Es la única acción del portal que cambia lo que alguien paga, así que hace
 * tres cosas juntas y en una transacción:
 *
 * 1. **Vincula o crea la ficha de cliente.** Si ya hay una con ese CUIT se
 *    marca esa, nunca se crea otra: dos fichas del mismo cliente parten su
 *    cuenta corriente en dos y nadie se entera hasta que los saldos no cierran.
 *    Busca por CUIT y también por cuenta web, porque quien pide acceso estando
 *    logueado ya tiene una ficha creada por el registro del sitio.
 * 2. **Asigna la lista de precios y el límite de cuenta corriente**, que son las
 *    dos decisiones comerciales de la aprobación.
 * 3. **Marca el perfil de la cuenta web**, para que el catálogo le muestre los
 *    precios nuevos apenas recargue.
 */
export async function aprobarSolicitud(
  _previo: EstadoProfesionales,
  formData: FormData,
): Promise<EstadoProfesionales> {
  const usuario = await requireStaff();

  const parsed = z
    .object({
      id: z.string().uuid(),
      priceListId: z.string().uuid().optional(),
      limiteCredito: z.string().optional(),
    })
    .safeParse({
      id: formData.get("id"),
      priceListId: (formData.get("priceListId") as string) || undefined,
      limiteCredito: (formData.get("limiteCredito") as string) || undefined,
    });

  if (!parsed.success)
    return {
      error: "No pudimos identificar esa solicitud. Recargá la pantalla y probá de nuevo.",
    };

  const solicitud = await db
    .select()
    .from(professionalApplications)
    .where(eq(professionalApplications.id, parsed.data.id))
    .limit(1)
    .then((f) => f[0]);

  if (!solicitud) return { error: "La solicitud no existe." };
  if (solicitud.estado === "aprobada") {
    return { error: "Esta solicitud ya estaba aprobada." };
  }

  const limite = parsed.data.limiteCredito
    ? parsearImporte(parsed.data.limiteCredito)
    : 0;

  if (!Number.isFinite(limite) || limite < 0) {
    return { error: "Revisá el límite de cuenta corriente." };
  }

  let nombreLista: string | null = null;
  let advertencia: string | null = null;

  try {
    await db.transaction(async (tx) => {
      // Ficha existente por CUIT, comparando solo dígitos: en el mostrador se
      // carga con guiones y en el formulario sin ellos.
      //
      // Desde que el CUIT es opcional puede no haberlo, y entonces no se busca
      // nada: enganchar por DNI contra `customers.cuit` aparearía la ficha
      // equivocada, que es exactamente el problema que esta búsqueda evita.
      const [porCuit] = solicitud.cuit
        ? await tx
            .select({ id: customers.id, userId: customers.userId })
            .from(customers)
            .where(
              and(
                eq(customers.active, true),
                inArray(customers.cuit, variantesDeCuit(solicitud.cuit)),
              ),
            )
            .limit(1)
        : [];

      // La ficha de la cuenta web, que es la que el CUIT no encuentra: el
      // registro del sitio crea una con `userId` y sin CUIT
      // (`app/(auth)/registro/actions.ts`), así que casi todo el que pide acceso
      // estando logueado ya tiene ficha. Sin esta búsqueda, el insert de abajo
      // choca con `customers_user_idx` y **la transacción entera se cae**: no se
      // crea la ficha, no se marca la solicitud, y la solicitud aprobada nunca
      // aparece en Clientes. No se filtra por `active` porque el índice único
      // tampoco lo hace.
      const [porUsuario] = solicitud.userId
        ? await tx
            .select({ id: customers.id })
            .from(customers)
            .where(eq(customers.userId, solicitud.userId))
            .limit(1)
        : [];

      // Qué ficha gana, en `lib/profesionales/fichas.ts` con su test.
      const decision = decidirFicha({
        porCuit,
        porUsuario,
        userId: solicitud.userId,
      });

      const datosComerciales = {
        tipo: "profesional" as const,
        rubro: solicitud.rubro,
        priceListId: parsed.data.priceListId ?? null,
        limiteCredito: limite.toFixed(2),
        updatedAt: new Date(),
      };

      let customerId: string;

      if (decision.destino) {
        // La ficha de la cuenta web se suelta antes de mudar el usuario: el
        // índice único no admite dos fichas con el mismo. Si no tiene nada que
        // perder se archiva; si tiene movimientos, pedidos o presupuestos **no
        // se toca** y se avisa, porque unir dos cuentas corrientes a ciegas es
        // peor que dejar dos fichas.
        if (decision.liberar) {
          const vacia = await fichaSinHistoria(tx, decision.liberar);

          await tx
            .update(customers)
            .set({
              userId: null,
              ...(vacia
                ? {
                    active: false,
                    notas:
                      "Ficha archivada al habilitar la cuenta profesional: se unió a la ficha con CUIT.",
                  }
                : {}),
              updatedAt: new Date(),
            })
            .where(eq(customers.id, decision.liberar));

          if (!vacia) {
            advertencia =
              "Ojo: este cliente tenía dos fichas —la del mostrador y la que creó en el sitio— y la del sitio ya tiene movimientos. Revisá cuál conserva la cuenta corriente.";
          }
        }

        await tx
          .update(customers)
          .set({
            ...datosComerciales,
            // Los datos de contacto de la solicitud son más nuevos que los del
            // mostrador, pero no pisan el nombre: la ficha puede estar a nombre de
            // la empresa y la solicitud a nombre de quien la llenó.
            email: solicitud.email,
            telefono: solicitud.telefono,
            razonSocial: solicitud.razonSocial ?? undefined,
            // La cuenta web queda colgada de esta ficha, que es lo que hace
            // que el cliente vea su cuenta corriente al ingresar.
            ...(decision.vincularCuentaWeb
              ? { userId: solicitud.userId }
              : {}),
          })
          .where(eq(customers.id, decision.destino));

        customerId = decision.destino;
      } else {
        const [creado] = await tx
          .insert(customers)
          .values({
            ...datosComerciales,
            nombre: solicitud.razonSocial || solicitud.nombre,
            razonSocial: solicitud.razonSocial,
            cuit: solicitud.cuit,
            // Un profesional con CUIT factura A salvo que diga lo contrario; se
            // corrige desde la ficha si no es el caso. Con DNI no hay factura A
            // posible, así que entra como consumidor final: ponerlo inscripto
            // haría que el catálogo le muestre precios netos que no le
            // corresponden y que la factura salga con la letra equivocada.
            condicionIva: solicitud.cuit
              ? "responsable_inscripto"
              : "consumidor_final",
            email: solicitud.email,
            telefono: solicitud.telefono,
            userId: solicitud.userId,
            estado: "activo",
          })
          // Red por si dos aprobaciones de la misma persona entran a la vez: el
          // índice único de la cuenta web abortaría la transacción entera.
          .onConflictDoUpdate({
            target: customers.userId,
            set: { ...datosComerciales, active: true, estado: "activo" },
          })
          .returning({ id: customers.id });

        customerId = creado.id;
      }

      // La cuenta web, si la tiene: es lo que hace que el catálogo le muestre los
      // precios nuevos sin que nadie toque nada más. Quién conserva su rol lo
      // decide `rolTrasAprobarProfesional`, que está en `lib/roles.ts` con su test.
      if (solicitud.userId) {
        const [perfil] = await tx
          .select({ role: profiles.role })
          .from(profiles)
          .where(eq(profiles.userId, solicitud.userId))
          .limit(1);

        const rolNuevo = rolTrasAprobarProfesional(perfil?.role);

        await tx
          .update(profiles)
          .set({
            ...(rolNuevo ? { role: rolNuevo } : {}),
            priceListId: parsed.data.priceListId ?? null,
            updatedAt: new Date(),
          })
          .where(eq(profiles.userId, solicitud.userId));
      }

      await tx
        .update(professionalApplications)
        .set({
          estado: "aprobada",
          customerId,
          resueltoPor: usuario.userId,
          resueltoAt: new Date(),
          motivoRechazo: null,
          updatedAt: new Date(),
        })
        .where(eq(professionalApplications.id, solicitud.id));

      if (parsed.data.priceListId) {
        const [lista] = await tx
          .select({ nombre: priceLists.name })
          .from(priceLists)
          .where(eq(priceLists.id, parsed.data.priceListId))
          .limit(1);

        nombreLista = lista?.nombre ?? null;
      }
    });
  } catch (error) {
    // Una aprobación que revienta deja la solicitud pendiente y al
    // profesional esperando precios que nunca le llegan, así que el error se
    // dice en pantalla y queda en el registro del servidor con el número de
    // solicitud para poder buscarlo.
    console.error(`No se pudo aprobar la solicitud ${solicitud.id}`, error);

    return {
      error:
        "No pudimos habilitar esta cuenta. Fijate si el cliente ya tiene ficha cargada y avisanos si sigue pasando.",
    };
  }

  await registrarEnBitacora({
    sesion: usuario,
    accion: "cambiar_estado",
    entidad: "profesional",
    entidadId: solicitud.id,
    descripcion: `Aprobó a ${solicitud.nombre}${nombreLista ? ` con lista ${nombreLista}` : ""}`,
    // El límite de cuenta corriente es plata que se presta: queda quién lo fijó.
    detalle: { lista: nombreLista, limiteCredito: limite },
  });

  refrescar();

  after(async () => {
    await notificarResolucionProfesional(solicitud.id, {
      lista: nombreLista,
      limiteCredito: limite,
    });
  });

  return {
    ok: `${solicitud.nombre} quedó habilitado. Los precios le cambian apenas recargue.${advertencia ? ` ${advertencia}` : ""}`,
  };
}

export async function rechazarSolicitud(
  _previo: EstadoProfesionales,
  formData: FormData,
): Promise<EstadoProfesionales> {
  const usuario = await requireStaff();

  const parsed = z
    .object({
      id: z.string().uuid(),
      // El motivo es obligatorio: un rechazo sin explicación genera un llamado
      // que alguien va a tener que atender igual.
      motivo: z
        .string()
        .trim()
        .min(5, "Escribí el motivo: se lo mandamos al solicitante.")
        .max(300),
    })
    .safeParse({ id: formData.get("id"), motivo: formData.get("motivo") });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }

  await db
    .update(professionalApplications)
    .set({
      estado: "rechazada",
      motivoRechazo: parsed.data.motivo,
      resueltoPor: usuario.userId,
      resueltoAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(professionalApplications.id, parsed.data.id));

  refrescar();

  after(async () => {
    await notificarResolucionProfesional(parsed.data.id);
  });

  await registrarEnBitacora({
    sesion: usuario,
    accion: "cambiar_estado",
    entidad: "profesional",
    entidadId: parsed.data.id,
    descripcion: "Rechazó una solicitud de cuenta profesional",
  });

  return { ok: "Solicitud rechazada. Le avisamos por correo." };
}

/*
 * Acá vivían `guardarEscala` y `borrarEscala`: el alta y la baja de los
 * descuentos por volumen del profesional.
 *
 * **Se fueron porque el negocio no da descuentos por volumen.** No es que la
 * pantalla sobrara: mientras la acción existiera, el panel ofrecía cargar una
 * promesa que el mostrador después no iba a cumplir. Y una server action sin
 * formulario no queda inofensiva —sigue siendo un endpoint— así que se borró
 * entera y no solo la pantalla que la llamaba.
 *
 * El cálculo del carrito (`descuentoPorVolumen`, en `lib/dal/carrito.ts`)
 * quedó: con `volume_discounts` vacía y sin forma de cargarle nada, no aplica
 * descuento a nadie. Sacarlo es tocar cómo se suma un carrito, y eso se hace
 * con tiempo y no la noche antes de una demostración.
 */
