const $=id=>document.getElementById(id);
let ws=null,connected=false;
function log(s,cls=''){const row=document.createElement('div');row.className='terminal-row '+cls;row.textContent=`[${new Date().toLocaleTimeString()}] ${s}`;$('activity').prepend(row);while($('activity').children.length>150)$('activity').lastChild.remove();}
function status(s,on=false){$('status').textContent=s;$('status-dot').className='dot '+(on?'online':'offline');connected=on;$('send-test').disabled=!on;}
function relayUrl(raw){const url=new URL(raw);const loopback=['localhost','127.0.0.1','[::1]'].includes(url.hostname);if(url.username||url.password||url.pathname!=='/'&&url.pathname||!((url.protocol==='https:')||(url.protocol==='http:'&&loopback)))throw Error('Use an HTTPS relay URL (localhost can use HTTP)');return url.origin;}
$('relay').value=localStorage.getItem('jcRelayURL')||location.origin;
$('pair-form').onsubmit=async e=>{e.preventDefault();try{
  const relay=relayUrl($('relay').value.trim());localStorage.setItem('jcRelayURL',relay);
  let id=$('id').value.trim(),key=$('key').value.trim();const code=$('code').value.trim();
  if(code){const r=await fetch(relay+'/api/pair-exchange',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});const d=await r.json();if(!r.ok)throw Error(d.error);id=d.receiver_id;key=d.receiver_key;$('id').value=id;$('key').value=key;$('code').value='';}
  if(!id||!key)throw Error('Enter receiver ID and key or use a pairing code');
  if(ws)ws.close();const url=relay.replace(/^http/,'ws')+'/receiver';status('Connecting…');
  ws=new WebSocket(url);ws.addEventListener('open',()=>ws.send(JSON.stringify({type:'hello',id,key})));ws.addEventListener('message',e=>{
    try{const m=JSON.parse(e.data);
      if(m.type==='authenticated'){status('CONNECTED TO INTERNET RELAY',true);$('name').textContent=m.name||'';log('AUTHENTICATED • receiver online','ok');ws.send(JSON.stringify({type:'info',platform:'Web browser',version:'0.3.0',keyboardEnabled:$('capture').checked,bridgeEnabled:false}));}
      else if(m.type==='test'){log(`TEST RECEIVED • ID ${m.id}`,'ok');ws.send(JSON.stringify({type:'result',id:m.id,ok:true,message:'Web-only receiver saw and acknowledged the test signal',receivedAt:Date.now()/1000}));log('ACKNOWLEDGEMENT SENT','ok');}
      else if(m.type==='execute'||m.type==='probe'){log(`${m.type.toUpperCase()} RECEIVED (browser cannot execute application control)`,'error');ws.send(JSON.stringify({type:'result',id:m.id,ok:false,error:'Browser receiver monitor cannot run local application commands'}));}
    }catch(err){log('Invalid signal: '+err.message,'error');}
  });ws.addEventListener('close',ev=>{status('DISCONNECTED');log('Disconnected '+(ev.reason||'(close / wrong key / network)'),'error');});ws.addEventListener('error',()=>log('Connection failed: check HTTPS relay and credentials','error'));
}catch(err){status('Connection failed');log(err.message,'error');}};
$('disconnect').onclick=()=>{if(ws)ws.close(1000,'User disconnected');status('Disconnected');};
$('send-test').onclick=()=>{if(connected&&ws?.readyState===1){ws.send(JSON.stringify({type:'input',kind:'test',key:'test'}));log('SIMULATED TEST INPUT sent to relay');}};
$('fullscreen').onclick=()=>document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();
const keys={ArrowRight:'right',ArrowLeft:'left',PageDown:'page_down',PageUp:'page_up',' ':'space',Enter:'enter'};
window.addEventListener('keydown',e=>{if(!$('capture').checked||!connected||e.repeat||e.target.closest('input,button,textarea,select'))return;const key=keys[e.key];if(!key)return;e.preventDefault();ws.send(JSON.stringify({type:'input',kind:'keyboard',key}));log('INPUT DETECTED '+key);});
