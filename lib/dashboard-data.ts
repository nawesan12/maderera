// KPIs
export const kpis = {
  ventasMes: { value: "$14.850.000", change: "+12.5%", trend: "up" as const },
  presupuestosPendientes: { value: "23", change: "-3", trend: "down" as const },
  productosStockBajo: { value: "18", change: "+5", trend: "up" as const },
  clientesActivos: { value: "142", change: "+8", trend: "up" as const },
};

// Ventas mensuales (últimos 6 meses)
export const ventasMensuales = [
  { mes: "Nov", central: 8200000, aserradero: 4100000 },
  { mes: "Dic", central: 9800000, aserradero: 5200000 },
  { mes: "Ene", central: 7500000, aserradero: 3800000 },
  { mes: "Feb", central: 10200000, aserradero: 5800000 },
  { mes: "Mar", central: 11500000, aserradero: 6200000 },
  { mes: "Abr", central: 9200000, aserradero: 5650000 },
];

// Presupuestos
export type PresupuestoEstado = "pendiente" | "revision" | "enviado" | "aceptado" | "rechazado";

export interface Presupuesto {
  id: string;
  fecha: string;
  cliente: string;
  empresa: string;
  items: number;
  total: string;
  estado: PresupuestoEstado;
  sucursal: string;
  asesor: string;
}

export const presupuestos: Presupuesto[] = [
  { id: "P-2026-0421", fecha: "08/04/2026", cliente: "Arq. Carolina Méndez", empresa: "Estudio CM", items: 12, total: "$2.450.000", estado: "pendiente", sucursal: "Central", asesor: "Martín" },
  { id: "P-2026-0420", fecha: "07/04/2026", cliente: "Roberto Fernández", empresa: "RF Construcciones", items: 28, total: "$8.200.000", estado: "revision", sucursal: "Aserradero", asesor: "Diego" },
  { id: "P-2026-0419", fecha: "07/04/2026", cliente: "Laura Gómez", empresa: "Constructora del Sur", items: 8, total: "$1.180.000", estado: "enviado", sucursal: "Central", asesor: "Martín" },
  { id: "P-2026-0418", fecha: "06/04/2026", cliente: "Martín Pérez", empresa: "Carpintería Pérez", items: 5, total: "$320.000", estado: "aceptado", sucursal: "Central", asesor: "Diego" },
  { id: "P-2026-0417", fecha: "05/04/2026", cliente: "Ana Torres", empresa: "AT Diseño", items: 15, total: "$3.750.000", estado: "aceptado", sucursal: "Aserradero", asesor: "Martín" },
  { id: "P-2026-0416", fecha: "05/04/2026", cliente: "Jorge Ruiz", empresa: "Particular", items: 3, total: "$185.000", estado: "rechazado", sucursal: "Central", asesor: "Diego" },
  { id: "P-2026-0415", fecha: "04/04/2026", cliente: "Ing. Facundo López", empresa: "López & Asoc.", items: 22, total: "$5.900.000", estado: "aceptado", sucursal: "Aserradero", asesor: "Martín" },
  { id: "P-2026-0414", fecha: "03/04/2026", cliente: "Sofía Martínez", empresa: "Particular", items: 7, total: "$420.000", estado: "enviado", sucursal: "Central", asesor: "Diego" },
];

// Pedidos
export type PedidoEstado = "preparando" | "listo" | "en-camino" | "entregado";

export interface Pedido {
  id: string;
  fecha: string;
  cliente: string;
  items: string;
  total: string;
  estado: PedidoEstado;
  sucursal: string;
  tipo: "retiro" | "entrega";
  direccion?: string;
}

export const pedidos: Pedido[] = [
  { id: "PED-1205", fecha: "08/04/2026 09:30", cliente: "Arq. Carolina Méndez", items: "12 placas melamina + corte", total: "$2.450.000", estado: "preparando", sucursal: "Central", tipo: "retiro" },
  { id: "PED-1204", fecha: "08/04/2026 08:15", cliente: "Roberto Fernández", items: "28 tirantes + machimbre", total: "$8.200.000", estado: "listo", sucursal: "Aserradero", tipo: "entrega", direccion: "Av. Colón 3200" },
  { id: "PED-1203", fecha: "07/04/2026 16:45", cliente: "Martín Pérez", items: "5 molduras Moldava", total: "$320.000", estado: "en-camino", sucursal: "Central", tipo: "entrega", direccion: "Güemes 1800" },
  { id: "PED-1202", fecha: "07/04/2026 14:20", cliente: "Laura Gómez", items: "8 placas yeso + perfiles", total: "$1.180.000", estado: "entregado", sucursal: "Central", tipo: "entrega", direccion: "Independencia 2500" },
  { id: "PED-1201", fecha: "07/04/2026 10:00", cliente: "Ana Torres", items: "15 deck grandis + estructura", total: "$3.750.000", estado: "entregado", sucursal: "Aserradero", tipo: "retiro" },
  { id: "PED-1200", fecha: "06/04/2026 15:30", cliente: "Ing. Facundo López", items: "22 tirantes saligna", total: "$5.900.000", estado: "entregado", sucursal: "Aserradero", tipo: "entrega", direccion: "Ruta 2 km 398" },
];

// Clientes profesionales
export interface Cliente {
  id: string;
  nombre: string;
  empresa: string;
  cuit: string;
  rubro: string;
  asesor: string;
  saldo: string;
  ultimaCompra: string;
  totalCompras: string;
  estado: "activo" | "moroso" | "inactivo";
}

export const clientes: Cliente[] = [
  { id: "C001", nombre: "Arq. Carolina Méndez", empresa: "Estudio CM Arquitectura", cuit: "27-32456789-4", rubro: "Arquitectura", asesor: "Martín", saldo: "$0", ultimaCompra: "08/04/2026", totalCompras: "$18.500.000", estado: "activo" },
  { id: "C002", nombre: "Roberto Fernández", empresa: "RF Construcciones SRL", cuit: "30-71234567-8", rubro: "Construcción", asesor: "Diego", saldo: "-$1.200.000", ultimaCompra: "07/04/2026", totalCompras: "$42.300.000", estado: "activo" },
  { id: "C003", nombre: "Martín Pérez", empresa: "Carpintería Pérez", cuit: "20-28765432-1", rubro: "Carpintería", asesor: "Diego", saldo: "$0", ultimaCompra: "06/04/2026", totalCompras: "$5.200.000", estado: "activo" },
  { id: "C004", nombre: "Ing. Facundo López", empresa: "López & Asociados", cuit: "30-70987654-3", rubro: "Ingeniería Civil", asesor: "Martín", saldo: "-$3.800.000", ultimaCompra: "04/04/2026", totalCompras: "$67.100.000", estado: "activo" },
  { id: "C005", nombre: "Laura Gómez", empresa: "Constructora del Sur SA", cuit: "30-71567890-2", rubro: "Construcción", asesor: "Martín", saldo: "$0", ultimaCompra: "03/04/2026", totalCompras: "$28.900.000", estado: "activo" },
  { id: "C006", nombre: "Ana Torres", empresa: "AT Diseño Interior", cuit: "27-34567890-6", rubro: "Diseño Interior", asesor: "Martín", saldo: "-$450.000", ultimaCompra: "01/04/2026", totalCompras: "$12.700.000", estado: "moroso" },
  { id: "C007", nombre: "Carlos Vega", empresa: "Vega Muebles", cuit: "20-25678901-5", rubro: "Mueblería", asesor: "Diego", saldo: "$0", ultimaCompra: "15/02/2026", totalCompras: "$3.100.000", estado: "inactivo" },
];

// Cola de cortes
export type CorteEstado = "en-cola" | "en-proceso" | "terminado" | "retirado";

export interface Corte {
  id: string;
  fecha: string;
  cliente: string;
  placa: string;
  piezas: number;
  estado: CorteEstado;
  sucursal: string;
  notas?: string;
}

export const cortes: Corte[] = [
  { id: "CRT-458", fecha: "08/04 10:30", cliente: "Arq. Carolina Méndez", placa: "Melamina Blanca 18mm (x4)", piezas: 12, estado: "en-cola", sucursal: "Central", notas: "Urgente - obra en curso" },
  { id: "CRT-457", fecha: "08/04 09:15", cliente: "Sofía Martínez", placa: "MDF 15mm (x2)", piezas: 8, estado: "en-proceso", sucursal: "Central" },
  { id: "CRT-456", fecha: "08/04 08:00", cliente: "Ana Torres", placa: "Melamina Roble 18mm (x6)", piezas: 24, estado: "en-proceso", sucursal: "Central", notas: "Vestidor completo" },
  { id: "CRT-455", fecha: "07/04 16:00", cliente: "Martín Pérez", placa: "Fenólico 18mm (x1)", piezas: 4, estado: "terminado", sucursal: "Central" },
  { id: "CRT-454", fecha: "07/04 14:30", cliente: "Roberto Fernández", placa: "Melamina Blanca 18mm (x8)", piezas: 32, estado: "terminado", sucursal: "Central", notas: "Cocina completa - cliente retira mañana" },
  { id: "CRT-453", fecha: "07/04 11:00", cliente: "Laura Gómez", placa: "Terciado 12mm (x2)", piezas: 6, estado: "retirado", sucursal: "Central" },
];

// Métricas por sucursal
export const sucursalMetricas = {
  central: {
    nombre: "Casa Central",
    ventasHoy: "$1.250.000",
    pedidosHoy: 8,
    cortesEnCola: 3,
    stockValor: "$45.200.000",
    clientesAtendidos: 12,
    productosStockBajo: 11,
  },
  aserradero: {
    nombre: "Aserradero",
    ventasHoy: "$890.000",
    pedidosHoy: 5,
    cortesEnCola: 0,
    stockValor: "$32.800.000",
    clientesAtendidos: 7,
    productosStockBajo: 7,
  },
};

// Stock alerts
export const stockAlerts = [
  { producto: "Melamina Blanca 18mm", sucursal: "Central", stock: 3, minimo: 10 },
  { producto: "Tirante Saligna 3x6", sucursal: "Central", stock: 2, minimo: 8 },
  { producto: "Fenólico 18mm", sucursal: "Aserradero", stock: 4, minimo: 12 },
  { producto: "Lana de Vidrio 50mm", sucursal: "Aserradero", stock: 1, minimo: 5 },
  { producto: "Piso Melamínico Nogal", sucursal: "Central", stock: 5, minimo: 15 },
  { producto: "Placa Yeso STD 12.5mm", sucursal: "Aserradero", stock: 6, minimo: 20 },
];

// Transferencias entre sucursales
export const transferencias = [
  { id: "TR-089", fecha: "08/04/2026", producto: "Tirante Pino 2x6", cantidad: 20, origen: "Aserradero", destino: "Central", estado: "en-transito" },
  { id: "TR-088", fecha: "07/04/2026", producto: "Moldura Zócalo 7cm", cantidad: 50, origen: "Aserradero", destino: "Central", estado: "completado" },
  { id: "TR-087", fecha: "06/04/2026", producto: "Deck Grandis", cantidad: 30, origen: "Aserradero", destino: "Central", estado: "completado" },
];
