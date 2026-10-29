// Un pedido de facturación: GET (o POST con CUERPO) a URL, con la cookie de
// sesión o el secreto interno (Go) o sin nada (TS, con la sesión stubeada).
// Con AUTORIZADO=1, además cuenta como fallo una venta que quedó sin CAE.
import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";

const sinCae = new Counter("sin_cae");

export const options = {
  vus: Number(__ENV.VUS || 20),
  duration: __ENV.DURACION || "20s",
  summaryTrendStats: ["avg", "p(50)", "p(95)", "p(99)", "max"],
};

export default function () {
  const headers = {};
  if (__ENV.COOKIE) headers.Cookie = __ENV.COOKIE;
  if (__ENV.AUTH) headers.Authorization = __ENV.AUTH;
  const r = __ENV.METODO === "POST"
    ? http.post(__ENV.URL, __ENV.CUERPO || "", { headers: { ...headers, "Content-Type": "application/json" } })
    : http.get(__ENV.URL, { headers });
  const ok = check(r, { "200": (x) => x.status === 200 });
  if (ok && __ENV.AUTORIZADO === "1") {
    const autorizado = r.json("autorizado") === true;
    if (!autorizado) sinCae.add(1);
    check(r, { autorizado: () => autorizado });
  }
}
