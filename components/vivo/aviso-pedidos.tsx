"use client";

import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useEnVivo } from "@/lib/vivo/use-en-vivo";

/**
 * «Entró un pedido web», en cualquier pantalla del panel.
 *
 * El aviso push ya existía, pero llega al teléfono; quien está en el panel
 * atendiendo el mostrador no lo ve. Este aparece donde está trabajando, con un
 * botón para abrirlo. Si la pantalla es la de pedidos o el resumen, además se
 * refresca: el pedido nuevo tiene que estar en la lista sin recargar.
 *
 * Solo lo reciben los roles que pueden abrir los pedidos: el canal lo filtra
 * el servidor.
 */
export function AvisoDePedidosEnVivo() {
  const router = useRouter();
  const ruta = usePathname();

  useEnVivo(["pedidos"], (aviso) => {
    if (aviso.canal !== "pedidos") return;

    if (ruta === "/admin" || ruta.startsWith("/admin/pedidos") || ruta.startsWith("/admin/reparto")) router.refresh();

    // Cualquier pedido nuevo o que cambia de estado refresca la pantalla; el
    // aviso es solo para lo que entra por la tienda (los del panel los cargó
    // alguien que ya sabe que existen). Un evento viejo, sin «nuevo», es el
    // de la tienda de siempre.
    if (aviso.nuevo === false || (aviso.origen && aviso.origen !== "tienda")) return;

    toast.info(aviso.numero ? `Entró un pedido web: ${aviso.numero}` : "Entró un pedido web", {
      duration: 20_000,
      action: aviso.id
        ? { label: "Verlo", onClick: () => router.push(`/admin/pedidos/${aviso.id}`) }
        : undefined,
    });
  });

  return null;
}
