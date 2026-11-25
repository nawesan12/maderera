// Carga de la lectura de sesión: GET con la cookie de una sesión real.
//   k6 run -e URL=http://127.0.0.1:8081/api/v1/sesion -e COOKIE="better-auth.session_token=…" bench/tanda1/sesion.k6.js
import http from "k6/http";
import { check } from "k6";

export const options = {
  scenarios: {
    sesion: { executor: "constant-vus", vus: Number(__ENV.VUS || 50), duration: __ENV.DURACION || "20s" },
  },
  summaryTrendStats: ["avg", "p(50)", "p(95)", "p(99)", "max"],
};

export default function () {
  const r = http.get(__ENV.URL, { headers: { cookie: __ENV.COOKIE } });
  check(r, { "200": (x) => x.status === 200 });
}
