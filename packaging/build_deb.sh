#!/usr/bin/env bash
# Construye el paquete .deb de Bitácora BEE (versión web)
# Requiere: dpkg-deb
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION=$(cat .VERSION)
if [ -z "$VERSION" ]; then
  echo "ERROR: .VERSION vacío" >&2
  exit 1
fi

NAME="bitacorabee"
AUTHOR="Jose Manuel Bernabeu Mejias"
EMAIL="apicolanovelda@gmail.com"
ARCH="amd64"

echo "==> Bitácora BEE $VERSION ($ARCH)"

echo "==> Preparando estructura .deb"
ROOT="packaging/debroot"
rm -rf "$ROOT" packaging/*.deb
mkdir -p "$ROOT/DEBIAN"
mkdir -p "$ROOT/usr/bin"
mkdir -p "$ROOT/usr/share/applications"
mkdir -p "$ROOT/usr/share/doc/$NAME"
mkdir -p "$ROOT/usr/share/pixmaps"
mkdir -p "$ROOT/opt/$NAME"

# Aplicación (solo estándar de Python: no hay dependencias extra)
cp server.py index.html app.js styles.css .VERSION "$ROOT/opt/$NAME/"
chmod 755 "$ROOT/opt/$NAME/server.py"

# Lanzador
cat > "$ROOT/usr/bin/$NAME" <<EOF
#!/bin/sh
# Bitácora BEE - lanzador
exec python3 /opt/$NAME/server.py "\$@"
EOF
chmod +x "$ROOT/usr/bin/$NAME"

# Entrada de escritorio
cat > "$ROOT/usr/share/applications/$NAME.desktop" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=Bitácora BEE
GenericName=Control de apiario
Comment=Registro de revisiones de apiario
Exec=$NAME
Icon=bitacorabee
Terminal=false
Categories=Utility;Office;
Keywords=apicultura;apiario;colmenas;abejas;
X-Zorin-ApplicationToolbar=true
EOF

# Icono (SVG generado)
cat > "$ROOT/usr/share/pixmaps/$NAME.svg" <<'EOF'
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffc93c"/>
      <stop offset="1" stop-color="#d9a206"/>
    </linearGradient>
  </defs>
  <rect x="16" y="16" width="224" height="224" rx="52" fill="url(#g)"/>
  <ellipse cx="128" cy="140" rx="58" ry="50" fill="#fff" transform="rotate(-14 128 140)"/>
  <ellipse cx="96" cy="70" rx="17" ry="22" fill="#fff"/>
  <ellipse cx="160" cy="70" rx="17" ry="22" fill="#fff"/>
  <rect x="92" y="128" width="72" height="24" rx="12" fill="#3a2f08"/>
  <path d="M60 122c18-16 44-16 60 0 18-16 44-16 60 0v36c-18 16-44 16-60 0-16 16-42 16-60 0z" fill="#3a2f08"/>
  <text x="128" y="212" font-size="46" font-family="Arial, sans-serif" font-weight="bold" fill="#2a2308" text-anchor="middle">B</text>
</svg>
EOF

# Documentación
cat > "$ROOT/usr/share/doc/$NAME/copyright" <<EOF
Bitácora BEE $VERSION

Registro de revisiones de apiario (versión web).

Autor: $AUTHOR
Correo: $EMAIL
Dirección: Calle Médico Rafael Navarro 2, 2C — Novelda 03660 Alicante

Licencia MIT: redistribución y uso comercial y privado permitidos,
con atribución de autoría.
EOF

SIZE=$(du -sk "$ROOT" | cut -f1)

cat > "$ROOT/DEBIAN/control" <<EOF
Package: $NAME
Version: $VERSION
Section: utils
Priority: optional
Architecture: $ARCH
Maintainer: $AUTHOR <$EMAIL>
Installed-Size: $SIZE
Depends: python3 (>= 3.8)
Recommends: xdg-utils
Description: Bitácora BEE - Registro de revisiones de apiario
 Control de apiario basado en la hoja "Bitácora de revisión de
 colmenas": datos generales, revisión por colmena, actividades
 realizadas, próxima revisión y notas.
 .
 Aplicación web local que se abre en el navegador. No necesita
 Internet. Los datos se guardan en ~/.bitacorabee/bitacorabee.json
 .
 Copyright (c) 2026 $AUTHOR <$EMAIL>
EOF

echo "==> Construyendo .deb"
dpkg-deb --root-owner-group --build "$ROOT" "packaging/${NAME}_${VERSION}_${ARCH}.deb"
ls -lh "packaging/${NAME}_${VERSION}_${ARCH}.deb"
echo "OK: packaging/${NAME}_${VERSION}_${ARCH}.deb"