"""Atomic per-account message profiles and group assignments."""
import json
import os
import secrets
import tempfile
from .storage import account_dir

def load(aid):
    path = account_dir(aid) / 'message_profiles.json'
    if not path.exists():
        return {'profiles': [], 'assignments': {}}
    return json.loads(path.read_text(encoding='utf-8'))

def save(aid, data):
    path = account_dir(aid) / 'message_profiles.json'
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(data, stream, ensure_ascii=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)

def create(aid, name, message):
    name, message = name.strip(), message.strip()
    if not name or not message:
        raise ValueError('กรอกชื่อและข้อความโปรไฟล์')
    data = load(aid)
    row = {'id': secrets.token_hex(8), 'name': name, 'message': message}
    data['profiles'].append(row)
    save(aid, data)
    return row

def assign(aid, urls, profile_id):
    data = load(aid)
    if profile_id and not any(p['id'] == profile_id for p in data['profiles']):
        raise ValueError('ไม่พบโปรไฟล์ข้อความ')
    for url in urls:
        if profile_id: data['assignments'][url] = profile_id
        else: data['assignments'].pop(url, None)
    save(aid, data)

def resolve(aid, urls, default):
    data = load(aid)
    profiles = {p['id']: p['message'] for p in data['profiles']}
    return {url: profiles.get(data['assignments'].get(url), default) for url in urls}
