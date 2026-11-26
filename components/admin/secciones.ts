import type { LucideIcon } from "lucide-react";
import { puedeEntrar, type RolStaff } from "@/lib/roles";
import {
  Banknote,
  BarChart3,
  BookOpen,
  Boxes,
  Building2,
  CalendarCheck,
  CalendarDays,
  ClipboardList,
  CreditCard,
  DatabaseZap,
  Factory,
  FileText,
  HandCoins,
  HardHat,
  History,
  Landmark,
  LayoutDashboard,
  Mail,
  MapPin,
  Megaphone,
  MessageCircle,
  Newspaper,
  Package,
  PackagePlus,
  PhoneCall,
  Receipt,
  ReceiptText,
  Scissors,
  ShoppingBag,
  SlidersHorizontal,
  Store,
  Tags,
  Truck,
  IdCard,
  UserCog,
  Users,
  Wallet,
} from "lucide-react";

/**
 * De qué se compone el panel: las secciones y sus destinos.
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
  /*
   * Agrupado como piensa quien atiende una maderera, por lo que se hace y no
   * por módulo del sistema: vender, cobrar, comprar, el depósito, el
   * catálogo, los números y lo que se configura de vez en cuando. Antes
   * Stock estaba en Catálogo y Recepciones en Compras, Reportes en Ajustes,
   * y la tienda se prendía desde Contenido.
   */
  {
    titulo: "Vender",
    items: [
      { href: "/admin", icon: LayoutDashboard, label: "Resumen" },
      /*
       * El mostrador es una pantalla completa fuera del panel, como el taller.
       * Va igual en el menú: es la única forma de llegar sin escribir la
       * dirección, y quien atiende entra por acá cada mañana.
       */
      { href: "/mostrador", icon: Store, label: "Mostrador" },
      { href: "/admin/pedidos", icon: ShoppingBag, label: "Pedidos" },
      { href: "/admin/presupuestos", icon: ClipboardList, label: "Presupuestos" },
      { href: "/admin/cortes", icon: Scissors, label: "Cortes" },
      {
        href: "/admin/whatsapp",
        icon: MessageCircle,
        label: "WhatsApp",
        contador: "whatsapp" as const,
      },
      { href: "/admin/clientes", icon: Users, label: "Clientes" },
      { href: "/admin/profesionales", icon: HardHat, label: "Profesionales" },
    ],
  },
  {
    titulo: "Cobrar",
    items: [
      { href: "/admin/facturacion", icon: FileText, label: "Facturación" },
      { href: "/admin/pagos", icon: HandCoins, label: "Cobranzas" },
      { href: "/admin/clientes/seguimiento", icon: PhoneCall, label: "Seguimiento" },
      { href: "/admin/caja", icon: Banknote, label: "Caja" },
      { href: "/admin/cheques", icon: CreditCard, label: "Cheques" },
    ],
  },
  /* En el orden del circuito: se pide, llega, se factura, se paga. */
  {
    titulo: "Comprar",
    items: [
      { href: "/admin/proveedores", icon: Factory, label: "Proveedores" },
      { href: "/admin/compras/ordenes", icon: ClipboardList, label: "Órdenes de compra" },
      { href: "/admin/compras/facturas", icon: ReceiptText, label: "Facturas de compra" },
      { href: "/admin/compras/pagos", icon: Wallet, label: "Pagos" },
      { href: "/admin/compras/gastos", icon: Receipt, label: "Gastos" },
    ],
  },
  {
    titulo: "Depósito",
    items: [
      { href: "/admin/stock", icon: Package, label: "Stock" },
      { href: "/admin/recepciones", icon: PackagePlus, label: "Recepciones" },
      { href: "/admin/reparto", icon: Truck, label: "Reparto" },
    ],
  },
  {
    titulo: "Catálogo",
    items: [
      { href: "/admin/productos", icon: Boxes, label: "Productos" },
      { href: "/admin/precios", icon: Tags, label: "Precios" },
      { href: "/admin/documentacion", icon: BookOpen, label: "Documentación" },
    ],
  },
  {
    titulo: "Números",
    items: [
      { href: "/admin/reportes", icon: BarChart3, label: "Reportes" },
      { href: "/admin/cierre", icon: CalendarCheck, label: "Cierre del mes" },
      { href: "/admin/arca", icon: Landmark, label: "ARCA e impuestos" },
      { href: "/admin/sucursales", icon: Building2, label: "Sucursales" },
    ],
  },
  /* Lo que se toca de vez en cuando: el sitio, las reglas y los rastros. */
  {
    titulo: "Sitio y configuración",
    items: [
      { href: "/admin/contenido", icon: Newspaper, label: "Tienda y contenido" },
      { href: "/admin/eventos", icon: CalendarDays, label: "Eventos" },
      { href: "/admin/avisos", icon: Mail, label: "Avisos" },
      { href: "/admin/campanas", icon: Megaphone, label: "Campañas" },
      { href: "/admin/reglas", icon: SlidersHorizontal, label: "Reglas del negocio" },
      { href: "/admin/envios", icon: MapPin, label: "Zonas de envío" },
      { href: "/admin/personal", icon: IdCard, label: "Personal" },
      { href: "/admin/clientes/vendedores", icon: UserCog, label: "Vendedores" },
      { href: "/admin/migracion", icon: DatabaseZap, label: "Importar planillas" },
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
      // `puedeEntrar` y no la clave exacta: el menú tiene que preguntar lo
      // mismo que pregunta la página. Vendedores y Seguimiento no tienen
      // clave propia y heredan la de `/admin/clientes`; con la clave exacta
      // le aparecían al depósito y al tocarlas rebotaba.
      items: seccion.items.filter((item) => !rol || puedeEntrar(item.href, rol)),
    }))
    .filter((seccion) => seccion.items.length > 0);
}

/**
 * El nombre de la sección a la que pertenece una ruta (la de href más largo
 * que la contiene), para el aviso del rebote de permisos. Null si no es de
 * ninguna: el aviso no repite una dirección que vino en la URL.
 */
export function nombreDeSeccion(ruta: string): string | null {
  let mejor: ItemNav | null = null;
  for (const seccion of secciones) {
    for (const item of seccion.items) {
      const contiene = ruta === item.href || ruta.startsWith(item.href + "/");
      if (contiene && (!mejor || item.href.length > mejor.href.length)) mejor = item;
    }
  }
  return mejor && mejor.href !== "/admin" ? mejor.label : null;
}

/** El parámetro con que el panel rebota a quien no puede entrar. */
export const PARAMETRO_SIN_ACCESO = "sin-acceso";

/**
 * El destino del rebote: el inicio del rol, con la ruta que no pudo abrir.
 * El resumen del panel no lleva aviso: es a donde se cae por omisión (el
 * aserradero que abre /admin va a su taller sin más).
 */
export function rebote(inicio: string, ruta: string): string {
  if (!ruta || ruta === "/admin") return inicio;
  return `${inicio}?${PARAMETRO_SIN_ACCESO}=${encodeURIComponent(ruta)}`;
}
