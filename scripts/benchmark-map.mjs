import {DatabaseSync} from 'node:sqlite';
import {performance} from 'node:perf_hooks';
import {pathToFileURL} from 'node:url';
import {mapViewport} from '../lib/map-viewport.mjs';

export function mapFixture(count=0){
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE schema_migrations(name TEXT PRIMARY KEY,created INTEGER NOT NULL);
    CREATE TABLE workspaces(id TEXT PRIMARY KEY,kind TEXT,owner_user_id TEXT,name TEXT,city TEXT,slug TEXT,bio TEXT,
      address TEXT,latitude REAL,longitude REAL,published INTEGER);
    CREATE TABLE performers(id TEXT PRIMARY KEY,workspace_id TEXT,user_id TEXT,name TEXT,active INTEGER,bookable INTEGER);
    CREATE INDEX performers_workspace ON performers(workspace_id,active);
    CREATE TABLE profiles(user_id TEXT PRIMARY KEY,slug TEXT UNIQUE,name TEXT,city TEXT,category TEXT,avatar TEXT,
      address TEXT,latitude REAL,longitude REAL,teaches INTEGER,published INTEGER,is_demo INTEGER,bio TEXT,private_note TEXT);
    CREATE TABLE profile_categories(user_id TEXT,category TEXT,PRIMARY KEY(user_id,category));
    CREATE INDEX profile_categories_by_category ON profile_categories(category,user_id);`);
  const workspace=db.prepare("INSERT INTO workspaces(id,kind,owner_user_id,name,city) VALUES(?,'solo',?,?,'Новосибирск')"),person=db.prepare('INSERT INTO performers VALUES(?,?,?,?,1,0)');
  const profile=db.prepare(`INSERT INTO profiles VALUES(?,?,?,?,?,?,?,?,?,0,1,0,?,?)`),category=db.prepare('INSERT INTO profile_categories VALUES(?,?)');
  function master(id,latitude=55,longitude=82.9,{name='Мастер '+id,city='Новосибирск',category:selected='Маникюр'}={}){
    workspace.run('solo:'+id,id,name);person.run(id,'solo:'+id,id,name);
    profile.run(id,'master-'+id,name,city,selected,'','ул Примерная, д 21',latitude,longitude,'Private biography','Private operator note');category.run(id,selected);
  }
  db.exec('BEGIN');for(let i=0;i<count;i++)master(String(i).padStart(6,'0'),54.96+(i%100)*0.0008,82.86+Math.floor(i/100)*0.0008);db.exec('COMMIT');
  const promotionControl={active:()=>new Map(),decorate:card=>card};
  const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
  return {db,master,promotionControl,fail};
}

export function benchmarkMap(count,rounds=60){
  const fixture=mapFixture(count),start=performance.now(),map=mapViewport(fixture),migrationMs=performance.now()-start;
  const scenarios=[['bootstrap',{}],['city',{bbox:'82.8,54.9,83.1,55.1',zoom:'11'}],['city_zoom18',{bbox:'82.8,54.9,83.1,55.1',zoom:'18'}],['street',{bbox:'82.88,54.98,82.90,55.0',zoom:'16'}],['search',{bbox:'82.8,54.9,83.1,55.1',zoom:'13',q:'НОВОСИБИРСК',category:'Маникюр'}]];
  const results=[];
  for(const [scenario,query] of scenarios){
    let result;for(let i=0;i<5;i++)map.read(query);
    const times=[];for(let i=0;i<rounds;i++){const begin=performance.now();result=map.read(query);times.push(performance.now()-begin)}times.sort((a,b)=>a-b);
    const coverage=result.points.length+result.clusters.reduce((sum,c)=>sum+c.count,0);
    if(coverage!==result.total||result.points.length+result.clusters.length>300)throw new Error('Map coverage regression');
    results.push({scenario,total:result.total,markers:result.points.length+result.clusters.length,items:result.items.length,
      p50_ms:Number(times[Math.floor(times.length*.5)].toFixed(2)),p95_ms:Number(times[Math.ceil(times.length*.95)-1].toFixed(2)),payload_bytes:Buffer.byteLength(JSON.stringify(result))});
  }
  const indexed=map.queryPlan({bbox:'82.88,54.98,82.90,55.0',zoom:'16'}).some(row=>/VIRTUAL TABLE INDEX/.test(row.detail));fixture.db.close();
  return {count,migration_ms:Number(migrationMs.toFixed(2)),rounds,indexed,results};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  console.log(JSON.stringify({runtime:process.version,source:'Synthetic isolated in-memory database; public request computation only',benchmarks:[benchmarkMap(1000),benchmarkMap(10000)]},null,2));
}
