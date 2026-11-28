"use client";

import { useEffect } from "react";

/**
 * Registra el ayudante (public/sw.js) también desde Mi cuenta: sin él, sin
 * conexión el portal caía en la página de error del navegador (M4-069). El
 * ayudante no guarda nada del portal; solo pone el aviso de «Sin conexión».
 * Es el mismo script y el mismo alcance que el del mostrador y los avisos.
 */
export function AyudanteSinConexion() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .getRegistration()
      .then(
        (r) =>
          r ??
          navigator.serviceWorker.register(`/sw.js?v=${process.env.NEXT_PUBLIC_BUILD_ID ?? "dev"}`, { scope: "/" }),
      )
      .catch(() => undefined);
  }, []);
  return null;
}
