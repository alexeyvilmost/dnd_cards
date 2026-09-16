"""Read-only production dump over verified SSH; no credentials are printed/saved.

Requires paramiko. Restoring is deliberately a separate, local-only step.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import urllib.request

import paramiko

root = Path(__file__).resolve().parents[2]
token = re.search(r"(?m)^TOKEN\s*=\s*(.+)$", (root / '.env').read_text()).group(1).strip().strip('\"\'')
request = urllib.request.Request('https://api.timeweb.cloud/api/v1/servers/8853759',
                                 headers={'Authorization': 'Bearer ' + token})
with urllib.request.urlopen(request, timeout=30) as response:
    server = json.load(response)['server']
if server['name'] != 'bagofholding-prod-app':
    raise RuntimeError('Unexpected production server')
destination = Path(sys.argv[1]).resolve()
if root not in destination.parents or destination.suffix != '.dump':
    raise RuntimeError('Dump must be a new workspace .dump file')
destination.parent.mkdir(parents=True, exist_ok=True)
ssh = paramiko.SSHClient()
ssh.load_host_keys(str(Path(os.environ['USERPROFILE']) / '.ssh' / 'known_hosts'))
ssh.set_missing_host_key_policy(paramiko.RejectPolicy())
ssh.connect('77.95.206.239', username='root', password=server['root_pass'],
            look_for_keys=False, allow_agent=False, timeout=30)
try:
    command = ('docker run --rm --env-file /opt/bagofholding/shared/app.env postgres:17-alpine '
               'sh -eu -c \'test -n "${DATABASE_URL:-}"; '
               'exec pg_dump --format=custom --no-owner --no-acl --dbname="$DATABASE_URL"\'')
    _, output, errors = ssh.exec_command(command, timeout=600)
    digest = hashlib.sha256()
    size = 0
    with destination.open('xb') as dump:
        while chunk := output.read(1024 * 1024):
            dump.write(chunk)
            digest.update(chunk)
            size += len(chunk)
    status = output.channel.recv_exit_status()
    if status or size < 1000:
        raise RuntimeError(f'pg_dump failed (exit {status}); incomplete file retained for inspection')
    print(json.dumps({'file': str(destination), 'bytes': size, 'sha256': digest.hexdigest(),
                      'source': 'bagofholding-prod-db', 'productionChanged': False}))
finally:
    ssh.close()
