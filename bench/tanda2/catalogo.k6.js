// Una prueba del catálogo: BASE + RUTA, con {n} cambiado por un número al
// azar (fichas distintas en cada pedido, para no medir siempre la misma fila).
import http from "k6/http";
import { check } from "k6";

export const options = {
  vus: Number(__ENV.VUS || 50),
  duration: __ENV.DURACION || "20s",
  summaryTrendStats: ["avg", "p(50)", "p(95)", "p(99)", "max"],
};

export default function () {
  const n = 1 + Math.floor(Math.random() * 79);
  const r = http.get(__ENV.URL.replace("{n}", String(n)));
  check(r, { "200": (x) => x.status === 200 });
}
