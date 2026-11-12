"""Copy the canonical GitHub Pages client into the relay local-public directory."""
from pathlib import Path
from shutil import copy2
root=Path(__file__).resolve().parents[1]
(root/'server'/'public').mkdir(exist_ok=True)
for name in ('index.html','app.js','style.css','browser.html','browser.js'):
    copy2(root/'docs'/name,root/'server'/'public'/name)
    print('Synced server/public/'+name)
