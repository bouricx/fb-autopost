"""Metadata shown by the signed-in Facebook group list; no private API calls."""
from pathlib import Path
from urllib.parse import urlparse
import re

EXTRACT_GROUPS = Path(__file__).with_suffix('.js').read_text(encoding='utf-8')
RESERVED = {'joins', 'feed', 'discover', 'create', 'notifications', 'search', 'your_groups'}


def normalize_group(row):
    try:
        parsed = urlparse(str(row.get('url', '')))
        match = re.fullmatch(r'/groups/([A-Za-z0-9_.-]+)/?', parsed.path)
        if parsed.scheme != 'https' or parsed.hostname not in ('facebook.com', 'www.facebook.com') or parsed.username or parsed.port:
            return None
        if not match or match[1] in RESERVED:
            return None
        name = ' '.join(str(row.get('name', '')).split())[:180]
        if not name:
            return None
        image = str(row.get('image_url', ''))[:4096]
        photo = urlparse(image)
        host = photo.hostname or ''
        allowed = any(host == domain or host.endswith('.' + domain) for domain in ('fbcdn.net', 'fbsbx.com'))
        if photo.scheme != 'https' or not allowed or photo.username or photo.port:
            image = ''
        return {'url': f'https://www.facebook.com/groups/{match[1]}/', 'name': name, 'image_url': image}
    except (ValueError, TypeError, AttributeError):
        return None
