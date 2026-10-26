import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { chromium, type BrowserContext } from "playwright-core";
import { loginWithCookies, injectAndClose } from "../electron/accounts/cookie-login";
let contexts: BrowserContext[]=[];let dirs: string[]=[];
afterEach(async()=>{vi.restoreAllMocks();await Promise.all(contexts.map(c=>c.close().catch(()=>undefined)));await Promise.all(dirs.map(d=>rm(d,{recursive:true,force:true,maxRetries:10,retryDelay:200})));contexts=[];dirs=[];});
async function fixture(mode:'ok'|'login'|'checkpoint'|'captcha'|'rejected'|'wrong-account'){
 const directory=await mkdtemp(join(tmpdir(),'cookie-login-fixture-'));dirs.push(directory);const launch=chromium.launchPersistentContext.bind(chromium);
 const spy=vi.spyOn(chromium,'launchPersistentContext').mockImplementation(async(dir,options)=>{
  const context=await launch(dir,{...options,...(process.env.AUTOPOST_TEST_CHROME?{executablePath:process.env.AUTOPOST_TEST_CHROME,channel:undefined}:{}),args:process.env.AUTOPOST_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[]});contexts.push(context);
  await context.addCookies([{name:'old_session',value:'fixture',domain:'.facebook.com',path:'/'}]);
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());if(url.pathname==='/'&&['login','checkpoint'].includes(mode)){await route.fulfill({contentType:'text/html',body:`<script>location.replace('/${mode}/')</script>`});return;}
   if(mode==='wrong-account')await context.addCookies([{name:'c_user',value:'654321',domain:'.facebook.com',path:'/'}]);
   const body=mode==='ok'||mode==='wrong-account'?'<button aria-label="Your profile">Account</button><a href="https://www.facebook.com/profile.php?id=123456">Fixture User</a>':mode==='captcha'?'<input name="captcha_response">':'<nav>Public navigation</nav>';
   await route.fulfill({contentType:'text/html',body});
  });return context;
 });return {directory,spy};
}
it('clears stale cookies, injects once, and returns the verified live context/page',async()=>{
 const {directory,spy}=await fixture('ok');const result=await loginWithCookies({cookieRaw:'c_user=123456; xs=fixture-only',userDataDir:directory,timeoutMs:5000});expect(result.ok).toBe(true);expect(spy).toHaveBeenCalledTimes(1);
 if(result.ok){expect(result.userId).toBe('123456');expect(result.context).toBe(contexts[0]);expect(result.page.isClosed()).toBe(false);expect((await result.context.cookies('https://www.facebook.com/')).some(c=>c.name==='old_session')).toBe(false);}
},30000);
it.each(['login','checkpoint'] as const)('stops on /%s/ and closes without retry',async mode=>{
 const {directory,spy}=await fixture(mode);expect(await loginWithCookies({cookieRaw:'c_user=123456; xs=fixture-only',userDataDir:directory,timeoutMs:5000})).toEqual({ok:false,reason:'checkpoint_or_login_required'});expect(spy).toHaveBeenCalledTimes(1);expect(contexts[0].pages()).toHaveLength(0);
},30000);
it.each(['rejected','wrong-account','captcha'] as const)('does not accept cookie presence alone when %s',async mode=>{
 const {directory}=await fixture(mode);expect(await loginWithCookies({cookieRaw:'c_user=123456; xs=fixture-only',userDataDir:directory,timeoutMs:300})).toEqual({ok:false,reason:mode==='captcha'?'checkpoint_or_login_required':'session_rejected'});expect(contexts[0].pages()).toHaveLength(0);
},30000);
it('injectAndClose releases the browser',async()=>{
 const {directory}=await fixture('ok');expect(await injectAndClose({cookieRaw:'c_user=123456; xs=fixture-only',userDataDir:directory,timeoutMs:5000})).toEqual({ok:true,userId:'123456',profileDir:directory});expect(contexts[0].pages()).toHaveLength(0);
},30000);
