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

import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import urllib.request
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
FICHERO_USUARIOS = os.path.join(DATOS_DIR, "usuarios.json")

REPO_ORIGEN = "JMBermejias/bitacorabee"
URL_RELEASE = f"https://api.github.com/repos/{REPO_ORIGEN}/releases/latest"
URL_DESCARGA = f"https://github.com/{REPO_ORIGEN}/archive/refs/tags/{{tag}}.tar.gz"


def _version_nueva(actual, tag):
    def partes(v):
        v = str(v or "").strip().lstrip("vV")
        out = []
        for p in v.split("."):
            try:
                out.append(int(p))
            except ValueError:
                out.append(0)
        while len(out) < 3:
            out.append(0)
        return out

    a, b = partes(actual), partes(tag)
    return b > a


def _es_ip_lan(ip):
    """True si es una IP privada de red local (alcanzable por el móvil)."""
    try:
        p = str(ip or "").split(".")
        if len(p) != 4:
            return False
        a = int(p[0])
        if a == 10:
            return True
        if a == 192 and p[1] == "168":
            return True
        if a == 172 and 16 <= int(p[1]) <= 31:
            return True
    except Exception:
        pass
    return False


def _ips_locales():
    """Direcciones IP de la máquina en la red local (lo que ven otros)."""
    ips = []
    vistos = set()

    def anade(ip):
        if ip and ip not in vistos:
            vistos.add(ip)
            ips.append(ip)

    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        anade(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    try:
        for x in socket.gethostbyname_ex(socket.gethostname())[2]:
            anade(x)
    except Exception:
        pass
    aaaa = [x for x in ips if _es_ip_lan(x)]
    extra = [x for x in ips if not _es_ip_lan(x)]
    ips = aaaa + extra
    if not ips:
        ips.append("127.0.0.1")
    return ips


def _consulta_release():
    try:
        req = urllib.request.Request(URL_RELEASE, headers={"User-Agent": APP_NOMBRE})
        with urllib.request.urlopen(req, timeout=25) as r:
            j = json.loads(r.read().decode("utf-8"))
        tag = str(j.get("tag_name", "")).lstrip("vV")
        deb_url = None
        for a in j.get("assets", []):
            if a.get("name", "").endswith(".deb"):
                deb_url = a.get("browser_download_url")
                break
        return {
            "tag": tag,
            "nombre": j.get("name", j.get("tag_name", "")),
            "notas": j.get("body", ""),
            "pagina": j.get("html_url", ""),
            "deb_url": deb_url,
        }
    except Exception as e:
        return {"tag": "", "nombre": "", "notas": "", "pagina": "", "deb_url": "", "error": str(e)}


# ---------------------------------------------------------------------------
# Sincronización por internet ("nube"): túnel de Cloudflare sin cuenta.
# cloudflared se descarga automáticamente la primera vez y expone el servidor
# local con una dirección pública https://xxxx.trycloudflare.com, que el móvil
# puede alcanzar desde cualquier lugar.
# ---------------------------------------------------------------------------

_URL_CLOUDFLARED = (
    "https://github.com/cloudflare/cloudflared/releases/latest/download/"
    "cloudflared-linux-amd64"
)
_NUBE_LOG = os.path.join(DATOS_DIR, "nube_cloudflared.log")
_NUBE_ESTADO_FICHERO = os.path.join(DATOS_DIR, "nube.json")
_PATRON_URL_NUBE = re.compile(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com")
_ESTADO_NUBE = {"pid": None, "url": "", "activa": False, "listo": False, "detalle": ""}
_BLOQUEO_NUBE = threading.Lock()
_PUERTO_SERVIDOR = 8000


def _nube_estado():
    with _BLOQUEO_NUBE:
        return dict(_ESTADO_NUBE)


def _nube_bin():
    ruta = os.path.join(DATOS_DIR, "cloudflared")
    return ruta if os.path.exists(ruta) and os.access(ruta, os.X_OK) else None


def _nube_descargar():
    ruta = os.path.join(DATOS_DIR, "cloudflared")
    try:
        req = urllib.request.Request(_URL_CLOUDFLARED, headers={"User-Agent": APP_NOMBRE})
        with urllib.request.urlopen(req, timeout=180) as r:
            with open(ruta, "wb") as f:
                shutil.copyfileobj(r, f)
        os.chmod(ruta, 0o755)
        return ruta
    except Exception as e:
        _ESTADO_NUBE["detalle"] = "No se pudo descargar cloudflared: " + str(e)
        return None


def _nube_proceso_vivo(pid):
    try:
        os.kill(pid, 0)
        return True
    except Exception:
        return False


def _nube_leer_url():
    try:
        with open(_NUBE_LOG, "r", encoding="utf-8", errors="ignore") as f:
            texto = f.read()
        m = _PATRON_URL_NUBE.search(texto)
        return m.group(0) if m else ""
    except Exception:
        return ""


def _nube_guardar_estado():
    try:
        with open(_NUBE_ESTADO_FICHERO, "w", encoding="utf-8") as f:
            json.dump({"pid": _ESTADO_NUBE["pid"], "url": _ESTADO_NUBE["url"],
                       "activa": _ESTADO_NUBE["activa"], "listo": _ESTADO_NUBE["listo"]}, f)
    except Exception:
        pass


def _nube_activar():
    with _BLOQUEO_NUBE:
        if _ESTADO_NUBE["activa"] and _ESTADO_NUBE["listo"] and not _ESTADO_NUBE["url"]:
            _ESTADO_NUBE["url"] = _nube_leer_url()
        if _ESTADO_NUBE["activa"] and _ESTADO_NUBE["listo"] and _ESTADO_NUBE["url"]:
            return dict(_ESTADO_NUBE)
        if _ESTADO_NUBE["activa"] and not _ESTADO_NUBE["pid"]:
            _ESTADO_NUBE["activa"] = False
        if not _ESTADO_NUBE["activa"]:
            binario = _nube_bin() or _nube_descargar()
            if not binario:
                _ESTADO_NUBE["detalle"] = "No se pudo activar la nube."
                return dict(_ESTADO_NUBE)
            try:
                log = open(_NUBE_LOG, "a", encoding="utf-8")
            except Exception:
                log = None
            try:
                proc = subprocess.Popen(
                    [binario, "tunnel", "--url", "http://127.0.0.1:%d" % _PUERTO_SERVIDOR,
                     "--no-autoupdate"],
                    stdout=(log or subprocess.DEVNULL), stderr=subprocess.STDOUT,
                    start_new_session=True,
                )
            except Exception as e:
                _ESTADO_NUBE["detalle"] = "cloudflared no arrancó: " + str(e)
                return dict(_ESTADO_NUBE)
            _ESTADO_NUBE["pid"] = proc.pid
            _ESTADO_NUBE["activa"] = True
            _ESTADO_NUBE["listo"] = False
            _ESTADO_NUBE["detalle"] = "Conectando a internet…"
        # esperar a que Cloudflare asigne la dirección pública
        for _ in range(40):
            url = _nube_leer_url()
            if url:
                _ESTADO_NUBE["url"] = url
                _ESTADO_NUBE["listo"] = True
                _ESTADO_NUBE["detalle"] = (
                    "Conectado. El móvil puede sincronizar desde cualquier lugar. "
                    "Escanea el QR o guarda esta dirección.")
                break
            if not _nube_proceso_vivo(_ESTADO_NUBE["pid"]):
                _ESTADO_NUBE["detalle"] = "cloudflared se detuvo. Mira el log o reintenta."
                break
            time.sleep(0.5)
        else:
            _ESTADO_NUBE["detalle"] = "Cloudflare aún no dio dirección: reintenta en unos segundos."
        _nube_guardar_estado()
        return dict(_ESTADO_NUBE)


def _nube_apagar():
    with _BLOQUEO_NUBE:
        pid = _ESTADO_NUBE.get("pid")
        if pid:
            for senal in (signal.SIGTERM, signal.SIGKILL):
                try:
                    os.killpg(pid, senal)
                    break
                except Exception:
                    try:
                        os.kill(pid, senal)
                        break
                    except Exception:
                        continue
        nube_ant = dict(_ESTADO_NUBE)
        _ESTADO_NUBE.update({"pid": None, "url": "", "activa": False,
                             "listo": False, "detalle": "Nube desconectada."})
        # si terminaba activa se conserva "apagada" en disco
        nube_ant["activa"] = False
        nube_ant["pid"] = None
        try:
            with open(_NUBE_ESTADO_FICHERO, "w", encoding="utf-8") as f:
                json.dump(nube_ant, f)
        except Exception:
            pass
        return dict(_ESTADO_NUBE)


def _nube_restaurar():
    """Al arrancar retoma el túnel si quedó activo (crashes, reinicios)."""
    try:
        with open(_NUBE_ESTADO_FICHERO, "r", encoding="utf-8") as f:
            guardado = json.load(f)
    except Exception:
        return
    if not guardado.get("activa"):
        return
    _ESTADO_NUBE["activa"] = True
    if guardado.get("pid") and _nube_proceso_vivo(guardado["pid"]):
        _ESTADO_NUBE["pid"] = guardado["pid"]
        _ESTADO_NUBE["url"] = guardado.get("url", "")
        _ESTADO_NUBE["listo"] = True
        _ESTADO_NUBE["detalle"] = "Nube activa desde el arranque anterior."
    else:
        _ESTADO_NUBE["pid"] = None
        _ESTADO_NUBE["detalle"] = "Se retoma la nube…"
        threading.Thread(target=_nube_activar, daemon=True).start()


def _aplicar_actualizacion(info):
    """Descarga el código del tag e instala en la carpeta de la app si es escribible."""
    ver = info.get("tag", "")
    if not ver:
        return {"aplicada": False, "razon": "sin-release"}
    if not os.access(AQUI, os.W_OK):
        return {
            "aplicada": False,
            "razon": "instalado",
            "deb_url": info.get("deb_url", ""),
            "tag": ver,
        }
    url = URL_DESCARGA.format(tag="v" + ver)
    tmp = None
    try:
        req = urllib.request.Request(url, headers={"User-Agent": APP_NOMBRE})
        with urllib.request.urlopen(req, timeout=120) as r:
            datos = r.read()
        tmp = tempfile.mkdtemp(prefix="bitacora-act-")
        tgz = os.path.join(tmp, "src.tar.gz")
        with open(tgz, "wb") as f:
            f.write(datos)
        with tarfile.open(tgz, "r:gz") as t:
            t.extractall(tmp)
        raiz = os.path.join(tmp, os.listdir(tmp)[0]) if len(os.listdir(tmp)) == 1 else tmp
        for nombre in os.listdir(raiz):
            origen = os.path.join(raiz, nombre)
            destino = os.path.join(AQUI, nombre)
            if os.path.isdir(origen):
                shutil.rmtree(destino, ignore_errors=True)
                shutil.copytree(origen, destino)
            else:
                shutil.copy2(origen, destino)
        return {"aplicada": True, "tag": ver}
    except Exception as e:
        return {"aplicada": False, "razon": "error", "detalle": str(e)}
    finally:
        if tmp:
            shutil.rmtree(tmp, ignore_errors=True)

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


def _cargar_usuarios():
    if not os.path.exists(FICHERO_USUARIOS):
        return {"usuarios": [], "activo": None}
    try:
        with open(FICHERO_USUARIOS, "r", encoding="utf-8") as f:
            u = json.load(f)
        if not isinstance(u, dict) or "usuarios" not in u:
            return {"usuarios": [], "activo": None}
        return u
    except Exception:
        return {"usuarios": [], "activo": None}


def _guardar_usuarios(registro):
    os.makedirs(DATOS_DIR, exist_ok=True)
    with open(FICHERO_USUARIOS, "w", encoding="utf-8") as f:
        json.dump(registro, f, ensure_ascii=False, indent=2)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=AQUI, **kwargs)

    def _json(self, codigo, objeto):
        cuerpo = json.dumps(objeto, ensure_ascii=False).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(cuerpo)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(cuerpo)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        ruta = urlparse(self.path).path
        if ruta == "/api/datos":
            self._json(200, _cargar_datos())
            return
        if ruta == "/api/version":
            self._json(200, {"version": _leer_version(), "nombre": APP_NOMBRE})
            return
        if ruta == "/api/usuarios":
            self._json(200, _cargar_usuarios())
            return
        if ruta == "/api/actualizacion":
            info = _consulta_release()
            actual = _leer_version()
            self._json(
                200,
                {
                    "actual": actual,
                    "nueva": info.get("tag", ""),
                    "hay": bool(info.get("tag")) and _version_nueva(actual, info.get("tag")),
                    "notas": info.get("notas", ""),
                    "pagina": info.get("pagina", ""),
                    "error": info.get("error", ""),
                },
            )
            return
        if ruta == "/api/red":
            self._json(
                200,
                {
                    "ips": _ips_locales(),
                    "puerto": self.server.server_address[1],
                    "nombre": APP_NOMBRE,
                    "version": _leer_version(),
                    "url_publica": _ESTADO_NUBE.get("url", "") or "",
                },
            )
            return
        if ruta == "/api/nube/estado":
            self._json(200, _nube_estado())
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
        if ruta == "/api/usuarios":
            try:
                largo = int(self.headers.get("Content-Length", 0))
                cuerpo = json.loads(self.rfile.read(largo).decode("utf-8"))
            except Exception as e:
                self._json(400, {"error": "JSON inválido", "detalle": str(e)})
                return
            if not isinstance(cuerpo, dict) or "usuarios" not in cuerpo:
                self._json(400, {"error": "Estructura inválida"})
                return
            _guardar_usuarios(cuerpo)
            self._json(200, {"ok": True, "guardado": datetime.now().isoformat(timespec="seconds")})
            return
        if ruta == "/api/actualizar":
            info = _consulta_release()
            resultado = _aplicar_actualizacion(info)
            if resultado.get("aplicada"):
                resultado["nueva_version"] = _leer_version()
            self._json(200, resultado)
            return
        if ruta == "/api/reiniciar":
            puerto = self.server.server_address[1]

            def _reiniciar():
                time.sleep(0.8)
                os.execv(
                    sys.executable,
                    [sys.executable, os.path.abspath(__file__), str(puerto)],
                )

            threading.Thread(target=_reiniciar, daemon=True).start()
            self._json(200, {"ok": True, "reiniciando": True})
            return
        if ruta == "/api/nube/activar":
            self._json(200, _nube_activar())
            return
        if ruta == "/api/nube/apagar":
            self._json(200, _nube_apagar())
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
    global _PUERTO_SERVIDOR
    _PUERTO_SERVIDOR = puerto

    # Se escucha en toda la red local (no solo en este equipo) para que el
    # móvil u otros ordenadores puedan sincronizar. Para restringirlo:
    # BITACORA_BIND=127.0.0.1
    host = os.environ.get("BITACORA_BIND", "0.0.0.0")

    if not os.path.exists(FICHERO_DATOS):
        doc = _documento_vacio()
        nueva = _nueva_visita()
        doc["visitas"].append(nueva)
        doc["actual"] = nueva["id"]
        _guardar_datos(doc)
        print("Creada bitácora inicial en:", FICHERO_DATOS)

    servidor = ThreadingHTTPServer((host, puerto), Handler)
    url = f"http://127.0.0.1:{puerto}/"
    print()
    print("=" * 62)
    print(f"  {APP_NOMBRE} {VERSION} - Control de apiario (versión web)")
    print(f"  Abre en tu navegador: {url}")
    if host == "0.0.0.0":
        try:
            for ip in _ips_locales():
                print(f"  Otros dispositivos (móvil): http://{ip}:{puerto}/")
        except Exception:
            pass
    _nube_restaurar()
    url_nube = _ESTADO_NUBE.get("url")
    if url_nube:
        print(f"  MODALIDAD NUBE activa: {url_nube}")
        print("  El móvil puede sincronizar desde internet. Para pararla: Usuarios → Desconectar nube.")
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