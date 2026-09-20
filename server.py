#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Bitácora BEE - Control de apiario (versión web)

Servidor local que publica la aplicación en el navegador y guarda la
bitácora en un archivo JSON. Solo usa la librería estándar de Python,
no requiere instalar dependencias.

Uso:
    python3 server.py               # puerto 8000 (por defecto)
    python3 server.py 9000          # puerto específico

Autor: Jose Manuel Bernabeu Mejias <apicolanovelda@gmail.com>
"""

import importlib.util
import json
import os
import socket
import sys
import threading
import webbrowser
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

APP_NOMBRE = "Bitácora BEE"

AQUI = os.path.dirname(os.path.abspath(__file__))
PUERTO_DEFECTO = 8000


def _leer_version():
    try:
        with open(os.path.join(AQUI, ".VERSION"), "r", encoding="utf-8") as f:
            v = f.read().strip()
        return v if v else "2.0.0"
    except Exception:
        return "2.0.0"


VERSION = _leer_version()


def _directorio_datos():
    """Carpeta de datos: la del app si es escribible, si no la del usuario."""
    env = os.environ.get("BITACORA_DATOS")
    if env:
        return env
    try:
        if os.access(AQUI, os.W_OK):
            return os.path.join(AQUI, "datos")
    except Exception:
        pass
    try:
        home = os.path.expanduser("~")
        if os.access(home, os.W_OK):
            return os.path.join(home, ".bitacorabee")
    except Exception:
        pass
    return os.path.join(AQUI, "datos")


DATOS_DIR = _directorio_datos()
FICHERO_DATOS = os.path.join(DATOS_DIR, "bitacorabee.json")

NUEVA_VISITA_VACIA = {
    "datos": {
        "apiario": "",
        "ubicacion": "",
        "fecha": "",
        "hora": "",
        "clima": "Soleado",
        "responsable": "",
    },
    "colmenas": [
        {
            "numero": 1,
            "estado_reina": "Buena",
            "postura": "Sí",
            "cria": "Alta",
            "poblacion": "Alta",
            "miel": "Alta",
            "polen": "Alta",
            "varroa": "No",
            "alimentacion": "No",
            "tratamiento": "No",
            "estado_general": "Buena",
            "observaciones": "",
        }
    ],
    "actividades": {
        "cambio_reina": False,
        "alimentacion_suplementaria": False,
        "control_plagas": False,
        "alzas": False,
        "division": False,
        "cosecha": False,
    },
    "otras": "",
    "proxima_revision": {
        "fecha": "",
        "actividades_pendientes": "",
        "notas": "",
    },
}


def _nueva_visita():
    import copy

    v = copy.deepcopy(NUEVA_VISITA_VACIA)
    ahora = datetime.now()
    if not v["datos"]["fecha"]:
        v["datos"]["fecha"] = ahora.strftime("%Y-%m-%d")
    if not v["datos"]["hora"]:
        v["datos"]["hora"] = ahora.strftime("%H:%M")
    v["id"] = ahora.strftime("%Y%m%d%H%M%S")
    v["creada"] = ahora.isoformat(timespec="seconds")
    v["actualizada"] = v["creada"]
    return v


def _documento_vacio():
    return {"visitas": [], "actual": None}


def _cargar_datos():
    if not os.path.exists(FICHERO_DATOS):
        return _documento_vacio()
    try:
        with open(FICHERO_DATOS, "r", encoding="utf-8") as f:
            datos = json.load(f)
        if not isinstance(datos, dict) or "visitas" not in datos:
            return _documento_vacio()
        return datos
    except Exception:
        return _documento_vacio()


def _guardar_datos(datos):
    os.makedirs(DATOS_DIR, exist_ok=True)
    with open(FICHERO_DATOS, "w", encoding="utf-8") as f:
        json.dump(datos, f, ensure_ascii=False, indent=2)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=AQUI, **kwargs)

    def _json(self, codigo, objeto):
        cuerpo = json.dumps(objeto, ensure_ascii=False).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(cuerpo)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(cuerpo)

    def do_GET(self):
        ruta = urlparse(self.path).path
        if ruta == "/api/datos":
            self._json(200, _cargar_datos())
            return
        if ruta == "/api/version":
            self._json(200, {"version": VERSION, "nombre": APP_NOMBRE})
            return
        super().do_GET()

    def do_POST(self):
        ruta = urlparse(self.path).path
        if ruta == "/api/datos":
            try:
                largo = int(self.headers.get("Content-Length", 0))
                cuerpo = json.loads(self.rfile.read(largo).decode("utf-8"))
            except Exception as e:
                self._json(400, {"error": "JSON inválido", "detalle": str(e)})
                return
            if not isinstance(cuerpo, dict) or not isinstance(cuerpo.get("visitas"), list):
                self._json(400, {"error": "Estructura de datos inválida"})
                return
            _guardar_datos(cuerpo)
            self._json(200, {"ok": True, "guardado": datetime.now().isoformat(timespec="seconds")})
            return
        self._json(404, {"error": "Ruta no encontrada"})

    def log_message(self, fmt, *args):
        print("[%s] %s" % (datetime.now().strftime("%H:%M:%S"), fmt % args))


def _abrir_navegador(puerto):
    time = __import__("time")
    time.sleep(0.6)
    try:
        webbrowser.open(f"http://127.0.0.1:{puerto}/")
    except Exception as e:
        print("No se pudo abrir el navegador automáticamente:", e)


def _puerto_libre(preferido):
    for puerto in range(preferido, preferido + 50):
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            s.bind(("127.0.0.1", puerto))
            s.close()
            return puerto
        except OSError:
            continue
    return preferido


def main():
    puerto = PUERTO_DEFECTO
    if len(sys.argv) > 1:
        try:
            puerto = int(sys.argv[1])
        except ValueError:
            print("El puerto debe ser un número. Se usa", PUERTO_DEFECTO)
            puerto = PUERTO_DEFECTO
    puerto = _puerto_libre(puerto)

    if not os.path.exists(FICHERO_DATOS):
        doc = _documento_vacio()
        nueva = _nueva_visita()
        doc["visitas"].append(nueva)
        doc["actual"] = nueva["id"]
        _guardar_datos(doc)
        print("Creada bitácora inicial en:", FICHERO_DATOS)

    servidor = ThreadingHTTPServer(("127.0.0.1", puerto), Handler)
    url = f"http://127.0.0.1:{puerto}/"
    print()
    print("=" * 62)
    print(f"  {APP_NOMBRE} {VERSION} - Control de apiario (versión web)")
    print(f"  Abre en tu navegador: {url}")
    print(f"  Datos guardados en: {DATOS_DIR}")
    print("  Pulsa Ctrl+C para detener el servidor.")
    print("=" * 62)
    print()
    threading.Thread(target=_abrir_navegador, args=(puerto,), daemon=True).start()
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor detenido. ¡Hasta pronto!")
        servidor.server_close()


if __name__ == "__main__":
    main()