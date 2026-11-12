"""Windows user-only autostart. Does not need administrator rights."""
import os
import platform
import sys
from pathlib import Path

KEY_NAME='JCInternetClickerReceiver'


def set_autostart(enabled):
    if platform.system()!='Windows':raise RuntimeError('Autostart only available on Windows')
    import winreg
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER,r'Software\Microsoft\Windows\CurrentVersion\Run') as key:
        if not enabled:
            try:winreg.DeleteValue(key,KEY_NAME)
            except FileNotFoundError:pass
            return
        if getattr(sys,'frozen',False):
            cmd=f'"{Path(sys.executable).resolve()}"'
        else:
            script=Path(__file__).with_name('launch.py').resolve()
            cmd=f'"{Path(sys.executable).resolve()}" "{script}"'
        winreg.SetValueEx(key,KEY_NAME,0,winreg.REG_SZ,cmd)


def get_autostart():
    if platform.system()!='Windows':return False
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER,r'Software\Microsoft\Windows\CurrentVersion\Run') as key:
            winreg.QueryValueEx(key,KEY_NAME);return True
    except FileNotFoundError:return False
