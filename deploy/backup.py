import sqlite3, pathlib, datetime, tarfile, os
os.umask(0o077)
root=pathlib.Path('/opt/atelie')
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S')
target=root/'backups'/stamp
target.mkdir(parents=True)
with sqlite3.connect(root/'shared'/'atelie.sqlite') as source, sqlite3.connect(target/'atelie.sqlite') as destination:
    source.backup(destination)
with tarfile.open(target/'files.tar.gz','w:gz') as archive:
    archive.add(root/'shared'/'uploads',arcname='uploads')
    archive.add(root/'shared'/'vapid.json',arcname='vapid.json')
print('Backup completed:',target)
