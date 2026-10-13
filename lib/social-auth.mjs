import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {authProviders} from './auth-providers.mjs';

export function socialAuth({app,db,authLimit,fail,session,cookie,hash,str,origin,secureCookie,access,requireUser,passwordOk,providers=authProviders()}){
  const get=(sql,...args)=>db.prepare(sql).get(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
  // Only transient state is extended. Existing identities and accounts remain.
  const additions={next_path:"TEXT NOT NULL DEFAULT ''",account_type:"TEXT NOT NULL DEFAULT 'client'",provider:"TEXT NOT NULL DEFAULT 'yandex'",intent:"TEXT NOT NULL DEFAULT 'login'",target_user:"TEXT NOT NULL DEFAULT ''",session_hash:"TEXT NOT NULL DEFAULT ''",nonce:"TEXT NOT NULL DEFAULT ''"};
  const columns=db.prepare('PRAGMA table_info(oauth_states)').all().map(c=>c.name);
  db.exec('BEGIN IMMEDIATE');
  try{
    for(const [name,definition] of Object.entries(additions))if(!columns.includes(name))db.exec(`ALTER TABLE oauth_states ADD COLUMN ${name} ${definition}`);
    if(!db.prepare('PRAGMA table_info(sessions)').all().some(c=>c.name==='authenticated_at'))db.exec('ALTER TABLE sessions ADD COLUMN authenticated_at INTEGER NOT NULL DEFAULT 0');
    db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e}
  const safeNext=value=>typeof value==='string'&&(/^\/v2\/join#[a-f0-9]{64}$/.test(value)||['/v2/me','/v2/studio','/v2/salon','/v2/access'].includes(value))?value:'';
  const enabled=()=>Object.fromEntries(Object.entries(providers).map(([name,p])=>[name,p.ready()]));
  const sessionHash=req=>hash(cookie(req,'atelie_session'));
  const freshSession=req=>Boolean(get('SELECT 1 FROM sessions WHERE token=? AND user_id=? AND expires>? AND authenticated_at>?',sessionHash(req),req.user.id,Date.now(),Date.now()-600000));
  function stillLinkedSession(req,auth){
    return req.user?.id===auth.target_user&&sessionHash(req)===auth.session_hash&&Boolean(get('SELECT 1 FROM sessions WHERE token=? AND user_id=? AND expires>?',auth.session_hash,auth.target_user,Date.now()));
  }
  function start(req,res,name,intent='login'){
    const link=intent==='link',reauth=intent==='reauth',privateAction=link||reauth;
    const provider=providers[name];
    if(!provider?.ready())fail('Этот способ входа пока не подключён',503);
    if(privateAction&&!req.user)fail('Войдите в аккаунт, чтобы добавить способ входа',401);
    if(!privateAction&&req.user)fail('Вы уже вошли. Добавьте способ входа в настройках аккаунта.',409);
    if(link&&!freshSession(req))fail('Сначала подтвердите вход в текущий аккаунт',403);
    if(reauth&&!get('SELECT 1 FROM identities WHERE user_id=? AND provider=?',req.user.id,name))fail('Этот способ не подключён к вашему аккаунту',403);
    if(link&&get('SELECT 1 FROM identities WHERE user_id=? AND provider=?',req.user.id,name))fail('Этот способ входа уже подключён',409);
    const state=randomBytes(24).toString('hex'),verifier=randomBytes(32).toString('base64url'),nonce=randomBytes(24).toString('hex');
    const challenge=createHash('sha256').update(verifier).digest('base64url');
    const body=req.body||{},role=['client','master','salon'].includes(body.account_type)?body.account_type:'client';
    const old=cookie(req,'oauth_state');if(old)run('DELETE FROM oauth_states WHERE state=?',hash(old));
    run('DELETE FROM oauth_states WHERE expires<=?',Date.now());
    run('INSERT INTO oauth_states(state,expires,verifier,next_path,account_type,provider,intent,target_user,session_hash,nonce) VALUES(?,?,?,?,?,?,?,?,?,?)',hash(state),Date.now()+600000,verifier,privateAction?'/v2/access':safeNext(body.next),role,name,intent,privateAction?req.user.id:'',privateAction?sessionHash(req):'',nonce);
    res.cookie('oauth_state',state,{httpOnly:true,secure:secureCookie,sameSite:'lax',maxAge:600000,path:'/auth'});
    return provider.authorize({response_type:'code',redirect_uri:origin+`/auth/${name}/callback`,state,code_challenge:challenge,code_challenge_method:'S256',nonce,...(reauth?{prompt:'login'}:{})});
  }
  function accountFor(name,subject,auth,req){
    db.exec('BEGIN IMMEDIATE');
    try{
      const existing=get('SELECT user_id FROM identities WHERE provider=? AND subject=?',name,subject);
      let id;
      if(auth.intent==='reauth'){
        if(!stillLinkedSession(req,auth))fail('Войдите заново',401);
        if(existing?.user_id!==auth.target_user)fail('Подтвердите вход в тот же аккаунт',409);
        id=auth.target_user;
        run('UPDATE sessions SET authenticated_at=? WHERE token=?',Date.now(),auth.session_hash);
      }else if(auth.intent==='link'){
        if(!stillLinkedSession(req,auth))fail('Войдите заново',401);
        if(!freshSession(req))fail('Подтвердите вход',401);
        id=auth.target_user;
        if(existing&&existing.user_id!==id)fail('Этот способ уже связан с другим аккаунтом',409);
        const current=get('SELECT subject FROM identities WHERE user_id=? AND provider=?',id,name);
        if(current&&current.subject!==subject)fail('Способ входа уже подключён',409);
        if(!existing)run('INSERT INTO identities(provider,subject,user_id) VALUES(?,?,?)',name,subject,id);
      }else{
        if(req.user)fail('Аккаунт изменился во время входа',409);
        id=existing?.user_id;
        if(!id){
          id=randomUUID();
          run('INSERT INTO users(id,login,password,recovery,created,account_type) VALUES(?,?,?,?,?,?)',id,name+'_'+randomBytes(8).toString('hex'),'disabled',hash(randomBytes(32)),Date.now(),auth.account_type);
          run('INSERT INTO identities(provider,subject,user_id) VALUES(?,?,?)',name,subject,id);
        }
      }
      db.exec('COMMIT');return id;
    }catch(error){db.exec('ROLLBACK');throw error}
  }
  for(const [name,provider] of Object.entries(providers)){
    app.post(`/api/auth/${name}/start`,authLimit,(req,res)=>res.json({url:start(req,res,name)}));
    app.post(`/api/account/access/${name}/start`,requireUser,authLimit,(req,res)=>res.json({url:start(req,res,name,'link')}));
    app.post(`/api/account/access/${name}/reauth`,requireUser,authLimit,(req,res)=>res.json({url:start(req,res,name,'reauth')}));
    // Retain the existing Yandex entry link. Linking is always a same-origin POST.
    if(name==='yandex')app.get('/auth/yandex',authLimit,(req,res)=>res.redirect(start(req,res,name)));
    app.get(`/auth/${name}/callback`,authLimit,async(req,res)=>{
      const state=str(req.query.state,100),auth=/^[a-f0-9]{48}$/.test(state)?get('SELECT * FROM oauth_states WHERE state=? AND expires>?',hash(state),Date.now()):null;
      let destination='/v2/auth';
      function error(code){
        if(destination.startsWith('/v2/join#'))return res.redirect('/v2/join?auth_error='+code+destination.slice('/v2/join'.length));
        return res.redirect(destination+'?auth_error='+code);
      }
      if(!auth||auth.provider!==name||state!==cookie(req,'oauth_state')||!auth.verifier)return error('expired');
      destination=auth.intent!=='login'?'/v2/access':safeNext(auth.next_path).startsWith('/v2/join#')?auth.next_path:'/v2/auth';
      // Consume before network I/O; concurrent/replayed callbacks cannot proceed.
      if(!run('DELETE FROM oauth_states WHERE state=?',hash(state)).changes)return error('expired');
      res.clearCookie('oauth_state',{httpOnly:true,secure:secureCookie,sameSite:'lax',path:'/auth'});
      if(auth.intent!=='login'&&!stillLinkedSession(req,auth))return error('session');
      if(auth.intent==='login'&&req.user)return error('session');
      const code=str(req.query.code,2000);
      if(req.query.error||!code)return error('cancelled');
      let subject;
      try{
        if(!provider.ready())throw new Error('Provider disabled');
        const value=await provider.subject({code,verifier:auth.verifier,redirect:origin+`/auth/${name}/callback`,state,nonce:auth.nonce,query:req.query});
        if(!['string','number'].includes(typeof value))throw new Error('Invalid subject');
        subject=String(value);
        if(!subject||subject.length>200||/\s/.test(subject))throw new Error('Invalid subject');
      }catch{return error('provider')}
      let id;
      try{id=accountFor(name,subject,auth,req)}catch(e){return error(e.status===409?'conflict':e.status===401?'session':'failed')}
      if(auth.intent==='link')return res.redirect('/v2/access?linked='+name);
      if(auth.intent==='reauth')return res.redirect('/v2/access?verified=1');
      session(res,id);
      const role=get('SELECT account_type FROM users WHERE id=?',id).account_type;
      const cabinet=role==='salon'||access.memberships(id).some(w=>w.kind==='salon')?'/v2/salon':role==='master'?'/v2/studio':'/v2/me';
      return res.redirect(safeNext(auth.next_path)||cabinet);
    });
  }
  app.get('/api/account/access',requireUser,(req,res)=>{
    const linked=db.prepare('SELECT DISTINCT provider FROM identities WHERE user_id=?').all(req.user.id).map(row=>row.provider);
    res.json({password:get('SELECT password FROM users WHERE id=?',req.user.id).password!=='disabled',recent: freshSession(req),providers:Object.entries(enabled()).map(([id,ready])=>({id,ready,linked:linked.includes(id)}))});
  });
  app.post('/api/account/access/password/reauth',requireUser,authLimit,async(req,res)=>{
    const stored=get('SELECT password FROM users WHERE id=?',req.user.id)?.password;
    if(!stored||!passwordOk||!await passwordOk(str(req.body.password,128),stored))fail('Пароль указан неверно',401);
    if(!run('UPDATE sessions SET authenticated_at=? WHERE token=? AND user_id=? AND expires>?',Date.now(),sessionHash(req),req.user.id,Date.now()).changes)fail('Войдите заново',401);
    res.json({ok:true});
  });
  app.post('/api/account/sessions/revoke',requireUser,authLimit,(req,res)=>{
    run('DELETE FROM sessions WHERE user_id=? AND token<>?',req.user.id,sessionHash(req));
    run('DELETE FROM oauth_states WHERE target_user=?',req.user.id);
    res.json({ok:true});
  });
  return {enabled};
}
