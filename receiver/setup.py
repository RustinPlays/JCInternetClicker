"""One-time pairing screen. Uses an expiring code; receiver secret is saved locally."""
import json
import sys
from pathlib import Path
import tkinter as tk
from tkinter import messagebox
from urllib.parse import urlparse
from urllib import request, error

from receiver import CONFIG_FILE

BASE=Path(__file__).resolve().parent
_candidates=[BASE/'config.example.json',BASE/'receiver'/'config.example.json']
if hasattr(sys,'_MEIPASS'):_candidates.append(Path(sys._MEIPASS)/'receiver'/'config.example.json')
_template=next((p for p in _candidates if p.exists()),None)
if _template is None:raise RuntimeError('Receiver template missing from the app bundle')
DEFAULT=json.loads(_template.read_text(encoding='utf-8'))


def is_valid_relay(value):
    u=urlparse(value)
    return bool(u.hostname and (u.scheme=='https' or (u.scheme=='http' and u.hostname in ('127.0.0.1','localhost','::1')))
                 and u.username is None and u.password is None and u.path in ('','/'))


def exchange_code(relay, code):
    payload=json.dumps({'code':code.strip().upper()}).encode()
    req=request.Request(relay.rstrip('/')+'/api/pair-exchange',data=payload,
                        headers={'Content-Type':'application/json'},method='POST')
    try:
        with request.urlopen(req,timeout=10) as resp:
            data=json.load(resp)
        return {'receiver_id':data['receiver_id'],'receiver_key':data['receiver_key']}
    except error.HTTPError as exc:
        try:detail=json.load(exc).get('error','Unknown error')
        except Exception:detail=str(exc)
        raise RuntimeError('Pairing failed: '+detail) from exc


def pair_window():
    root=tk.Tk();root.title('JC Clicker — Pair Receiver');root.geometry('590x575');root.resizable(False,False);root.configure(bg='#111824')
    panel=tk.Frame(root,bg='#111824',padx=26,pady=22);panel.pack(fill='both',expand=True)
    def label(text):tk.Label(panel,text=text,bg='#111824',fg='#cddae9',font=('Segoe UI',10),anchor='w').pack(anchor='w',pady=(7,3))
    def field(secret=False):
        e=tk.Entry(panel,bg='#203045',fg='white',insertbackground='white',show='●' if secret else '',relief='flat',font=('Segoe UI',11));e.pack(fill='x',ipady=9);return e
    tk.Label(panel,text='JC INTERNET CLICKER',bg='#111824',fg='#e7f1fd',font=('Segoe UI',18,'bold')).pack(anchor='w')
    tk.Label(panel,text='PAIR THIS WINDOWS RECEIVER',bg='#111824',fg='#72abc8',font=('Segoe UI',10,'bold')).pack(anchor='w')
    tk.Label(panel,text='1. On the website, create a receiver. 2. Press Pair with code. 3. Enter it here.',bg='#111824',fg='#b3c2d1',wraplength=520,justify='left').pack(anchor='w',pady=(12,8))
    label('Internet relay URL (HTTPS, or localhost for test)');relay=field();relay.insert(0,'http://127.0.0.1:8787')
    label('Short pairing code (expires after 10 minutes)');code=field()
    tk.Label(panel,text='OR enter the permanent receiver details below',bg='#111824',fg='#87b5cb').pack(anchor='w',pady=(14,3))
    label('Receiver ID');receiver_id=field()
    label('Receiver private key');key=field(secret=True)
    status=tk.Label(panel,text='',bg='#111824',fg='#e6c36a',wraplength=525,justify='left');status.pack(anchor='w',pady=10)
    result={'success':False}
    def save():
        url=relay.get().strip().rstrip('/')
        try:
            if not is_valid_relay(url):raise ValueError('Enter HTTPS relay URL, or localhost for local testing')
            pair={}
            if code.get().strip():
                status.config(text='Pairing…');root.update_idletasks()
                pair=exchange_code(url,code.get())
            else:
                pair={'receiver_id':receiver_id.get().strip(),'receiver_key':key.get().strip()}
            if not pair['receiver_id'] or len(pair['receiver_key'])<32:raise ValueError('Enter receiver ID + private key, or a short pairing code')
            existing={}
            config=Path(CONFIG_FILE)
            if config.exists():existing=json.loads(config.read_text(encoding='utf8'))
            data={**DEFAULT,**existing,'server_url':url,**pair}
            config.parent.mkdir(parents=True,exist_ok=True)
            config.write_text(json.dumps(data,indent=2)+'\n',encoding='utf8')
            status.config(text='Receiver paired successfully')
            result['success']=True;messagebox.showinfo('Connected','Receiver saved. You can now run the monitor.');root.destroy()
        except Exception as exc:
            status.config(text=str(exc));messagebox.showerror('Pairing unsuccessful',str(exc))
    tk.Button(panel,text='PAIR & SAVE RECEIVER',command=save,bg='#2c765e',fg='white',relief='flat',padx=18,pady=10,font=('Segoe UI',10,'bold')).pack(anchor='e',pady=10)
    root.mainloop()
    return result['success']

if __name__=='__main__':pair_window()
