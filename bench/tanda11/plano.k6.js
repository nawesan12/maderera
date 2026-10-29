// El plano por HTTP: cada pedido manda uno de los 200 despieces del banco.
//   k6 run -e URL=http://127.0.0.1:8291/api/v1/cortes/plano -e VUS=20 -e DURACION=20s bench/tanda11/plano.k6.js
import http from "k6/http";
import { check } from "k6";

const despieces = JSON.parse(open("./despieces.json"));

export const options = {
  vus: Number(__ENV.VUS || 20),
  duration: __ENV.DURACION || "20s",
  summaryTrendStats: ["avg", "p(50)", "p(95)", "p(99)", "max"],
};

export default function () {
  const d = despieces[Math.floor(Math.random() * despieces.length)];
  const r = http.post(__ENV.URL, JSON.stringify(d), { headers: { "Content-Type": "application/json" } });
  check(r, { "200": (x) => x.status === 200 });
}
