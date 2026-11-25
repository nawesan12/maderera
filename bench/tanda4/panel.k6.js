// Un pedido del panel: GET (o POST con CUERPO) a URL, con la cookie de sesión
// (Go) o sin ella (TS, con la sesión stubeada).
import http from "k6/http";
import { check } from "k6";

export const options = {
  vus: Number(__ENV.VUS || 20),
  duration: __ENV.DURACION || "20s",
  summaryTrendStats: ["avg", "p(50)", "p(95)", "p(99)", "max"],
};

export default function () {
  const headers = __ENV.COOKIE ? { Cookie: __ENV.COOKIE } : {};
  const r = __ENV.CUERPO
    ? http.post(__ENV.URL, __ENV.CUERPO, { headers: { ...headers, "Content-Type": "application/json" } })
    : http.get(__ENV.URL, { headers });
  check(r, { "200": (x) => x.status === 200 });
}
