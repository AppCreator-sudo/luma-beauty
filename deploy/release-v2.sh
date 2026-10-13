#!/bin/sh
set -eu
old=$(readlink -f /opt/atelie/current)
new=/opt/atelie/releases/20260929-v2-1
[ ! -e "$new" ] || { echo 'Release directory already exists'; exit 1; }
mkdir -p "$new"
tar -xzf /opt/atelie/atelie-20260929-v2-1.tar.gz -C "$new"
ln -s "$old/node_modules" "$new/node_modules"
chmod -R a+rX "$new/public" "$new/lib" "$new/deploy"
node --check "$new/server.mjs"
if [ -f /opt/atelie/shared/atelie.sqlite ]; then
  python3 -c 'import sqlite3; a=sqlite3.connect("/opt/atelie/shared/atelie.sqlite"); b=sqlite3.connect("/opt/atelie/shared/pre-v2-20260929.sqlite"); a.backup(b); b.close(); a.close()'
fi
ln -sfn "$new" /opt/atelie/current
systemctl restart atelie
if ! curl -fsS --retry 5 --retry-connrefused --retry-delay 1 --max-time 10 http://127.0.0.1:3100/v2/ -o /dev/null; then
  ln -sfn "$old" /opt/atelie/current
  systemctl restart atelie
  echo 'Startup failed; previous release restored'
  exit 1
fi
systemctl is-active atelie
printf 'CURRENT: '; readlink -f /opt/atelie/current
curl -fsS --max-time 10 http://127.0.0.1:3100/api/profiles -o /dev/null
curl -sS --max-time 15 -o /dev/null -w 'PUBLIC V2 HTTP %{http_code}\n' https://atelie-13-143-66-1.sslip.io/v2/
curl -sS --max-time 15 -r 0-0 -o /dev/null -w 'VIDEO HTTP %{http_code}\n' https://atelie-13-143-66-1.sslip.io/v2/hero-iris.mp4
curl -sSI --max-time 15 https://atelie-13-143-66-1.sslip.io/ | head -n 6
