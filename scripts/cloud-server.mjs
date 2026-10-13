// Uses the dedicated app-scoped SSH key from the private transfer.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const folder=path.resolve('.local-data/cloud-access');
const configPath=path.join(folder,'config.json');
const quote=value=>"'"+String(value).replaceAll("'","'\\''")+"'";
const [action,...args]=process.argv.slice(2);
const actions=new Set(['status','logs','backup','restart','install','switch','run']);
try {
  if(!actions.has(action) || (['install','switch','run'].includes(action)?args.length!==1:args.length!==0))throw new Error('Use status/logs/backup/restart or install/switch/run with one argument');
  const config=JSON.parse(fs.readFileSync(configPath,'utf8'));
  if(config.host!=='13.143.66.1'||config.user!=='luma-codex'||config.helper!=='/usr/local/sbin/luma-cloud-admin')throw new Error('Unexpected server target');
  if(!config.accountInstalled)throw new Error('The dedicated server account is awaiting approval/activation; see OPS-04');
  const key=path.join(folder,'id_ed25519'),known=path.join(folder,'known_hosts');
  const remote=['sudo','-n',config.helper,action,...args].map(quote).join(' ');
  const result=spawnSync('ssh',['-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes',
    '-o','ClearAllForwardings=yes','-o',`UserKnownHostsFile=${known}`,'-i',key,'-p',String(config.port||22),`${config.user}@${config.host}`,remote],{stdio:'inherit'});
  if(result.error)throw new Error('SSH client unavailable');
  process.exitCode=result.status??1;
} catch(error) {
  console.error('Cloud server access: '+error.message);
  process.exitCode=1;
}
