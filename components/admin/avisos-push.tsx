"use client";

import { useEffect, useState, useTransition } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";
import {
  activarAvisos,
  claveDePush,
  desactivarAvisos,
  probarAviso,
} from "@/app/admin/avisos/push-actions";

/**
 * Prender los avisos del panel en **este** dispositivo.
 *
 * El permiso de notificaciones lo da el navegador y es por dispositivo: decir
 * que sí en el teléfono no dice nada de la computadora del mostrador. Por eso
 * este botón está en la pantalla y no hay una casilla en el perfil.
 *
 * **Sin claves VAPID en el servidor no se ofrece nada**: un botón que promete
 * avisos y no los manda es peor que no tenerlo. Se dice qué falta.
 */
export function AvisosPush() {
  const [estado, setEstado] = useState<
    "cargando" | "sin-claves" | "sin-soporte" | "apagado" | "prendido"
  >("cargando");
  const [clave, setClave] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [trabajando, empezar] = useTransition();

  useEffect(() => {
    let vivo = true;

    void (async () => {
      if (
        typeof window === "undefined" ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window)
      ) {
        if (vivo) setEstado("sin-soporte");
        return;
      }

      const { clave: publica, configurado } = await claveDePush();
      if (!vivo) return;

      if (!configurado || !publica) {
        setEstado("sin-claves");
        return;
      }

      setClave(publica);

      const registro = await navigator.serviceWorker.getRegistration();
      const suscripcion = await registro?.pushManager.getSubscription();

      if (vivo) setEstado(suscripcion ? "prendido" : "apagado");
    })();

    return () => {
      vivo = false;
    };
  }, []);

  async function prender() {
    setAviso(null);

    const permiso = await Notification.requestPermission();

    if (permiso !== "granted") {
      setAviso(
        "El navegador no dio permiso. Se habilita desde el candado de la barra de direcciones.",
      );
      return;
    }

    // El ayudante ya está registrado por el mostrador con alcance de raíz; si
    // todavía no está —alguien que solo usa el panel— se registra acá.
    const registro =
      (await navigator.serviceWorker.getRegistration()) ??
      (await navigator.serviceWorker.register(
        `/sw.js?v=${process.env.NEXT_PUBLIC_BUILD_ID ?? "dev"}`,
        { scope: "/" },
      ));

    await navigator.serviceWorker.ready;

    const suscripcion = await registro.pushManager.subscribe({
      // Sin esto el navegador no entrega mensajes sin notificación visible, y
      // Chrome directamente rechaza la suscripción.
      userVisibleOnly: true,
      applicationServerKey: clave!,
    });

    const datos = suscripcion.toJSON();

    const r = await activarAvisos({
      endpoint: suscripcion.endpoint,
      p256dh: datos.keys?.p256dh ?? "",
      auth: datos.keys?.auth ?? "",
      descripcion: navigator.userAgent.slice(0, 120),
    });

    setAviso(r.error ?? r.ok ?? null);
    if (!r.error) setEstado("prendido");
  }

  async function apagar() {
    const registro = await navigator.serviceWorker.getRegistration();
    const suscripcion = await registro?.pushManager.getSubscription();

    if (suscripcion) {
      await desactivarAvisos(suscripcion.endpoint);
      await suscripcion.unsubscribe();
    }

    setEstado("apagado");
    setAviso("Este dispositivo dejó de recibir avisos.");
  }

  if (estado === "cargando") return null;

  if (estado === "sin-soporte") {
    return (
      <p className="text-base text-muted-foreground">
        Este navegador no admite avisos. En el teléfono, instalá el panel desde
        el menú del navegador («Agregar a la pantalla de inicio») y activalos
        desde ahí.
      </p>
    );
  }

  if (estado === "sin-claves") {
    return (
      <p className="text-base text-muted-foreground">
        Los avisos del panel todavía no están habilitados en el servidor: faltan
        las claves <code className="tabular">VAPID_PUBLIC_KEY</code> y{" "}
        <code className="tabular">VAPID_PRIVATE_KEY</code>. Se generan una vez y
        no vencen.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {estado === "prendido" ? (
        <>
          <span className="inline-flex items-center gap-2 text-base">
            <Bell className="h-5 w-5 text-brand-orange" />
            Este dispositivo recibe avisos
          </span>
          <button
            type="button"
            onClick={() => empezar(async () => void (await apagar()))}
            disabled={trabajando}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border px-3.5 text-base font-medium transition-colors hover:bg-muted disabled:opacity-60"
          >
            <BellOff className="h-4 w-4" />
            Apagarlos acá
          </button>
          <button
            type="button"
            onClick={() =>
              empezar(async () => {
                const r = await probarAviso();
                setAviso(r.error ?? r.ok ?? null);
              })
            }
            disabled={trabajando}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border px-3.5 text-base font-medium transition-colors hover:bg-muted disabled:opacity-60"
          >
            {trabajando && <Loader2 className="h-4 w-4 animate-spin" />}
            Probar
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => empezar(async () => void (await prender()))}
          disabled={trabajando}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-orange px-3.5 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
        >
          {trabajando ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Bell className="h-4 w-4" />
          )}
          Activar avisos en este dispositivo
        </button>
      )}

      {aviso && (
        <span className="text-base text-muted-foreground">{aviso}</span>
      )}
    </div>
  );
}
