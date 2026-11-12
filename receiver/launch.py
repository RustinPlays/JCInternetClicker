"""Bundled receiver executable first-runs pairing, then opens monitor."""
from pathlib import Path
import sys
from receiver import CONFIG_FILE
from setup import pair_window
from monitor import Monitor
import tkinter as tk

if __name__=='__main__':
    if not Path(CONFIG_FILE).is_file() and not pair_window():sys.exit(1)
    root=tk.Tk()
    Monitor(root)
    root.mainloop()
