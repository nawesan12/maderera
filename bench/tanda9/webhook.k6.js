// El webhook de Meta en ráfaga: cada iteración es un mensaje nuevo de un
// cliente, firmado como lo firma Meta (X-Hub-Signature-256).
import http from "k6/http";
import crypto from "k6/crypto";
import { check } from "k6";

// Una cantidad fija de mensajes (no una duración): los dos lados encolan lo
// mismo, y después se mide cuánto tarda en procesarse.
export const options = {
  scenarios: { rafaga: { executor: "shared-iterations", vus: Number(__ENV.VUS || 50), iterations: Number(__ENV.MENSAJES || 5000), maxDuration: "5m" } },
  summaryTrendStats: ["avg", "p(50)", "p(95)", "p(99)", "max"],
};

export default function () {
  const id = `${__ENV.PREFIJO || "x"}-${__VU}-${__ITER}`;
  const de = `549223${(6000000 + ((__VU * 100000 + __ITER) % 900000)).toString()}`;
  const cuerpo = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "102290129340398", changes: [{ field: "messages", value: {
      messaging_product: "whatsapp",
      metadata: { display_phone_number: "5492235903118", phone_number_id: "106540352242922" },
      contacts: [{ profile: { name: "Cliente " + __VU }, wa_id: de }],
      messages: [{ from: de, id: "wamid." + id, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "Hola, ¿tienen fenólico de 18? " + id } }],
    } }] }],
  });
  const firma = "sha256=" + crypto.hmac("sha256", "secreto-de-prueba", cuerpo, "hex");
  const r = http.post(__ENV.URL, cuerpo, { headers: { "Content-Type": "application/json", "X-Hub-Signature-256": firma } });
  check(r, { "200": (x) => x.status === 200 });
}
