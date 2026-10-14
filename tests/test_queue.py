import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
from autopost import queue_storage as storage, manager
from autopost.api import app, facebook
from autopost.fb_accounts import ensure_accounts
from autopost.config import DEFAULT_CONFIG
import copy

class QueueTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory()
  self.patch=patch.object(storage,'DATA',Path(self.temp.name));self.patch.start()
  storage.init()
 def tearDown(self):
  self.patch.stop();self.temp.cleanup();facebook.tokens.clear()
 def test_timezone_and_claim(self):
  jid=manager.create('123','Hello','','2020-01-01T07:00:00+07:00')
  job=storage.claim_due();self.assertEqual(job['id'],jid)
  self.assertEqual(job['scheduled_at'],'2020-01-01T00:00:00+00:00')
  self.assertIsNone(storage.claim_due())
  with self.assertRaises(ValueError):manager.transition(jid,'cancel')
  storage.finish(jid,'sent','123_456')
  self.assertEqual(storage.list_jobs()[0]['result_id'],'123_456')
 def test_crash_is_uncertain(self):
  manager.create('123','Hello','','2020-01-01T00:00:00Z');storage.claim_due();storage.init()
  self.assertEqual(storage.list_jobs()[0]['status'],'uncertain')
 def test_validation(self):
  for link in ['javascript:alert(1)','https://user:pass@example.com']:
   with self.assertRaises(ValueError):manager.create('123','Hello',link,'2020-01-01T00:00:00Z')
  with self.assertRaises(ValueError):manager.create('123','Hello','','2020-01-01T00:00:00')
 def test_legacy_accounts_still_work(self):
  cfg=copy.deepcopy(DEFAULT_CONFIG);ensure_accounts(cfg)
  self.assertEqual(len(cfg['fb_accounts']),1)
 def test_engine_success_and_network_uncertainty(self):
  from autopost.engine import Engine
  from autopost.page_client import PublishError
  from unittest.mock import AsyncMock
  async def run_case(error=None):
   jid=manager.create('123','Hello','','2020-01-01T00:00:00Z')
   client=type('FakeClient',(),{})()
   client.publish=AsyncMock(return_value='123_456',side_effect=error)
   engine=Engine(client)
   async def stop_after_publish(job):
    engine.stopped.set()
    if error:raise error
    return '123_456'
   client.publish.side_effect=stop_after_publish
   with patch('autopost.engine.notify',new=AsyncMock(return_value=False)):
    await engine.run()
   result=next(j for j in storage.list_jobs() if j['id']==jid)
   return result
  self.assertEqual(asyncio.run(run_case())['status'],'sent')
  self.assertEqual(asyncio.run(run_case(PublishError('Network interrupted',uncertain=True)))['status'],'uncertain')
 def test_http_queue_and_security(self):
  with TestClient(app,base_url='http://127.0.0.1:8765') as c:
   self.assertEqual(c.get('/').status_code,200)
   self.assertEqual(c.get('/assets/app.js').status_code,200)
   self.assertEqual(c.get('/api/state',headers={'host':'evil.example'}).status_code,403)
   payload={'page_id':'123','message':'Test','scheduled_at':'2099-01-01T00:00:00Z'}
   self.assertEqual(c.post('/api/jobs',json=payload).status_code,403)
   headers={'x-local-token':c.get('/api/state').json()['local_token']}
   facebook.tokens['123']={'name':'Test','token':'mock-token'}
   r=c.post('/api/jobs',json=payload,headers=headers);self.assertEqual(r.status_code,200)
   jid=r.json()['id'];payload['message']='Edited'
   self.assertEqual(c.put('/api/jobs/'+jid,json=payload,headers=headers).status_code,200)
   self.assertEqual(c.post('/api/jobs/'+jid+'/cancel',headers=headers).status_code,200)
   state=c.get('/api/state').json()
   self.assertNotIn('mock-token',str(state))
   self.assertEqual(state['jobs'][0]['status'],'cancelled')

if __name__=='__main__':unittest.main()
