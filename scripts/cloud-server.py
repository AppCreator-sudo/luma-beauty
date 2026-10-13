"""Use existing Luma credentials; no accounts or permissions created."""
import pathlib,sys,re,json
root=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'.local-data/cloud-tools'))
import paramiko
folder=root/'deploy/cloud-transfer/server-secrets'
config=json.loads((folder/'config.json').read_text())
private=(folder/'SSH_ACCESS_PRIVATE.md').read_text(encoding='utf-8-sig')
match=re.search(r'^Пароль:\s*(.+)$',private,re.M)
if not match:raise SystemExit('Existing SSH credentials unavailable')
args=sys.argv[1:]
if args==['status']:command='systemctl is-active atelie && readlink -f /opt/atelie/current && curl -fsS http://127.0.0.1:3100/api/health'
elif len(args)==2 and args[0]=='run':command=args[1]
else:raise SystemExit('Use status or run COMMAND; work only on Luma according to AGENTS.md')
client=paramiko.SSHClient();client.load_host_keys(str(folder/'known_hosts'));client.set_missing_host_key_policy(paramiko.RejectPolicy())
try:
 client.connect(config['host'],port=config['port'],username=config['user'],password=match.group(1).strip(),look_for_keys=False,allow_agent=False,timeout=15)
 _,out,err=client.exec_command(command,timeout=300)
 sys.stdout.write(out.read().decode('utf8',errors='replace'));sys.stderr.write(err.read().decode('utf8',errors='replace'))
 sys.exit(out.channel.recv_exit_status())
except Exception:raise SystemExit('Existing server connection failed; check cloud networking. Credentials were not printed.')
finally:client.close()
