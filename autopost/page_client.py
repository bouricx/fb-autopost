import asyncio
import re
import httpx
from .runtime_config import VERSION

class PublishError(Exception):
    def __init__(self, text, uncertain=False):
        super().__init__(text)
        self.uncertain = uncertain

class Facebook:
    def __init__(self):
        self.candidates = {}
        self.tokens = {}  # Memory only. Tokens are never returned to the UI or database.
        self.lock = asyncio.Lock()

    async def connect(self, page_id, token):
        if not page_id.isdigit() or not token.strip():
            raise ValueError('Page ID must be numeric and a token is required.')
        if not re.fullmatch(r'v\d+\.\d+', VERSION):
            raise ValueError('Invalid FB_GRAPH_VERSION.')
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(f'https://graph.facebook.com/{VERSION}/{page_id}',
                params={'fields': 'id,name'}, headers={'Authorization': 'Bearer ' + token.strip()})
        data = self._response(response)
        if str(data.get('id')) != page_id:
            raise ValueError('Token did not return the requested Page.')
        self.tokens[page_id] = {'token': token.strip(), 'name': data.get('name', page_id)}
        return {'id': page_id, 'name': self.tokens[page_id]['name']}

    async def discover(self, token):
        # Use cursor values rather than provider next URLs containing tokens.
        pages = []
        after = None
        async with httpx.AsyncClient(timeout=30) as client:
            for _ in range(10):
                params = {'fields': 'id,name,access_token,tasks', 'limit': 100}
                if after:
                    params['after'] = after
                response = await client.get(f'https://graph.facebook.com/{VERSION}/me/accounts',
                    params=params, headers={'Authorization': 'Bearer ' + token.strip()})
                data = self._response(response)
                for row in data.get('data', []):
                    pid = str(row.get('id', ''))
                    if pid.isdigit() and row.get('access_token'):
                        self.candidates[pid] = {'token': row['access_token'], 'name': row.get('name', pid)}
                        pages.append({'id': pid, 'name': row.get('name', pid)})
                after = data.get('paging', {}).get('cursors', {}).get('after')
                if not data.get('paging', {}).get('next') or not after:
                    break
        return pages

    @staticmethod
    def _response(response):
        try:
            data = response.json()
        except ValueError:
            raise PublishError('Facebook returned an unreadable response.', uncertain=response.is_success)
        if not response.is_success or 'error' in data:
            err = data.get('error', {})
            # Avoid logging provider text that could contain secrets.
            raise PublishError(f"Facebook rejected request (HTTP {response.status_code}, code {err.get('code', 'unknown')}). Check token and Page permissions.")
        return data

    async def publish(self, job):
        account = self.tokens.get(job['page_id'])
        if not account:
            raise PublishError('Page is disconnected. Reconnect it and retry this job.')
        payload = {'message': job['message']}
        if job['link']:
            payload['link'] = job['link']
        try:
            async with self.lock:
                async with httpx.AsyncClient(timeout=45) as client:
                    response = await client.post(f"https://graph.facebook.com/{VERSION}/{job['page_id']}/feed",
                        data=payload, headers={'Authorization': 'Bearer ' + account['token']})
        except httpx.HTTPError:
            raise PublishError('Network interrupted. Check the Page before retrying.', uncertain=True)
        data = self._response(response)
        if not data.get('id'):
            raise PublishError('No post ID returned. Check the Page before retrying.', uncertain=True)
        return str(data['id'])
