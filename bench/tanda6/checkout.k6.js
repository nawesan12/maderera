// El benchmark de la tanda 6. MODO:
//   compra-go / compra-ts: cada iteración arma un carrito nuevo (agregar) y lo
//     confirma; se mide solo la confirmación (la métrica `confirmar`). Cada
//     compra va con otra IP (X-Forwarded-For) y otro correo: el freno
//     «comprar» es de 10 por hora y acá se mide la compra, no el freno.
//   webhook: el aviso de Mercado Pago firmado (FIRMA_SECRETO), al webhook.
//   get: un GET (el listado de pagos), con la cookie si hay.
import http from "k6/http";
import crypto from "k6/crypto";
import { check } from "k6";
import { Trend, Counter } from "k6/metrics";
import { uuidv4 } from "./uuid.js";

export const options = {
  vus: Number(__ENV.VUS || 20),
  duration: __ENV.DURACION || "20s",
  summaryTrendStats: ["avg", "p(50)", "p(95)", "p(99)", "max"],
};

const confirmar = new Trend("confirmar", true);
const compras = new Counter("compras");

function ip() {
  return `10.${(__VU % 250) + 1}.${__ITER % 250}.${Math.floor(Math.random() * 250) + 1}`;
}

function datos() {
  return {
    nombre: "Banco de pruebas",
    email: `k6-${uuidv4()}@bench.test`,
    telefono: "2235550000",
    entrega: "retiro",
    sucursalId: __ENV.SUCURSAL,
    medioPago: "transferencia",
  };
}

const json = (extra) => ({ headers: Object.assign({ "Content-Type": "application/json" }, extra) });

export default function () {
  const modo = __ENV.MODO;
  if (modo === "compra-go") {
    const cabeceras = { "X-Forwarded-For": ip() };
    const a = http.post(`${__ENV.URL}/carrito/items`, JSON.stringify({ variantId: __ENV.VARIANTE, descripcion: "Banco", cantidad: 1 }), json(cabeceras));
    check(a, { agregado: (r) => r.status === 200 });
    const r = http.post(`${__ENV.URL}/carrito/confirmar`, JSON.stringify(datos()), json(cabeceras));
    confirmar.add(r.timings.duration);
    if (check(r, { compra: (x) => x.status === 200 })) compras.add(1);
    return;
  }
  if (modo === "compra-ts") {
    const token = uuidv4();
    const cabeceras = { "X-Forwarded-For": ip() };
    const a = http.post(`${__ENV.URL}/agregar`, JSON.stringify({ token, variantId: __ENV.VARIANTE, cantidad: 1 }), json(cabeceras));
    check(a, { agregado: (r) => r.status === 200 });
    const r = http.post(`${__ENV.URL}/confirmar`, JSON.stringify(Object.assign({ token }, datos())), json(cabeceras));
    confirmar.add(r.timings.duration);
    if (check(r, { compra: (x) => x.status === 200 && x.body.indexOf('"numero"') >= 0 })) compras.add(1);
    return;
  }
  if (modo === "webhook") {
    const pago = String(1000000 + Math.floor(Math.random() * 1e9));
    const req = uuidv4();
    const ts = Math.floor(Date.now() / 1000);
    const v1 = crypto.hmac("sha256", __ENV.FIRMA_SECRETO, `id:${pago};request-id:${req};ts:${ts};`, "hex");
    const cuerpo = JSON.stringify({ action: "payment.updated", api_version: "v1", data: { id: pago }, id: Math.floor(Math.random() * 1e9), live_mode: false, type: "payment" });
    const r = http.post(`${__ENV.URL}?data.id=${pago}&type=payment`, cuerpo, json({ "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": req }));
    check(r, { aceptado: (x) => x.status === 200 });
    return;
  }
  const r = http.get(__ENV.URL, __ENV.COOKIE ? { headers: { Cookie: __ENV.COOKIE } } : {});
  check(r, { bien: (x) => x.status === 200 });
}
