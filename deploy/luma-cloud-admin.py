#!/usr/bin/python3 -I
"""App-scoped administrative commands for the luma-codex SSH account."""
import datetime
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sqlite3
import stat
import subprocess
import sys
import tarfile
import tempfile

APP = Path('/opt/atelie')
SHARED = APP / 'shared'
INCOMING = Path('/home/luma-codex/incoming')
ID = re.compile(r'[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}\Z')


def require_id(value):
    if not ID.fullmatch(value) or value in {'.', '..'}:
        raise ValueError('Invalid release identifier')
    return value


def extract_release(archive, target):
    """Extract only regular files/directories; validate the entire archive first."""
    with tarfile.open(archive, 'r:gz') as tar:
        members = tar.getmembers()
        if len(members) > 100000 or sum(m.size for m in members) > 1024**3:
            raise ValueError('Archive exceeds deployment limits')
        seen = set()
        for member in members:
            name = member.name
            p = PurePosixPath(name)
            if name.startswith('./'):
                name = name[2:]
                p = PurePosixPath(name)
            if name in {'', '.'} and member.isdir():
                continue
            if p.is_absolute() or '..' in p.parts or '\\' in name or not p.parts:
                raise ValueError('Unsafe archive path')
            if not (member.isfile() or member.isdir()):
                raise ValueError('Links/devices are not allowed in release archives')
            if p.parts[0] in {'data', 'shared', 'uploads', 'private-client', 'node_modules', '.git', '.cache', '.local-data'}:
                raise ValueError('Runtime/private data does not belong in a release')
            if any(part.startswith('.env') or part == '.ssh' for part in p.parts):
                raise ValueError('Credentials do not belong in a release')
            if p.as_posix() in seen:
                raise ValueError('Duplicate archive entry')
            seen.add(p.as_posix())
        for member in members:
            if member.name in {'.', './'}:
                continue
            name = member.name[2:] if member.name.startswith('./') else member.name
            dest = target / name
            if member.isdir():
                dest.mkdir(parents=True, exist_ok=True)
            else:
                dest.parent.mkdir(parents=True, exist_ok=True)
                with tar.extractfile(member) as source, dest.open('xb') as output:
                    shutil.copyfileobj(source, output)
                dest.chmod(0o755 if member.mode & 0o111 else 0o644)
    for required in ['server.mjs', 'package.json', 'package-lock.json', 'lib', 'public/v2/index.html']:
        if not (target / required).exists():
            raise ValueError('Missing release file: ' + required)


def backup():
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    dest = APP / 'backups' / ('cloud-' + stamp)
    dest.mkdir(mode=0o700, parents=True)
    db = sqlite3.connect((SHARED / 'atelie.sqlite').as_uri() + '?mode=ro', uri=True)
    out = sqlite3.connect(dest / 'atelie.sqlite')
    try:
        db.backup(out)
        if out.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
            raise RuntimeError('Backup integrity check failed')
        if out.execute('PRAGMA foreign_key_check').fetchall():
            raise RuntimeError('Backup foreign-key check failed')
    finally:
        db.close()
        out.close()
    for name in ['uploads', 'private-client']:
        if (SHARED / name).exists():
            shutil.copytree(SHARED / name, dest / name, symlinks=False)
    for source, name in [(SHARED / 'vapid.json', 'vapid.json'), (Path('/etc/atelie.env'), 'production.env')]:
        if source.exists():
            shutil.copy2(source, dest / name)
            (dest / name).chmod(0o600)
    (dest / 'previous-release.txt').write_text(str((APP / 'current').resolve()) + '\n')
    print(json.dumps({'backup': str(dest), 'integrity': 'ok', 'foreign_keys': 'ok'}))
    return dest


def status():
    print(json.dumps({'current': str((APP / 'current').resolve()),
        'active': subprocess.run(['/bin/systemctl', 'is-active', 'atelie'], capture_output=True, text=True).stdout.strip()}))
    subprocess.run(['/usr/bin/curl', '-fsS', '--retry', '4', '--retry-delay', '1', '--retry-connrefused', '--max-time', '10', 'http://127.0.0.1:3100/api/health'], check=True)


def install(identifier):
    identifier = require_id(identifier)
    dest = APP / 'releases' / identifier
    if dest.exists():
        raise ValueError('New release and regular incoming archive required')
    # Copy into a root-owned private directory before inspection (no upload races).
    with tempfile.TemporaryDirectory(prefix='luma-cloud-', dir=APP / 'releases') as temp:
        temp = Path(temp)
        temp.chmod(0o755)  # Service user can traverse, cannot replace children.
        frozen = temp / 'incoming.tar.gz'
        import pwd
        upload_user = pwd.getpwnam('luma-codex')
        directory_fd = os.open(INCOMING, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            upload_fd = os.open(identifier + '.tar.gz', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory_fd)
            with os.fdopen(upload_fd, 'rb') as source, frozen.open('xb') as output:
                details = os.fstat(source.fileno())
                if not stat.S_ISREG(details.st_mode) or details.st_uid != upload_user.pw_uid or details.st_size > 512*1024**2:
                    raise ValueError('Regular bounded archive owned by luma-codex required')
                shutil.copyfileobj(source, output)
        finally:
            os.close(directory_fd)
        unpacked = temp / 'release'
        unpacked.mkdir()
        extract_release(frozen, unpacked)
        account = pwd.getpwnam('atelie')
        for path in [unpacked, *unpacked.rglob('*')]:
            os.chown(path, account.pw_uid, account.pw_gid, follow_symlinks=False)
        cache = unpacked / '.npm-cache'
        cache.mkdir(exist_ok=True, mode=0o700)
        if cache.is_symlink() or not cache.is_dir():
            raise ValueError('Unsafe package cache')
        os.chown(cache, account.pw_uid, account.pw_gid, follow_symlinks=False)
        subprocess.run(['/usr/sbin/runuser', '-u', 'atelie', '--', '/usr/bin/npm', 'ci', '--omit=dev', '--cache', str(cache)],
            cwd=unpacked, check=True, env={'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': str(SHARED)})
        unpacked.rename(dest)
    print(json.dumps({'installed': identifier, 'published': False}))


def switch(identifier):
    identifier = require_id(identifier)
    dest = APP / 'releases' / identifier
    if dest.is_symlink() or not dest.is_dir() or not (dest / 'server.mjs').is_file():
        raise ValueError('Existing regular release required')
    backup()
    temporary = APP / 'current.cloud-next'
    if temporary.exists() or temporary.is_symlink():
        raise ValueError('Existing pending switch needs inspection')
    temporary.symlink_to(dest)
    temporary.replace(APP / 'current')
    subprocess.run(['/bin/systemctl', 'restart', 'atelie'], check=True)
    # No automatic old-database or old-backend restore after schema changes.
    status()


def main():
    args = sys.argv[1:]
    if not args or args[0] not in {'status', 'logs', 'backup', 'restart', 'install', 'switch', 'run'}:
        raise ValueError('Commands: status, logs, backup, restart, install ID, switch ID, run COMMAND')
    action = args[0]
    if action in {'install', 'switch', 'run'}:
        if len(args) != 2:
            raise ValueError('Exactly one argument required')
    elif len(args) != 1:
        raise ValueError('No additional arguments accepted')
    if action == 'status': status()
    elif action == 'backup': backup()
    elif action == 'logs': subprocess.run(['/bin/journalctl', '-u', 'atelie', '-n', '100', '--no-pager'], check=True)
    elif action == 'restart':
        subprocess.run(['/bin/systemctl', 'restart', 'atelie'], check=True)
        status()
    elif action == 'install': install(args[1])
    elif action == 'switch': switch(args[1])
    elif action == 'run':
        # Arbitrary diagnostics run with service-user privileges, never as root.
        subprocess.run(['/usr/sbin/runuser', '-u', 'atelie', '--', '/bin/bash', '-lc', args[1]],
            cwd=APP / 'current', check=True, env={'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': str(SHARED)})


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Luma cloud command failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
