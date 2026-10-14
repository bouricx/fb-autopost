import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch,AsyncMock,MagicMock
from autopost.browser_manager import BrowserManager
from autopost import config as C

class BrowserTests(unittest.IsolatedAsyncioTestCase):
 async def asyncSetUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
  self.patches=[patch.object(C,'CONFIG_PATH',self.root/'config.json'),patch.object(C,'PROFILE_ROOT',self.root/'profiles'),patch.object(C,'DATA_DIR',self.root/'data'),patch.object(C,'IMAGES_DIR',self.root/'images'),patch.object(C,'IMAGES_DISCORD_DIR',self.root/'discord')]
  for p in self.patches:p.start()
  self.manager=BrowserManager();self.account=await self.manager.add('Veltshop')
 async def asyncTearDown(self):
  await self.manager.shutdown()
  for p in self.patches:p.stop()
  self.temp.cleanup()
 async def test_profile_isolation(self):
  other=await self.manager.add('Other')
  self.assertNotEqual(self.account['id'],other['id'])
  self.assertEqual([a['name'] for a in self.manager.accounts()],['Veltshop','Other'])
  with self.assertRaises(ValueError):self.manager.account('..')
 async def test_login_opens_facebook_and_never_reads_password(self):
  page=AsyncMock()
  with patch.object(self.manager,'session',new=AsyncMock(return_value=page)):
   await self.manager.login(self.account['id'])
  page.goto.assert_awaited_once_with('https://www.facebook.com/',wait_until='domcontentloaded',timeout=60000)
  page.bring_to_front.assert_awaited_once()
 async def test_session_probe_exposes_no_cookies(self):
  page=MagicMock();page.is_closed.return_value=False
  ctx=AsyncMock();ctx.cookies.return_value=[{'name':'c_user','value':'private'}]
  self.manager.sessions[self.account['id']]=(AsyncMock(),ctx,page)
  self.assertTrue(await self.manager.check(self.account['id']))
  self.assertNotIn('private',str(self.manager.accounts()))
  self.manager.sessions.clear()
 async def test_group_url_validation(self):
  for url in ['http://facebook.com/groups/123','https://facebook.com.evil.com/groups/123','https://facebook.com/groups/123/posts/45','https://user@facebook.com/groups/123']:
   with self.assertRaises(ValueError):self.manager.group_url(url)
  self.assertEqual(self.manager.group_url('https://facebook.com/groups/123'),'https://www.facebook.com/groups/123')
 async def test_failed_send_stops_without_retry(self):
  dialog=MagicMock();button=AsyncMock();button.is_enabled.return_value=True
  dialog.get_by_role.return_value.last=button
  dialog.wait_for=AsyncMock(side_effect=TimeoutError())
  with patch.object(self.manager,'prepare',new=AsyncMock(return_value=(AsyncMock(),dialog))) as prepare:
   await self.manager.start(self.account['id'],['https://facebook.com/groups/1','https://facebook.com/groups/2'],'hello',30)
   await self.manager.tasks[self.account['id']]
  self.assertEqual(prepare.await_count,1)
  self.assertEqual(button.click.await_count,1)
  self.assertIn('หยุดรอบ',self.manager.logs[-1]['message'])
 async def test_stop_prevents_next_send(self):
  dialog=MagicMock();button=AsyncMock();button.is_enabled.return_value=True
  dialog.get_by_role.return_value.last=button
  dialog.wait_for=AsyncMock()
  async def prepare(*args):
   await self.manager.stop(self.account['id'])
   return AsyncMock(),dialog
  with patch.object(self.manager,'prepare',new=prepare):
   await self.manager.start(self.account['id'],['https://facebook.com/groups/1'],'hello',30)
   await self.manager.tasks[self.account['id']]
  button.click.assert_not_awaited()
