import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { chromium, type Browser, type Page } from "playwright-core";
import { FacebookActions } from "../electron/automation/facebook-actions";
import { isPendingApprovalDetected } from "../electron/automation/pending-approval";
import { actionPayloadSchema } from "../electron/automation/contracts";
import type { FacebookBrowserAdapter } from "../electron/adapters/facebook-browser";
import type { Account } from "../src/shared/types";
let browser: Browser;
beforeAll(async () => { browser=await chromium.launch({...(process.env.AUTOPOST_TEST_CHROME ? {executablePath:process.env.AUTOPOST_TEST_CHROME}:{channel:'chrome'}),headless:true,args:process.env.AUTOPOST_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[]}); },30000);
afterAll(async()=>{await browser?.close();});
const account={id:'fixture',name:'Local account label',facebookName:'Alice',facebookUserId:'123456',sessionStatus:'online'} as Account;
it("ignores another feed post mentioning approval but recognizes a visible submission notice",async()=>{
 const page=await browser.newPage();
 try {
  await page.setContent('<div role="article">Your post is pending admin approval</div><div role="status" style="display:none">Pending admin approval</div>');
  expect(await isPendingApprovalDetected(page)).toBe(false);
  await page.setContent('<div role="status">Your post is pending admin approval</div>');
  expect(await isPendingApprovalDetected(page)).toBe(true);
 }finally{await page.close();}
});
async function shareFixture(mode:'published'|'approval'|'ambiguous'|'wrong-actor') {
 const context=await browser.newContext();await context.addCookies([{name:'c_user',value:mode==='wrong-actor'?'987654':'123456',domain:'.facebook.com',path:'/'}]);
 const page=await context.newPage();let submitted=false;
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.hostname!=='www.facebook.com'){await route.abort();return;}
  if(url.pathname.startsWith('/groups/222')) {
   const evidence=submitted && mode==='published'?'<div role="article"><a href="/profile.php?id=123456">Alice</a><a href="/groups/222/posts/777/">now</a><p>Share caption</p><div role="article"><a href="/posts/555/">Original post</a></div></div>':'';
   await route.fulfill({contentType:'text/html',body:`<main>${evidence}</main>`});return;
  }
  await route.fulfill({contentType:'text/html',body:`<div role="article"><a href="/posts/555/">Original post</a><button id="share">Share</button></div><div id="host"></div><script>
 document.querySelector('#share').onclick=()=>{document.querySelector('#host').innerHTML='<button id="group">Share to a group</button>';document.querySelector('#group').onclick=()=>{document.querySelector('#host').innerHTML='<div role="dialog"><input aria-label="Search"><a href="/groups/222/" id="choose">Target group</a></div>';document.querySelector('#choose').onclick=(event)=>{event.preventDefault();document.querySelector('#host').innerHTML='<div role="dialog"><div contenteditable="true"></div><button id="submit">Post</button></div>';document.querySelector('#submit').onclick=async()=>{await fetch('/fixture-submitted');document.querySelector('#host').innerHTML=${JSON.stringify(mode==='approval'?'<div role="status">Your post is pending admin approval</div>':'')};};};};};
 </script>`});
 });
 await context.route('**/fixture-submitted',async route=>{submitted=true;await route.fulfill({body:'ok'});});
 const adapter={withActionPage:async(_a:Account,work:(page:Page)=>Promise<unknown>)=>work(page)} as unknown as FacebookBrowserAdapter;
 return {context,page,actions:new FacebookActions(adapter,process.env.TEMP || '/tmp'),submitted:()=>submitted};
}
it("confirms a native share only with new group permalink, author and original source",async()=>{
 const f=await shareFixture('published');
 try { const result=await f.actions.execute('share',account,actionPayloadSchema.parse({targetUrl:'https://www.facebook.com/groups/222/',sourceUrl:'https://www.facebook.com/posts/555/',groupName:'Target group',caption:'Share caption'}),vi.fn());expect(result).toMatchObject({status:'published',url:'https://www.facebook.com/groups/222/posts/777/'});expect(f.submitted()).toBe(true); }finally{await f.context.close();}
},30000);
it("records explicit pending approval separately from a successful published share",async()=>{
 const f=await shareFixture('approval');
 try {const result=await f.actions.execute('share',account,actionPayloadSchema.parse({targetUrl:'https://www.facebook.com/groups/222/',sourceUrl:'https://www.facebook.com/posts/555/',groupName:'Target group'}),vi.fn());expect(result.status).toBe('pending_approval');}finally{await f.context.close();}
},30000);
it("refuses to submit from a cookie belonging to another account",async()=>{
 const f=await shareFixture('wrong-actor');
 try {await expect(f.actions.execute('share',account,actionPayloadSchema.parse({targetUrl:'https://www.facebook.com/groups/222/',sourceUrl:'https://www.facebook.com/posts/555/',groupName:'Target group'}),vi.fn())).rejects.toThrow(/Session/);expect(f.submitted()).toBe(false);}finally{await f.context.close();}
},30000);
it("a closed share dialog without publication evidence remains uncertain, never successful",async()=>{
 const f=await shareFixture('ambiguous');
 try {await expect(f.actions.execute('share',account,actionPayloadSchema.parse({targetUrl:'https://www.facebook.com/groups/222/',sourceUrl:'https://www.facebook.com/posts/555/',groupName:'Target group'}),vi.fn())).rejects.toThrow(/ยืนยันโพสต์ใหม่/);expect(f.submitted()).toBe(true);}finally{await f.context.close();}
},30000);
it("verifies a new comment using the Facebook name even when the local account label differs",async()=>{
 const context=await browser.newContext();await context.addCookies([{name:'c_user',value:'123456',domain:'.facebook.com',path:'/'}]);const page=await context.newPage();
 await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:`<div role="article" id="post"><a href="/posts/555/">Original</a><button>Comment</button><div contenteditable="true" aria-label="Write a comment"></div></div><script>document.querySelector('[contenteditable]').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();const article=document.createElement('div');article.setAttribute('role','article');article.innerHTML='<a href="/alice">Alice</a><p>Local fixture comment</p><a href="/posts/555/?comment_id=999">now</a>';document.querySelector('#post').append(article);e.currentTarget.textContent='';}};</script>`}));
 try {
  const adapter={withActionPage:async(_a:Account,work:(page:Page)=>Promise<unknown>)=>work(page)} as unknown as FacebookBrowserAdapter;
  const result=await new FacebookActions(adapter,process.env.TEMP||'/tmp').execute('comment',account,actionPayloadSchema.parse({targetUrl:'https://www.facebook.com/posts/555/',caption:'Local fixture comment'}),vi.fn());
  expect(result.status).toBe('published');expect(result.url).toContain('comment_id=999');
 }finally{await context.close();}
},30000);
