const $ = (s, root=document) => root.querySelector(s);
const escapeHTML = s => String(s ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const state = { agents:[],buttons:[],logs:[],events:[],mappings:[],profiles:[],macros:[],role:'operator',tab:'clicker',credentials:null,editingTarget:null };
let showId=localStorage.getItem('jcShowId')||'default';
let simpleMode=localStorage.getItem('jcSimple')!=='false';
let uiTheme=localStorage.getItem('jcTheme')||'dark';
let relayURL = localStorage.getItem('jcRelayURL') || (location.hostname.endsWith('github.io') ? '' : location.origin);
let sessionToken = sessionStorage.getItem('jcToken:'+relayURL) || '';
function secureRelay(url){
  let u;try{u=new URL(url)}catch{throw Error('Enter a valid relay URL, starting with https://');}
  if(u.username || u.password || u.search || u.hash || (u.pathname && u.pathname!=='/'))throw Error('Enter only the relay website root URL');
  if(u.protocol==='https:' || (u.protocol==='http:' && ['127.0.0.1','localhost','[::1]'].includes(u.hostname))) return u.origin;
  throw Error('Public relays must use HTTPS (localhost can use HTTP)');
}
function showRelay(error=''){
  $('#relay-view').classList.remove('hidden');$('#login-view').classList.add('hidden');$('#main-view').classList.add('hidden');
  $('#relay-url').value=relayURL;$('#relay-error').textContent=error;
  $('#relay-dot').className='dot offline';$('#relay-status').textContent='Relay not connected';
}
function relayOnline(online){
  $('#relay-dot').className='dot '+(online?'online':'offline');
  $('#relay-status').textContent=online?'Relay reachable':'Relay unavailable';
  $('#relay-address').textContent=relayURL;
}

const typeName={powerpoint:'PowerPoint',osc:'OSC',companion:'Companion HTTP',http:'HTTP(S)',tcp:'TCP',udp:'UDP',vmix:'vMix API',obs:'OBS WebSocket',hotkey:'Keyboard shortcut',midi:'MIDI output',script:'Approved local script'};
function profileOptions(){return (state.profiles||[]).map(p=>`<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)}</option>`).join('');}
function isAdmin(){return state.role==='admin';}
function syncMode(){document.body.classList.toggle('simple-mode',simpleMode);document.body.classList.toggle('light-mode',uiTheme==='light');$('#mode-toggle').textContent=simpleMode?'Advanced Mode':'Simple Mode';$('#theme-toggle').textContent=uiTheme==='light'?'Dark theme':'Light theme';$('#who-role').textContent=state.role||'operator';document.body.classList.toggle('operator-mode',!isAdmin());applyBrand();}
function applyBrand(){const title=localStorage.getItem('jcBrandTitle');$('.brand strong').textContent=title||'INTERNET CLICKER';const logo=localStorage.getItem('jcBrandLogo');const el=$('.brand-logo');if(logo){el.style.backgroundImage=`url(${JSON.stringify(logo)})`;el.textContent='';}else{el.style.backgroundImage='';el.textContent='JC';}}
async function api(url,{method='GET',body}={}){
  if(!relayURL)throw Error('Set the relay address first');
  const headers={};
  if(body)headers['Content-Type']='application/json';
  if(sessionToken)headers['Authorization']='Bearer '+sessionToken;
  let response;
  try{response=await fetch(relayURL+url,{method,headers,body:body?JSON.stringify(body):undefined,cache:'no-store'});}
  catch{throw Error('Cannot reach relay. Check its HTTPS URL, service status, and WEB_ORIGINS configuration.');}
  let data={};try{data=await response.json()}catch{}
  if(!response.ok)throw Error(data.error || data.message || `HTTP ${response.status}`);
  return data;
}
function notice(message,isError=false){const box=$('#notice');box.innerHTML=`<div class="notice ${isError?'error':''}">${escapeHTML(message)}</div>`;clearTimeout(notice.timer);notice.timer=setTimeout(()=>box.innerHTML='',6500)}
function signedIn(yes,user='') {$('#relay-view').classList.add('hidden');$('#login-view').classList.toggle('hidden',yes);$('#main-view').classList.toggle('hidden',!yes);$('#account').classList.toggle('hidden',!yes);$('#who').textContent=user;}
async function load(refresh=false){
  try{const v=await api('/api/state');Object.assign(state,v);
    renderClicker();renderConnections();renderHistory();renderInputFeeds();syncMode();
    if(!refresh){renderSetup();renderInputs();renderShows();renderSecurity();}
  }catch(e){if(e.message==='Log in first'){sessionToken='';sessionStorage.removeItem('jcToken:'+relayURL);signedIn(false);return;}relayOnline(false);if(!refresh)notice(e.message,true)}
}
function buttonsFor(id){return state.buttons.filter(b=>b.agentId===id&&(b.profileId||'default')===showId)}
function renderClicker(){
  const profiles=state.profiles||[{id:'default',name:'Default Show'}];if(!profiles.some(p=>p.id===showId))showId='default';
  options($('#profile-select'),profileOptions(),showId);
  $('#connected-summary').textContent=`${state.agents.filter(a=>a.online).length} / ${state.agents.length} receivers online`;
  const content=$('#clicker-content');
  if(!state.agents.length){$('#macro-clicker-content').innerHTML='';content.innerHTML='<div class="panel"><h2>No receivers yet</h2><p>Open Configuration to add your first computer. Starter buttons will be created automatically.</p><button class="primary" data-go="setup">Add receiver</button></div>';return;}
  content.innerHTML=state.agents.map(a=>{
    const buttons=buttonsFor(a.id);
    return `<article class="receiver"><div class="receiver-heading"><div><h2>${escapeHTML(a.name)}</h2><span class="muted">${buttons.length} buttons · ${a.targets.length} configured targets · ${a.lastAck? 'Last ACK '+new Date(a.lastAck.time).toLocaleTimeString():'Awaiting first signal'}</span></div><div class="button-row"><span class="badge ${a.online?'online':''}">${a.online?'● REMOTE CONNECTED':'● OFFLINE'}</span><button class="small secondary" data-test-agent="${a.id}" ${a.online?'':'disabled'}>Test signal</button></div></div>
      <div class="button-grid">${buttons.length?buttons.map(b=>{
        const t=a.targets.find(t=>t.id===b.targetId);
        return `<button class="click ${escapeHTML(b.color)}" data-press="${b.id}" ${a.online?'':'disabled'}><b>${escapeHTML(b.name)}</b><small>${escapeHTML(t?.name || 'Deleted target')} · ${escapeHTML(typeName[t?.type] || '')}</small></button>`;
      }).join(''):'<p>No buttons configured.</p>'}</div></article>`;
  }).join('');
  const macros=(state.macros||[]).filter(m=>m.profileId===showId);
  $('#macro-clicker-content').innerHTML=macros.length?`<article class="receiver"><h2>Multi-PC / multi-action macros</h2><p>Run saved steps in order. Stops when a receiver does not confirm.</p><div class="button-grid">${macros.map(m=>`<button class="click ${escapeHTML(m.color)}" data-run-macro="${m.id}"><b>${escapeHTML(m.name)}</b><small>${m.steps.length} step(s) · ${m.mode==='parallel'?'parallel':'sequence'} · live only</small></button>`).join('')}</div></article>`:'';
}
function agentOptions(){return state.agents.map(a=>`<option value="${a.id}">${escapeHTML(a.name)}</option>`).join('')}
function options(select,markup,preferred){const previous=preferred || select.value;select.innerHTML=markup; if([...select.options].some(x=>x.value===previous))select.value=previous;}
function renderSetup(){
  options($('#target-agent'),agentOptions()); options($('#button-agent'),agentOptions()); options($('#button-profile'),profileOptions(),showId);
  $('#agent-list').innerHTML=state.agents.map(a=>`<div class="item"><div class="item-title"><strong>${escapeHTML(a.name)}</strong><span class="badge ${a.online?'online':''}">${a.online?'Online':'Offline'}</span></div><small class="muted">${a.id}</small><div class="actions"><button data-pair-agent="${a.id}">Pair with code</button><button data-remove-agent="${a.id}">Delete receiver</button></div></div>`).join('')||'<p class="hint">No receivers yet.</p>';
  $('#new-key').classList.toggle('hidden',!state.credentials);
  if(state.credentials){const k=state.credentials;$('#new-key').innerHTML=`<strong>Save these now — the receiver key is only shown once.</strong><p>On ${escapeHTML(k.name)}, copy receiver/config.example.json to config.json and paste the following settings:</p><code>${escapeHTML(JSON.stringify({server_url:relayURL,receiver_id:k.id,receiver_key:k.key},null,2))}</code><button type="button" class="secondary small" id="copy-key">Copy settings</button><p class="hint">Keep the allowed_networks list from config.example.json. Do not publish the key.</p>`;}
  renderTargets();updateButtonTargets();renderButtons();updateTargetType();
}
function renderTargets(){
  const a=state.agents.find(a=>a.id===$('#target-agent').value);
  $('#targets-list').innerHTML=(a?.targets||[]).map(t=>`<div class="item"><div class="item-title"><strong>${escapeHTML(t.name)}</strong><span class="muted">${escapeHTML(typeName[t.type])}</span></div><div class="muted">${t.type==='powerpoint'?'Windows PowerPoint COM':escapeHTML(t.host)+':'+t.port}</div><div class="actions"><button data-edit-target="${t.id}">Edit</button><button data-probe="${a.id}:${t.id}" ${a.online?'':'disabled'}>Test</button><button data-delete-target="${a.id}:${t.id}">Remove</button></div></div>`).join('')||'<p class="hint">No targets for this computer.</p>';
}
function renderButtons(){
  const a=state.agents.find(a=>a.id===$('#button-agent').value);
  $('#buttons-list').innerHTML=(a?buttonsFor(a.id):[]).map(b=>`<div class="item"><div class="item-title"><strong>${escapeHTML(b.name)}</strong><button class="small" data-delete-button="${b.id}">Delete</button></div><div class="muted">${escapeHTML(a.targets.find(t=>t.id===b.targetId)?.name||'Target missing')}</div><div class="actions"><button data-copy-input="${b.id}">Copy Stream Deck HTTP endpoint</button></div></div>`).join('')||'<p class="hint">No buttons for this computer.</p>';
}
function updateButtonTargets(){
  const a=state.agents.find(x=>x.id===$('#button-agent').value);
  options($('#button-target'),(a?.targets||[]).map(t=>`<option value="${t.id}">${escapeHTML(t.name)} (${escapeHTML(typeName[t.type])})</option>`).join(''));
  renderActionFields();
}
function updateTargetType(){
  const form=$('#target-form'),type=$('#target-type').value;
  const local=['powerpoint','midi','script','hotkey'].includes(type);
  $('#network-fields').classList.toggle('hidden',local);$('#secure-field').classList.toggle('hidden',type!=='http');
  if(!form.elements.editingId.value){
    const defaults={osc:7000,companion:8000,http:8080,tcp:9000,udp:9000,vmix:8088,obs:4455};
    form.elements.port.value=defaults[type]||'';
    form.elements.host.value=local?'':'127.0.0.1';
  }
}
function renderActionFields(){
  const a=state.agents.find(x=>x.id===$('#button-agent').value),t=a?.targets.find(x=>x.id===$('#button-target').value);
  if(!t){$('#action-fields').innerHTML='<p class="hint">Choose a target first.</p>';return;}
  const fields={
    powerpoint:`<label>Action<select name="operation"><option value="next">Next slide / build</option><option value="previous">Previous slide / build</option><option value="start">Start slideshow</option><option value="first">First slide</option><option value="last">Last slide</option><option value="end">End slideshow</option><option value="goto">Go to slide</option></select></label><label>Slide number (Go to slide only)<input type="number" name="slide" value="1" min="1"></label>`,
    osc:`<label>OSC address<input name="address" value="/composition/connectnextcolumn" required placeholder="/composition/connectnextcolumn"></label><div class="two"><label>Argument type<select name="valueType"><option value="int">Integer</option><option value="float">Float</option><option value="string">Text</option><option value="none">No argument</option></select></label><label>Value<input name="value" value="1"></label></div>`,
    companion:`<div class="two"><label>Page<input type="number" name="page" value="1" min="1" required></label><label>Row<input type="number" name="row" value="1" min="1" required></label></div><div class="two"><label>Column<input type="number" name="column" value="1" min="1" required></label><label>Action<select name="operation"><option value="press">Press + release</option><option value="down">Hold down</option><option value="up">Release</option><option value="rotate-left">Rotate left</option><option value="rotate-right">Rotate right</option></select></label></div>`,
    http:`<label>Method<select name="method"><option>POST</option><option>GET</option><option>PUT</option><option>PATCH</option></select></label><label>Local URL path<input name="path" value="/api/" required placeholder="/api/trigger"></label><label>Body (optional)<textarea name="body" placeholder='{"cue":1}'></textarea></label><label>Body format<select name="contentType"><option value="json">JSON</option><option value="text">Plain text</option></select></label>`,
    tcp:`<label>Send bytes<input name="payload" required placeholder="GO\\r\\n"></label><label>Encoding<select name="encoding"><option value="utf8">UTF-8 text</option><option value="hex">Hex bytes</option></select></label><p class="hint">Text sends exactly what you enter; for CRLF use hex 0D0A.</p>`,
    udp:`<label>Send datagram<input name="payload" required placeholder="TRIGGER"></label><label>Encoding<select name="encoding"><option value="utf8">UTF-8 text</option><option value="hex">Hex bytes</option></select></label>`,
    vmix:`<label>vMix function<input name="operation" value="Cut" required placeholder="Cut"></label><label>Input (optional)<input name="input" placeholder="1"></label><p class="hint">Requires vMix HTTP API enabled; default port 8088.</p>`,
    obs:`<label>OBS request<select name="operation"><option>StartStream</option><option>StopStream</option><option>StartRecord</option><option>StopRecord</option><option>TriggerStudioModeTransition</option><option>SetCurrentProgramScene</option><option>SetCurrentPreviewScene</option></select></label><label>Scene name (if applicable)<input name="sceneName"></label><p class="hint">OBS WebSocket 5, usually port 4455. Store OBS password on receiver only.</p>`,
    hotkey:`<label>Keyboard shortcut<input name="keys" value="ctrl+right" required placeholder="ctrl+right"></label><p class="hint">Sent to the active window on the target PC. Can affect the wrong app if focus changes.</p>`,
    midi:`<label>MIDI output port name<input name="device" placeholder="loopMIDI Port" required></label><div class="two"><label>Message<select name="kind"><option value="note_on">Note On</option><option value="note_off">Note Off</option><option value="control_change">Control Change</option><option value="program_change">Program Change</option></select></label><label>Channel (0-15)<input name="channel" type="number" min="0" max="15" value="0"></label></div><div class="two"><label>Note / CC / Program<input name="note" type="number" min="0" max="127" value="60"></label><label>Value / velocity<input name="value" type="number" min="0" max="127" value="127"></label></div>`,
    script:`<label>Locally approved script name<input name="script" required placeholder="preset1"></label><p class="hint">Requires approved_scripts entry in receiver/config.json. Raw commands from website are never executed.</p>`
  };
  $('#action-fields').innerHTML=fields[t.type]||'';
}
function dateShort(t){return t?new Date(t).toLocaleTimeString():'Never';}
function renderConnections(){
  const el=$('#connections-content');
  if(!state.agents.length){el.innerHTML='<article class="panel"><h2>No PCs configured</h2><p>Add a receiver under Configuration.</p></article>';return;}
  el.innerHTML=state.agents.map(a=>`<article class="status-card"><div class="status-top"><div><h2>${escapeHTML(a.name)}</h2><span class="muted">${escapeHTML(a.id)}</span></div><span class="badge ${a.online?'online':''}">${a.online?'● ONLINE — remote receiver connected':'● OFFLINE'}</span></div>
    <div class="status-grid"><div class="status-stat">Connected since<strong>${dateShort(a.connectedAt)}</strong></div><div class="status-stat">Last received input<strong>${a.lastInput?escapeHTML(a.lastInput.kind+' / '+a.lastInput.key):'No input yet'}</strong></div><div class="status-stat">Last command acknowledged<strong>${a.lastAck?dateShort(a.lastAck.time)+' — '+(a.lastAck.ok?'OK':'FAILED'):'No ACK yet'}</strong></div><div class="status-stat">Last round-trip test<strong>${a.latencyMs===null?'Not tested':a.latencyMs+' ms'}</strong></div></div>
    <div class="button-row"><button class="primary" data-test-agent="${a.id}" ${a.online?'':'disabled'}>Send test signal → receiver</button>${a.targets.map(t=>`<button class="secondary small" data-probe="${a.id}:${t.id}" ${a.online?'':'disabled'}>Check ${escapeHTML(t.name)}</button>`).join('')}</div>
    <p class="hint">Receiver: ${escapeHTML(a.info?.platform || 'Unknown OS')} • USB clicker capture ${a.info?.keyboardEnabled?'enabled':'not enabled'} • Input bridge ${a.info?.bridgeEnabled?'enabled':'not detected'}. Application acknowledgment varies by protocol.</p></article>`).join('');
  $('#signal-feed').innerHTML=(state.events||[]).slice(0,15).map(x=>`<div class="history-row ${escapeHTML(x.status)}"><strong>${escapeHTML(x.receiverName)}: ${escapeHTML(x.detail)}</strong><small>${dateShort(x.time)} · ${escapeHTML(x.kind)}</small></div>`).join('')||'<p class="hint">Nothing received yet. Use Send test signal above.</p>';
}
const mappingKeys=[['right','Right Arrow'],['left','Left Arrow'],['page_down','Page Down'],['page_up','Page Up'],['space','Space'],['enter','Enter'],['f5','F5'],['escape','Escape']];
function renderInputs(){
  const select=$('#mapping-agent');options(select,agentOptions());
  const inputAgent=select.value;
  const dynamic=(state.events||[]).filter(e=>e.kind==='input'&&e.receiverId===inputAgent).map(e=>e.inputKey).filter(k=>k?.startsWith('midi:'));
  const keys=[...mappingKeys,...[...new Set(dynamic)].map(k=>[k,k])];
  $('#mappings-content').innerHTML=inputAgent?keys.map(([key,label])=>{
    const current=state.mappings.find(m=>m.receiverId===inputAgent && m.key===key)?.buttonId || '';
    return `<div class="map-row"><span>${label}</span><select data-map-key="${key}"><option value="">Do nothing — detect only</option>${state.buttons.map(b=>`<option value="${b.id}" ${b.id===current?'selected':''}>${escapeHTML(state.agents.find(a=>a.id===b.agentId)?.name||'Deleted')} — ${escapeHTML(b.name)}</option>`).join('')}</select><button class="small" data-save-mapping="${key}">Save</button></div>`;
  }).join(''):'<p>Add a PC to enable mappings.</p>';
  options($('#stream-button'),state.buttons.map(b=>`<option value="${b.id}">${escapeHTML(state.agents.find(a=>a.id===b.agentId)?.name||'Deleted')} — ${escapeHTML(b.name)}</option>`).join(''));
}
function renderInputFeeds(){
  $('#input-feed').innerHTML=(state.events||[]).filter(e=>e.kind==='input').slice(0,15).map(e=>`<div class="history-row ${escapeHTML(e.status)}"><strong>${escapeHTML(e.receiverName)}: ${escapeHTML(e.detail)}</strong><small>${dateShort(e.time)}</small></div>`).join('')||'<p class="hint">No inputs detected yet.</p>';
}
function renderHistory(){
  $('#history-list').innerHTML=state.logs.map(l=>`<div class="history-row ${escapeHTML(l.status)}"><strong>${escapeHTML(l.message)}</strong><small>${new Date(l.time).toLocaleString()}</small></div>`).join('')||'<p>No commands sent yet.</p>';
}
function showTab(tab){state.tab=tab;document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));document.querySelectorAll('.tab-view').forEach(v=>v.classList.toggle('hidden',v.id!==tab+'-view'));if(tab==='clicker')renderClicker();if(tab==='connections')renderConnections();if(tab==='setup')renderSetup();if(tab==='inputs'){renderInputs();renderInputFeeds();}  if(tab==='history')renderHistory();if(tab==='shows')renderShows();if(tab==='security')renderSecurity();}
function extract(form){const out={};for(const [k,v] of new FormData(form))out[k]=v;return out;}
async function operation(fn){try{await fn();await load();}catch(e){notice(e.message,true)}}
$('#relay-form').addEventListener('submit',async e=>{
  e.preventDefault();try{
    relayURL=secureRelay($('#relay-url').value.trim());localStorage.setItem('jcRelayURL',relayURL);
    sessionToken=sessionStorage.getItem('jcToken:'+relayURL)||'';
    await connect();
  }catch(err){showRelay(err.message);}
});
$('#change-relay').addEventListener('click',()=>showRelay());
$('#login-form').addEventListener('submit',async e=>{e.preventDefault();const form=extract(e.target);try{
  const result=await api('/api/login',{method:'POST',body:form});
  sessionToken=result.token;sessionStorage.setItem('jcToken:'+relayURL,sessionToken);
  e.target.reset();$('#login-error').textContent='';state.role=result.role;signedIn(true,result.username);await load();
}catch(err){$('#login-error').textContent=err.message;}});
$('#logout').addEventListener('click',async()=>{try{await api('/api/logout',{method:'POST'});}catch{} sessionStorage.removeItem('jcToken:'+relayURL);sessionToken='';signedIn(false);});
$('#refresh').addEventListener('click',()=>load());
document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.tab)));
$('#agent-form').addEventListener('submit',async e=>{e.preventDefault();await operation(async()=>{const result=await api('/api/agents',{method:'POST',body:extract(e.target)});state.credentials={...result};e.target.reset();notice('Receiver created — copy its private key now.');});});
$('#target-agent').addEventListener('change',()=>{renderTargets();resetTargetForm();});
$('#mapping-agent').addEventListener('change',renderInputs);
$('#button-agent').addEventListener('change',()=>{updateButtonTargets();renderButtons();});
$('#button-target').addEventListener('change',renderActionFields);
$('#target-type').addEventListener('change',updateTargetType);
$('#profile-select').addEventListener('change',e=>{showId=e.target.value;localStorage.setItem('jcShowId',showId);renderClicker();});
$('#mode-toggle').addEventListener('click',()=>{simpleMode=!simpleMode;localStorage.setItem('jcSimple',String(simpleMode));syncMode();if(simpleMode)showTab('clicker');});
$('#theme-toggle').addEventListener('click',()=>{uiTheme=uiTheme==='dark'?'light':'dark';localStorage.setItem('jcTheme',uiTheme);syncMode();});
$('#full-screen').addEventListener('click',()=>{if(document.fullscreenElement)document.exitFullscreen();else document.documentElement.requestFullscreen();});
function resetTargetForm(){const f=$('#target-form');f.elements.editingId.value='';f.elements.name.value='';f.elements.type.value='powerpoint';$('#save-target').textContent='Add target';$('#cancel-target').classList.add('hidden');updateTargetType();}
$('#cancel-target').addEventListener('click',resetTargetForm);
$('#target-form').addEventListener('submit',async e=>{e.preventDefault();const v=extract(e.target),edit=v.editingId;await operation(async()=>{await api(`/api/agents/${v.agentId}/targets${edit?'/'+edit:''}`,{method:edit?'PUT':'POST',body:v});resetTargetForm();notice('Target saved');});});
$('#button-form').addEventListener('submit',async e=>{e.preventDefault();const f=e.target,v=extract(f);const action={};for(const [k,val] of Object.entries(v)){if(!['agentId','targetId','profileId','name','color'].includes(k))action[k]=val;}
  await operation(async()=>{await api('/api/buttons',{method:'POST',body:{agentId:v.agentId,targetId:v.targetId,name:v.name,color:v.color,profileId:v.profileId,action}});f.elements.name.value='';notice('Button created');});});
document.addEventListener('click',async e=>{
  const btn=e.target.closest('button');if(!btn)return;
  if(btn.dataset.go)return showTab(btn.dataset.go);
  if(btn.id==='copy-key'&&state.credentials){const {id,key}=state.credentials;await navigator.clipboard.writeText(JSON.stringify({server_url:relayURL,receiver_id:id,receiver_key:key},null,2));return notice('Receiver settings copied');}
  if(btn.dataset.runMacro){btn.disabled=true;try{const r=await api(`/api/macros/${btn.dataset.runMacro}/run`,{method:'POST'});notice(`${r.results.length} macro steps confirmed`);await load(true);}catch(err){notice(err.message,true)}finally{btn.disabled=false;}return;}
  if(btn.dataset.pairAgent){try{const r=await api('/api/pair-codes',{method:'POST',body:{agentId:btn.dataset.pairAgent}});notice(`Pair code: ${r.code} (valid 10 min). Enter it on the receiver alongside relay URL ${relayURL}`);}catch(err){notice(err.message,true);}return;}
  if(btn.dataset.testAgent){btn.disabled=true;const original=btn.textContent;btn.textContent='Testing…';try{const r=await api(`/api/agents/${btn.dataset.testAgent}/test`,{method:'POST'});notice(`Receiver acknowledged test in ${r.latencyMs}ms. Check its monitor window.`);await load(true);}catch(err){notice(err.message,true);}finally{btn.disabled=false;btn.textContent=original;}return;}
  if(btn.dataset.saveMapping){const key=btn.dataset.saveMapping;const input=$(`[data-map-key="${key}"]`);
    try{await api('/api/mappings',{method:'POST',body:{receiverId:$('#mapping-agent').value,key,buttonId:input.value}});notice(`Saved ${key} input mapping`);await load(true);}catch(err){notice(err.message,true);}return;}
  if(btn.id==='copy-stream' || btn.dataset.copyInput){const id=btn.dataset.copyInput || $('#stream-button').value;
    if(!id)return notice('Select a button first',true);
    const endpoint=`http://127.0.0.1:8877/trigger/${id}`;
    try{await navigator.clipboard.writeText(endpoint);notice('Copied POST endpoint. Send X-Clicker-Key with the local receiver key.');}
    catch{notice('HTTP POST endpoint: '+endpoint);}
    return;}
  if(btn.dataset.press){btn.disabled=true;const old=btn.innerHTML;btn.innerHTML='<b>Sending…</b>';
    try{const r=await api(`/api/press/${btn.dataset.press}`,{method:'POST'});notice(r.message || 'Command sent');}catch(err){notice(err.message,true)}finally{btn.disabled=false;btn.innerHTML=old;}return;}
  if(btn.dataset.editTarget){const a=state.agents.find(x=>x.id===$('#target-agent').value),t=a?.targets.find(x=>x.id===btn.dataset.editTarget);if(!t)return;const f=$('#target-form');for(const key of ['id','name','type','host','port'])if(f.elements[key])f.elements[key].value=t[key]||'';f.elements.editingId.value=t.id;updateTargetType();f.elements.secure.checked=!!t.secure;$('#save-target').textContent='Save target';$('#cancel-target').classList.remove('hidden');f.scrollIntoView({behavior:'smooth',block:'start'});return;}
  if(btn.dataset.probe){const [aid,tid]=btn.dataset.probe.split(':');btn.disabled=true;try{const r=await api(`/api/probe/${aid}/${tid}`,{method:'POST'});notice(r.message);}catch(err){notice(err.message,true)}finally{btn.disabled=false}return;}
  const actions=[['deleteButton','/api/buttons/'],['deleteTarget',null],['removeAgent','/api/agents/']];
  for(const [key,base] of actions){if(!btn.dataset[key])continue;if(!confirm(`Permanently delete this ${key==='removeAgent'?'receiver and all its targets/buttons':key==='deleteTarget'?'target and its buttons':'button'}?`))return;
    await operation(async()=>{const dest=key==='deleteTarget'?(()=>{const [aid,tid]=btn.dataset[key].split(':');return `/api/agents/${aid}/targets/${tid}`;})():base+btn.dataset[key];await api(dest,{method:'DELETE'});notice('Deleted');});return;}
});
async function connect(){
  try{
    await api('/api/health');relayOnline(true);
    const v=await api('/api/session');signedIn(v.loggedIn,v.username||'');
    if(v.loggedIn){state.role=v.role;await load();}
  }catch(err){relayOnline(false);showRelay(err.message);}
}
(async()=>{if(relayURL)await connect();else showRelay();
  setInterval(async()=>{
    if($('#main-view').classList.contains('hidden'))return;
    try{await load(true);relayOnline(true);}catch{relayOnline(false);}
  },2000);
})();

// v0.3 show profiles, macros, operator access, and local presentation preferences.
function renderShows(){
  options($('#macro-profile'),profileOptions(),showId);
  $('#profile-list').innerHTML=(state.profiles||[]).map(p=>`<div class="item"><strong>${escapeHTML(p.name)}</strong>${p.id==='default'?'':' <button class="small" data-delete-profile="'+p.id+'">Delete</button>'}</div>`).join('');
  $('#macro-list').innerHTML=(state.macros||[]).map(m=>`<div class="item"><strong>${escapeHTML(m.name)}</strong> <span class="muted">${m.steps.length} actions · ${m.mode==='parallel'?'parallel':'sequence'}</span><div class="actions"><button class="small" data-delete-macro="${m.id}">Delete</button></div></div>`).join('');
  if(!$('#macro-steps').children.length)addStepRow();
  else for(const row of $('#macro-steps').querySelectorAll('.macro-step')){
    const sel=row.querySelector('select');options(sel,macroButtonOptions(),sel.value);
  }
}
function macroButtonOptions(){return state.buttons.map(b=>`<option value="${b.id}">${escapeHTML(state.agents.find(a=>a.id===b.agentId)?.name||'Unknown')} • ${escapeHTML(b.name)}</option>`).join('');}
function addStepRow(){const row=document.createElement('div');row.className='macro-step';row.innerHTML=`<label>Action<select name="buttonId">${macroButtonOptions()}</select></label><label>Delay before action (ms)<input name="delayMs" type="number" value="0" min="0" max="5000" step="100"></label><button type="button" class="small" data-remove-step="1">× Remove</button>`;$('#macro-steps').append(row);}
function renderSecurity(){if(!isAdmin())return;api('/api/operators').then(r=>{$('#operator-list').innerHTML=r.operators.map(o=>`<div class="item">${escapeHTML(o.username)} <button class="small" data-delete-operator="${escapeHTML(o.username)}">Remove</button></div>`).join('')||'<p class="hint">No operator accounts.</p>'}).catch(()=>{});}
$('#profile-form').addEventListener('submit',e=>{e.preventDefault();operation(async()=>{await api('/api/profiles',{method:'POST',body:extract(e.target)});e.target.reset();notice('Show created');});});
$('#macro-form').addEventListener('submit',e=>{e.preventDefault();const v=extract(e.target),steps=[...$('#macro-steps').querySelectorAll('.macro-step')].map(row=>({buttonId:row.querySelector('select').value,delayMs:Number(row.querySelector('input').value)}));operation(async()=>{await api('/api/macros',{method:'POST',body:{name:v.name,profileId:v.profileId,mode:v.mode,color:v.color,steps}});e.target.reset();$('#macro-steps').innerHTML='';notice('Macro saved');});});
$('#add-macro-step').addEventListener('click',()=>{if($('#macro-steps').children.length>=16)return notice('Maximum 16 steps',true);addStepRow();});
$('#operator-form').addEventListener('submit',e=>{e.preventDefault();operation(async()=>{await api('/api/operators',{method:'POST',body:extract(e.target)});e.target.reset();notice('Operator created');});});
$('#learn-input').addEventListener('click',()=>{const e=(state.events||[]).find(e=>e.kind==='input'&&e.receiverId===$('#mapping-agent').value);if(!e?.inputKey)return notice('Press the clicker or MIDI control, then try Learn again',true);$('#learned-input').classList.remove('hidden');$('#learn-key').value=e.inputKey;options($('#learn-button'),macroButtonOptions());notice('Learned '+e.inputKey);});
$('#save-learn').addEventListener('click',()=>operation(async()=>{await api('/api/mappings',{method:'POST',body:{receiverId:$('#mapping-agent').value,key:$('#learn-key').value,buttonId:$('#learn-button').value}});$('#learned-input').classList.add('hidden');notice('Input mapping saved');}));
function downloadText(name,text,mime){const blob=new Blob([text],{type:mime});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
$('#download-logs').addEventListener('click',()=>{const rows=[['Time','Status','Receiver','Kind','Detail'],...(state.events||[]).map(x=>[x.time,x.status,x.receiverName,x.kind,x.detail])];downloadText('JC-Clicker-Events.csv',rows.map(row=>row.map(x=>'"'+String(x||'').replaceAll('"','""')+'"').join(',')).join('\r\n'),'text/csv');});
$('#export-backup').addEventListener('click',async()=>{try{const data=await api('/api/export');downloadText('JC-Clicker-Backup.json',JSON.stringify(data,null,2),'application/json');notice('Backup exported (no credentials)');}catch(e){notice(e.message,true);}});
$('#import-backup').addEventListener('change',async e=>{const f=e.target.files?.[0];if(!f)return;if(f.size>200000) return notice('Backup too large',true);try{const data=JSON.parse(await f.text());const r=await api('/api/import',{method:'POST',body:data});notice(`Imported ${r.profiles} profiles, ${r.buttons} buttons and ${r.macros} macros`);await load();}catch(err){notice(err.message,true)}finally{e.target.value='';}});
$('#brand-name').addEventListener('change',e=>{localStorage.setItem('jcBrandTitle',e.target.value.slice(0,30));syncMode();});
$('#logo-file').addEventListener('change',e=>{const f=e.target.files?.[0];if(!f)return;if(f.size>250000||!['image/png','image/jpeg','image/webp'].includes(f.type))return notice('Use a PNG/JPG/WebP under 250KB',true);const rd=new FileReader();rd.onload=()=>{localStorage.setItem('jcBrandLogo',rd.result);syncMode();};rd.readAsDataURL(f);});
$('#clear-brand').addEventListener('click',()=>{localStorage.removeItem('jcBrandTitle');localStorage.removeItem('jcBrandLogo');$('#brand-name').value='';syncMode();});
$('#brand-name').value=localStorage.getItem('jcBrandTitle')||'';
document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;
 if(b.dataset.removeStep){b.closest('.macro-step')?.remove();return;}
 const targets=[['deleteProfile','/api/profiles/'],['deleteMacro','/api/macros/'],['deleteOperator','/api/operators/']];
 for(const [name,path] of targets){if(!b.dataset[name])continue;if(!confirm('Remove this item?'))return;await operation(async()=>{await api(path+encodeURIComponent(b.dataset[name]),{method:'DELETE'});notice('Removed');});return;}
});
syncMode();
