// Un documento: URL de un caso del golden en el servidor de Go o en el de TS.
import http from "k6/http";
import { check } from "k6";

export const options = {
  vus: Number(__ENV.VUS || 8),
  duration: __ENV.DURACION || "10s",
  summaryTrendStats: ["avg", "p(50)", "p(95)", "p(99)", "max"],
};

export default function () {
  const r = http.get(__ENV.URL);
  check(r, { "200": (x) => x.status === 200 });
}
