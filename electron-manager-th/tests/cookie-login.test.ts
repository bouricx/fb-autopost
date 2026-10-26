import { afterEach, describe, expect, it, vi } from "vitest";
import { chromium } from "playwright-core";
import { parseCookieString, hasCoreSession, toPlaywrightCookies, cookieProfileDir, loginWithCookies, injectAndClose } from "../electron/accounts/cookie-login";
afterEach(()=>vi.restoreAllMocks());
describe('raw cookie helpers',()=>{
 it('preserves equals, trims whitespace, and never decodes values',()=>{
  const map=parseCookieString(' Cookie: c_user=123456;\n xs=fixture=a%3Db; datr=fixture; ');
  expect(map.c_user).toBe('123456');expect(map.xs).toBe('fixture=a%3Db');expect(hasCoreSession(map)).toBe(true);
 });
 it('requires both core values and rejects path traversal and inherited properties',()=>{
  for(const value of ['', 'c_user=123456', 'xs=fixture','c_user=../outside; xs=fixture','c_user=123; xs='])expect(hasCoreSession(parseCookieString(value))).toBe(false);
  expect(hasCoreSession(Object.create({c_user:'123',xs:'fixture'}))).toBe(false);expect(()=>cookieProfileDir('../outside')).toThrow('invalid_cookie');
 });
 it('rejects ambiguous duplicates without echoing credential values',()=>{
  for(const raw of ['c_user=1; c_user=2; xs=PRIVATE_FIXTURE','c_user=1; malformed; xs=PRIVATE_FIXTURE','c_user=1; xs=PRIVATE_FIXTURE\u0000']){
   expect(()=>parseCookieString(raw)).toThrow('invalid_cookie');try{parseCookieString(raw);}catch(e){expect(String(e)).not.toContain('PRIVATE_FIXTURE');}
  }
 });
 it('converts only to secure Facebook cookies with core httpOnly flags',()=>{
  const cookies=toPlaywrightCookies(parseCookieString('c_user=123456; xs=fixture; locale=th_TH'));
  expect(cookies).toHaveLength(3);expect(cookies.every(c=>c.domain==='.facebook.com'&&c.path==='/'&&c.secure&&c.sameSite==='None')).toBe(true);expect(cookies.filter(c=>c.httpOnly).map(c=>c.name)).toEqual(['c_user','xs']);
 });
 it('rejects incomplete credentials before opening a browser',async()=>{
  const launch=vi.spyOn(chromium,'launchPersistentContext');expect(await loginWithCookies({cookieRaw:'c_user=123456'})).toEqual({ok:false,reason:'missing_c_user_or_xs'});expect(await loginWithCookies({cookieRaw:'malformed'})).toEqual({ok:false,reason:'invalid_cookie'});expect(launch).not.toHaveBeenCalled();
 });
 it('sanitizes launch exceptions and does not retry',async()=>{
  const launch=vi.spyOn(chromium,'launchPersistentContext').mockRejectedValue(new Error('PRIVATE_FIXTURE'));
  expect(await injectAndClose({cookieRaw:'c_user=123456; xs=fixture',userDataDir:process.env.TEMP||'/tmp'})).toEqual({ok:false,reason:'browser_unavailable'});expect(launch).toHaveBeenCalledTimes(1);
 });
});
