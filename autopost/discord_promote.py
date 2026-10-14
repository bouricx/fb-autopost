"""Optional owner-provided Discord webhook notification; not user-account automation."""
import os
import httpx
from urllib.parse import urlparse

async def notify(post_id):
    url = os.environ.get('DISCORD_WEBHOOK_URL', '')
    if not url:
        return False
    parsed = urlparse(url)
    if parsed.scheme != 'https' or parsed.hostname not in ('discord.com', 'discordapp.com') or not parsed.path.startswith('/api/webhooks/') or parsed.username or parsed.port:
        return False
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(url, json={'content': f'Facebook post published: {post_id}', 'allowed_mentions': {'parse': []}})
        return response.is_success
    except httpx.HTTPError:
        return False
