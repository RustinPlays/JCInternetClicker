import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

const home = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(home, '.env');
if (fs.existsSync(envPath)) for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && !process.env[match[1]]) {
    const value = match[2].trim();
    try { process.env[match[1]] = value.startsWith('"') ? JSON.parse(value) : value; }
    catch { process.env[match[1]] = value; }
  }
}
const { ADMIN_USERNAME, ADMIN_PASSWORD_SALT, ADMIN_PASSWORD_HASH, SESSION_SECRET } = process.env;
if (!ADMIN_USERNAME || !ADMIN_PASSWORD_SALT || !ADMIN_PASSWORD_HASH || !SESSION_SECRET) {
  console.error('First run: cd server && npm install && npm run setup && npm start');
  process.exit(1);
}
const PORT = parseInt(process.env.PORT || '8787');
const PUBLIC_ORIGIN = (process.env.PUBLIC_ORIGIN || '').replace(/\/$/, '');
const WEB_ORIGINS = (process.env.WEB_ORIGINS || '').split(',').map(x=>x.trim().replace(/\/$/, '')).filter(Boolean);
const STARTED = Date.now();
const STATE = path.join(home, 'state.json');
const initial = { agents: [], buttons: [], logs: [], mappings: [], events: [], profiles:[{id:'default',name:'Default Show'}], macros:[], operators:[] };
let db = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : initial;
db.agents ||= []; db.buttons ||= []; db.logs ||= []; db.mappings ||= []; db.events ||= [];
db.profiles ||= [{id:'default',name:'Default Show'}]; db.macros ||= []; db.operators ||= [];
for(const b of db.buttons) b.profileId ||= 'default';
const online = new Map(), pending = new Map(), sessions = new Map(), attempts = new Map(), inputDebounce = new Map(), pairCodes=new Map();
const uuid = () => crypto.randomUUID();
const keyHash = str => crypto.createHash('sha256').update(str).digest('hex');
const safeEq = (a,b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
};
function save() {
  fs.writeFileSync(STATE + '.tmp', JSON.stringify(db, null, 2), { mode: 0o600 });
  fs.renameSync(STATE + '.tmp', STATE);
}
function log(message, status='info') {
  db.logs.unshift({ id: uuid(), time: new Date().toISOString(), status, message: String(message).slice(0, 300) });
  db.logs = db.logs.slice(0, 100);
  save();
}
function send(res, status, data, extra={}) {
  const json = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(json);
}
function readJSON(req) {
  return new Promise((resolve,reject) => {
    let buffer='';
    req.on('data', chunk => { buffer += chunk; if (buffer.length > 300_000) { reject(Error('Request too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(buffer || '{}')); } catch { reject(Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}
const text = (v,max=120) => typeof v==='string' ? v.trim().slice(0,max) : '';
const isPort = v => Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 65535;
const TYPES = ['powerpoint','osc','companion','http','tcp','udp','vmix','obs','midi','script','hotkey'];
const INPUT_KEYS = ['right','left','page_down','page_up','space','enter','f5','escape','test'];
const INPUT_KINDS = ['keyboard','http','test','midi'];
const validInputKey=k=>INPUT_KEYS.includes(k) || /^midi:(?:note_on|note_off|control_change|program_change):(?:[0-9]{1,3}):[0-9]{1,2}$/.test(k||'');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function targetForButton(b){const agent=db.agents.find(a=>a.id===b.agentId);return {agent,target:agent?.targets.find(t=>t.id===b.targetId)};}
async function executeButton(b,source='clicker'){const {agent,target}=targetForButton(b);if(!target)throw Error('Target missing');const result=await dispatch(agent.id,{type:'execute',target,action:b.action});agent.lastAck={time:new Date().toISOString(),kind:'command',ok:!!result.ok,detail:result.message||result.error||'No detail'};event('command',agent,`${source} / ${b.name}: ${agent.lastAck.detail}`,result.ok?'ok':'error');return result;}
const targetPublic = a => ({ id:a.id, name:a.name, online:online.has(a.id), seenAt:a.seenAt || null,
  connectedAt:a.connectedAt || null, lastAck:a.lastAck || null, lastInput:a.lastInput || null,
  latencyMs:a.latencyMs ?? null, info:a.info || {}, targets: a.targets.map(t=>({...t})) });
const authToken = req => (req.headers.authorization || '').match(/^Bearer ([A-Za-z0-9_-]{20,100})$/)?.[1];
const sessionFor = req => { const sid=authToken(req), s=sessions.get(sid);return s && s.until>Date.now()?s:null; };
const loggedIn=req=>!!sessionFor(req);
const isAdmin=req=>sessionFor(req)?.role==='admin';
function validOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;  // Non-browser clients still need bearer authentication.
  const sameOrigin = origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`;
  return sameOrigin || origin === PUBLIC_ORIGIN || WEB_ORIGINS.includes(origin);
}
function addCors(req,res) {
  if (req.headers.origin && validOrigin(req)) {
    res.setHeader('Access-Control-Allow-Origin',req.headers.origin);
    res.setHeader('Vary','Origin');
    res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age','300');
  }
}
function event(kind, receiver, detail, status='info', extra={}) {
  db.events.unshift({id:uuid(),time:new Date().toISOString(),kind,receiverId:receiver.id,
    receiverName:receiver.name,detail:String(detail).slice(0,250),status,...extra});
  db.events=db.events.slice(0,80);save();
}

function wsSend(ws, payload) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload)); }
function dispatch(agentId, packet, timeout=8000) {
  return new Promise((resolve,reject) => {
    const ws = online.get(agentId);
    if (!ws || ws.readyState !== WebSocket.OPEN) return reject(Error('Receiver offline'));
    const id=uuid();
    const timer=setTimeout(()=>{pending.delete(id);reject(Error('Receiver did not respond within 8 seconds'));},timeout);
    pending.set(id, { resolve,reject,timer,agentId });
    wsSend(ws, { ...packet, id });
  });
}
function respondPending(msg,agentId) {
  const task=pending.get(msg.id);
  if (!task || task.agentId!==agentId) return;
  pending.delete(msg.id);clearTimeout(task.timer);
  task.resolve(msg);
}
function defaultTargets() { return [
  {id:uuid(), name:'PowerPoint', type:'powerpoint',host:'',port:null},
  {id:uuid(), name:'Resolume Arena', type:'osc',host:'127.0.0.1',port:7000},
  {id:uuid(), name:'Bitfocus Companion', type:'companion',host:'127.0.0.1',port:8000}
]; }
function buttonDefaults(agent) {
  const [ppt,arena,comp] = agent.targets;
  return [
    {id:uuid(),profileId:'default',agentId:agent.id,targetId:ppt.id,name:'Next slide',color:'green',action:{operation:'next'}},
    {id:uuid(),agentId:agent.id,targetId:ppt.id,name:'Previous slide',color:'blue',action:{operation:'previous'}},
    {id:uuid(),agentId:agent.id,targetId:ppt.id,name:'Start slideshow',color:'neutral',action:{operation:'start'}},
    {id:uuid(),agentId:agent.id,targetId:arena.id,name:'Next column',color:'green',action:{address:'/composition/connectnextcolumn',valueType:'int',value:1}},
    {id:uuid(),agentId:agent.id,targetId:arena.id,name:'Previous column',color:'blue',action:{address:'/composition/connectprevcolumn',valueType:'int',value:1}},
    {id:uuid(),agentId:agent.id,targetId:comp.id,name:'Companion 1 / 1 / 1',color:'neutral',action:{page:1,row:1,column:1,operation:'press'}}
  ];
}
function cleanTarget(data,existing) {
  const type = text(data.type,20);
  if (!TYPES.includes(type)) throw Error('Unknown target type');
  const name = text(data.name,70);
  if (!name) throw Error('Enter a target name');
  const localOnly=['powerpoint','midi','script','hotkey'].includes(type);
  const host = localOnly ? '' : text(data.host,190);
  if (!localOnly && (!host || /[^a-zA-Z0-9.:-]/.test(host))) throw Error('Enter an IP address or hostname');
  const port = localOnly ? null : Number(data.port);
  if (!localOnly && !isPort(port)) throw Error('Enter a port between 1 and 65535');
  return { id:existing?.id || uuid(),name,type,host,port,secure:type==='http'&&!!data.secure };
}
function actionValid(type,a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) throw Error('Invalid action');
  if (type==='powerpoint') {
    if (!['next','previous','first','last','start','end','goto'].includes(a.operation)) throw Error('Unknown PowerPoint action');
    if (a.operation==='goto' && (!Number.isInteger(Number(a.slide)) || Number(a.slide)<1 || Number(a.slide)>10000)) throw Error('Slide number invalid');
    return {operation:a.operation, ...(a.operation==='goto'?{slide:Number(a.slide)}:{})};
  }
  if (type==='osc') {
    const address=text(a.address,180);
    if (!/^\/[a-zA-Z0-9_\-/]+$/.test(address)) throw Error('OSC address must begin with /');
    if (!['int','float','string','none'].includes(a.valueType)) throw Error('Choose OSC argument type');
    const value = a.valueType==='none' ? '' : a.valueType==='string' ? text(a.value,200) : Number(a.value);
    if (['int','float'].includes(a.valueType) && (!Number.isFinite(value) || (a.valueType==='int' && !Number.isInteger(value)))) throw Error('Invalid OSC numeric value');
    return {address,valueType:a.valueType,value};
  }
  if (type==='companion') {
    const numbers = ['page','row','column'].map(k=>Number(a[k]));
    if (numbers.some(n=>!Number.isInteger(n) || n<1 || n>999)) throw Error('Invalid Companion button position');
    if (!['press','down','up','rotate-left','rotate-right'].includes(a.operation)) throw Error('Invalid Companion operation');
    return {page:numbers[0],row:numbers[1],column:numbers[2],operation:a.operation};
  }
  if (type==='http') {
    const urlPath=text(a.path,500);
    if (!urlPath.startsWith('/') || urlPath.startsWith('//')) throw Error('HTTP path must start with /');
    if (!['GET','POST','PUT','PATCH'].includes(a.method)) throw Error('Invalid HTTP method');
    return {path:urlPath,method:a.method,body:String(a.body||'').slice(0,2000),contentType:a.contentType==='json'?'json':'text'};
  }
  if(type==='hotkey'){const keys=text(a.keys,100);if(!/^[A-Za-z0-9+,_ -]{1,100}$/.test(keys))throw Error('Invalid shortcut');return {keys};}
  if(type==='script'){const script=text(a.script,70);if(!/^[A-Za-z][A-Za-z0-9_-]{0,69}$/.test(script))throw Error('Use an approved local script name');return {script};}
  if(type==='midi'){const kind=text(a.kind,30),device=text(a.device,120);if(!['note_on','note_off','control_change','program_change'].includes(kind))throw Error('Invalid MIDI action');const channel=Number(a.channel),note=Number(a.note),value=Number(a.value);if(!Number.isInteger(channel)||channel<0||channel>15||!Number.isInteger(note)||note<0||note>127||!Number.isInteger(value)||value<0||value>127)throw Error('Invalid MIDI values');return {kind,device,channel,note,value};}
  if(type==='vmix'){const operation=text(a.operation,60),input=text(a.input,120);if(!/^[A-Za-z][A-Za-z0-9]{0,60}$/.test(operation))throw Error('Invalid vMix function');return {operation,input};}
  if(type==='obs'){const operation=text(a.operation,70);if(!['StartStream','StopStream','StartRecord','StopRecord','TriggerStudioModeTransition','SetCurrentProgramScene','SetCurrentPreviewScene'].includes(operation))throw Error('OBS function not allowed');return {operation,sceneName:text(a.sceneName,100)};}
  if (type==='tcp' || type==='udp') {
    const payload=String(a.payload||'');
    if (payload.length>2000 || !payload) throw Error('Enter a payload (max 2000 characters)');
    if (!['utf8','hex'].includes(a.encoding)) throw Error('Select UTF-8 or hex');
    if (a.encoding==='hex' && (!/^(?:[0-9a-fA-F]{2}\s*)+$/.test(payload))) throw Error('Invalid hex bytes');
    return {payload,encoding:a.encoding};
  }
  throw Error('Unknown type');
}

const contentTypes={ '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8' };
const httpServer = http.createServer(async (req,res) => {
  try {
    const u=new URL(req.url,'http://localhost');
    const p=u.pathname;
    const isApi = p.startsWith('/api/');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Referrer-Policy','no-referrer');
    addCors(req,res);
    if (req.method==='OPTIONS' && isApi) {
      if (!validOrigin(req)) return send(res,403,{error:'Origin not allowed'});
      res.writeHead(204);return res.end();
    }
    if (!isApi && req.method==='GET') {
      const publicPath = p==='/' ? '/index.html' : p;
      if (!['/index.html','/app.js','/style.css','/browser.html','/browser.js'].includes(publicPath)) return send(res,404,{error:'Not found'});
      const asset=fs.readFileSync(path.join(home,'public',publicPath));
      res.writeHead(200, {'Content-Type':contentTypes[path.extname(publicPath)],'Cache-Control':'no-store', 'Content-Security-Policy':"default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self' https: wss: http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*; img-src 'self' data:; frame-ancestors 'none'" });
      return res.end(asset);
    }
    if (!isApi) return send(res,404,{error:'Not found'});
    if (!validOrigin(req)) return send(res,403,{error:'Origin not allowed. Add your GitHub Pages URL to WEB_ORIGINS on the relay.'});
    if (req.method==='GET' && p==='/api/health') return send(res,200,{ok:true,version:'0.3.0',uptimeSeconds:Math.round((Date.now()-STARTED)/1000)});
    if (req.method==='GET' && p==='/api/session') return send(res,200,{loggedIn:loggedIn(req),username:sessionFor(req)?.username||null,role:sessionFor(req)?.role||null});
    if (req.method==='POST' && p==='/api/login') {
      const addr=req.socket.remoteAddress || 'unknown';
      const entry=attempts.get(addr) || {n:0,until:0};
      if (entry.until>Date.now()) return send(res,429,{error:'Too many attempts; retry in 15 minutes'});
      const v=await readJSON(req);
      const operator=db.operators.find(o=>o.username===v.username);
      const salt=operator?.salt||ADMIN_PASSWORD_SALT;
      const calculated = crypto.scryptSync(String(v.password||'').slice(0,500),salt,64).toString('hex');
      const adminOk=v.username===ADMIN_USERNAME&&safeEq(calculated,ADMIN_PASSWORD_HASH);
      const operatorOk=operator&&safeEq(calculated,operator.hash);
      if (!adminOk && !operatorOk) {
        entry.n++; if (entry.n>=8){entry.until=Date.now()+900000;entry.n=0;} attempts.set(addr,entry);
        return send(res,401,{error:'Incorrect username or password'});
      }
      attempts.delete(addr);
      const sid=crypto.randomBytes(32).toString('base64url');
      const role=adminOk?'admin':'operator';const username=adminOk?ADMIN_USERNAME:operator.username;
      sessions.set(sid,{until:Date.now()+12*60*60*1000,role,username});
      return send(res,200,{ok:true,token:sid,username,role,expiresSeconds:43200});
    }
    if(req.method==='POST' && p==='/api/pair-exchange'){
      // Receiver downloads a key only via TLS, with a time-limited one-time pairing code.
      const host=req.headers.host||'';
      if(!req.socket.encrypted && !['127.0.0.1','localhost','[::1]'].includes(host.split(':')[0]) && req.headers['x-forwarded-proto']!=='https')return send(res,403,{error:'Pairing requires HTTPS'});
      const v=await readJSON(req),code=text(v.code,30).toUpperCase();
      const addr=req.socket.remoteAddress||'unknown',attempt=attempts.get('pair:'+addr)||{n:0,until:0};
      if(attempt.until>Date.now())return send(res,429,{error:'Pairing temporarily locked'});
      const rec=pairCodes.get(code);
      if(!rec||rec.until<Date.now()){
        attempt.n++;if(attempt.n>=6){attempt.n=0;attempt.until=Date.now()+900000;}attempts.set('pair:'+addr,attempt);
        return send(res,401,{error:'Pair code invalid or expired'});
      }
      pairCodes.delete(code);attempts.delete('pair:'+addr);
      const a=db.agents.find(a=>a.id===rec.agentId);if(!a)return send(res,404,{error:'Receiver removed'});
      const secret=crypto.randomBytes(32).toString('hex');a.keyHash=keyHash(secret);save();
      const existing=online.get(a.id);if(existing)existing.close(1008,'Receiver re-paired');
      return send(res,200,{receiver_id:a.id,receiver_key:secret,name:a.name});
    }
    if (!loggedIn(req)) return send(res,401,{error:'Log in first'});
    if (req.method==='POST' && p==='/api/logout') {
      sessions.delete(authToken(req));
      return send(res,200,{ok:true});
    }
    if (req.method==='GET' && p==='/api/state') return send(res,200,{agents:db.agents.map(targetPublic),buttons:db.buttons.map(b=>({...b,profileId:b.profileId||'default'})),logs:db.logs.slice(0,100),events:db.events.slice(0,80),mappings:db.mappings,profiles:db.profiles,macros:db.macros,role:sessionFor(req).role});
    if (req.method==='GET' && p==='/api/export') {if(!isAdmin(req))return send(res,403,{error:'Admin only'});return send(res,200,{version:3,exportedAt:new Date().toISOString(),profiles:db.profiles,buttons:db.buttons,macros:db.macros,agents:db.agents.map(a=>({...a,keyHash:undefined})),mappings:db.mappings,events:db.events,logs:db.logs});}
    if (req.method==='GET' && p==='/api/operators') {if(!isAdmin(req))return send(res,403,{error:'Admin only'});return send(res,200,{operators:db.operators.map(o=>({username:o.username}))});}
    if (req.method==='POST' && p==='/api/operators') {
      if(!isAdmin(req))return send(res,403,{error:'Admin only'});
      const v=await readJSON(req),username=text(v.username,50),password=String(v.password||'');
      if(!/^[A-Za-z0-9_.-]{3,50}$/.test(username)||username===ADMIN_USERNAME||password.length<12||password.length>200)throw Error('Use a unique operator username and password of at least 12 characters');
      if(db.operators.some(o=>o.username===username))throw Error('Username exists');
      const salt=crypto.randomBytes(24).toString('hex'),hash=crypto.scryptSync(password,salt,64).toString('hex');
      db.operators.push({username,salt,hash});log(`Operator added: ${username}`);return send(res,201,{ok:true});
    }
    const deleteOp=p.match(/^\/api\/operators\/([A-Za-z0-9_.-]+)$/);
    if(req.method==='DELETE' && deleteOp){if(!isAdmin(req))return send(res,403,{error:'Admin only'});db.operators=db.operators.filter(o=>o.username!==deleteOp[1]);for(const [token,s] of sessions)if(s.username===deleteOp[1])sessions.delete(token);log('Operator removed');return send(res,200,{ok:true});}
    if(req.method==='POST' && p==='/api/pair-codes'){
      if(!isAdmin(req))return send(res,403,{error:'Admin only'});
      const v=await readJSON(req),a=db.agents.find(x=>x.id===v.agentId);
      if(!a) return send(res,404,{error:'Receiver not found'});
      const code=crypto.randomBytes(6).toString('base64url').toUpperCase().replaceAll('-','A').replaceAll('_','B');
      pairCodes.set(code,{agentId:a.id,until:Date.now()+600000});
      return send(res,200,{code,expiresSeconds:600});
    }
    if(req.method==='POST' && p==='/api/profiles'){
      if(!isAdmin(req))return send(res,403,{error:'Admin only'});
      const v=await readJSON(req),name=text(v.name,70);if(!name)throw Error('Enter profile name');
      const profile={id:uuid(),name};db.profiles.push(profile);save();return send(res,201,{profile});
    }
    const profileDelete=p.match(/^\/api\/profiles\/([\w-]+)$/);
    if(profileDelete && req.method==='DELETE'){
      if(!isAdmin(req))return send(res,403,{error:'Admin only'});
      if(profileDelete[1]==='default')throw Error('Default profile cannot be removed');
      db.profiles=db.profiles.filter(q=>q.id!==profileDelete[1]);db.buttons=db.buttons.map(b=>({...b,profileId:b.profileId===profileDelete[1]?'default':b.profileId}));
      db.macros=db.macros.map(m=>({...m,profileId:m.profileId===profileDelete[1]?'default':m.profileId}));save();return send(res,200,{ok:true});
    }
    if(req.method==='POST' && p==='/api/macros'){
      if(!isAdmin(req))return send(res,403,{error:'Admin only'});
      const v=await readJSON(req),name=text(v.name,70),steps=v.steps;
      if(!name||!Array.isArray(steps)||steps.length<1||steps.length>16)throw Error('Macro requires 1–16 steps');
      if(!db.profiles.some(q=>q.id===v.profileId))throw Error('Invalid show profile');
      const parsed=steps.map(step=>{
        if(!db.buttons.some(b=>b.id===step.buttonId))throw Error('Macro button missing');
        const delayMs=Number(step.delayMs||0);
        if(!Number.isInteger(delayMs)||delayMs<0||delayMs>5000)throw Error('Delay must be 0–5000ms');
        return {buttonId:step.buttonId,delayMs};
      });
      const mode=v.mode==='parallel'?'parallel':'sequence';
      const macro={id:uuid(),name,profileId:v.profileId,mode,color:['green','blue','amber','red','neutral'].includes(v.color)?v.color:'neutral',steps:parsed};
      db.macros.push(macro);save();return send(res,201,{macro});
    }
    const macroRoute=p.match(/^\/api\/macros\/([\w-]+)(?:\/(run))?$/);
    if(macroRoute && req.method==='DELETE'){
      if(!isAdmin(req))return send(res,403,{error:'Admin only'});
      db.macros=db.macros.filter(m=>m.id!==macroRoute[1]);save();return send(res,200,{ok:true});
    }
    if(macroRoute && req.method==='POST' && macroRoute[2]==='run'){
      const macro=db.macros.find(m=>m.id===macroRoute[1]);if(!macro)return send(res,404,{error:'Macro not found'});
      // Never queue a missed click for retry. Run live, in the selected order, stopping on failure.
      const runStep=async step=>{
        if(step.delayMs)await sleep(step.delayMs);
        const b=db.buttons.find(b=>b.id===step.buttonId);
        if(!b)return {button:'Missing button',ok:false,message:'A macro button was removed'};
        try{const r=await executeButton(b,`macro ${macro.name}`);return {button:b.name,ok:!!r.ok,message:r.message||r.error};}
        catch(e){return {button:b.name,ok:false,message:e.message};}
      };
      const results=[];
      if(macro.mode==='parallel'){
        // Send independent receiver commands concurrently; not sample-accurate show sync.
        results.push(...await Promise.all(macro.steps.map(runStep)));
      }else{
        for(const step of macro.steps){const result=await runStep(step);results.push(result);if(!result.ok)break;}
      }
      return send(res,results.every(r=>r.ok)?200:502,{ok:results.every(r=>r.ok),results});
    }
    if(req.method==='POST' && p==='/api/import'){
      if(!isAdmin(req))return send(res,403,{error:'Admin only'});
      const data=await readJSON(req);
      if(data.version!==3||!Array.isArray(data.profiles)||!Array.isArray(data.buttons)||!Array.isArray(data.macros))throw Error('Import requires a v0.3 export');
      if(data.profiles.length>100||data.buttons.length>400||data.macros.length>100)throw Error('Import exceeds size limit');
      const profileIds=new Map([['default','default']]),buttonIds=new Map();
      const newProfiles=[],newButtons=[],newMacros=[];
      for(const profile of data.profiles){
        if(profile.id==='default')continue;
        const name=text(profile.name,70);if(!name)throw Error('Imported profile name missing');
        const id=uuid();profileIds.set(profile.id,id);newProfiles.push({id,name:name+' (imported)'});
      }
      for(const b of data.buttons){
        const a=db.agents.find(x=>x.id===b.agentId),t=a?.targets.find(x=>x.id===b.targetId);
        if(!t)continue;// Imported control from another relay has no matching receiver.
        const name=text(b.name,70);if(!name)continue;
        const action=actionValid(t.type,b.action);
        const id=uuid();buttonIds.set(b.id,id);
        newButtons.push({id,profileId:profileIds.get(b.profileId)||'default',agentId:a.id,targetId:t.id,name,color:['green','blue','amber','red','neutral'].includes(b.color)?b.color:'neutral',action});
      }
      for(const m of data.macros){
        if(!Array.isArray(m.steps)||!m.steps.length||m.steps.length>16)continue;
        const steps=[];
        for(const step of m.steps){const buttonId=buttonIds.get(step.buttonId);if(!buttonId)break;const delayMs=Number(step.delayMs||0);if(!Number.isInteger(delayMs)||delayMs<0||delayMs>5000)break;steps.push({buttonId,delayMs});}
        if(steps.length!==m.steps.length)continue;
        newMacros.push({id:uuid(),name:text(m.name,70)||'Imported macro',profileId:profileIds.get(m.profileId)||'default',mode:m.mode==='parallel'?'parallel':'sequence',color:['green','blue','amber','red','neutral'].includes(m.color)?m.color:'neutral',steps});
      }
      db.profiles.push(...newProfiles);db.buttons.push(...newButtons);db.macros.push(...newMacros);
      log(`Import: ${newProfiles.length} profiles, ${newButtons.length} buttons, ${newMacros.length} macros`);
      return send(res,200,{ok:true,profiles:newProfiles.length,buttons:newButtons.length,macros:newMacros.length});
    }
    // Privileged configuration mutations: operators can click and test but cannot change shows or targets.
    if(['POST','PUT','DELETE'].includes(req.method) && !isAdmin(req) && !p.startsWith('/api/press/') && !p.endsWith('/test') && !p.startsWith('/api/probe/'))return send(res,403,{error:'Admin access required for configuration'});
    
    if (req.method==='POST' && p==='/api/agents') {
      const v=await readJSON(req), name=text(v.name,70);
      if (!name) throw Error('Enter a receiver name');
      const secret=crypto.randomBytes(32).toString('hex');
      const agent={id:uuid(),name,keyHash:keyHash(secret),seenAt:null,targets:defaultTargets()};
      db.agents.push(agent); db.buttons.push(...buttonDefaults(agent).map(b=>({...b,profileId:'default'})));
      log(`Receiver created: ${name}`);
      return send(res,201,{id:agent.id,key:secret,name});
    }
    const agentDelete=p.match(/^\/api\/agents\/([\w-]+)$/);
    if (agentDelete && req.method==='DELETE') {
      const index=db.agents.findIndex(a=>a.id===agentDelete[1]);
      if (index<0) return send(res,404,{error:'Receiver not found'});
      const [a]=db.agents.splice(index,1);
      const ws=online.get(a.id); if (ws) ws.close(1008,'Revoked');
      db.buttons=db.buttons.filter(b=>b.agentId!==a.id);
      db.mappings=db.mappings.filter(m=>m.receiverId!==a.id && db.buttons.some(b=>b.id===m.buttonId));
      log(`Receiver deleted: ${a.name}`);return send(res,200,{ok:true});
    }
    const targetRoute=p.match(/^\/api\/agents\/([\w-]+)\/targets(?:\/([\w-]+))?$/);
    if (targetRoute && ['POST','PUT','DELETE'].includes(req.method)) {
      const a=db.agents.find(x=>x.id===targetRoute[1]);if(!a) return send(res,404,{error:'Receiver not found'});
      const targetId=targetRoute[2]; const old=a.targets.find(t=>t.id===targetId);
      if (req.method==='DELETE') {
        if (!old) return send(res,404,{error:'Target not found'});
        a.targets=a.targets.filter(t=>t.id!==targetId);
        db.buttons=db.buttons.filter(b=>b.targetId!==targetId);
        db.mappings=db.mappings.filter(m=>db.buttons.some(b=>b.id===m.buttonId));
        log(`Target removed: ${a.name} / ${old.name}`);return send(res,200,{ok:true});
      }
      if (req.method==='PUT' && !old) return send(res,404,{error:'Target not found'});
      const v=await readJSON(req);const target=cleanTarget(v,old);
      if (old) {
        if (target.type!==old.type && db.buttons.some(b=>b.targetId===old.id)) throw Error('Remove buttons before changing target type');
        Object.assign(old,target);
      } else a.targets.push(target);
      log(`Saved target: ${a.name} / ${target.name}`);return send(res,200,{target});
    }
    if (req.method==='POST' && p==='/api/buttons') {
      const v=await readJSON(req), a=db.agents.find(x=>x.id===v.agentId);
      const t=a?.targets.find(x=>x.id===v.targetId);
      if (!t) throw Error('Select a receiver and target');
      const name=text(v.name,70);if(!name)throw Error('Name the button');
      const action=actionValid(t.type,v.action);
      const profileId=db.profiles.some(p=>p.id===v.profileId)?v.profileId:'default';
      const btn={id:uuid(),profileId,agentId:a.id,targetId:t.id,name,color:['green','blue','amber','red','neutral'].includes(v.color)?v.color:'neutral',action};
      db.buttons.push(btn);log(`Button added: ${btn.name}`);return send(res,201,{button:btn});
    }
    const bdel=p.match(/^\/api\/buttons\/([\w-]+)$/);
    if (bdel && req.method==='DELETE') {
      const b=db.buttons.find(x=>x.id===bdel[1]);if(!b) return send(res,404,{error:'Button not found'});
      db.buttons=db.buttons.filter(x=>x.id!==b.id);db.mappings=db.mappings.filter(m=>m.buttonId!==b.id);log(`Button removed: ${b.name}`);return send(res,200,{ok:true});
    }
    if (req.method==='POST' && p==='/api/mappings') {
      const v=await readJSON(req);
      const a=db.agents.find(x=>x.id===v.receiverId);
      if(!a) return send(res,404,{error:'Input receiver not found'});
      if (!validInputKey(v.key) || v.key==='test') throw Error('Choose a supported input key');
      if(v.buttonId && !db.buttons.some(b=>b.id===v.buttonId)) throw Error('Clicker button not found');
      db.mappings=db.mappings.filter(m=>m.receiverId!==a.id || m.key!==v.key);
      if(v.buttonId) db.mappings.push({receiverId:a.id,key:v.key,buttonId:v.buttonId});
      log(`Input mapping ${a.name} / ${v.key}: ${v.buttonId?'saved':'removed'}`);
      return send(res,200,{ok:true});
    }
    const test=p.match(/^\/api\/agents\/([\w-]+)\/test$/);
    if(req.method==='POST' && test){
      const a=db.agents.find(x=>x.id===test[1]);
      if(!a)return send(res,404,{error:'Receiver not found'});
      const sent=Date.now();
      event('test',a,'Test sent from web dashboard','info');
      try {
        const result=await dispatch(a.id,{type:'test',sentAt:new Date(sent).toISOString()});
        const latencyMs=Date.now()-sent;
        a.latencyMs=latencyMs;
        a.lastAck={time:new Date().toISOString(),kind:'test',ok:!!result.ok,detail:result.message || result.error || 'No details'};
        event('test',a,result.ok?`Receiver ACK received in ${latencyMs} ms: ${a.lastAck.detail}`:a.lastAck.detail,result.ok?'ok':'error');
        return send(res,result.ok?200:502,{ok:!!result.ok,latencyMs,message:result.message||result.error});
      }catch(e){event('test',a,e.message,'error');return send(res,503,{error:e.message});}
    }
    const press=p.match(/^\/api\/press\/([\w-]+)$/);
    if (req.method==='POST' && press) {
      const button=db.buttons.find(b=>b.id===press[1]);if(!button)return send(res,404,{error:'Button not found'});
      try {const r=await executeButton(button);return send(res,r.ok?200:502,{ok:!!r.ok,message:r.message||r.error});}
      catch(e){return send(res,503,{error:e.message});}
    }
    const probe=p.match(/^\/api\/probe\/([\w-]+)\/([\w-]+)$/);
    if (req.method==='POST' && probe) {
      const a=db.agents.find(x=>x.id===probe[1]),t=a?.targets.find(x=>x.id===probe[2]);
      if (!t) return send(res,404,{error:'Target not found'});
      try {
        const result=await dispatch(a.id,{type:'probe',target:t});
        return send(res,result.ok?200:502,{ok:!!result.ok,message:result.message||result.error});
      } catch(e) {return send(res,503,{error:e.message});}
    }
    return send(res,404,{error:'Not found'});
  } catch(e) {
    if (!res.headersSent) send(res,400,{error:e.message});
  }
});
const wss=new WebSocketServer({noServer:true,maxPayload:65536});
httpServer.on('upgrade',(req,socket,head)=>{
  if (req.url!=='/receiver') return socket.destroy();
  // Receiver authentication is performed in first WebSocket message; only WSS over the public internet.
  wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
});
wss.on('connection', ws=>{
  let agentId=null;
  const authTimeout=setTimeout(()=>{if(!agentId)ws.close(1008,'Auth timeout');},6000);
  ws.on('message',raw=>{
    try {
      const m=JSON.parse(String(raw));
      if (!agentId) {
        if (m.type!=='hello') return ws.close(1008,'Authentication needed');
        const a=db.agents.find(x=>x.id===m.id);
        if (!a || !safeEq(keyHash(String(m.key||'')),a.keyHash)) return ws.close(1008,'Invalid receiver key');
        agentId=a.id; clearTimeout(authTimeout);
        const previous=online.get(agentId); if(previous) previous.close(1000,'New connection');
        online.set(agentId,ws);a.seenAt=new Date().toISOString();a.connectedAt=a.seenAt;a.latencyMs=null;save();
        wsSend(ws,{type:'authenticated',name:a.name});log(`Receiver online: ${a.name}`);return;
      }
      if (m.type==='result' && typeof m.id==='string') respondPending(m,agentId);
      if (m.type==='info') {
        const a=db.agents.find(x=>x.id===agentId);
        if(a){a.info={platform:text(m.platform,60),version:text(m.version,20),keyboardEnabled:!!m.keyboardEnabled,bridgeEnabled:!!m.bridgeEnabled};save();}
      }
      if(m.type==='input') {
        const a=db.agents.find(x=>x.id===agentId);
        if(!a || !INPUT_KINDS.includes(m.kind) || !validInputKey(m.key)) return;
        const now=Date.now(); const limit=`${agentId}:${m.kind}:${m.key}`;
        if((inputDebounce.get(limit)||0)>now-170)return;
        inputDebounce.set(limit,now);
        const mapping=db.mappings.find(x=>x.receiverId===agentId && x.key===m.key);
        const button=m.kind==='http' && typeof m.buttonId==='string'
          ? db.buttons.find(b=>b.id===m.buttonId)
          : (mapping ? db.buttons.find(b=>b.id===mapping.buttonId) : null);
        a.lastInput={time:new Date().toISOString(),kind:m.kind,key:m.key,buttonName:button?.name||null};
        event('input',a,`${m.kind} ${m.key}${button?' → '+button.name:' (received, no mapping)'}`,'info',{inputKey:m.key});
        if(button){
          const destination=db.agents.find(x=>x.id===button.agentId);
          const target=destination?.targets.find(t=>t.id===button.targetId);
          if(!target){event('input',a,`Mapped button target missing`,'error');return;}
          dispatch(destination.id,{type:'execute',target,action:button.action}).then(result=>{
            const detail=`${m.kind} ${m.key} → ${destination.name} / ${button.name}: ${result.message||result.error||'No detail'}`;
            destination.lastAck={time:new Date().toISOString(),kind:'input',ok:!!result.ok,detail};
            event('input',a,detail,result.ok?'ok':'error');
          }).catch(err=>event('input',a,`${m.kind} ${m.key} → ${button.name}: ${err.message}`,'error'));
        }
      }
      if (m.type==='pong') ws.alive=true;
    } catch(e) { ws.close(1003,'Bad message'); }
  });
  ws.on('pong',()=>{ws.alive=true;});
  ws.alive=true;
  ws.on('close',()=>{clearTimeout(authTimeout);if(agentId && online.get(agentId)===ws){online.delete(agentId);const a=db.agents.find(x=>x.id===agentId);if(a){a.connectedAt=null;log(`Receiver offline: ${a.name}`);}}});
});
setInterval(()=>{
  for(const ws of online.values()){
    if(!ws.alive){ws.terminate();continue;}
    ws.alive=false;ws.ping();
  }
  for(const [k,t] of sessions) if(t.until<Date.now())sessions.delete(k);
  for(const [k,t] of pairCodes) if(t.until<Date.now())pairCodes.delete(k);
},30000).unref();
httpServer.listen(PORT,()=>console.log(`JC Internet Clicker relay listening on http://localhost:${PORT}`));
