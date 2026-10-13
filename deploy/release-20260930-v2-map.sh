#!/bin/sh
set -eu

base=/opt/atelie
archive="$base/atelie-20261002-v2-map.tar.gz"
release="$base/releases/20261002-v2-map"
previous=$(readlink -f "$base/current")

[ -f "$archive" ] || { echo "Release archive is missing"; exit 1; }
[ ! -e "$release" ] || { echo "Release directory already exists"; exit 1; }
[ -d "$previous" ] || { echo "Current release is missing"; exit 1; }

mkdir -p "$release"
tar -xzf "$archive" -C "$release"
# Keep lazy chunks available to clients that opened the previous release.
if [ -d "$previous/public/v2/assets" ]; then
  cp -an "$previous/public/v2/assets/." "$release/public/v2/assets/"
fi
ln -s "$(readlink -f "$previous/node_modules")" "$release/node_modules"
chmod -R a+rX "$release/public" "$release/lib" "$release/scripts"
node --check "$release/server.mjs"
node --check "$release/lib/geocoding.mjs"
node --check "$release/scripts/geocode-profiles.mjs"

if [ -f "$base/shared/atelie.sqlite" ]; then
  python3 -c 'import sqlite3; a=sqlite3.connect("/opt/atelie/shared/atelie.sqlite"); b=sqlite3.connect("/opt/atelie/shared/pre-v2-map-20261002.sqlite"); a.backup(b); b.close(); a.close()'
fi

ln -sfn "$release" "$base/current"
if ! systemctl restart atelie || ! curl -fsS --retry 5 --retry-connrefused --retry-delay 1 --max-time 10 http://127.0.0.1:3100/v2/ -o /dev/null; then
  ln -sfn "$previous" "$base/current"
  systemctl restart atelie
  echo "Startup failed; previous release restored"
  exit 1
fi

systemctl is-active atelie
printf 'CURRENT: '; readlink -f "$base/current"
curl -fsS --max-time 10 http://127.0.0.1:3100/api/health
printf '\n'
curl -sS --max-time 15 -o /dev/null -w 'PUBLIC V2 HTTP %{http_code}\n' https://atelie-13-143-66-1.sslip.io/v2/
