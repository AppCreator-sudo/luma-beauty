#!/bin/bash
set -euo pipefail
base=/opt/atelie
tag=20261003-v2-address-fixes
previous="$base/releases/20261003-v2-platform-addresses"
release="$base/releases/$tag"
backup="$base/backups/$tag"
exec 9> "$base/.release.lock"; flock -n 9
[ "$(readlink -f "$base/current")" = "$previous" ]
[ ! -e "$release" ]; [ ! -e "$backup" ]
printf 'd34e2395f34a8e152ea27bf5eb7faeb9836c431cc6f744da03c2c8f07e963cbf  %s\n' "$base/atelie-$tag.tar.gz" | sha256sum -c -
mkdir -p "$release" "$backup"; chmod 755 "$release"; chmod 700 "$backup"
tar -xzf "$base/atelie-$tag.tar.gz" -C "$release"
ln -s "$(readlink -f "$previous/node_modules")" "$release/node_modules"
cp -an "$previous/public/v2/assets/." "$release/public/v2/assets/"
chmod -R a+rX "$release/public" "$release/lib" "$release/scripts"
for file in "$release/server.mjs" "$release"/lib/*.mjs; do node --check "$file"; done
backup_ready=0
rollback() {
  status=$?; trap - ERR
  systemctl stop atelie || true
  if [ "$backup_ready" = 1 ]; then
    python3 - "$backup" <<'PY'
import sqlite3,pathlib,sys,shutil,os
shared=pathlib.Path('/opt/atelie/shared');backup=pathlib.Path(sys.argv[1])
for suffix in ['', '-wal','-shm']:(shared/('atelie.sqlite'+suffix)).unlink(missing_ok=True)
src=sqlite3.connect(backup/'atelie.sqlite');dst=sqlite3.connect(shared/'atelie.sqlite');src.backup(dst);src.close();dst.close()
shutil.chown(shared/'atelie.sqlite',user='atelie',group='atelie');os.chmod(shared/'atelie.sqlite',0o640)
PY
  fi
  ln -sfn "$previous" "$base/current"; systemctl start atelie
  echo 'Patch failed; previous version restored'
  exit "$status"
}
trap rollback ERR
systemctl stop atelie
python3 - "$backup" <<'PY'
import sqlite3,pathlib,sys,os,shutil
backup=pathlib.Path(sys.argv[1]);src=sqlite3.connect('/opt/atelie/shared/atelie.sqlite');dst=sqlite3.connect(backup/'atelie.sqlite');src.backup(dst);src.close();dst.close();os.chmod(backup/'atelie.sqlite',0o600)
shutil.copy2('/etc/atelie.env',backup/'atelie.env');os.chmod(backup/'atelie.env',0o600)
PY
backup_ready=1
ln -sfn "$release" "$base/current.next"; mv -Tf "$base/current.next" "$base/current"
systemctl start atelie
curl -fsS --retry 8 --retry-connrefused --retry-delay 1 --max-time 5 http://127.0.0.1:3100/api/health > /dev/null
python3 - "$backup" <<'PY'
import sqlite3,pathlib,sys,urllib.request,re
before=sqlite3.connect(pathlib.Path(sys.argv[1])/'atelie.sqlite');after=sqlite3.connect('file:/opt/atelie/shared/atelie.sqlite?mode=ro',uri=True)
assert after.execute('PRAGMA quick_check').fetchone()[0]=='ok';assert not list(after.execute('PRAGMA foreign_key_check'))
for table in ['users','profiles','services','works','appointments','work_images','workspaces','performers','master_schedules','guest_bookings']:
  assert before.execute('SELECT * FROM '+table+' ORDER BY rowid').fetchall()==after.execute('SELECT * FROM '+table+' ORDER BY rowid').fetchall(),table
origin='http://127.0.0.1:3100'
for url in ['/api/health','/api/search/masters','/api/map/masters','/v2/','/v2/studio','/v2/salon']:
  with urllib.request.urlopen(origin+url,timeout=8) as r:assert r.status==200,url
with urllib.request.urlopen(origin+'/v2/',timeout=8) as r:html=r.read().decode()
for asset in re.findall(r'(?:src|href)="(/v2/assets/[^"]+)"',html):
  with urllib.request.urlopen(origin+asset,timeout=8) as r:assert r.status==200,asset
print('PATCH CHECK: business data preserved, DB/foreign keys/APIs/assets OK')
PY
curl -fsS --max-time 15 https://atelie-13-143-66-1.sslip.io/v2/ -o /dev/null
systemctl is-active --quiet atelie
trap - ERR
printf 'PUBLISHED ';readlink -f "$base/current"
printf 'BACKUP %s\n' "$backup"
