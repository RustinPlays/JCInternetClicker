import tempfile,shutil,subprocess,os,socket,time,json,hashlib,secrets,urllib.request,urllib.error
from pathlib import Path
src=Path(__file__).resolve().parents[1]/'server'


def test_relay_http_api_with_mock_ws_package():
    # Fake ws transport allows HTTP route testing where npm registry is unavailable.
    # This test deliberately does NOT validate actual WebSocket handshake or forwarding.
    with tempfile.TemporaryDirectory() as work:
     p=Path(work);shutil.copy(src/'server.mjs',p/'server.mjs');shutil.copytree(src/'public',p/'public',dirs_exist_ok=True)
     ws=p/'node_modules/ws';ws.mkdir(parents=True);(ws/'package.json').write_text('{"type":"module","exports":"./index.js"}')
     (ws/'index.js').write_text('import {EventEmitter} from "node:events";export class WebSocketServer extends EventEmitter {constructor(){super()}handleUpgrade(req,socket,head,cb){socket.destroy()}}export class WebSocket {static OPEN=1}')
     salt=secrets.token_hex(24);pw='TestPasswordTestPassword!';hash=hashlib.scrypt(pw.encode(),salt=salt.encode(),n=16384,r=8,p=1,dklen=64).hex()
     with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
     env={**os.environ,'ADMIN_USERNAME':'admin','ADMIN_PASSWORD_SALT':salt,'ADMIN_PASSWORD_HASH':hash,'SESSION_SECRET':secrets.token_hex(32),'PORT':str(port)}
     proc=subprocess.Popen(['node',str(p/'server.mjs')],cwd=p,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
     try:
      root=f'http://127.0.0.1:{port}'
      def call(path,method='GET',data=None,token=None):
       body=None if data is None else json.dumps(data).encode()
       h={'Content-Type':'application/json'}
       if token:h['Authorization']='Bearer '+token
       req=urllib.request.Request(root+path,method=method,headers=h,data=body)
       try:
        with urllib.request.urlopen(req,timeout=5) as r:return r.status,json.load(r)
       except urllib.error.HTTPError as e:return e.code,json.load(e)
      for i in range(50):
       try:
        if call('/api/health')[0]==200:break
       except Exception:time.sleep(.1)
      else:raise RuntimeError('relay did not start: '+proc.stdout.read())
      assert call('/api/health')[1]['version']=='0.3.0'
      assert call('/api/state')[0]==401
      assert call('/api/login','POST',{'username':'admin','password':'wrong'})[0]==401
      login=call('/api/login','POST',{'username':'admin','password':pw})
      assert login[0]==200,login
      admin=login[1]['token'];assert login[1]['role']=='admin'
      a=call('/api/agents','POST',{'name':'Hamilton Test'},admin); assert a[0]==201,a
      agentid=a[1]['id'];key=a[1]['key']
      state=call('/api/state',token=admin)[1]
      assert len(state['buttons'])==6
      assert state['agents'][0]['name']=='Hamilton Test'
      code=call('/api/pair-codes','POST',{'agentId':agentid},admin); assert code[0]==200
      paired=call('/api/pair-exchange','POST',{'code':code[1]['code']});assert paired[0]==200,paired
      assert paired[1]['receiver_key']!=key
      assert call('/api/pair-exchange','POST',{'code':code[1]['code']})[0]==401
      prof=call('/api/profiles','POST',{'name':'Genesis Show'},admin);assert prof[0]==201,prof
      profileid=prof[1]['profile']['id']
      btn=call('/api/buttons','POST',{'agentId':agentid,'targetId':state['agents'][0]['targets'][0]['id'],'profileId':profileid,'name':'Test Next','action':{'operation':'next'},'color':'green'},admin);assert btn[0]==201,btn
      macro=call('/api/macros','POST',{'name':'All Advance','profileId':profileid,'steps':[{'buttonId':btn[1]['button']['id'],'delayMs':0}]},admin)
      assert macro[0]==201,macro
      assert call('/api/macros/'+macro[1]['macro']['id']+'/run','POST',{},admin)[0]==502 # receiver offline
      operator=call('/api/operators','POST',{'username':'stage','password':'at-least-12-password'},admin);assert operator[0]==201,operator
      opLogin=call('/api/login','POST',{'username':'stage','password':'at-least-12-password'});assert opLogin[0]==200
      tok=opLogin[1]['token'];assert opLogin[1]['role']=='operator'
      assert call('/api/profiles','POST',{'name':'Nope'},tok)[0]==403
      assert call('/api/agents','POST',{'name':'Not Allowed'},tok)[0]==403
      assert call('/api/export',token=tok)[0]==403
      ex=call('/api/export',token=admin);assert ex[0]==200
      assert not any('keyHash' in a for a in ex[1]['agents'])
      assert 'operators' not in ex[1]
      # import is additive, existing receiver refs required
      imported=call('/api/import','POST',ex[1],admin);assert imported[0]==200,imported
      assert imported[1]['buttons']>=7
      assert imported[1]['profiles']==1
      print('relay HTTP smoke PASS; admin/operator, auth, pairing, macros, backups and import')
     finally:
      proc.terminate();
      try:proc.wait(timeout=3)
      except subprocess.TimeoutExpired:proc.kill()
