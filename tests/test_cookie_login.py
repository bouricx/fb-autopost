import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch
from autopost.cookie_login import parse_cookie_string, has_core_session, to_playwright_cookies, cookie_profile_dir, login_with_cookies
from autopost.cookie_vault import CookieVault

class CookieUnitTests(unittest.TestCase):
    def test_raw_and_safe_validation(self):
        data=parse_cookie_string(' Cookie: c_user=123456;\n xs=fixture=a%3Db; ')
        self.assertEqual(data['xs'],'fixture=a%3Db');self.assertTrue(has_core_session(data))
        for raw in ['', 'c_user=123456', 'xs=fixture', 'c_user=../outside; xs=fixture']:
            self.assertFalse(has_core_session(parse_cookie_string(raw)))
        for raw in ['malformed; xs=PRIVATE_FIXTURE','c_user=1; c_user=2; xs=PRIVATE_FIXTURE']:
            with self.assertRaisesRegex(ValueError,'^invalid_cookie$'):parse_cookie_string(raw)
        with self.assertRaises(ValueError):cookie_profile_dir('../outside')
        rows=to_playwright_cookies(data)
        self.assertTrue(all(c['secure'] and c['domain']=='.facebook.com' and c['httpOnly'] for c in rows))
    def test_profile_location(self):
        with patch.dict(os.environ,{'LOCALAPPDATA':str(Path(tempfile.gettempdir())/'fixture-local')}):
            self.assertEqual(cookie_profile_dir('123456'),Path(os.environ['LOCALAPPDATA'])/'FB-AutoPost'/'cookie-profiles'/'123456')
    @unittest.skipUnless(os.name=='nt','Windows DPAPI only')
    def test_dpapi_roundtrip_never_stores_plaintext(self):
        with tempfile.TemporaryDirectory() as tmp:
            vault=CookieVault(Path(tmp));raw='c_user=123456; xs=fixture-only'
            vault.store('123456',raw)
            self.assertNotIn(b'fixture-only',(Path(tmp)/'123456.bin').read_bytes())
            self.assertEqual(vault.load('123456'),raw)
    @unittest.skipIf(os.name=='nt','Non-Windows fail-closed test')
    def test_no_plaintext_fallback(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(ValueError,'secure_storage_unavailable'):CookieVault(Path(tmp)).store('123456','fixture-only')
            self.assertEqual(list(Path(tmp).iterdir()),[])

class CookieLocalIntegration(unittest.IsolatedAsyncioTestCase):
    def fixture(self,url='https://www.facebook.com/',valid=True):
        page=MagicMock();page.url=url;page.goto=AsyncMock();page.get_by_role.return_value.first.wait_for=AsyncMock();page.get_by_role.return_value.first.is_visible=AsyncMock(return_value=valid)
        page.locator.return_value.first.is_visible=AsyncMock(return_value=False);page.locator.return_value.all_text_contents=AsyncMock(return_value=[])
        ctx=AsyncMock();ctx.new_page.return_value=page;ctx.cookies.return_value=[{'name':'c_user','value':'123456'},{'name':'xs','value':'fixture-only'}]
        pw=MagicMock();pw.chromium.launch_persistent_context=AsyncMock(return_value=ctx);pw.stop=AsyncMock();factory=MagicMock();factory.return_value.start=AsyncMock(return_value=pw)
        return page,ctx,pw,factory
    async def test_inject_verifies_and_returns_owned_context(self):
        page,ctx,pw,factory=self.fixture()
        with tempfile.TemporaryDirectory() as tmp,patch('autopost.cookie_login.async_playwright',factory):
            result=await login_with_cookies('c_user=123456; xs=fixture-only',user_data_dir=Path(tmp))
            self.assertTrue(result.ok);self.assertIs(result.context,ctx);self.assertIs(result.page,page)
            ctx.clear_cookies.assert_awaited_once();ctx.add_cookies.assert_awaited_once();ctx.close.assert_not_awaited()
            self.assertLess([c[0] for c in ctx.mock_calls].index('clear_cookies'),[c[0] for c in ctx.mock_calls].index('add_cookies'))
            await result.close();ctx.close.assert_awaited_once();pw.stop.assert_awaited_once()
    async def test_checkpoint_login_and_rejection_close_without_retry(self):
        for url,valid,reason in [('https://www.facebook.com/checkpoint/',True,'checkpoint_or_login_required'),('https://www.facebook.com/login/',True,'checkpoint_or_login_required'),('https://www.facebook.com/',False,'session_rejected')]:
            with self.subTest(url=url):
                page,ctx,pw,factory=self.fixture(url,valid)
                with tempfile.TemporaryDirectory() as tmp,patch('autopost.cookie_login.async_playwright',factory):
                    result=await login_with_cookies('c_user=123456; xs=fixture-only',user_data_dir=Path(tmp))
                self.assertFalse(result.ok);self.assertEqual(result.reason,reason);ctx.close.assert_awaited_once();pw.stop.assert_awaited_once();pw.chromium.launch_persistent_context.assert_awaited_once()
    async def test_missing_core_does_not_start_browser(self):
        with patch('autopost.cookie_login.async_playwright') as launch:
            result=await login_with_cookies('c_user=123456')
            self.assertEqual(result.reason,'missing_c_user_or_xs');launch.assert_not_called()
