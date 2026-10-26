import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../src/shared/types";
import type { CookieLoginResult } from "../electron/accounts/cookie-login";
import { FacebookBrowserAdapter } from "../electron/adapters/facebook-browser";
describe('cookie-backed group discovery lifecycle',()=>{
 const account={id:'account',browserProfilePath:'profile',headless:0,cookieManaged:1} as Account;
 beforeEach(()=>vi.clearAllMocks());
 function setup(){
  const page={goto:vi.fn().mockResolvedValue(undefined),url:()=> 'https://www.facebook.com/groups/joins/',evaluate:vi.fn().mockResolvedValue(undefined),waitForTimeout:vi.fn().mockResolvedValue(undefined),locator:()=>({evaluateAll:vi.fn().mockResolvedValue([{id:'123',name:'Group',url:'https://www.facebook.com/groups/123/',imageUrl:null}])}),close:vi.fn().mockResolvedValue(undefined)};
  const browser={newPage:vi.fn().mockResolvedValue(page),close:vi.fn().mockResolvedValue(undefined),cookies:vi.fn().mockResolvedValue([]),setDefaultTimeout:vi.fn(),on:vi.fn()};
  const verifiedPage={close:vi.fn().mockResolvedValue(undefined)};
  const cookieSession=vi.fn().mockResolvedValue({ok:true,userId:'12345',context:browser,page:verifiedPage} as unknown as CookieLoginResult);
  return{page,browser,cookieSession,adapter:new FacebookBrowserAdapter(cookieSession)};
 }
 it('uses the verified context headlessly and releases it after discovery',async()=>{
  const {page,browser,cookieSession,adapter}=setup();expect(await adapter.discoverGroups(account)).toHaveLength(1);expect(cookieSession).toHaveBeenCalledWith(expect.objectContaining({headless:1}));expect(page.close).toHaveBeenCalledTimes(1);expect(browser.close).toHaveBeenCalledTimes(1);await adapter.discoverGroups(account);expect(cookieSession).toHaveBeenCalledTimes(2);
 });
 it('closes the context if group navigation fails',async()=>{const {page,browser,adapter}=setup();page.goto.mockRejectedValueOnce(new Error('network'));await expect(adapter.discoverGroups(account)).rejects.toThrow('network');expect(browser.close).toHaveBeenCalled();});
 it('stops on rejected authentication without manual login or retry',async()=>{const {cookieSession,adapter}=setup();cookieSession.mockResolvedValue({ok:false,reason:'checkpoint_or_login_required'});await expect(adapter.discoverGroups(account)).rejects.toThrow('checkpoint_or_login_required');expect(cookieSession).toHaveBeenCalledTimes(1);});
 it('closes browser if a new tab cannot be created',async()=>{const {browser,adapter}=setup();browser.newPage.mockRejectedValueOnce(new Error('closed'));await expect(adapter.discoverGroups(account)).rejects.toThrow();expect(browser.close).toHaveBeenCalled();});
 it('refuses group discovery from a different account',async()=>{const {browser,adapter}=setup();browser.cookies.mockResolvedValue([{name:'c_user',value:'99999'}]);await expect(adapter.discoverGroups({...account,facebookUserId:'12345'})).rejects.toThrow(/ไม่ตรงบัญชี/);expect(browser.close).toHaveBeenCalledTimes(1);});
 it('blocks legacy manual sessions before calling the provider',async()=>{const {adapter,cookieSession}=setup();await expect(adapter.discoverGroups({...account,cookieManaged:0})).rejects.toThrow('cookie_required');await expect(adapter.openLogin(account)).rejects.toThrow('manual_login_disabled');expect(cookieSession).not.toHaveBeenCalled();});
});
