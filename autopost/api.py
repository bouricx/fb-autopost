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

facebook = Facebook()
engine = Engine(facebook)
csrf = secrets.token_urlsafe(32)

@asynccontextmanager
async def lifespan(app):
    init()
    engine.stopped.clear()
    task = asyncio.create_task(engine.run())
    yield
    engine.stopped.set()
    await task

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
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"
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

app.mount('/assets', StaticFiles(directory=ROOT / 'ui'), name='assets')
