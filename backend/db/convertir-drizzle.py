#!/usr/bin/env python3
"""
Pasa las migraciones de drizzle (drizzle/*.sql) a goose
(backend/db/migraciones/), una vez y para siempre.

Se corrió el 24/10/2026, con las 79 migraciones de drizzle (0000–0078). Las
que salen de acá son la historia congelada: no se editan. Lo nuevo va en
00080 en adelante, escrito a mano para goose. Queda en el repo para que se vea
cómo se generaron y se pueda repetir si hiciera falta comparar.

Qué hace con cada archivo:
- La versión de goose es el número de drizzle + 1 (0000 → 00001), con el
  mismo nombre.
- Drizzle separa las sentencias con `--> statement-breakpoint`; goose separa
  por `;`, y eso rompe las funciones plpgsql (con `;` adentro de `$$`). Por eso
  cada sentencia va entre `StatementBegin` y `StatementEnd`, que goose manda
  entera.
- Solo `Up`: drizzle no tiene bajadas, y una bajada inventada para 79
  migraciones sería una mentira peligrosa. Para volver atrás está el respaldo.
- Una transacción por archivo, como hacía drizzle-kit.
"""
import json
import pathlib
import re

RAIZ = pathlib.Path(__file__).resolve().parents[2]
ORIGEN = RAIZ / "drizzle"
DESTINO = RAIZ / "backend" / "db" / "migraciones"

journal = json.loads((ORIGEN / "meta" / "_journal.json").read_text())
DESTINO.mkdir(parents=True, exist_ok=True)

for entrada in journal["entries"]:
    idx, tag = entrada["idx"], entrada["tag"]
    sql = (ORIGEN / f"{tag}.sql").read_text()
    sentencias = [s.strip() for s in re.split(r"-->\s*statement-breakpoint", sql)]
    sentencias = [s for s in sentencias if s and not all(l.strip().startswith("--") or not l.strip() for l in s.splitlines())]
    partes = [
        f"-- Migración {idx:04d} de drizzle ({tag}), pasada a goose el 24/10/2026.\n"
        "-- Historia congelada: no se edita (ver backend/db/convertir-drizzle.py).\n\n"
        "-- +goose Up"
    ]
    for s in sentencias:
        partes.append(f"-- +goose StatementBegin\n{s}\n-- +goose StatementEnd")
    nombre = f"{idx + 1:05d}_{tag.split('_', 1)[1]}.sql"
    (DESTINO / nombre).write_text("\n".join(partes) + "\n")

print(f"{len(journal['entries'])} migraciones en {DESTINO.relative_to(RAIZ)}")
