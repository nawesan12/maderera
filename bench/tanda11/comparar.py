#!/usr/bin/env python3
"""Antes de medir: los dos servidores dan el mismo plano para los 200 despieces.

    python3 bench/tanda11/comparar.py
"""
import json
import os
import urllib.request

aqui = os.path.dirname(os.path.abspath(__file__))
despieces = json.load(open(os.path.join(aqui, "despieces.json")))
distintos = 0
for d in despieces:
    cuerpo = json.dumps(d).encode()
    r = []
    for url in ("http://127.0.0.1:8291/api/v1/cortes/plano", "http://127.0.0.1:8391/plano"):
        pedido = urllib.request.Request(url, data=cuerpo, headers={"Content-Type": "application/json"})
        r.append(json.load(urllib.request.urlopen(pedido)))
    if r[0] != r[1]:
        distintos += 1
print(f"distintos: {distintos} de {len(despieces)}")
