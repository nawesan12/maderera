"""Antes de medir: que los dos lados den lo mismo (ver README.md).

  python3 bench/tanda10/comparar.py "<cookie admin de Go>" "<cookie del profesional>"
"""
import json
import sys
import urllib.request

admin, pro = sys.argv[1], sys.argv[2]
G, T = "http://127.0.0.1:8210/api/v1", "http://127.0.0.1:8310"


def get(url, cookie=None, cuerpo=None):
    req = urllib.request.Request(url, data=json.dumps(cuerpo).encode() if cuerpo else None)
    if cookie:
        req.add_header("Cookie", cookie)
    if cuerpo:
        req.add_header("Content-Type", "application/json")
    return json.load(urllib.request.urlopen(req))


def igual(nombre, a, b):
    print(f"{nombre:12} {'igual' if a == b else 'DISTINTO'}")
    if a != b:
        for x, y in zip(a if isinstance(a, list) else [a], b if isinstance(b, list) else [b]):
            if x != y:
                print("  go:", x, "\n  ts:", y)
                break
        sys.exit(1)


CONTEOS = ["id", "asunto", "estado", "total", "enviados", "fallidos", "omitidos", "pendientes"]
ts = get(T + "/campanas")
igual("campañas", [{k: c[k] for k in CONTEOS} for c in get(G + "/admin/campanas", admin)],
      [{k: c[k] for k in CONTEOS} for c in ts["lista"]])
igual("bajas", get(G + "/admin/campanas/estado", admin)["bajas"], ts["bajas"])
igual("alcance", get(G + "/admin/campanas/alcance", admin, {"tipo": "profesional", "rubros": ["carpintero", "arquitecto"]})["cantidad"],
      get(T + "/alcance"))
S = ["id", "estado", "cuit", "clienteExistente", "customerId"]
ts = get(T + "/solicitudes")
igual("solicitudes", [{k: s[k] for k in S} for s in get(G + "/admin/profesionales/solicitudes", admin)], [{k: s[k] for k in S} for s in ts["s"]])
igual("resumen", get(G + "/admin/profesionales/resumen", admin), ts["r"])
E = ["id", "slug", "cupo", "precio", "estado", "inscriptos", "confirmados", "reservados", "recaudado", "proximo"]
igual("eventos", [{k: e[k] for k in E} for e in get(G + "/admin/eventos", admin)], [{k: e[k] for k in E} for e in get(T + "/eventos")])
P = ["aprobado", "customerId", "nombre", "priceListId", "nombreLista", "limiteCredito"]
g, t = get(G + "/profesionales/estado", pro), get(T + "/estado")
igual("estado", {k: g[k] for k in P} | {"sol": g["solicitud"]["id"]}, {k: t[k] for k in P} | {"sol": t["solicitud"]["id"]})
