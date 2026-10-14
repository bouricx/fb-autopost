import asyncio
import secrets
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from .runtime_config import ROOT, PORT
from .queue_storage import init, list_jobs
from .page_client import Facebook, PublishError
from .engine import Engine
from . import manager
from .queue_importer import parse

from .browser_manager import BrowserManager
from .group_metadata import normalize_group
from . import config as legacy_config, storage as legacy_storage
browsers = BrowserManager()

facebook = Facebook()
engine = Engine(facebook)
csrf = secrets.token_urlsafe(32)

@asynccontextmanager
async def lifespan(app):
    init()
    engine.stopped = asyncio.Event()
    task = asyncio.create_task(engine.run())
    yield
    engine.stopped.set()
    await task
    await browsers.shutdown()

app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

@app.middleware('http')
async def local_only(request: Request, call_next):
    # DNS rebinding and cross-site POST protection for the loopback service.
    if request.headers.get('host') not in (f'127.0.0.1:{PORT}', f'localhost:{PORT}'):
        return JSONResponse({'detail': 'Invalid host'}, status_code=403)
    if request.method not in ('GET', 'HEAD'):
        if not secrets.compare_digest(request.headers.get('x-local-token', ''), csrf):
            return JSONResponse({'detail': 'Reload this app to refresh its local token.'}, status_code=403)
    response = await call_next(request)
    response.headers['Cache-Control'] = 'no-store'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' https://*.fbcdn.net https://*.fbsbx.com; frame-ancestors 'none'; base-uri 'none'"
    return response

class Account(BaseModel):
    page_id: str = Field(max_length=40)
    token: str = Field(min_length=1, max_length=4096)

class Job(BaseModel):
    page_id: str = Field(max_length=40)
    message: str = Field(min_length=1, max_length=10000)
    link: str = Field(default='', max_length=2048)
    scheduled_at: str = Field(max_length=80)

class Import(BaseModel):
    text: str = Field(max_length=200000)

@app.get('/', response_class=HTMLResponse)
def home():
    return (ROOT / 'ui/index.html').read_text(encoding='utf-8')

@app.get('/api/state')
def state():
    return {'local_token': csrf, 'jobs': list_jobs(), 'pages': [{'id': key, 'name': value['name']} for key, value in facebook.tokens.items()]}

@app.post('/api/pages')
async def connect(body: Account):
    try:
        return await facebook.connect(body.page_id, body.token)
    except (ValueError, PublishError):
        raise HTTPException(400, 'Connection failed. Check Page ID, token, permissions and Graph API version.')
    except Exception:
        raise HTTPException(502, 'Facebook connection unavailable.')

class Discovery(BaseModel):
    token: str = Field(min_length=1, max_length=4096)

@app.post('/api/discover')
async def discover(body: Discovery):
    facebook.candidates.clear()
    try:
        return {'pages': await facebook.discover(body.token)}
    except Exception:
        facebook.candidates.clear()
        raise HTTPException(400, 'ค้นหาเพจไม่สำเร็จ ตรวจ User Access Token และสิทธิ์ pages_show_list')

@app.post('/api/select/{page_id}')
async def select_page(page_id: str):
    row = facebook.candidates.get(page_id)
    if not row:
        raise HTTPException(400, 'ค้นหาเพจใหม่ก่อนเลือก')
    try:
        return await facebook.connect(page_id, row['token'])
    except Exception:
        raise HTTPException(400, 'เชื่อมต่อเพจไม่สำเร็จ ตรวจสิทธิ์เพจ')

@app.delete('/api/pages/{page_id}')
def disconnect(page_id: str):
    facebook.tokens.pop(page_id, None)
    return {'ok': True}

@app.post('/api/jobs')
def create(body: Job):
    if body.page_id not in facebook.tokens:
        raise HTTPException(400, 'Connect this Page first.')
    try:
        return {'id': manager.create(**body.model_dump())}
    except ValueError as exc:
        raise HTTPException(400, str(exc))

@app.put('/api/jobs/{job_id}')
def update(job_id: str, body: Job):
    try:
        manager.update(job_id, **body.model_dump())
        return {'ok': True}
    except ValueError as exc:
        raise HTTPException(400, str(exc))

@app.post('/api/jobs/{job_id}/{action}')
def transition(job_id: str, action: str):
    try:
        manager.transition(job_id, action)
        return {'ok': True}
    except ValueError as exc:
        raise HTTPException(400, str(exc))

@app.post('/api/import')
def import_jobs(body: Import):
    try:
        rows = parse(body.text)
        if any(row['page_id'] not in facebook.tokens for row in rows):
            raise ValueError('Connect all imported Pages first.')
        return {'ids': [manager.create(**row) for row in rows]}
    except ValueError as exc:
        raise HTTPException(400, str(exc))

class BrowserAccount(BaseModel):
    name: str = Field(min_length=1,max_length=80)
class BrowserPost(BaseModel):
    account_id: str = Field(max_length=80)
    urls: list[str] = Field(min_length=1,max_length=20)
    message: str = Field(min_length=1,max_length=10000)
    delay: int = Field(default=60,ge=30,le=3600)

@app.get('/api/browser/state')
def browser_state():
    return {'accounts':browsers.accounts(),'logs':browsers.logs}

@app.post('/api/browser/accounts')
async def browser_add(body: BrowserAccount):
    return await browsers.add(body.name)

@app.get('/api/browser/groups/{aid}')
def saved_groups(aid: str):
    try:browsers.account(aid)
    except ValueError as exc:raise HTTPException(400,str(exc))
    data=legacy_storage.read_joined_groups(aid)
    data['groups']=[row for raw in data['groups'] if (row:=normalize_group(raw))]
    return data

@app.post('/api/browser/accounts/{aid}/{action}')
async def browser_action(aid: str,action: str):
    try:
        browsers.account(aid)
        if action=='login':await browsers.login(aid)
        elif action=='check':return {'logged_in':await browsers.check(aid)}
        elif action=='groups':return {'groups':await browsers.groups(aid)}
        elif action=='stop':await browsers.stop(aid)
        elif action=='close':await browsers.close(aid)
        else:raise ValueError('ไม่รู้จักคำสั่ง')
        return {'ok':True}
    except ValueError as exc:raise HTTPException(400,str(exc))
    except Exception:raise HTTPException(400,'ทำรายการไม่สำเร็จ ตรวจ Chrome และหน้า Facebook แล้วลองใหม่')

@app.post('/api/browser/post/{mode}')
async def browser_post(mode: str,body: BrowserPost):
    try:
        if mode=='draft':await browsers.draft(body.account_id,body.urls[0],body.message)
        elif mode=='start':await browsers.start(body.account_id,body.urls,body.message,body.delay)
        else:raise ValueError('ไม่รู้จักโหมด')
        return {'ok':True}
    except ValueError as exc:raise HTTPException(400,str(exc))
    except Exception:raise HTTPException(400,'เตรียมโพสต์ไม่สำเร็จ ตรวจ Facebook หรือหน้าสร้างโพสต์')

app.mount('/assets', StaticFiles(directory=ROOT / 'ui'), name='assets')
