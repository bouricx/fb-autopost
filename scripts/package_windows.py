"""Package the current source with an existing Windows embedded-Python bundle.
Example:
  zig cc -target x86_64-windows-gnu -municode -Wl,--subsystem,windows -O2 sfx.c -o sfx-base.exe
  python scripts/package_windows.py --bundle-root /path/FB-AutoPost --launcher sfx-base.exe
The bundle must contain runtime/python.exe, installed Windows wheels and the
inner FB-AutoPost.exe launcher. No installed account data is copied into releases.
"""
import argparse
import hashlib
import io
from pathlib import Path
import shutil
import struct
import zipfile

p=argparse.ArgumentParser()
p.add_argument('--bundle-root',type=Path,required=True)
p.add_argument('--launcher',type=Path,required=True)
args=p.parse_args()
source=Path(__file__).resolve().parents[1]
root=args.bundle_root.resolve()
assert (root/'runtime/python.exe').is_file()
assert (root/'FB-AutoPost.exe').is_file()
assert (root/'runtime/Lib/site-packages/playwright/driver/node.exe').is_file()
for folder in ('autopost','ui','tests','scripts'):
    target=root/'app'/folder
    if target.exists():shutil.rmtree(target)
    shutil.copytree(source/folder,target,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
for name in ('main.py','requirements.txt','requirements-legacy.txt','run.bat','README.md','README-original.md','launcher.c','sfx.c'):
    shutil.copy2(source/name,root/'app'/name)
(root/'READ-ME-FIRST.txt').write_bytes((source/'README.md').read_bytes())
output=source/'downloads'
output.mkdir(exist_ok=True)
archive=output/'FB-AutoPost-Windows-x64.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
    for file in sorted(root.rglob('*')):
        if not file.is_file():continue
        rel=file.relative_to(root)
        if any(part in ('__pycache__','data','fb_profile','.git','.venv') for part in rel.parts):continue
        if file.name in ('config.json','cookies.json') or file.suffix in ('.sqlite3','.db','.pyc'):continue
        z.write(file,Path('FB-AutoPost')/rel)
blob=archive.read_bytes()
launcher=args.launcher.read_bytes()
assert launcher[:2]==b'MZ'
exe=output/'FB-AutoPost-Setup.exe'
exe.write_bytes(launcher+blob+struct.pack('<Q',len(blob)))
with zipfile.ZipFile(io.BytesIO(blob)) as z:
    assert z.testzip() is None
    assert 'FB-AutoPost/app/autopost/group_metadata.js' in z.namelist()
assert exe.stat().st_size<100*1024*1024
(output/'SHA256SUMS.txt').write_text(''.join(f'{hashlib.sha256(f.read_bytes()).hexdigest()}  {f.name}\n' for f in (exe,archive)))
print(f'EXE ready: {exe.stat().st_size:,} bytes; ZIP payload verified')
