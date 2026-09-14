"use client"

import { useEffect, useState } from "react"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

/**
 * Los avisos de "se guardó" y "no se pudo".
 *
 * Arriba y al centro, no abajo a la derecha: el aviso salía en la punta
 * opuesta de la pantalla, lejos de donde la persona estaba mirando cuando
 * apretó el botón, y en un monitor grande eso es medio metro de distancia. Y
 * seis segundos en vez de cuatro, porque el panel lo usa gente que no lee de
 * corrido un cartel chico que ya se está yendo.
 *
 * Y el tema sale de donde sale el del resto de la app —la clase `.dark` del
 * `<html>`, que pone `theme-toggle`—, no de una constante: estaba clavado en
 * claro con el tema oscuro andando, así que `richColors` pintaba siempre
 * contra la paleta equivocada.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const tema = useTemaDelDocumento()

  return (
    <Sonner
      theme={tema}
      className="toaster group"
      position="top-center"
      duration={6000}
      richColors
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

/** Mira la clase `.dark` del `<html>` y sigue sus cambios en vivo. */
function useTemaDelDocumento(): "light" | "dark" {
  const [tema, setTema] = useState<"light" | "dark">("light")

  useEffect(() => {
    const raiz = document.documentElement
    const leer = () =>
      setTema(raiz.classList.contains("dark") ? "dark" : "light")

    leer()
    const observador = new MutationObserver(leer)
    observador.observe(raiz, { attributes: true, attributeFilter: ["class"] })
    return () => observador.disconnect()
  }, [])

  return tema
}

export { Toaster }
