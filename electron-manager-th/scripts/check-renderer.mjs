import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:process.env.AUTOPOST_TEST_CHROME||'/usr/bin/chromium',headless:true,args:process.env.AUTOPOST_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[]});
const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{
 const account={id:'11111111-1111-4111-8111-111111111111',name:'Veltshop',platform:'facebook',adapterType:'facebook-browser',status:'active',sessionStatus:'online',facebookName:'Veltshop',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
 const profiles=[];const events=[];const lists=new Set(['listSchedules','listOverdue','listActions','listProjects','listNotificationChannels','listJobs','listLogs','listProfileRuns']);
 window.autopost=new Proxy({}, {get:(_,key)=>{
  if(key==='onProgress'||key==='onSessionProgress')return callback=>{events.push(callback);return ()=>{};};
  return async(...args)=>{
   if(key==='importCookies') {if(!String(args[0]).includes('xs='))throw new Error('missing_c_user_or_xs');return [{accountId:account.id,status:'online',message:'verified local fixture'}];}
   if(key==='listAccounts')return [account];
   if(key==='listDestinations')return [{id:'22222222-2222-4222-8222-222222222222',accountId:account.id,name:'Veltshop community',kind:'facebook_group',url:'https://www.facebook.com/groups/123/',enabled:true}];
   if(key==='dashboard')return {pending:0,running:0,succeeded:0,failed:0,accounts:1,successRate:0,nextJobs:[]};
   if(key==='workerStatus')return {running:false};
   if(key==='listMessageProfiles')return profiles;
   if(key==='saveMessageProfile'){const id=args[0]||'33333333-3333-4333-8333-333333333333';profiles.splice(0,profiles.length,{...args[1],id,updatedAt:new Date().toISOString()});return id;}
   if(key==='previewMedia')return [];
   if(lists.has(key))return [];
   if(key==='getAutoStart')return false;
   return null;
  };
 }});
});
try {
 await page.goto(process.env.AUTOPOST_UI_URL||'http://127.0.0.1:5102');
 const names=['ภาพรวมและสถานะ','1. บัญชีและปลายทาง','2. สร้างงานและตั้งเวลา','โปรไฟล์ข้อความ','แชร์ / คอมเมนต์ / ถูกใจ','3. คิวและผลการทำงาน','Log การทำงาน','ตั้งค่า'];
 for(const width of [800,1024,1440]) {
  await page.setViewportSize({width,height:900});
  for(const name of names){await page.locator('nav').getByRole('button',{name,exact:true}).click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${name} at ${width}`);}
 }
 await page.locator('nav').getByRole('button',{name:'โปรไฟล์ข้อความ',exact:true}).click();
 const sets=page.locator('.profile-set');
 for(const [index,id] of ['123','456'].entries()) {await sets.nth(index).locator('textarea').nth(0).fill(`https://www.facebook.com/groups/${id}/`);await sets.nth(index).locator('textarea').nth(1).fill(`ข้อความชุด ${index+1}`);}
 await page.keyboard.press('Control+s');
 await page.getByRole('status').filter({hasText:'บันทึกแล้ว ทุกบัญชี'}).waitFor();
 assert.equal(await page.evaluate(()=>window.autopost.listMessageProfiles().then(p=>p[0].sets.length)),2);
 await page.locator(".content").evaluate(node=>node.scrollTop=0);
 await page.screenshot({path:process.env.AUTOPOST_UI_SCREENSHOT||'/tmp/autopost-070-profiles.png',fullPage:true});
 await page.locator('nav').getByRole('button',{name:'1. บัญชีและปลายทาง',exact:true}).click();
 await page.getByRole('button',{name:'เพิ่มบัญชี',exact:true}).click();
 await page.getByRole('button',{name:'เข้าด้วย cookie',exact:true}).click();
 const cookie=page.getByRole('textbox',{name:'Cookie string / Cookie-Editor JSON'});
 await cookie.fill('c_user=123456');
 await page.getByRole('button',{name:'เข้าด้วย cookie',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'missing_c_user_or_xs'}).waitFor();
 assert.equal(await cookie.inputValue(),'');
 assert.equal(await page.getByRole('button',{name:'เปิด Chrome เพื่อล็อกอิน',exact:true}).count(),0);
 await cookie.fill('c_user=123456; xs=fixture-only');
 await page.getByRole('button',{name:'เข้าด้วย cookie',exact:true}).click();
 await page.getByRole('status').filter({hasText:'สำเร็จ: verified local fixture'}).waitFor();
 assert.equal(await cookie.inputValue(),'');
 assert.deepEqual(errors,[]);
 console.log('Renderer passed: 8 screens at 800/1024/1440px, profile A/B editor, Ctrl+S, no page errors or document overflow. Mock IPC, no Facebook access.');
}finally{await browser.close();}
