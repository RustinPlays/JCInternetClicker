"""JC Clicker Studio: native operator console + integrated remote receiver.

The remote website remains the main editor. This native client provides quick
control, receiver logs, local configuration and an optional embedded web view.
"""
import json
import os
from pathlib import Path
import queue
import sys
import threading
import urllib.error
import urllib.request
from urllib.parse import urlparse
import webbrowser
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

# Frozen build includes receiver package modules via PyInstaller --paths.
HERE=Path(__file__).resolve().parent
RECEIVER_ROOT=HERE.parent/'receiver'
if str(RECEIVER_ROOT) not in sys.path:sys.path.insert(0,str(RECEIVER_ROOT))
from receiver import ReceiverClient, CONFIG_FILE, load_config

CURRENT_VERSION='0.3.0'
RELEASES_URL='https://api.github.com/repos/RustinPlays/JC-Internet-Clicker/releases/latest'


def get_json(url, method='GET', body=None, token=None):
    payload=json.dumps(body).encode('utf-8') if body is not None else None
    headers={'Accept':'application/json','User-Agent':f'JC-Clicker-Studio/{CURRENT_VERSION}'}
    if payload is not None:headers['Content-Type']='application/json'
    if token:headers['Authorization']='Bearer '+token
    req=urllib.request.Request(url,headers=headers,data=payload,method=method)
    try:
        with urllib.request.urlopen(req,timeout=9) as response:return json.load(response)
    except urllib.error.HTTPError as exc:
        try:detail=json.load(exc).get('error',str(exc))
        except Exception:detail=str(exc)
        raise RuntimeError(detail) from exc


def ensure_url(url):
    u=urlparse(url)
    if not u.hostname or u.path not in ('','/') or u.scheme not in ('http','https') or (u.scheme=='http' and u.hostname not in ('127.0.0.1','localhost','::1')):
        raise ValueError('For online operation use HTTPS relay URL. HTTP allowed only on localhost.')
    return url.rstrip('/')


def open_embedded(url):
    try:import webview
    except ImportError:
        webbrowser.open(url)
        return
    webview.create_window('JC Internet Clicker — Studio Web Dashboard',url,width=1240,height=820,min_size=(760,520))
    webview.start()


class Studio:
    def __init__(self,root):
        self.root=root;root.title('JC Internet Clicker Studio  •  v0.3 beta');root.geometry('1070x760');root.minsize(780,580)
        root.configure(bg='#111824')
        self.events=queue.Queue();self.client=None;self.receiver_thread=None;self.session=None;self.state={}
        self.receiver_status=tk.StringVar(value='Receiver not running')
        self.login_status=tk.StringVar(value='Not signed into relay')
        self.relay=tk.StringVar(value='http://127.0.0.1:8787')
        if Path(CONFIG_FILE).exists():
            try:self.relay.set(load_config()['server_url'])
            except Exception:pass
        tk.Label(root,text='JC / INTERNET CLICKER STUDIO',font=('Segoe UI',16,'bold'),fg='#f1f7ff',bg='#111824').pack(fill='x',pady=(14,5))
        style=ttk.Style();style.theme_use('clam');style.configure('TNotebook',background='#111824',borderwidth=0)
        style.configure('TNotebook.Tab',font=('Segoe UI',10,'bold'),padding=(17,10))
        self.tabs=ttk.Notebook(root);self.tabs.pack(fill='both',expand=True,padx=16,pady=12)
        self.build_control();self.build_receiver();self.build_config();self.build_logs()
        root.protocol('WM_DELETE_WINDOW',self.close)
        root.after(150,self.poll)
        threading.Thread(target=self.check_update,daemon=True).start()

    def frame(self,title):
        panel=tk.Frame(self.tabs,bg='#1b2838');self.tabs.add(panel,text=title)
        inner=tk.Frame(panel,bg='#1b2838',padx=18,pady=15);inner.pack(fill='both',expand=True)
        return inner

    def text(self,parent,label,colour='#cad8e8',size=10):
        tk.Label(parent,text=label,bg=parent.cget('bg'),fg=colour,font=('Segoe UI',size),anchor='w',justify='left').pack(anchor='w',pady=(6,2))

    def button(self,parent,label,command,primary=False):
        b=tk.Button(parent,text=label,command=command,padx=15,pady=8,font=('Segoe UI',10,'bold'),relief='flat',
                    bg='#246a52' if primary else '#35516d',fg='white',activebackground='#367e6b')
        b.pack(side='left',padx=(0,9),pady=7)
        return b

    def entry(self,parent,var=None,secret=False):
        ent=tk.Entry(parent,textvariable=var,show='●' if secret else '',bg='#0d1826',fg='white',insertbackground='white',relief='flat',font=('Segoe UI',11))
        ent.pack(fill='x',ipady=8,pady=(0,10));return ent

    def build_control(self):
        panel=self.frame('Operator / Live')
        self.text(panel,'Internet relay URL');self.entry(panel,self.relay)
        row=tk.Frame(panel,bg='#1b2838');row.pack(fill='x')
        self.text(row,'Log into the relay to trigger buttons from this application')
        frm=tk.Frame(panel,bg='#1b2838');frm.pack(fill='x')
        tk.Label(frm,text='Username',bg='#1b2838',fg='white').grid(row=0,column=0,sticky='w')
        tk.Label(frm,text='Password',bg='#1b2838',fg='white').grid(row=0,column=1,sticky='w')
        self.username=tk.Entry(frm,bg='#0d1826',fg='white',insertbackground='white');self.username.grid(row=1,column=0,sticky='ew',padx=(0,10),ipady=7)
        self.password=tk.Entry(frm,show='●',bg='#0d1826',fg='white',insertbackground='white');self.password.grid(row=1,column=1,sticky='ew',ipady=7)
        frm.columnconfigure(0,weight=1);frm.columnconfigure(1,weight=1)
        btns=tk.Frame(panel,bg='#1b2838');btns.pack(fill='x',pady=7)
        self.button(btns,'Sign in + load buttons',self.login,True)
        self.button(btns,'Refresh',self.refresh_buttons)
        self.button(btns,'Full web dashboard',self.launch_dashboard)
        tk.Label(panel,textvariable=self.login_status,bg='#1b2838',fg='#89c6a7').pack(anchor='w',pady=5)
        self.text(panel,'Show controls (double click a button to send its command)')
        self.control_list=tk.Listbox(panel,bg='#101b2a',fg='#e6eef7',selectbackground='#2a674f',font=('Segoe UI',11),bd=0,highlightthickness=0)
        self.control_list.pack(fill='both',expand=True,pady=10)
        self.control_list.bind('<Double-Button-1>',lambda event:self.run_selected())
        row=tk.Frame(panel,bg='#1b2838');row.pack(fill='x')
        self.button(row,'Send selected',self.run_selected,True)
        self.button(row,'Test selected receiver',self.test_selected)
        self.control_lookup=[]

    def build_receiver(self):
        panel=self.frame('Receiver / Inputs')
        self.text(panel,'Live Internet receiver — on this Windows PC')
        tk.Label(panel,textvariable=self.receiver_status,bg='#1b2838',fg='#80d7ae',font=('Segoe UI',16,'bold')).pack(anchor='w',pady=9)
        row=tk.Frame(panel,bg='#1b2838');row.pack(fill='x')
        self.button(row,'Start receiver',self.start_receiver,True)
        self.button(row,'Stop receiver',self.stop_receiver)
        self.button(row,'Pair this computer',self.open_pairing)
        self.text(panel,'Simulate external input (test without hardware)')
        row=tk.Frame(panel,bg='#1b2838');row.pack(fill='x')
        self.button(row,'Test input',lambda:self.send_input('test','test'))
        self.button(row,'Right Arrow',lambda:self.send_input('right','keyboard'))
        self.button(row,'Left Arrow',lambda:self.send_input('left','keyboard'))
        self.keyboard_capture=tk.BooleanVar(value=False)
        tk.Checkbutton(panel,text='Capture USB clicker keyboard inputs (system-wide)',bg='#1b2838',fg='white',
                       selectcolor='#263e52',variable=self.keyboard_capture,command=self.toggle_keyboard).pack(anchor='w',pady=8)
        self.text(panel,'Receiver monitor — incoming tests, outgoing acknowledgments and failures')
        self.receiver_log=tk.Text(panel,bg='#0b1421',fg='#c7e3df',font=('Consolas',10),bd=0,wrap='word',height=14)
        self.receiver_log.pack(fill='both',expand=True)
        self.receiver_log.configure(state='disabled')

    def build_config(self):
        panel=self.frame('Local configuration')
        self.text(panel,'Settings are stored on this receiving computer, not in GitHub.')
        self.fields={}
        for label,key in [('Approved network ranges (comma separated)','allowed_networks'),
                          ('MIDI input device name','midi_input_name'),('MIDI output device name','midi_output_name'),
                          ('Local HTTP bridge port','input_port'),('OBS WebSocket password (receiver only)','obs_password')]:
            self.text(panel,label)
            var=tk.StringVar()
            self.entry(panel,var,secret=(key=='obs_password'))
            self.fields[key]=var
        self.text(panel,'Approved local scripts — JSON mapping of script names to fixed command arrays')
        self.approved=tk.Text(panel,height=5,bg='#0d1826',fg='#e8eff7',insertbackground='white',relief='flat',font=('Consolas',10))
        self.approved.pack(fill='x',pady=5)
        row=tk.Frame(panel,bg='#1b2838');row.pack(fill='x')
        self.button(row,'Reload local configuration',self.reload_config)
        self.button(row,'Save local settings',self.save_config,True)
        self.reload_config()

    def build_logs(self):
        panel=self.frame('Activity logs')
        self.text(panel,'Local receiver and operator actions (only on this PC)')
        row=tk.Frame(panel,bg='#1b2838');row.pack(fill='x')
        self.button(row,'Save logs',self.save_logs)
        self.button(row,'Clear screen',lambda:self.clear_text(self.all_log))
        self.all_log=tk.Text(panel,bg='#0b1421',fg='#d6e6fa',font=('Consolas',10),bd=0,wrap='word')
        self.all_log.pack(fill='both',expand=True,pady=8)
        self.all_log.configure(state='disabled')

    def append_text(self,widget,s):
        widget.configure(state='normal');widget.insert('end',str(s)+'\n');widget.see('end');widget.configure(state='disabled')
    def clear_text(self,widget):
        widget.configure(state='normal');widget.delete('1.0','end');widget.configure(state='disabled')
    def log(self,s):self.events.put(('log',s))
    def poll(self):
        while True:
            try:kind,data=self.events.get_nowait()
            except queue.Empty:break
            if kind=='log':
                self.append_text(self.all_log,data)
                if 'RECEIVED' in data or 'ACK' in data or 'CONNECTED' in data or 'FAILED' in data:
                    self.append_text(self.receiver_log,data)
            if kind=='status':self.receiver_status.set('CONNECTED TO RELAY' if data.get('connected') else 'DISCONNECTED — checking/reconnecting')
            if kind=='login':self.login_status.set(data)
            if kind=='controls':
                self.control_list.delete(0,'end');self.control_lookup=[]
                for a in data.get('agents',[]):
                    for b in data.get('buttons',[]):
                        if b.get('agentId')==a['id']:
                            self.control_lookup.append(('button',b['id'],a['id']))
                            self.control_list.insert('end',('🟢' if a['online'] else '○')+'  '+a['name']+' / '+b['name'])
                    self.control_lookup.append(('test',a['id'],a['id']))
                    self.control_list.insert('end',('🟢' if a['online'] else '○')+'  '+a['name']+' / TEST CONNECTION')
                self.state=data
        self.root.after(120,self.poll)

    def ensure_relay(self):return ensure_url(self.relay.get().strip())
    def login(self):
        try:
            url=self.ensure_relay();data=get_json(url+'/api/login','POST',{'username':self.username.get(),'password':self.password.get()})
            self.session=data['token'];self.password.delete(0,'end')
            self.log('Operator logged in: '+data['username']);self.refresh_buttons()
        except Exception as exc:messagebox.showerror('Login failed',str(exc))
    def refresh_buttons(self):
        try:
            if not self.session:raise ValueError('Sign in first')
            data=get_json(self.ensure_relay()+'/api/state',token=self.session)
            self.events.put(('controls',data));self.events.put(('login','Signed in — live controls loaded'))
        except Exception as exc:self.log('Could not refresh buttons: '+str(exc))
    def run_selected(self):
        idx=self.control_list.curselection()
        if not idx:return
        kind,button_id,_=self.control_lookup[idx[0]]
        if kind=='test':return self.test_selected()
        try:
            data=get_json(self.ensure_relay()+'/api/press/'+button_id,'POST',{},self.session)
            self.log('COMMAND: '+str(data.get('message','acknowledged')))
        except Exception as exc:self.log('FAILED command: '+str(exc))
    def test_selected(self):
        idx=self.control_list.curselection()
        if not idx:return
        _,_,agent_id=self.control_lookup[idx[0]]
        try:
            data=get_json(self.ensure_relay()+f'/api/agents/{agent_id}/test','POST',{},self.session)
            self.log(f'TEST acknowledged {data.get("latencyMs","?")} ms: {data.get("message")}')
        except Exception as exc:self.log('TEST FAILED: '+str(exc))
    def launch_dashboard(self):
        try:
            url=self.ensure_relay()
            if getattr(sys,'frozen',False):
                import subprocess;subprocess.Popen([sys.executable,'--webview',url]);return
            import subprocess;subprocess.Popen([sys.executable,str(Path(__file__)),'--webview',url]);return
        except Exception as exc:
            self.log('Cannot open embedded dashboard, using browser: '+str(exc))
            webbrowser.open(self.relay.get().strip())

    def start_receiver(self):
        if self.receiver_thread and self.receiver_thread.is_alive():return self.log('Receiver is already running')
        try:cfg=load_config()
        except Exception as exc:
            messagebox.showerror('Pair receiver first',str(exc));return
        self.client=ReceiverClient(cfg,log=self.log,status=lambda **v:self.events.put(('status',v)))
        self.receiver_thread=threading.Thread(target=self.client.run,daemon=True)
        self.receiver_thread.start();self.log('Receiver started')
    def stop_receiver(self):
        if self.client:self.client.shutdown();self.client=None;self.receiver_status.set('Receiver stopped')
    def send_input(self,key,kind):
        if self.client:self.client.send_input(key,kind)
        else:self.log('Start receiver before sending an input')
    def toggle_keyboard(self):
        if self.client:self.keyboard_capture.set(self.client.keyboard_monitor(self.keyboard_capture.get()))
        else:self.keyboard_capture.set(False)
    def open_pairing(self):
        if self.client:messagebox.showinfo('Stop receiver','Stop the receiver before pairing again.');return
        from setup import pair_window
        if pair_window():self.reload_config();self.log('Receiver paired using setup wizard')
    def reload_config(self):
        try:
            data=load_config()
            for key,var in self.fields.items():
                value=data.get(key,[] if key=='allowed_networks' else '')
                var.set(', '.join(value) if isinstance(value,list) else str(value))
            self.approved.delete('1.0','end');self.approved.insert('1.0',json.dumps(data.get('approved_scripts',{}),indent=2))
            self.keyboard_capture.set(data.get('capture_keys',False))
        except Exception as exc:self.log('Config not loaded: '+str(exc))
    def save_config(self):
        try:
            if self.client:raise RuntimeError('Stop receiver before changing local settings')
            data=load_config()
            data['allowed_networks']=[v.strip() for v in self.fields['allowed_networks'].get().split(',') if v.strip()]
            data['input_port']=int(self.fields['input_port'].get())
            for key in ('midi_input_name','midi_output_name','obs_password'):data[key]=self.fields[key].get()
            scripts=json.loads(self.approved.get('1.0','end'))
            if not isinstance(scripts,dict) or not all(isinstance(k,str) and isinstance(v,list) and all(isinstance(x,str) for x in v) for k,v in scripts.items()):raise ValueError('Scripts must be JSON object: name -> array of fixed command strings')
            data['approved_scripts']=scripts
            Path(CONFIG_FILE).write_text(json.dumps(data,indent=2)+'\n',encoding='utf8')
            self.log('Local configuration saved')
        except Exception as exc:messagebox.showerror('Config not saved',str(exc))
    def save_logs(self):
        path=filedialog.asksaveasfilename(defaultextension='.txt',initialfile='JC-Clicker-Studio-Logs.txt')
        if path:Path(path).write_text(self.all_log.get('1.0','end'),encoding='utf8')
    def check_update(self):
        try:
            resp=get_json(RELEASES_URL)
            tag=resp.get('tag_name','').removeprefix('v')
            if tag and tag!=CURRENT_VERSION:self.log('Release available: '+tag+' — '+resp.get('html_url',''))
        except Exception:pass # No public release yet; do not interrupt the show.
    def close(self):
        self.stop_receiver();self.root.destroy()


if __name__=='__main__':
    if len(sys.argv)>1 and sys.argv[1]=='--webview':
        try:open_embedded(ensure_url(sys.argv[2]))
        except Exception as exc:print('Webview failed:',exc)
    else:
        root=tk.Tk();Studio(root);root.mainloop()
