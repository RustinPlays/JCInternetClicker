"""JC Internet Clicker receiver. Run on a computer you own/control.

Outbound WebSocket to the authenticated relay; incoming commands are restricted
 to supported application protocols and configured destination address ranges.
"""
import ipaddress
import json
import hmac
import re
import threading
import queue
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qs
import os
import platform
import socket
import struct
import sys
import time
import hashlib
import base64
import subprocess
from urllib.parse import urlencode
from urllib import request, error

import websocket  # pip install websocket-client

CONFIG_DIR = os.path.dirname(os.path.abspath(sys.executable if getattr(sys, 'frozen', False) else __file__))
CONFIG_FILE = os.path.join(CONFIG_DIR, 'config.json')


def load_config():
    with open(CONFIG_FILE, 'r', encoding='utf-8') as file:
        cfg = json.load(file)
    for key in ('server_url', 'receiver_id', 'receiver_key'):
        if not cfg.get(key):
            raise ValueError('Missing ' + key + ' in receiver/config.json')
    cfg.setdefault('input_port', 8877)
    cfg.setdefault('capture_keys', False)
    cfg.setdefault('capture_midi', False)
    cfg.setdefault('midi_input_name', '')
    cfg.setdefault('approved_scripts', {})
    cfg.setdefault('obs_password', '')
    cfg.setdefault('allowed_networks', ['127.0.0.0/8','10.0.0.0/8','172.16.0.0/12',
                                        '192.168.0.0/16','100.64.0.0/10','::1/128','fc00::/7'])
    return cfg


def validate_destination(host, cfg):
    """No unrestricted internet scan/proxy. All resolved addresses must be approved."""
    nets = [ipaddress.ip_network(x, strict=False) for x in cfg['allowed_networks']]
    if host.lower() == 'localhost':
        host = '127.0.0.1'
    addresses = {info[4][0] for info in socket.getaddrinfo(host, None)}
    if not addresses or any(not any(ipaddress.ip_address(a) in n for n in nets) for a in addresses):
        raise ValueError(f'Destination {host} is outside receiver allowed_networks')
    return host


def osc_string(value):
    raw = value.encode('utf-8') + b'\x00'
    return raw + (b'\x00' * ((4 - len(raw) % 4) % 4))


def osc_packet(action):
    data = osc_string(action['address'])
    value_type = action.get('valueType', 'int')
    if value_type == 'none':
        return data + osc_string(',')
    if value_type == 'int':
        return data + osc_string(',i') + struct.pack('>i', int(action['value']))
    if value_type == 'float':
        return data + osc_string(',f') + struct.pack('>f', float(action['value']))
    if value_type == 'string':
        return data + osc_string(',s') + osc_string(str(action['value']))
    raise ValueError('Unsupported OSC type')


def powerpoint(operation, slide=None):
    if platform.system() != 'Windows':
        raise RuntimeError('PowerPoint control requires Windows + desktop PowerPoint')
    try:
        import pythoncom
        import win32com.client
    except ImportError as exc:
        raise RuntimeError('Run pip install pywin32 on this computer') from exc
    pythoncom.CoInitialize()
    try:
        try:
            app = win32com.client.GetActiveObject('PowerPoint.Application')
        except Exception as exc:
            raise RuntimeError('PowerPoint is not running') from exc
        if operation == 'start' and app.SlideShowWindows.Count == 0:
            app.ActivePresentation.SlideShowSettings.Run()
            return 'Slideshow started'
        if app.SlideShowWindows.Count == 0:
            raise RuntimeError('No slideshow is running; press Start slideshow first')
        view = app.SlideShowWindows(1).View
        actions = {
            'next': view.Next, 'previous': view.Previous, 'first': view.First,
            'last': view.Last, 'end': view.Exit
        }
        if operation == 'goto':
            view.GotoSlide(int(slide))
        elif operation == 'start':
            return 'Slideshow already running'
        elif operation in actions:
            actions[operation]()
        else:
            raise ValueError('Unsupported PowerPoint action')
        return f'PowerPoint: {operation} executed'
    finally:
        pythoncom.CoUninitialize()


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('HTTP redirects are blocked to prevent destination changes')


def send_http(host, port, action, secure=False):
    url_host = f'[{host}]' if ':' in host else host
    scheme = 'https' if secure else 'http'
    dest = f'{scheme}://{url_host}:{port}{action["path"]}'
    method = action['method']
    body = action.get('body','')
    payload = body.encode('utf-8') if method != 'GET' else None
    headers = {'Content-Type':'application/json' if action.get('contentType') == 'json' else 'text/plain; charset=utf-8'}
    req = request.Request(dest, data=payload, method=method, headers=headers)
    try:
        with request.build_opener(NoRedirect()).open(req, timeout=4) as res:
            return f'HTTP {res.status} from target'
    except error.HTTPError as exc:
        raise RuntimeError(f'HTTP target returned {exc.code}') from exc


def udp_send(host, port, data):
    info = socket.getaddrinfo(host, port, type=socket.SOCK_DGRAM)[0]
    with socket.socket(info[0], socket.SOCK_DGRAM) as sock:
        sock.sendto(data, info[4])


def run_action(target, action, cfg):
    typ = target['type']
    if typ == 'powerpoint':
        return powerpoint(action['operation'], action.get('slide'))
    if typ == 'hotkey':
        try:
            from pynput.keyboard import Controller, Key
        except ImportError as exc:
            raise RuntimeError('Install pynput to send shortcuts') from exc
        parts = [p.strip().lower() for p in action['keys'].split('+')]
        names = {'ctrl': Key.ctrl, 'control': Key.ctrl, 'alt': Key.alt,
                 'shift': Key.shift, 'win': Key.cmd, 'enter': Key.enter,
                 'space': Key.space, 'esc': Key.esc, 'escape': Key.esc,
                 'left': Key.left, 'right': Key.right, 'up': Key.up,
                 'down': Key.down, 'pageup': Key.page_up, 'pagedown': Key.page_down,
                 'tab': Key.tab, 'f5': Key.f5}
        keys = [names.get(k, k) for k in parts]
        if len(keys)>5 or any(not isinstance(k,str) or len(k)!=1 for k in keys if isinstance(k,str)):
            raise ValueError('Unsupported shortcut keys')
        keyboard=Controller()
        try:
            for key in keys: keyboard.press(key)
        finally:
            for key in reversed(keys): keyboard.release(key)
        return 'Keyboard shortcut sent to focused window; target application not confirmed'
    if typ == 'script':
        script=action['script']
        approved=cfg.get('approved_scripts',{})
        # Only paths + static args on the physical receiver. The website never supplies shell text.
        argv=approved.get(script)
        if not isinstance(argv,list) or not argv or not all(isinstance(x,str) and x for x in argv):
            raise RuntimeError(f'Local script {script} is not approved in receiver config')
        run=subprocess.run(argv, shell=False, timeout=8, capture_output=True, text=True, check=False)
        if run.returncode: raise RuntimeError(f'Approved script {script} exited with code {run.returncode}')
        return f'Approved script {script} completed (exit 0)'
    if typ == 'midi':
        try: import mido
        except ImportError as exc:raise RuntimeError('Install mido and python-rtmidi for MIDI output') from exc
        kind=action['kind'];kwargs={'channel':int(action['channel'])}
        if kind=='program_change':kwargs['program']=int(action['note'])
        elif kind=='control_change':kwargs.update(control=int(action['note']),value=int(action['value']))
        else:kwargs.update(note=int(action['note']),velocity=int(action['value']))
        output=action.get('device') or cfg.get('midi_output_name')
        if not output: raise RuntimeError('Choose MIDI output device in action or receiver config')
        with mido.open_output(output) as port:
            port.send(mido.Message(kind,**kwargs))
        return f'MIDI {kind} sent to {output}; software reaction not confirmed'
    host = validate_destination(target['host'], cfg)
    port = int(target['port'])
    if not 1 <= port <= 65535:
        raise ValueError('Invalid port')
    if typ == 'osc':
        payload = osc_packet(action)
        udp_send(host, port, payload)
        return 'OSC sent via UDP; application receipt not confirmed'
    if typ == 'companion':
        page,row,col = int(action['page']),int(action['row']),int(action['column'])
        op = action['operation']
        if not (1 <= page <= 999 and 1 <= row <= 999 and 1 <= col <= 999) or op not in ('press','down','up','rotate-left','rotate-right'):
            raise ValueError('Invalid Companion action')
        return send_http(host,port,{'path':f'/api/location/{page}/{row}/{col}/{op}', 'method':'POST','body':'','contentType':'text'})
    if typ == 'http':
        return send_http(host,port,action,secure=bool(target.get('secure',False)))
    if typ == 'vmix':
        parameters={'Function':action['operation']}
        if action.get('input'):parameters['Input']=action['input']
        return send_http(host,port,{'path':'/api/?'+urlencode(parameters), 'method':'GET','body':'','contentType':'text'})
    if typ == 'obs':
        # OBS WebSocket 5.x protocol. The password stays on the receiver PC, never on the relay.
        conn=websocket.create_connection(f'ws://{host}:{port}',timeout=4)
        try:
            hello=json.loads(conn.recv())
            if hello.get('op')!=0:raise RuntimeError('OBS did not send WebSocket Hello')
            identify={'rpcVersion':1}
            auth=hello.get('d',{}).get('authentication')
            if auth:
                password=cfg.get('obs_password','')
                if not password:raise RuntimeError('Set obs_password locally in receiver/config.json')
                secret=base64.b64encode(hashlib.sha256((password+auth['salt']).encode()).digest()).decode()
                identify['authentication']=base64.b64encode(hashlib.sha256((secret+auth['challenge']).encode()).digest()).decode()
            conn.send(json.dumps({'op':1,'d':identify}))
            identified=json.loads(conn.recv())
            if identified.get('op')!=2:raise RuntimeError('OBS authentication/identification failed')
            request_data={}
            if action['operation'] in ('SetCurrentProgramScene','SetCurrentPreviewScene'):
                if not action.get('sceneName'):raise ValueError('Set OBS scene name')
                request_data['sceneName']=action['sceneName']
            conn.send(json.dumps({'op':6,'d':{'requestType':action['operation'],
                'requestId':f'jc-{int(time.time()*1000)}','requestData':request_data}}))
            for _ in range(10):
                result=json.loads(conn.recv())
                if result.get('op')==7:
                    status=result.get('d',{}).get('requestStatus',{})
                    if not status.get('result'):raise RuntimeError(f'OBS failed: {status.get("comment", "unknown error")}')
                    return f'OBS confirmed {action["operation"]}'
            raise RuntimeError('OBS did not return a matching request result')
        finally:conn.close()
    if typ in ('tcp','udp'):
        raw = action['payload'].encode('utf-8') if action.get('encoding') == 'utf8' else bytes.fromhex(action['payload'])
        if typ == 'tcp':
            with socket.create_connection((host,port),timeout=4) as sock:
                sock.sendall(raw)
            return f'TCP connected and {len(raw)} bytes sent'
        udp_send(host,port,raw)
        return f'{len(raw)} UDP bytes sent; application receipt not confirmed'
    raise ValueError('Unsupported device type')


def probe(target, cfg):
    typ = target['type']
    if typ in ('hotkey','midi','script'):
        return f'{typ.upper()} target configured; actual device or application requires a live command'
    if typ == 'powerpoint':
        if platform.system() != 'Windows':
            raise RuntimeError('PowerPoint integration is Windows only')
        import pythoncom
        import win32com.client
        pythoncom.CoInitialize()
        try:
            app = win32com.client.GetActiveObject('PowerPoint.Application')
            return f'PowerPoint open; {app.SlideShowWindows.Count} slideshow(s) running'
        finally:
            pythoncom.CoUninitialize()
    host = validate_destination(target['host'], cfg)
    if typ in ('osc','udp'):
        return f'Receiver online, destination {host}:{target["port"]} permitted. UDP cannot verify application listening.'
    with socket.create_connection((host,int(target['port'])),timeout=3):
        return f'TCP connection successful to {host}:{target["port"]}'



SUPPORTED_KEYS = {'right','left','page_down','page_up','space','enter','f5','escape'}
def valid_input_key(key):
    return key in SUPPORTED_KEYS | {'test'} or bool(re.fullmatch(r'midi:(?:note_on|note_off|control_change|program_change):(?:[0-9]{1,3}):[0-9]{1,2}',str(key)))


class ReceiverClient:
    """One active outbound connection, optional local-only input bridge and HID monitor."""

    def __init__(self, cfg, log=print, status=None):
        self.cfg = cfg
        self.log = log
        self.status = status or (lambda **kw: None)
        self.ws = None
        self.connected = False
        self._lock = threading.Lock()
        self._pressed = set()
        self._keyboard_listener = None
        self._midi_port = None
        self._midi_thread = None
        self._httpd = None
        self._seen_packets = {}
        self._stop = threading.Event()

    def tell(self, message):
        self.log(f'[{time.strftime("%H:%M:%S")}] {message}')

    def _notify(self):
        self.status(connected=self.connected, keyboard=self._keyboard_listener is not None,
                    bridge=self._httpd is not None)

    def send(self, value):
        if not self.connected or not self.ws:
            self.tell('Input NOT sent: receiver is disconnected')
            return False
        try:
            with self._lock:
                self.ws.send(json.dumps(value))
            return True
        except Exception as exc:
            self.tell(f'Input could not send: {exc}')
            return False

    def send_input(self, key, kind='test', button_id=None):
        if not valid_input_key(key):
            return False
        value = {'type':'input','kind':kind,'key':key}
        if button_id:
            value['buttonId'] = button_id
        ok = self.send(value)
        if ok:
            self.tell(f'INPUT SENT | {kind.upper()} | {key}' + (f' | button {button_id}' if button_id else ''))
        return ok

    def bridge(self):
        client = self
        secret = self.cfg.get('input_secret') or self.cfg['receiver_key']
        port = int(self.cfg['input_port'])
        if not 1024 <= port <= 65535:
            raise ValueError('input_port must be 1024–65535')

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                parts = urlsplit(self.path)
                key = (parse_qs(parts.query).get('key') or [''])[0]
                key = self.headers.get('X-Clicker-Key') or key
                if not hmac.compare_digest(str(key), str(secret)):
                    return self.reply(401, 'Incorrect bridge key')
                if not client.connected:
                    return self.reply(503, 'Receiver not connected to relay')
                if int(self.headers.get('Content-Length', 0)) > 1024:
                    return self.reply(413, 'Request too large')
                segments = parts.path.strip('/').split('/')
                if len(segments)!=2:
                    return self.reply(404, 'Use /input/right or /trigger/<button-id>')
                group, value = segments
                if group == 'input' and value in SUPPORTED_KEYS:
                    ok=client.send_input(value, kind='http')
                elif group == 'trigger' and re.fullmatch(r'[a-f0-9-]{36}',value):
                    ok=client.send_input('test',kind='http',button_id=value)
                else:
                    return self.reply(404, 'Unknown input route')
                return self.reply(202 if ok else 503, 'Accepted by receiver; check dashboard for delivery acknowledgement' if ok else 'Disconnected')

            def reply(self, status, message):
                body = message.encode('utf-8')
                self.send_response(status)
                self.send_header('Content-Type','text/plain; charset=utf-8')
                self.send_header('Cache-Control','no-store')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, fmt, *args):
                # Never include private key from query parameters in logs.
                pass

        self._httpd=ThreadingHTTPServer(('127.0.0.1',port),Handler)
        threading.Thread(target=self._httpd.serve_forever, daemon=True).start()
        self.tell(f'Local Stream Deck/Companion input port ready: 127.0.0.1:{port} (loopback only)')
        self._notify()

    def keyboard_monitor(self, enable):
        if enable and self._keyboard_listener is None:
            try:
                from pynput import keyboard
            except ImportError:
                self.tell('Install pynput to monitor USB keyboard-style clickers: pip install pynput')
                return False
            aliases={'page_down':'page_down','page_up':'page_up','esc':'escape','escape':'escape',
                     'right':'right','left':'left','space':'space','enter':'enter','f5':'f5'}
            def keyname(key):
                return aliases.get(getattr(key,'name',None),None)
            def pressed(key):
                name = keyname(key)
                if name and name not in self._pressed:
                    self._pressed.add(name)
                    self.send_input(name,kind='keyboard')
            def released(key):
                name=keyname(key)
                if name:self._pressed.discard(name)
            self._keyboard_listener=keyboard.Listener(on_press=pressed,on_release=released)
            self._keyboard_listener.start()
            self.tell('USB clicker monitor ON (only arrow/PageUp/PageDown/Space/Enter/F5/Escape)')
        if not enable and self._keyboard_listener:
            self._keyboard_listener.stop()
            self._keyboard_listener=None
            self._pressed.clear()
            self.tell('USB clicker monitor OFF')
        self._notify()
        if self.connected:self.send({'type':'info','platform':platform.system(),'version':'0.3.0',
                                    'keyboardEnabled':self._keyboard_listener is not None,
                                    'bridgeEnabled':self._httpd is not None})
        return self._keyboard_listener is not None

    def midi_monitor(self, enable):
        if enable and self._midi_port is None:
            try:import mido
            except ImportError:
                self.tell('Install mido + python-rtmidi to monitor MIDI');return False
            name=self.cfg.get('midi_input_name') or ''
            if not name:
                self.tell('Set midi_input_name in config.json before enabling MIDI input');return False
            try:self._midi_port=mido.open_input(name)
            except Exception as exc:self.tell(f'MIDI input unavailable: {exc}');return False
            self.tell('MIDI input monitor ON: '+name)
            def poll():
                while self._midi_port is not None and not self._stop.is_set():
                    try:
                        for msg in self._midi_port.iter_pending():
                            if msg.type in ('note_on','note_off','control_change','program_change'):
                                number=getattr(msg,'note',getattr(msg,'control',getattr(msg,'program',0)))
                                key=f'midi:{msg.type}:{number}:{getattr(msg,"channel",0)}'
                                self.send_input(key,kind='midi')
                    except Exception as exc:self.tell('MIDI receive failed: '+str(exc));break
                    time.sleep(.02)
            self._midi_thread=threading.Thread(target=poll,daemon=True);self._midi_thread.start()
        if not enable and self._midi_port:
            port=self._midi_port;self._midi_port=None;port.close()
            self.tell('MIDI input monitor OFF')
        return self._midi_port is not None

    def _on_open(self, ws):
        ws.send(json.dumps({'type':'hello','id':self.cfg['receiver_id'],'key':self.cfg['receiver_key']}))

    def _on_message(self, ws, raw):
        try:
            msg=json.loads(raw)
            kind=msg.get('type')
            if kind=='authenticated':
                self.connected=True
                self.tell('CONNECTED to relay as ' + str(msg.get('name')))
                self._notify()
                self.send({'type':'info','platform':platform.system(), 'version':'0.3.0',
                           'keyboardEnabled':self._keyboard_listener is not None,
                           'bridgeEnabled':self._httpd is not None})
                return
            if kind not in ('execute','probe','test'):
                return
            # Ignore duplicates when a websocket unexpectedly retransmits a command.
            packet_id=str(msg.get('id',''))
            if packet_id in self._seen_packets:
                self.tell('DUPLICATE signal ignored: '+packet_id)
                self.send({'type':'result','id':packet_id,'ok':False,'error':'Duplicate command ignored'})
                return
            self._seen_packets[packet_id]=time.monotonic()
            if len(self._seen_packets)>500:
                oldest=sorted(self._seen_packets,key=self._seen_packets.get)[:250]
                for old in oldest:self._seen_packets.pop(old,None)
            self.tell('RECEIVED FROM INTERNET: ' +
                      ('TEST SIGNAL' if kind=='test' else f'{kind.upper()} | {msg.get("target",{}).get("name", "Unknown")}'))
            try:
                if kind == 'test':
                    detail = 'Receiver saw the test signal and sent an acknowledgement'
                elif kind == 'execute':
                    detail = run_action(msg['target'],msg['action'],self.cfg)
                else:
                    detail = probe(msg['target'],self.cfg)
                answer={'type':'result','id':msg['id'],'ok':True,'message':detail,
                        'receivedAt':time.time()}
                self.tell('ACK SENT: ' + detail)
            except Exception as exc:
                answer={'type':'result','id':msg['id'],'ok':False,'error':str(exc)[:250]}
                self.tell('FAILED: '+str(exc))
            self.send(answer)
        except Exception as exc:
            self.tell(f'Invalid relay packet: {exc}')

    def _on_error(self, ws, err):
        self.tell('Connection issue: ' + str(err))

    def _on_close(self, ws, code, reason):
        self.connected=False
        self.tell(f'DISCONNECTED ({code}): {reason}; reconnecting automatically')
        self._notify()

    def run(self):
        url = self.cfg['server_url'].rstrip('/')
        if url.startswith('https://'): url = 'wss://' + url[len('https://'):]
        elif url.startswith('http://'): url = 'ws://' + url[len('http://'):]
        if not url.startswith(('wss://','ws://')):
            raise ValueError('server_url must begin with HTTPS or HTTP')
        if url.startswith('ws://'):
            from urllib.parse import urlparse
            if urlparse(url).hostname not in ('localhost','127.0.0.1','::1'):
                raise ValueError('Public receiver connection must use HTTPS/WSS, not unsecured HTTP')
        self.tell('Starting receiver for ' + self.cfg['server_url'])
        self.bridge()
        if self.cfg.get('capture_keys',False):
            self.keyboard_monitor(True)
        if self.cfg.get('capture_midi',False):
            self.midi_monitor(True)
        while not self._stop.is_set():
            self.ws=websocket.WebSocketApp(url+'/receiver',on_open=self._on_open,
                     on_message=self._on_message,on_error=self._on_error,on_close=self._on_close)
            self.ws.run_forever(ping_interval=20,ping_timeout=10)
            self.connected=False
            self._notify()
            if self._stop.wait(3):break

    def shutdown(self):
        self._stop.set()
        if self.ws:self.ws.close()
        if self._httpd:self._httpd.shutdown();self._httpd.server_close()
        self.keyboard_monitor(False)
        self.midi_monitor(False)


def main():
    cfg=load_config()
    client=ReceiverClient(cfg)
    try:
        client.run()
    except KeyboardInterrupt:
        print('Receiver stopped')
    finally:
        client.shutdown()


if __name__=='__main__':
    try:
        main()
    except Exception as exc:
        print('Receiver could not start:',exc)
        sys.exit(1)
