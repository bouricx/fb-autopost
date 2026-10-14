import asyncio
import re
import secrets
from datetime import datetime,timezone
from urllib.parse import urlparse
from . import config as C, fb_accounts as A, storage as S
from .browser import launch_context,close_context
from .group_metadata import EXTRACT_GROUPS, normalize_group

class BrowserManager:
    def __init__(self):
        self.sessions={}
        self.tasks={}
        self.stops={}
        self.logs=[]
        self.account_lock=asyncio.Lock()
        self.status={}

    def log(self,account,text):
        self.logs.append({'time':datetime.now(timezone.utc).isoformat(),'account':account,'message':text})
        self.logs=self.logs[-200:]

    def accounts(self):
        cfg=C.load_config()
        return [{'id':a['id'],'name':a['name'],'open':a['id'] in self.sessions,
                 'status':self.status.get(a['id'],'ยังไม่ได้ตรวจ'),
                 'running':a['id'] in self.tasks and not self.tasks[a['id']].done()} for a in cfg['fb_accounts']]

    async def add(self,name):
        async with self.account_lock:
            cfg=C.load_config();C.ensure_dirs()
            a=A.add_account(cfg,name)
            # Stable random ID avoids reusing a deleted account's private profile.
            a['id']='account-'+secrets.token_hex(6)
            a['dir']=str(C.PROFILE_ROOT/a['id'])
            cfg['active_account']=a['id'];C.save_config(cfg)
            return {'id':a['id'],'name':a['name']}

    def account(self,aid):
        if not re.fullmatch(r"account-[A-Za-z0-9_-]+",aid):raise ValueError("รหัสบัญชีไม่ถูกต้อง")
        a=A.find_account(C.load_config(),aid)
        if not a:raise ValueError('ไม่พบบัญชี')
        return a

    async def session(self,aid):
        self.account(aid)
        if aid in self.sessions:
            pw,ctx,page=self.sessions[aid]
            if not page.is_closed():return page
            await self.close(aid)
        # Only profiles inside this app are opened, never the user's normal Chrome profile.
        pw,ctx=await launch_context(C.PROFILE_ROOT/aid)
        page=ctx.pages[0] if ctx.pages else await ctx.new_page()
        self.sessions[aid]=(pw,ctx,page)
        self.status[aid]='เบราว์เซอร์เปิดอยู่'
        return page

    async def login(self,aid):
        page=await self.session(aid)
        await page.goto('https://www.facebook.com/',wait_until='domcontentloaded',timeout=60000)
        await page.bring_to_front()
        self.log(aid,'เปิด Facebook แล้ว ล็อกอินและยืนยันตัวตนบนหน้า Facebook เอง')

    async def check(self,aid):
        if aid not in self.sessions:
            self.status[aid]='กดล็อกอินเพื่อเปิดและตรวจบัญชี'
            return False
        pw,ctx,page=self.sessions[aid]
        if page.is_closed():
            await self.close(aid);return False
        cookies=await ctx.cookies('https://www.facebook.com/')
        # Session indicator only; Facebook can still request verification on the next page.
        found=any(c['name']=='c_user' and c.get('value') for c in cookies)
        self.status[aid]='พบเซสชันล็อกอิน' if found else 'ยังไม่พบเซสชันล็อกอิน'
        return found

    async def groups(self,aid):
        if self.tasks.get(aid) and not self.tasks[aid].done():raise ValueError('หยุดงานก่อนโหลดกลุ่ม')
        page=await self.session(aid)
        await page.goto('https://www.facebook.com/groups/joins/',wait_until='domcontentloaded',timeout=60000)
        if not await self.check(aid):raise ValueError('ล็อกอิน Facebook ก่อน')
        await page.locator('a[href*="/groups/"]').first.wait_for(state='visible',timeout=20000)
        found={}
        for _ in range(8):
            rows=await page.locator('a[href]').evaluate_all(EXTRACT_GROUPS)
            for raw in rows:
                row=normalize_group(raw)
                if row:
                    existing=found.get(row['url'])
                    if existing and not row['image_url']:
                        row['image_url']=existing['image_url']
                    found[row['url']]=row
            if len(found)>=100:break
            await page.mouse.wheel(0,750);await asyncio.sleep(1)
        result=list(found.values())[:100]
        if not result:
            raise ValueError('ยังไม่พบกลุ่มบนหน้า Facebook ตรวจการล็อกอินแล้วลองใหม่ ข้อมูลกลุ่มเดิมยังอยู่')
        S.save_joined_groups(aid,result,datetime.now(timezone.utc).isoformat())
        self.log(aid,f'อัปเดตชื่อและรูปกลุ่ม {len(result)} กลุ่มจากหน้าที่เปิด (อาจไม่ครบทุกกลุ่ม)')
        return result

    @staticmethod
    def group_url(url):
        p=urlparse(url)
        if p.scheme!='https' or p.hostname not in ('facebook.com','www.facebook.com') or p.username or p.port:
            raise ValueError('ใช้ลิงก์กลุ่ม Facebook แบบ HTTPS เท่านั้น')
        if not re.fullmatch(r'/groups/[A-Za-z0-9_.-]+/?',p.path):raise ValueError('ลิงก์กลุ่มไม่ถูกต้อง')
        return 'https://www.facebook.com'+p.path

    async def prepare(self,aid,url,message):
        if self.tasks.get(aid) and not self.tasks[aid].done() and asyncio.current_task()!=self.tasks[aid]:
            raise ValueError('บัญชีนี้กำลังทำงาน')
        page=await self.session(aid)
        await page.goto(self.group_url(url),wait_until='domcontentloaded',timeout=60000)
        if not await self.check(aid):raise ValueError('กรุณาล็อกอินหรือยืนยันตัวตนใน Facebook')
        trigger=page.get_by_text(re.compile(r'^(Write something|เขียนอะไรบางอย่าง|คุณกำลังคิดอะไร)',re.I)).first
        await trigger.click(timeout=15000)
        dialog=page.get_by_role('dialog').last
        editor=dialog.locator('[contenteditable="true"][role="textbox"]').first
        await editor.fill(message,timeout=15000)
        await page.bring_to_front()
        return page,dialog

    async def draft(self,aid,url,message):
        await self.prepare(aid,url,message)
        self.log(aid,'เตรียมข้อความแล้ว ตรวจเนื้อหาและกดโพสต์ใน Facebook ได้เลย')

    async def start(self,aid,urls,message,delay):
        self.account(aid)
        if self.tasks.get(aid) and not self.tasks[aid].done():raise ValueError('งานบัญชีนี้กำลังทำงาน')
        urls=list(dict.fromkeys(self.group_url(u) for u in urls))
        if not urls or len(urls)>20:raise ValueError('เลือก 1–20 กลุ่มต่อรอบ')
        if not message.strip() or len(message)>10000:raise ValueError('ข้อความต้องมี 1–10000 ตัวอักษร')
        delay=max(30,min(3600,int(delay)))
        stop=asyncio.Event();self.stops[aid]=stop
        async def work():
            self.status[aid]='กำลังทำงาน'
            for i,url in enumerate(urls):
                if stop.is_set():break
                try:
                    page,dialog=await self.prepare(aid,url,message)
                    if stop.is_set():break
                    button=dialog.get_by_role('button',name=re.compile(r'^(Post|โพสต์)$')).last
                    if not await button.is_enabled():raise ValueError('ปุ่มโพสต์ยังใช้งานไม่ได้')
                    # Once clicked, never retry automatically: a post may have been accepted.
                    await button.click(timeout=15000)
                    await dialog.wait_for(state='hidden',timeout=20000)
                    self.log(aid,'ส่งผ่านปุ่มโพสต์แล้ว: '+url+' (อาจรอผู้ดูแลอนุมัติ)')
                    S.append_post_link(aid,'ส่งจากกลุ่ม',url)
                except Exception:
                    self.log(aid,'หยุดรอบ: ไม่ยืนยันผลได้ ให้ตรวจ Facebook ก่อนเริ่มใหม่ — '+url)
                    break
                if i<len(urls)-1:
                    try:await asyncio.wait_for(stop.wait(),timeout=delay)
                    except asyncio.TimeoutError:pass
            self.status[aid]='หยุดแล้ว' if stop.is_set() else 'จบรอบ'
        self.tasks[aid]=asyncio.create_task(work())

    async def close(self,aid):
        if self.tasks.get(aid) and not self.tasks[aid].done():raise ValueError('หยุดงานก่อนปิดเบราว์เซอร์')
        session=self.sessions.pop(aid,None)
        if session:await close_context(session[0],session[1])
        self.status[aid]='เบราว์เซอร์ปิดแล้ว'

    async def stop(self,aid):
        if aid in self.stops:self.stops[aid].set()
        # A send already in progress may finish; stop prevents the next send.
        self.log(aid,'สั่งหยุดแล้ว งานที่กดส่งไปแล้วอาจเสร็จต่อได้')

    async def shutdown(self):
        for event in self.stops.values():event.set()
        for task in self.tasks.values():
            if not task.done():
                try:await asyncio.wait_for(asyncio.shield(task),timeout=65)
                except asyncio.TimeoutError:
                    task.cancel()
                    try:await task
                    except asyncio.CancelledError:pass
        for aid in list(self.sessions):await self.close(aid)
