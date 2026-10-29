// Ventas del mostrador con una clave nueva cada vez, o un lote de LOTE
// ventas para la descarga de la cola. MODO: venta | descarga-go | descarga-ts
// | get. SUCURSAL y VARIANTE son las de la base del benchmark.
import http from "k6/http";
import { check } from "k6";
import { uuidv4 } from "./uuid.js";

export const options = {
  vus: Number(__ENV.VUS || 20),
  duration: __ENV.DURACION || "20s",
  summaryTrendStats: ["avg", "p(50)", "p(95)", "p(99)", "max"],
};

function venta(i) {
  return {
    clave: uuidv4(),
    branchId: __ENV.SUCURSAL,
    lineas: [
      { variantId: __ENV.VARIANTE, descripcion: "Placa", unidad: "placa", cantidad: 1, precioUnitario: 1000 },
      { variantId: null, descripcion: "Flete", unidad: "unidad", cantidad: 1, precioUnitario: 500 },
    ],
    customerId: null,
    contactoNombre: "Consumidor final",
    medioPago: "transferencia",
    numeroProvisorio: `K6-${uuidv4().slice(0, 13)}-${i}`,
    cobradaAt: new Date().toISOString(),
  };
}

export default function () {
  const headers = { "Content-Type": "application/json" };
  if (__ENV.COOKIE) headers.Cookie = __ENV.COOKIE;
  if (__ENV.MODO === "get") {
    const r = http.get(__ENV.URL, { headers });
    check(r, { "200": (x) => x.status === 200 });
    return;
  }
  let cuerpo;
  if (__ENV.MODO === "venta") cuerpo = venta(0);
  else {
    const lote = [];
    for (let i = 0; i < Number(__ENV.LOTE || 25); i++) lote.push(venta(i));
    cuerpo = __ENV.MODO === "descarga-go" ? { cuerpo: { ventas: lote } } : { ventas: lote };
  }
  const r = http.post(__ENV.URL, JSON.stringify(cuerpo), { headers, timeout: "120s" });
  check(r, {
    "200": (x) => x.status === 200 && !String(x.body).includes('"ok":false') && !String(x.body).includes("rechazada") && !String(x.body).includes("reintentar"),
  });
}
