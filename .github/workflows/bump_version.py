#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Auto-bump de versión para el release automático en cada push a main.

- La versión base se lee de .VERSION.
- Si ya existe un tag v{base} se incrementa el parche (x.y.z -> x.y.z+1).
- Si aún no existe tag para la versión base, se usa tal cual.
- Escribe la versión elegida en .VERSION.
"""

import subprocess
import sys


def run(*args):
    return subprocess.run(args, capture_output=True, text=True)


def tags_existentes():
    run("git", "fetch", "--tags", "--quiet", "origin")
    res = run("git", "tag", "--list")
    return {t.strip() for t in (res.stdout or "").splitlines()}


def parse(texto):
    p = []
    for c in texto.split("."):
        n = "".join(d for d in c if d.isdigit())
        p.append(int(n) if n else 0)
    while len(p) < 3:
        p.append(0)
    return tuple(p[:3])


def main():
    with open(".VERSION", "r", encoding="utf-8") as f:
        base = f.read().strip()
    if not base:
        sys.exit("No se encontró .VERSION")
    base_t = parse(base)

    if "v" + base in tags_existentes():
        mayor, menor, parche = base_t
        nueva = (mayor, menor, parche + 1)
    else:
        nueva = base_t
    nueva_txt = ".".join(str(p) for p in nueva)

    with open(".VERSION", "w", encoding="utf-8") as f:
        f.write(nueva_txt)
    print(nueva_txt)


if __name__ == "__main__":
    main()