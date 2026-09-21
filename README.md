# Bitácora BEE · Control de apiario

Software de control de apiario basado en la hoja **"Bitácora de revisión de
colmenas"** (MIEL 100% NATURAL). Aplicación web que se sirve en local con
Python (solo librería estándar, sin dependencias) y versión Android en APK.

## Secciones (iguales a la hoja del PDF)

1. **Datos Generales** — Apiario, ubicación, fecha, hora, clima y responsable.
2. **Registro de Revisión por Colmena** — una fila por colmena con:
   estado de la reina, postura/huevos, cría operculada, población, reservas
   de miel, reservas de polen, plagas/varroa, alimentación aplicada,
   tratamiento aplicado, estado general y observaciones.
3. **Actividades Realizadas** — cambio de reina, alimentación suplementaria,
   control de plagas/enfermedades, colocación o retiro de alzas, división de
   colmenas, cosecha de miel y otras actividades/observaciones generales.
4. **Próxima Revisión** — fecha programada, actividades pendientes y notas.

## En Linux (desarrollo)

```bash
python3 server.py
```

Se abre el navegador en `http://127.0.0.1:8000/`. Los datos se guardan en
`datos/bitacorabee.json` (junto al código) o en `~/.bitacorabee/` si la
carpeta del programa no es escribible.

## Instalación del paquete .deb

```bash
sudo apt install ./bitacorabee_<versión>_amd64.deb
bitacorabee
```

Solo requiere `python3`. El lanzador abre la aplicación en el navegador y
guarda los datos en `~/.bitacorabee/bitacorabee.json`.

## En Android (APK)

Instala el `.apk` en el teléfono (permite "orígenes desconocidos"). En el
móvil la bitácora funciona sin servidor: los datos se guardan en el propio
dispositivo. Para mover los datos entre equipos usa **Exportar JSON** y
**Importar JSON** (botones en la ventana "Hojas").

## Operadores y sincronización entre dispositivos

Cada persona trabaja con **su propia aplicación independiente** (no hace falta
ninguna cuenta ni Internet). Para tener las mismas hojas entre tus propios
dispositivos (ordenador y móvil) en la misma red local:

1. **Ordenador**: deja Bitácora BEE abierta. Al arrancar muestra la dirección
   de la red local (ej. `http://192.168.1.10:8000/`) y sirve la bitácora al
   resto de dispositivos de la red.
2. **Móvil**: abre **Usuarios**, escribe la dirección del ordenador
   (`IP:puerto`, ej. `192.168.1.10:8000`) y pulsa **Guardar dirección**.
3. Desde entonces **sincroniza automáticamente**: al abrir la app y cada
   30 segundos mientras haya dirección guardada se intercambian las hojas
   (fusionan) y quedan en ambos dispositivos. También puedes pulsar
   **Sincronizar** en cualquier momento para forzarlo.
4. También se puede sincronizar entre dos ordenadores de la misma red
   (en el segundo escribe la dirección del primero).

Los **operadores** son simples nombres locales (quién rellena la hoja) y se
pueden añadir, editar y eliminar; el activo se usa automáticamente como
«Responsable».

## Actualizaciones

- Al abrir la aplicación se comprueba automáticamente si hay una release
  nueva y se ofrece **Actualizar ahora**.
- El botón **Actualizar** de la barra comprueba manualmente.
- En el ordenador: si el código es escribible se auto-actualiza y se
  reinicia solo; en un paquete `.deb` instalado indica cómo descargar e
  instalar la nueva versión.
- En el móvil: indica la nueva versión y abre la página con el `.apk` nuevo.

## Características

- Guardado automático y botón **Guardar** (abre la ventana **Hojas** con
  todas las revisiones: editar, duplicar, imprimir, borrar y exportar).
- Historial de revisiones con selector "Revisión".
- Botón **Imprimir hoja**: genera la hoja apaisada fiel al PDF.
- Interfaz responsive: ordenador, tableta y móvil.
- Funciona sin conexión; la conexión solo se usa para sincronizar y para
  comprobar actualizaciones.

## Releases automáticas (GitHub Actions)

Cada push a `main` construye automáticamente y publica una release con:
- `.deb` para Linux (paquete `packaging/build_deb.sh`)
- `.apk` para Android (proyecto Cordova, `packaging/build_apk.sh`)

La versión se lee de `.VERSION` y se auto-incrementa con cada release.

## Estructura del proyecto

```
server.py                 servidor local (solo estándar de Python) + API
index.html / app.js / styles.css   aplicación web
packaging/build_deb.sh    construye el .deb
packaging/build_apk.sh    construye el APK Android (Cordova)
packaging/cordova/        configuración del proyecto Cordova
.github/workflows/        build + release automáticos
.VERSION                  versión actual
```

## Autor

Jose Manuel Bernabeu Mejias <apicolanovelda@gmail.com>
Calle Médico Rafael Navarro 2, 2C — Novelda 03660 Alicante