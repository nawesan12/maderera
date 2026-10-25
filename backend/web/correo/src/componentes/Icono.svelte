<script lang="ts" module>
  // Los íconos son los de Lucide (licencia ISC), uno por archivo para que
  // Vite meta en el paquete solo los que se usan. Los componentes los piden
  // por un nombre en castellano, así un cambio de ícono se hace acá.
  import Inbox from "@lucide/svelte/icons/inbox";
  import Send from "@lucide/svelte/icons/send";
  import FilePen from "@lucide/svelte/icons/file-pen";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import ShieldAlert from "@lucide/svelte/icons/shield-alert";
  import Archive from "@lucide/svelte/icons/archive";
  import Folder from "@lucide/svelte/icons/folder";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Search from "@lucide/svelte/icons/search";
  import Star from "@lucide/svelte/icons/star";
  import Paperclip from "@lucide/svelte/icons/paperclip";
  import Reply from "@lucide/svelte/icons/reply";
  import ReplyAll from "@lucide/svelte/icons/reply-all";
  import Forward from "@lucide/svelte/icons/forward";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import X from "@lucide/svelte/icons/x";
  import Menu from "@lucide/svelte/icons/menu";
  import Mail from "@lucide/svelte/icons/mail";
  import MailOpen from "@lucide/svelte/icons/mail-open";
  import MailCheck from "@lucide/svelte/icons/mail-check";
  import LogOut from "@lucide/svelte/icons/log-out";
  import Settings from "@lucide/svelte/icons/settings";
  import ArchiveRestore from "@lucide/svelte/icons/archive-restore";
  import Download from "@lucide/svelte/icons/download";
  import ImageIcon from "@lucide/svelte/icons/image";
  import ImageOff from "@lucide/svelte/icons/image-off";
  import RotateCw from "@lucide/svelte/icons/rotate-cw";
  import SlidersHorizontal from "@lucide/svelte/icons/sliders-horizontal";
  import LayoutGrid from "@lucide/svelte/icons/layout-grid";
  import Moon from "@lucide/svelte/icons/moon";
  import Sun from "@lucide/svelte/icons/sun";
  import EllipsisVertical from "@lucide/svelte/icons/ellipsis-vertical";
  import Eye from "@lucide/svelte/icons/eye";
  import FileText from "@lucide/svelte/icons/file-text";
  import FileSpreadsheet from "@lucide/svelte/icons/file-spreadsheet";
  import FileDown from "@lucide/svelte/icons/file-down";
  import WifiOff from "@lucide/svelte/icons/wifi-off";
  import CloudOff from "@lucide/svelte/icons/cloud-off";
  import Lock from "@lucide/svelte/icons/lock";
  import ClipboardList from "@lucide/svelte/icons/clipboard-list";
  import Truck from "@lucide/svelte/icons/truck";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronUp from "@lucide/svelte/icons/chevron-up";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Minus from "@lucide/svelte/icons/minus";
  import Plus from "@lucide/svelte/icons/plus";
  import Maximize2 from "@lucide/svelte/icons/maximize-2";
  import Check from "@lucide/svelte/icons/check";
  import Tag from "@lucide/svelte/icons/tag";
  import FolderInput from "@lucide/svelte/icons/folder-input";
  import Printer from "@lucide/svelte/icons/printer";
  import ZoomIn from "@lucide/svelte/icons/zoom-in";
  import ZoomOut from "@lucide/svelte/icons/zoom-out";
  import UserRound from "@lucide/svelte/icons/user-round";
  import MessageSquareText from "@lucide/svelte/icons/message-square-text";
  import Keyboard from "@lucide/svelte/icons/keyboard";
  import FolderDown from "@lucide/svelte/icons/folder-down";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import Clock from "@lucide/svelte/icons/clock";
  import PenLine from "@lucide/svelte/icons/pen-line";
  import Scissors from "@lucide/svelte/icons/scissors";
  import Ban from "@lucide/svelte/icons/ban";

  const iconos = {
    entrada: Inbox,
    enviados: Send,
    enviar: Send,
    borradores: FilePen,
    papelera: Trash2,
    spam: ShieldAlert,
    archivo: Archive,
    carpeta: Folder,
    lapiz: Pencil,
    buscar: Search,
    estrella: Star,
    clip: Paperclip,
    responder: Reply,
    "responder-todos": ReplyAll,
    reenviar: Forward,
    atras: ArrowLeft,
    cerrar: X,
    menu: Menu,
    sobre: Mail,
    "sobre-abierto": MailOpen,
    "todo-leido": MailCheck,
    salir: LogOut,
    ajustes: Settings,
    restaurar: ArchiveRestore,
    descargar: Download,
    imagen: ImageIcon,
    "sin-imagenes": ImageOff,
    refrescar: RotateCw,
    filtros: SlidersHorizontal,
    panel: LayoutGrid,
    luna: Moon,
    sol: Sun,
    mas: EllipsisVertical,
    ver: Eye,
    pdf: FileText,
    planilla: FileSpreadsheet,
    "bajar-pdf": FileDown,
    "sin-red": WifiOff,
    "sin-servidor": CloudOff,
    candado: Lock,
    presupuesto: ClipboardList,
    pedido: Truck,
    "flecha-abajo": ChevronDown,
    "flecha-arriba": ChevronUp,
    "flecha-izquierda": ChevronLeft,
    "flecha-derecha": ChevronRight,
    minimizar: Minus,
    mas_uno: Plus,
    agrandar: Maximize2,
    tilde: Check,
    etiqueta: Tag,
    mover: FolderInput,
    imprimir: Printer,
    acercar: ZoomIn,
    alejar: ZoomOut,
    persona: UserRound,
    respuestas: MessageSquareText,
    teclado: Keyboard,
    "bajar-carpeta": FolderDown,
    afuera: ExternalLink,
    reloj: Clock,
    firma: PenLine,
    cortes: Scissors,
    bloquear: Ban,
  } as const;
  export type NombreIcono = keyof typeof iconos;
</script>

<script lang="ts">
  let { nombre, tamano = 18, relleno = false }: { nombre: NombreIcono; tamano?: number; relleno?: boolean } = $props();
  const Componente = $derived(iconos[nombre]);
</script>

<Componente size={tamano} fill={relleno ? "currentColor" : "none"} strokeWidth={2} aria-hidden="true" />
