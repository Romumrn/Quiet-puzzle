#!/usr/bin/env bash
# Creates a new Play Store UPLOAD key, after the old one was lost.
#
# Play App Signing holds the real app-signing key; the upload key only proves a
# bundle comes from us, so Google can replace it ("Request upload key reset").
# This script does everything on our side in one go:
#
#   mobile/android/app/upload-keystore.jks   the key (gitignored)
#   mobile/android/app/keystore.properties   what build.gradle reads (gitignored)
#   upload_certificate.pem                   the certificate to send to Google
#
# The password is typed here, never written anywhere but keystore.properties.
# Procedure and what comes after: "Play Store upload key" in AGENTS.md.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/mobile/android/app"
STORE="$APP/upload-keystore.jks"
PROPS="$APP/keystore.properties"
PEM="$ROOT/upload_certificate.pem"
ALIAS=upload

for f in "$STORE" "$PROPS"; do
  if [ -e "$f" ]; then
    echo "Already there: $f — move it away first, it may be the only copy of a key." >&2
    exit 1
  fi
done

while :; do
  read -rsp "Password for the new upload key (6+ characters): " PW; echo
  read -rsp "Same password again: " PW2; echo
  if [ "${#PW}" -lt 6 ]; then echo "Too short."; continue; fi
  if [ "$PW" != "$PW2" ]; then echo "They differ."; continue; fi
  break
done
export QP_STOREPASS="$PW"
unset PW PW2

# PKCS12: one password for the store and the key, which is what keytool expects.
keytool -genkeypair -keystore "$STORE" -storetype PKCS12 -alias "$ALIAS" \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=Quiet Puzzle, O=Quiet Puzzle, C=FR" \
  -storepass:env QP_STOREPASS -keypass:env QP_STOREPASS

keytool -export -rfc -keystore "$STORE" -alias "$ALIAS" -file "$PEM" \
  -storepass:env QP_STOREPASS

umask 077
cat > "$PROPS" <<EOF
storeFile=upload-keystore.jks
storePassword=$QP_STOREPASS
keyAlias=$ALIAS
keyPassword=$QP_STOREPASS
EOF

echo
echo "SHA-1 of the new upload key (Google Cloud Android OAuth client, for builds installed outside the Play Store):"
unset QP_STOREPASS
# Read off the certificate, in English: `keytool -list -v` is localised.
LC_ALL=C keytool -printcert -file "$PEM" | grep -E 'SHA1:' || true

echo
echo "Done:"
echo "  $STORE"
echo "  $PROPS"
echo "  $PEM   <- upload this in Play Console"
echo
echo "Back up the .jks and keystore.properties OUTSIDE this computer now."
