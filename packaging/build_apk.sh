#!/usr/bin/env bash
# Construye el APK de Android (Cordova) de Bitácora BEE
# Requiere: Node.js 18+, JDK 17 y el Android SDK (ANDROID_HOME/ANDROID_SDK_ROOT)
set -euo pipefail

cd "$(dirname "$0")"

VERSION=$(cat ../.VERSION)
if [ -z "$VERSION" ]; then
  echo "ERROR: .VERSION vacío" >&2
  exit 1
fi
APP=$(cd .. && pwd)
DIST="$APP/dist"

echo "==> Bitácora BEE $VERSION - APK Android"
echo "    JAVA_HOME=${JAVA_HOME:-(vacío)}"
echo "    ANDROID_HOME=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-(vacío)}}"

if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm no instalado" >&2
  exit 1
fi

echo "==> Preparando proyecto Cordova"
rm -rf cordova-build
mkdir -p cordova-build/www "$DIST"

cp "$APP"/index.html "$APP"/app.js "$APP"/styles.css cordova-build/www/
cp -r "$APP"/vendor cordova-build/www/vendor
cp -r "$APP"/packaging/cordova/res cordova-build/res
printf '\nwindow.BITACORA_VERSION = "%s";\n' "$VERSION" >> cordova-build/www/app.js
sed -e "s/@VERSION@/$VERSION/" cordova/config.xml > cordova-build/config.xml

echo "==> Instalando Cordova (local)"
cd cordova-build
npm init -y >/dev/null 2>&1
npm install --no-fund --no-audit cordova@12 >/dev/null 2>&1

echo "==> Añadiendo plataforma Android"
npx cordova platform add android --no-telemetry

echo "==> Permitiendo tráfico HTTP local en el WebView"
npx cordova prepare android --no-telemetry
MANIFEST="platforms/android/app/src/main/AndroidManifest.xml"
if [ -f "$MANIFEST" ]; then
  if ! grep -q 'usesCleartextTraffic' "$MANIFEST"; then
    sed -i 's|<application|<application android:usesCleartextTraffic="true"|' "$MANIFEST"
    echo "    usesCleartextTraffic=true inyectado en el manifest"
  else
    echo "    usesCleartextTraffic ya presente"
  fi
else
  echo "    AVISO: no se encontró el AndroidManifest.xml"
fi

echo "==> Compilando APK (debug)"
npx cordova compile android --no-telemetry

APK="platforms/android/app/build/outputs/apk/debug/app-debug.apk"
if [ ! -f "$APK" ]; then
  echo "ERROR: no se encontró el APK en $APK" >&2
  exit 1
fi

echo "==> Copiando APK"
cp "$APK" "$DIST/bitacorabee-v${VERSION}-android.apk"
ls -lh "$DIST"/*.apk
echo "OK: $DIST/bitacorabee-v${VERSION}-android.apk"