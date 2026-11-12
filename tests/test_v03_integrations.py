"""Tests for v0.3 receiver integrations without local Windows AV software."""
import json
import socket
import sys
import threading
from pathlib import Path
from unittest.mock import patch
import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'receiver'))
from receiver import run_action, valid_input_key

CFG={'allowed_networks':['127.0.0.0/8']}


def test_midi_key_recognition():
    assert valid_input_key('midi:note_on:60:0')
    assert valid_input_key('midi:control_change:111:15')
    assert not valid_input_key('midi:arbitrary:xyz')
    assert valid_input_key('page_down')


def test_script_allowlist_accepts_only_local_approved_commands():
    cfg={**CFG,'approved_scripts':{'hello':[sys.executable,'-c','print("ready")']}}
    msg=run_action({'type':'script'},{'script':'hello'},cfg)
    assert 'completed' in msg
    with pytest.raises(RuntimeError,match='not approved'):
        run_action({'type':'script'},{'script':'anything_else'},cfg)


def test_vmix_http_request():
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    paths=[]
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            paths.append(self.path)
            self.send_response(200);self.end_headers();self.wfile.write(b'<vmix/>')
        def log_message(self,*args):pass
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    th=threading.Thread(target=server.serve_forever,daemon=True);th.start()
    try:
        reply=run_action({'type':'vmix','host':'127.0.0.1','port':server.server_port},
                         {'operation':'Cut','input':'2'},CFG)
        assert 'HTTP 200' in reply
        assert paths==['/api/?Function=Cut&Input=2']
    finally:server.shutdown();server.server_close()


def test_midi_output_sends_correct_message():
    calls=[]
    class Port:
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def send(self,m):calls.append(m)
    class Midi:
        @staticmethod
        def open_output(name):assert name=='Test MIDI';return Port()
        @staticmethod
        def Message(kind,**kw):return {'type':kind,**kw}
    with patch.dict(sys.modules,{'mido':Midi()}):
        msg=run_action({'type':'midi'}, {'device':'Test MIDI','kind':'control_change','channel':3,'note':7,'value':80},CFG)
    assert calls==[{'type':'control_change','channel':3,'control':7,'value':80}]
    assert 'not confirmed' in msg


def test_obs_websocket_produces_request_and_ack():
    # Simulate OBS v5 using real WebSocket transport, without depending on OBS installed.
    import asyncio
    from websockets.sync.server import serve
    from websocket import create_connection
    commands=[]
    ready=threading.Event();address=[]
    def handler(ws):
        ws.send(json.dumps({'op':0,'d':{'obsWebSocketVersion':'5.5.0','rpcVersion':1}}))
        msg=json.loads(ws.recv());assert msg['op']==1
        ws.send(json.dumps({'op':2,'d':{'negotiatedRpcVersion':1}}))
        req=json.loads(ws.recv());commands.append(req)
        ws.send(json.dumps({'op':7,'d':{'requestId':req['d']['requestId'],
                                     'requestType':req['d']['requestType'],
                                     'requestStatus':{'result':True,'code':100}}}))
    def start():
        with serve(handler,'127.0.0.1',0) as server:
            address.append(server.socket.getsockname()[1]);ready.set()
            server.serve_forever()
    # Run the server as daemon; process exit cleans up the fake server.
    thread=threading.Thread(target=start,daemon=True);thread.start();assert ready.wait(3)
    result=run_action({'type':'obs','host':'127.0.0.1','port':address[0]},
                     {'operation':'SetCurrentProgramScene','sceneName':'Program A'},CFG)
    assert 'confirmed' in result
    assert commands[0]['d']['requestData']['sceneName']=='Program A'
