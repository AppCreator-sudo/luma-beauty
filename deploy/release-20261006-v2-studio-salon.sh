#!/bin/bash
set -euo pipefail
base=/opt/atelie
tag=20261006-v2-studio-salon
previous="$base/releases/20261004-v2-map-card"
release="$base/releases/$tag"
backup="$base/backups/$tag"
exec 9> "$base/.release.lock"; flock -n 9
[ "$(readlink -f "$base/current")" = "$previous" ]
printf '586f384d776cef976be4c507f87a2fa5a0be4e5f81d9656211306fbe8b629f66  %s\n' "$base/atelie-$tag.tar.gz" | sha256sum -c -
umask 077
if [ -e "$release" ] || [ -e "$backup" ]; then
  [ "${1:-}" = '--resume' ]; [ -d "$release" ]; [ -d "$backup" ]
  # Preserve the first closed backup and use a fresh one for the retry.
  backup="$backup/retry-$(date -u +%Y%m%dT%H%M%SZ)"
  [ ! -e "$backup" ]; mkdir "$backup"; chmod 700 "$backup"
else
  mkdir -p "$release" "$backup"; chmod 755 "$release"; chmod 700 "$backup"
  tar -xzf "$base/atelie-$tag.tar.gz" -C "$release"
  ln -s "$(readlink -f "$previous/node_modules")" "$release/node_modules"
  cp -an "$previous/public/v2/assets/." "$release/public/v2/assets/"
fi
chmod -R a+rX "$release/public" "$release/lib" "$release/scripts"
for file in "$release/server.mjs" "$release"/lib/*.mjs "$release/public/sw.js"; do node --check "$file"; done
# A closed, consistent working copy first. No live writers are stopped yet.
python3 - "$backup" <<'PY'
import sqlite3,pathlib,sys,os
folder=pathlib.Path(sys.argv[1])
src=sqlite3.connect('file:/opt/atelie/shared/atelie.sqlite?mode=ro',uri=True)
for name in ['rehearsal-source.sqlite','rehearsal.sqlite']:
    dst=sqlite3.connect(folder/name);src.backup(dst);dst.close();os.chmod(folder/name,0o600)
src.close()
PY
node --input-type=module - "$release" "$backup" <<'JS'
import {DatabaseSync} from 'node:sqlite';
const [release,backup]=process.argv.slice(2);
const {migrateSalonVisual}=await import(release+'/lib/salon-public.mjs');
const db=new DatabaseSync(backup+'/rehearsal.sqlite');
db.exec('PRAGMA foreign_keys=ON');
migrateSalonVisual(db,{backupDir:backup+'/rehearsal-migration-backup'});
migrateSalonVisual(db,{backupDir:backup+'/rehearsal-migration-backup'});
db.close();
console.log('Closed migration rehearsal and repeat completed');
JS
python3 "$release/scripts/verify-salon-visual-migration.py" "$backup/rehearsal-source.sqlite" "$backup/rehearsal.sqlite" --migration
python3 - "$backup" <<'PY'
import sqlite3,pathlib,sys,os
folder=pathlib.Path(sys.argv[1]);src=sqlite3.connect(folder/'rehearsal-source.sqlite');dst=sqlite3.connect(folder/'restore-check.sqlite');src.backup(dst);src.close();dst.close();os.chmod(folder/'restore-check.sqlite',0o600)
PY
python3 "$release/scripts/verify-salon-visual-migration.py" "$backup/rehearsal-source.sqlite" "$backup/restore-check.sqlite"
# Additive logo/cover columns permit previous code to run. Rollback keeps all
# live records, including any visits/photos created after opening the service.
rollback() {
  status=$?; trap - ERR
  systemctl stop atelie || true
  ln -sfn "$previous" "$base/current.rollback"; mv -Tf "$base/current.rollback" "$base/current"
  systemctl start atelie
  echo 'Release failed; previous code restored; shared database preserved'
  exit "$status"
}
trap rollback ERR
systemctl stop atelie
python3 - "$backup" <<'PY'
import sqlite3,pathlib,sys,os,shutil
folder=pathlib.Path(sys.argv[1]);src=sqlite3.connect('/opt/atelie/shared/atelie.sqlite');dst=sqlite3.connect(folder/'atelie.sqlite');src.backup(dst);src.close();dst.close();os.chmod(folder/'atelie.sqlite',0o600)
shutil.copy2('/etc/atelie.env',folder/'atelie.env');os.chmod(folder/'atelie.env',0o600)
shutil.copytree('/opt/atelie/shared/uploads',folder/'uploads')
for root,dirs,files in os.walk(folder/'uploads'):
    os.chmod(root,0o700)
    for name in files:os.chmod(pathlib.Path(root)/name,0o600)
PY
ln -sfn "$release" "$base/current.next"; mv -Tf "$base/current.next" "$base/current"
systemctl start atelie
curl -fsS --retry 8 --retry-connrefused --retry-delay 1 --max-time 5 http://127.0.0.1:3100/api/health > /dev/null
python3 "$release/scripts/verify-salon-visual-migration.py" "$backup/atelie.sqlite" "$base/shared/atelie.sqlite" --migration
python3 - <<'PY'
import urllib.request,urllib.error,re,json
origin='http://127.0.0.1:3100'
def request(url):
    with urllib.request.urlopen(origin+url,timeout=10) as response:
        assert response.status==200,url
        return response.read().decode()
for url in ['/api/health','/api/search/masters','/api/map/masters','/api/map/viewport?bbox=-180,-90,180,90&zoom=0','/v2/studio','/v2/salon']:request(url)
html=request('/v2/')
for asset in re.findall(r'(?:src|href)="(/v2/assets/[^"]+)"',html):request(asset)
assert 'atelie-v2-shell-20261006-studio-salon' in request('/sw.js')
body=json.dumps({'published':True}).encode()
try:
    urllib.request.urlopen(urllib.request.Request(origin+'/api/profile/publication',data=body,headers={'Content-Type':'application/json','Origin':'https://atelie-13-143-66-1.sslip.io'},method='PATCH'))
    raise AssertionError('Anonymous publication allowed')
except urllib.error.HTTPError as error:assert error.code==401
print('PUBLIC API, assets, PWA and anonymous publication checks passed')
PY
curl -fsS --max-time 15 https://atelie-13-143-66-1.sslip.io/v2/ -o /dev/null
systemctl is-active --quiet atelie
trap - ERR
printf 'PUBLISHED ';readlink -f "$base/current"
printf 'BACKUP %s\n' "$backup"
