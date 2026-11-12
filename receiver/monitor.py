"""JC Internet Clicker receiver: small visible local monitor window."""
import json
import queue
import threading
import tkinter as tk
from tkinter import ttk, messagebox
from pathlib import Path

from receiver import load_config, ReceiverClient, CONFIG_FILE
from autostart import set_autostart, get_autostart


class Monitor:
    def __init__(self, root):
        self.root=root
        root.title('JC Internet Clicker — Receiver Monitor')
        root.geometry('780x570')
        root.minsize(560,450)
        root.configure(bg='#111824')
        self.events=queue.Queue()
        self.connection=tk.StringVar(value='CONNECTING')
        self.count=tk.StringVar(value='0 signals received/sent')
        self.number=0
        self.cfg=load_config()
        self.client=ReceiverClient(self.cfg,log=lambda s:self.events.put(('log',s)),
                                   status=lambda **kw:self.events.put(('status',kw)))
        panel=tk.Frame(root,bg='#111824',padx=20,pady=15)
        panel.pack(fill='both',expand=True)
        tk.Label(panel,text='JC  /  INTERNET CLICKER',fg='#c7d9f9',bg='#111824',font=('Segoe UI',17,'bold')).pack(anchor='w')
        tk.Label(panel,text='REMOTE RECEIVER   •   Keep this running on the slave PC',fg='#a4b0c2',bg='#111824',font=('Segoe UI',10)).pack(anchor='w',pady=(0,16))
        status=tk.Frame(panel,bg='#202d3d',padx=15,pady=12)
        status.pack(fill='x')
        tk.Label(status,textvariable=self.connection,fg='#93b7ff',bg='#202d3d',font=('Segoe UI',17,'bold')).pack(anchor='w')
        tk.Label(status,textvariable=self.count,fg='#c5d3e3',bg='#202d3d',font=('Segoe UI',10)).pack(anchor='w')
        tk.Label(panel,text='Test receiver and inputs',fg='white',bg='#111824',font=('Segoe UI',11,'bold')).pack(anchor='w',pady=(16,8))
        actions=tk.Frame(panel,bg='#111824')
        actions.pack(fill='x')
        for label,command in [('SEND TEST INPUT',lambda:self.client.send_input('test',kind='test')),
                              ('SIMULATE RIGHT',lambda:self.client.send_input('right',kind='keyboard')),
                              ('SIMULATE LEFT',lambda:self.client.send_input('left',kind='keyboard'))]:
            tk.Button(actions,text=label,command=command,bg='#275783',fg='white',
                      activebackground='#3d76a5',font=('Segoe UI',9,'bold'),padx=12,pady=8,
                      relief='flat').pack(side='left',padx=(0,8),pady=(0,8))
        self.autostart=tk.BooleanVar(value=get_autostart())
        tk.Checkbutton(panel,text='Start receiver automatically with Windows',variable=self.autostart,
                       command=self.switch_autostart,bg='#111824',fg='#d8e4ef',selectcolor='#1c3448',
                       activebackground='#111824',font=('Segoe UI',10)).pack(anchor='w',pady=(0,4))
        self.monitorKeys=tk.BooleanVar(value=bool(self.cfg.get('capture_keys',False)))
        tk.Checkbutton(panel,text='Detect USB clicker / keyboard keys (global — use on sending PC)',
                       variable=self.monitorKeys,command=self.switch_input, bg='#111824',fg='#d8e4ef',
                       selectcolor='#1c3448',activebackground='#111824',activeforeground='white',
                       font=('Segoe UI',10)).pack(anchor='w',pady=(4,10))
        self.monitorMidi=tk.BooleanVar(value=bool(self.cfg.get('capture_midi',False)))
        tk.Checkbutton(panel,text='Detect MIDI input from configured device',variable=self.monitorMidi,
                       command=self.switch_midi,bg='#111824',fg='#d8e4ef',selectcolor='#1c3448',
                       activebackground='#111824',font=('Segoe UI',10)).pack(anchor='w',pady=(0,5))
        tk.Label(panel,text='Incoming and outgoing signals (newest at bottom)' ,fg='white',
                 bg='#111824',font=('Segoe UI',11,'bold')).pack(anchor='w',pady=(4,6))
        logs_frame=tk.Frame(panel,bg='#111824')
        logs_frame.pack(fill='both',expand=True)
        self.logs=tk.Text(logs_frame,wrap='word',bg='#0c1119',fg='#d7f0e5',font=('Consolas',10),
                          borderwidth=0,padx=12,pady=10,state='disabled')
        scrollbar=ttk.Scrollbar(logs_frame,orient='vertical',command=self.logs.yview)
        scrollbar.pack(side='right',fill='y')
        self.logs.configure(yscrollcommand=scrollbar.set)
        self.logs.pack(side='left',fill='both',expand=True)
        tk.Label(panel,text=f'Input bridge: 127.0.0.1:{self.cfg["input_port"]}  |  Relay: {self.cfg["server_url"]}',
                 fg='#91a8c0',bg='#111824',font=('Segoe UI',9)).pack(anchor='w',pady=(10,0))
        self.worker=threading.Thread(target=self.connect,daemon=True)
        self.worker.start()
        self.tray=None
        root.protocol('WM_DELETE_WINDOW',self.hide_to_tray)
        self.prepare_tray()
        root.after(100,self.poll)

    def connect(self):
        try:self.client.run()
        except Exception as exc:self.events.put(('log','STARTUP ERROR: '+str(exc)))

    def switch_autostart(self):
        try:set_autostart(self.autostart.get())
        except Exception as exc:messagebox.showerror('Autostart',str(exc));self.autostart.set(get_autostart())

    def switch_input(self):
        enabled=self.client.keyboard_monitor(self.monitorKeys.get())
        self.monitorKeys.set(enabled)
        self.cfg['capture_keys']=enabled
        try:
            Path(CONFIG_FILE).write_text(json.dumps(self.cfg,indent=2)+'\n',encoding='utf-8')
        except Exception as exc:
            messagebox.showerror('Cannot save setting',str(exc))

    def switch_midi(self):
        enabled=self.client.midi_monitor(self.monitorMidi.get())
        self.monitorMidi.set(enabled)
        self.cfg['capture_midi']=enabled
        Path(CONFIG_FILE).write_text(json.dumps(self.cfg,indent=2)+'\n',encoding='utf-8')

    def poll(self):
        while True:
            try:kind, value=self.events.get_nowait()
            except queue.Empty:break
            if kind=='status':
                self.connection.set('CONNECTED  ●' if value.get('connected') else 'DISCONNECTED  ○')
            else:
                self.logs.configure(state='normal')
                self.logs.insert('end',value+'\n')
                self.logs.see('end')
                self.logs.configure(state='disabled')
                if 'RECEIVED' in value or 'INPUT SENT' in value or 'ACK SENT' in value:
                    self.number+=1
                    self.count.set(f'{self.number} signal events logged')
        self.root.after(100,self.poll)

    def prepare_tray(self):
        try:
            import pystray
            from PIL import Image, ImageDraw
            img=Image.new('RGB',(64,64),'#152335')
            draw=ImageDraw.Draw(img);draw.rounded_rectangle((8,8,56,56),radius=12,fill='#2b765d')
            draw.text((19,21),'JC',fill='white')
            menu=pystray.Menu(pystray.MenuItem('Show receiver',lambda icon,item:self.root.after(0,self.restore)),
                              pystray.MenuItem('Quit receiver',lambda icon,item:self.root.after(0,self.close)))
            self.tray=pystray.Icon('jc-clicker',img,'JC Internet Clicker — Receiver',menu)
            threading.Thread(target=self.tray.run,daemon=True).start()
        except ImportError:
            self.tray=None

    def restore(self):
        self.root.deiconify();self.root.lift()

    def hide_to_tray(self):
        if self.tray:self.root.withdraw()
        else:self.close()

    def close(self):
        self.client.shutdown()
        if self.tray:self.tray.stop()
        self.root.destroy()


if __name__=='__main__':
    root=tk.Tk()
    try:Monitor(root);root.mainloop()
    except Exception as exc:
        messagebox.showerror('JC Receiver failed to start',str(exc))
        root.destroy()
