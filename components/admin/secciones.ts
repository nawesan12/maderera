import type { LucideIcon } from "lucide-react";
import { quienEntra, type RolStaff } from "@/lib/roles";
import {
  Banknote,
  BarChart3,
  BookOpen,
  Boxes,
  Building2,
  Calculator,
  CalendarCheck,
  CalendarDays,
  ClipboardList,
  DatabaseZap,
  FileText,
  HardHat,
  History,
  Landmark,
  LayoutDashboard,
  Mail,
  MapPin,
  MessageCircle,
  Newspaper,
  Package,
  PackagePlus,
  Receipt,
  ReceiptText,
  Scissors,
  Store,
  Tags,
  Truck,
  Users,
  Wallet,
} from "lucide-react";

/**
 * De qué se compone el panel: las seis secciones y sus destinos.
 *
 * **Vive fuera del menú lateral a propósito.** `sidebar.tsx` es `"use client"`
 * —necesita `usePathname` para marcar dónde está uno— y desde un componente de
 * servidor no se puede llamar a una función que quedó del otro lado de esa
 * frontera. El resumen del panel arma su grilla de botones con esta misma
 * lista, y sin separarla la pantalla compila pero revienta al abrirla.
 *
 * Que la lista sea una sola importa más que dónde vive: el menú y el resumen
 * ofrecen exactamente los mismos destinos, y agregar una sección se hace una
 * vez.
 */
/**
 * Navegación del panel.
 *
 * Casi sin contadores: los que había antes estaban escritos a mano y no se
 * correspondían con nada, y un número que no es cierto es peor que ningún
 * número porque se deja de mirar. Lo que hay que atender aparece dentro de cada
 * pantalla, donde además se puede resolver.
 *
 * La excepción es WhatsApp, y por un motivo concreto: un mensaje sin contestar
 * no se ve desde ninguna otra pantalla y el cliente está del otro lado
 * esperando. Ese contador sale de la base, no de una constante.
 */
export interface ItemNav {
  href: string;
  icon: LucideIcon;
  label: string;
  /** El único contador del menú; sale de la base. */
  contador?: "whatsapp";
  /*
   * Quién la ve **no se declara acá**: sale de `ACCESO`, que es la misma lista
   * que exigen las páginas. Tenerla en dos lugares fue justamente el problema:
   * el menú escondía Precios y la página lo dejaba entrar igual.
   */
}

/**
 * El panel entero, agrupado.
 *
 * Se exporta porque el resumen lo dibuja como botones grandes: es el mismo
 * menú, en otra forma. Tenerlo dos veces sería repetir el problema que este
 * archivo ya documenta —dos listas del mismo dato terminan diciendo cosas
 * distintas—, y encima en la pantalla que existe para no tener que buscar.
 *
 * Quién ve cada cosa sigue saliendo de `ACCESO`, no de acá: para filtrarla está
 * `seccionesPara`.
 */
export const secciones: { titulo: string; items: ItemNav[] }[] = [
  {
    titulo: "Operación",
    items: [
      { href: "/admin", icon: LayoutDashboard, label: "Resumen" },
      { href: "/admin/pedidos", icon: Truck, label: "Pedidos" },
      {
        href: "/admin/whatsapp",
        icon: MessageCircle,
        label: "WhatsApp",
        contador: "whatsapp" as const,
      },
      {
        href: "/admin/presupuestos",
        icon: ClipboardList,
        label: "Presupuestos",
      },
      { href: "/admin/cortes", icon: Scissors, label: "Cortes" },
      /*
       * El mostrador es una pantalla completa fuera del panel, como el taller.
       * Va igual en el menú: es la única forma de llegar sin escribir la
       * dirección, y quien atiende entra por acá cada mañana.
       */
      {
        href: "/mostrador",
        icon: Store,
        label: "Mostrador",
      },
    ],
  },
  {
    titulo: "Catálogo",
    items: [
      { href: "/admin/productos", icon: Boxes, label: "Productos" },
      { href: "/admin/stock", icon: Package, label: "Stock" },
      { href: "/admin/precios", icon: Tags, label: "Precios" },
      { href: "/admin/calculadoras", icon: Calculator, label: "Calculadoras" },
    ],
  },
  {
    titulo: "Compras",
    items: [
      { href: "/admin/proveedores", icon: Truck, label: "Proveedores" },
      {
        href: "/admin/compras/ordenes",
        icon: ClipboardList,
        label: "Órdenes de compra",
      },
      { href: "/admin/recepciones", icon: PackagePlus, label: "Recepciones" },
      {
        href: "/admin/compras/facturas",
        icon: ReceiptText,
        label: "Facturas de compra",
      },
      { href: "/admin/compras/pagos", icon: Wallet, label: "Pagos" },
      { href: "/admin/cheques", icon: Banknote, label: "Cheques" },
      { href: "/admin/compras/gastos", icon: Receipt, label: "Gastos" },
    ],
  },
  /*
   * Ventas tiene grupo propio, y antes no.
   *
   * "Administración" juntaba dieciséis ítems que eran cuatro cosas distintas:
   * la cobranza, el trato con el cliente, el sitio y la configuración. La
   * asimetría se notaba al lado de Compras, que sí tiene su grupo con los siete
   * pasos en orden cronológico, mientras que el circuito de venta quedaba
   * partido entre Operación (presupuesto y pedido) y ese cajón (factura y
   * cobro).
   *
   * El orden de adentro es el del circuito, no el alfabético: se factura,
   * se cobra, entra a la caja, se declara y se cierra el mes.
   */
  {
    titulo: "Ventas",
    items: [
      { href: "/admin/clientes", icon: Users, label: "Clientes" },
      { href: "/admin/profesionales", icon: HardHat, label: "Profesionales" },
      { href: "/admin/facturacion", icon: FileText, label: "Facturación" },
      { href: "/admin/pagos", icon: Wallet, label: "Cobros" },
      { href: "/admin/caja", icon: Banknote, label: "Caja" },
      { href: "/admin/arca", icon: Landmark, label: "ARCA" },
      { href: "/admin/cierre", icon: CalendarCheck, label: "Cierre del mes" },
    ],
  },
  {
    titulo: "Sitio",
    items: [
      { href: "/admin/contenido", icon: Newspaper, label: "Contenido" },
      { href: "/admin/eventos", icon: CalendarDays, label: "Eventos" },
      { href: "/admin/documentacion", icon: BookOpen, label: "Documentación" },
      { href: "/admin/avisos", icon: Mail, label: "Avisos" },
    ],
  },
  /* Lo que se toca de vez en cuando: reglas, datos del negocio y rastros. */
  {
    titulo: "Ajustes",
    items: [
      { href: "/admin/reportes", icon: BarChart3, label: "Reportes" },
      { href: "/admin/sucursales", icon: Building2, label: "Sucursales" },
      { href: "/admin/envios", icon: MapPin, label: "Envíos" },
      { href: "/admin/migracion", icon: DatabaseZap, label: "Migración" },
      { href: "/admin/bitacora", icon: History, label: "Bitácora" },
    ],
  },
];

/**
 * Las secciones que le corresponden a un rol, con sus ítems ya filtrados.
 *
 * La usan el menú lateral y el resumen. El permiso sale de `ACCESO` —la misma
 * lista que exigen las páginas— y no de una marca puesta en cada ítem: tenerlo
 * en dos lugares fue el problema que dejaba el menú escondiendo Precios
 * mientras la página lo dejaba entrar igual.
 *
 * Sin rol se devuelve todo: es el caso de quien todavía no se resolvió, y el
 * servidor vuelve a chequear en cada página.
 */
export function seccionesPara(rol?: RolStaff | null) {
  return secciones
    .map((seccion) => ({
      ...seccion,
      items: seccion.items.filter((item) => {
        const permitidos = quienEntra(item.href);
        return !permitidos || !rol || permitidos.includes(rol);
      }),
    }))
    .filter((seccion) => seccion.items.length > 0);
}
