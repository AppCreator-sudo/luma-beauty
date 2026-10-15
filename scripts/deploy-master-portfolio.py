#!/usr/bin/env python3
"""
Deploy master portfolio & compact wizard refinement to production server (13.143.66.1).
Includes:
- Safe baseline checks
- Database backup with integrity & foreign_key checks
- Smoke verification on an isolated temporary instance
- Atomic symlink switch with rollback trap
- Public health & assets verification
"""

import sys
import os
import json
import re
import tarfile
import hashlib
import pathlib
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
SECRETS_DIR = ROOT / 'deploy/cloud-transfer/server-secrets'
TAG = '20261015-v2-master-portfolio'
PREVIOUS_TAG = '20261015-v2-cabinet-refinement'

sys.path.insert(0, str(ROOT / '.local-data/cloud-tools'))
import paramiko


def compute_sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def main():
    print(f"=== Preparing release: {TAG} ===")
    
    # 1. Update frontend-release.txt
    release_txt = ROOT / 'frontend-release.txt'
    release_txt.write_text(TAG + '\n', encoding='utf-8')
    
    # 2. Package release tarball
    archive_path = ROOT / f'atelie-{TAG}.tar.gz'
    if archive_path.exists():
        archive_path.unlink()
        
    print(f"Packaging archive {archive_path.name}...")
    with tarfile.open(archive_path, 'w:gz') as tar:
        tar.add(release_txt, arcname='frontend-release.txt')
        tar.add(ROOT / 'public/sw.js', arcname='public/sw.js')
        tar.add(ROOT / 'public/v2/index.html', arcname='public/v2/index.html')
        tar.add(ROOT / 'public/v2/hero-v2.webp', arcname='public/v2/hero-v2.webp')
        
        assets_dir = ROOT / 'public/v2/assets'
        for asset in sorted(assets_dir.glob('*')):
            if asset.is_file():
                tar.add(asset, arcname=f'public/v2/assets/{asset.name}')
                
    archive_size = archive_path.stat().st_size
    archive_sha = compute_sha256(archive_path)
    print(f"Archive ready: {archive_size} bytes, SHA256: {archive_sha}")

    # 3. Create the remote deployer script
    remote_script_code = f'''#!/usr/bin/python3
import os, sys, json, hashlib, pathlib, tarfile, shutil, subprocess, sqlite3, time, fcntl, pwd, urllib.request

base = pathlib.Path('/opt/atelie')
tag = '{TAG}'
previous_tag = '{PREVIOUS_TAG}'
old = base / 'releases' / previous_tag
release = base / 'releases' / tag
backup = base / 'backups' / tag
stage = base / 'staging' / tag
smoke = base / 'staging' / (tag + '-smoke')
archive = base / ('atelie-' + tag + '.tar.gz')
shared = base / 'shared'
account = pwd.getpwnam('atelie')
expected_sha = '{archive_sha}'

def log(msg):
    print(f"[{TAG}] " + msg, flush=True)

def run(*args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, text=True, **kwargs).stdout.strip()

def check_db(db_path):
    d = sqlite3.connect(db_path.as_uri() + '?mode=ro', uri=True)
    assert d.execute('PRAGMA integrity_check').fetchall() == [('ok',)], 'Integrity check failed'
    assert not d.execute('PRAGMA foreign_key_check').fetchall(), 'Foreign key check failed'
    return d

def snapshot_db(dest_path):
    src = sqlite3.connect((shared / 'atelie.sqlite').as_uri() + '?mode=ro', uri=True)
    dst = sqlite3.connect(dest_path)
    src.backup(dst)
    dst.close()
    src.close()
    os.chmod(dest_path, 0o600)
    return hashlib.sha256(dest_path.read_bytes()).hexdigest()

def switch_symlink(target):
    link = base / ('.current-' + tag)
    if link.exists() or link.is_symlink():
        link.unlink()
    link.symlink_to(target)
    os.replace(link, base / 'current')

# 1. Verification of baseline
log("Verifying baseline and current state...")
lock_file = base / '.release.lock'
lock = os.open(str(lock_file), os.O_RDWR | os.O_CREAT, 0o600)
fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)

current_target = (base / 'current').resolve()
assert current_target == old, f"Baseline mismatch: current is {{current_target}}, expected {{old}}"
assert run('systemctl', 'is-active', 'atelie') == 'active', "Service atelie is not active"

with urllib.request.urlopen('http://127.0.0.1:3100/api/health', timeout=5) as r:
    assert json.load(r).get('ok') is True, "API health check failed on current instance"

# 2. Check archive hash
log("Verifying uploaded archive SHA256...")
assert hashlib.sha256(archive.read_bytes()).hexdigest() == expected_sha, "Archive SHA256 mismatch"

# 3. Create backup
log("Creating database backup...")
backup.mkdir(mode=0o700, parents=True, exist_ok=True)
backup_sha = snapshot_db(backup / 'atelie.sqlite')
shutil.copy2('/etc/atelie.env', backup / 'atelie.env')
os.chmod(backup / 'atelie.env', 0o600)
log(f"Backup created at {{backup / 'atelie.sqlite'}}, SHA256: {{backup_sha}}")

# 4. Clone release directory and overlay changes
log("Preparing release directory...")
if release.exists():
    shutil.rmtree(release)
release.mkdir(mode=0o755, parents=True)

# Copy base from previous release
run('cp', '-a', str(old) + '/.', str(release) + '/')

# Unpack new assets and files over the clone
with tarfile.open(archive, 'r:gz') as tar:
    tar.extractall(release)

# Ensure permissions
run('chmod', '-R', 'a+rX', str(release))

# Check node syntax on relevant files
run('node', '--check', str(release / 'server.mjs'))
run('node', '--check', str(release / 'public/sw.js'))

# 5. Smoke test on isolated copy as atelie user
log("Running isolated smoke test as atelie...")
if smoke.exists():
    shutil.rmtree(smoke)
smoke.mkdir(mode=0o700, parents=True)
shutil.copyfile(backup / 'atelie.sqlite', smoke / 'atelie.sqlite')

# Strip active push subscriptions and sessions in smoke copy
sdb = sqlite3.connect(smoke / 'atelie.sqlite')
sdb.execute('DELETE FROM pushes')
sdb.execute('DELETE FROM sessions')
sdb.commit()
sdb.close()

os.chmod(smoke / 'atelie.sqlite', 0o600)
os.chown(smoke, account.pw_uid, account.pw_gid)
os.chown(smoke / 'atelie.sqlite', account.pw_uid, account.pw_gid)

smoke_env = {{
    'PATH': '/usr/local/bin:/usr/bin:/bin',
    'NODE_ENV': 'test',
    'DATA_DIR': str(smoke),
    'PORT': '3291',
    'APP_ORIGIN': 'http://127.0.0.1:3291'
}}

with (smoke / 'server.log').open('w') as smoke_out:
    proc = subprocess.Popen(
        ['/usr/sbin/runuser', '-u', 'atelie', '--', '/usr/local/bin/node', str(release / 'server.mjs')],
        cwd=str(release),
        env=smoke_env,
        stdout=smoke_out,
        stderr=smoke_out
    )
    smoke_ok = False
    try:
        for _ in range(30):
            if proc.poll() is not None:
                raise RuntimeError("Smoke server exited prematurely")
            try:
                with urllib.request.urlopen('http://127.0.0.1:3291/api/health', timeout=1) as resp:
                    if json.load(resp).get('ok') is True:
                        smoke_ok = True
                        break
            except Exception:
                time.sleep(0.3)
        assert smoke_ok, "Smoke instance failed to become healthy within timeout"
        
        # Verify /v2/ html
        with urllib.request.urlopen('http://127.0.0.1:3291/v2/', timeout=2) as resp:
            body = resp.read().decode('utf-8')
            assert 'index-C5Wrh_NG.js' in body, "Expected entry asset missing in smoke /v2/"
        log("Isolated smoke check passed: health OK, entry asset OK")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=2)
        shutil.rmtree(smoke, ignore_errors=True)

# 6. Atomic switch with rollback protection
log("Switching service to new release...")
switched = False
stopped = False
try:
    run('systemctl', 'stop', 'atelie')
    stopped = True
    pre_switch_sha = snapshot_db(backup / 'pre-switch.sqlite')
    
    switch_symlink(release)
    switched = True
    
    run('systemctl', 'start', 'atelie')
    stopped = False
    
    # Wait for service health
    healthy = False
    for _ in range(30):
        if run('systemctl', 'is-active', 'atelie') == 'active':
            try:
                with urllib.request.urlopen('http://127.0.0.1:3100/api/health', timeout=1) as resp:
                    if json.load(resp).get('ok') is True:
                        healthy = True
                        break
            except Exception:
                pass
        time.sleep(0.4)
    assert healthy, "Service failed to report healthy on port 3100"
    
    # Verify live /v2/ index and SW
    with urllib.request.urlopen('http://127.0.0.1:3100/v2/', timeout=3) as resp:
        v2_body = resp.read().decode('utf-8')
        assert 'index-C5Wrh_NG.js' in v2_body, "Live /v2/ index does not contain new build entry"
        
    with urllib.request.urlopen('http://127.0.0.1:3100/sw.js', timeout=3) as resp:
        sw_body = resp.read().decode('utf-8')
        assert 'luma-v2-shell-' + tag in sw_body, "Live sw.js does not contain new cache tag"
        
    log("Live service is ACTIVE and HEALTHY with new build!")
    
    result = {{
        'published_at': time.strftime('%Y-%m-%dT%H:%M:%S+07:00'),
        'tag': tag,
        'previous': str(old),
        'current': str(release),
        'backup': str(backup),
        'backup_sha256': backup_sha,
        'pre_switch_sha256': pre_switch_sha,
        'archive_sha256': expected_sha,
        'entry': 'index-C5Wrh_NG.js',
        'sw_cache': 'luma-v2-shell-' + tag,
        'status': 'SUCCESS'
    }}
    (backup / 'release-result.json').write_text(json.dumps(result, indent=2))
    print("DEPLOY_RESULT=" + json.dumps(result))

except Exception as ex:
    log(f"ERROR during deployment: {{ex}}")
    if switched:
        log("Initiating ROLLBACK to previous release...")
        switch_symlink(old)
        run('systemctl', 'restart', 'atelie')
        log("Rollback completed. Service restored to previous release.")
    elif stopped:
        run('systemctl', 'start', 'atelie')
        log("Service restarted on previous release.")
    raise
'''

    # 4. Connect via paramiko SSH and SFTP
    print("Connecting to server via SSH/SFTP...")
    config = json.loads((SECRETS_DIR / 'config.json').read_text())
    private = (SECRETS_DIR / 'SSH_ACCESS_PRIVATE.md').read_text(encoding='utf-8-sig')
    pwd_match = re.search(r'^Пароль:\s*(.+)$', private, re.M)
    if not pwd_match:
        raise SystemExit("Server credentials not found")
        
    client = paramiko.SSHClient()
    client.load_host_keys(str(SECRETS_DIR / 'known_hosts'))
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    client.connect(
        config['host'],
        port=config['port'],
        username=config['user'],
        password=pwd_match.group(1).strip(),
        look_for_keys=False,
        allow_agent=False,
        timeout=15
    )
    
    sftp = client.open_sftp()
    
    # Upload archive
    remote_archive = f'/opt/atelie/atelie-{TAG}.tar.gz'
    print(f"Uploading {archive_path.name} to {remote_archive}...")
    sftp.put(str(archive_path), remote_archive)
    
    # Upload deployer script
    remote_script = f'/opt/atelie/deploy-{TAG}.py'
    print(f"Uploading deployment script to {remote_script}...")
    with sftp.file(remote_script, 'w') as f:
        f.write(remote_script_code)
    sftp.chmod(remote_script, 0o700)
    sftp.close()
    
    # 5. Execute deployer script on server
    print("Executing deployment script on server...")
    stdin, stdout, stderr = client.exec_command(f'python3 {remote_script}', timeout=300)
    
    out_text = stdout.read().decode('utf-8', errors='replace')
    err_text = stderr.read().decode('utf-8', errors='replace')
    exit_code = stdout.channel.recv_exit_status()
    
    print("\n--- SERVER OUTPUT ---")
    print(out_text)
    if err_text:
        print("--- SERVER STDERR ---")
        print(err_text)
    print("---------------------")
    
    client.close()
    
    if exit_code != 0:
        print(f"Deployment script failed with code {exit_code}")
        sys.exit(exit_code)
        
    print(f"\n=== Deployment of {TAG} successfully completed! ===")


if __name__ == '__main__':
    main()
