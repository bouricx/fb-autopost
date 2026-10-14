# FB AutoPost 1.1 — วิธีใช้แบบง่าย

[ดาวน์โหลดโปรแกรม .exe](https://github.com/bouricx/fb-autopost/raw/refs/heads/main/downloads/FB-AutoPost-Setup.exe)

1. ใช้ Windows 10/11 แบบ x64 แล้วดาวน์โหลด FB-AutoPost-Setup.exe
2. ดับเบิลคลิก รอแตกไฟล์ครั้งแรก โปรแกรมจะเปิดหน้าจอในเบราว์เซอร์
3. ใน Meta Graph API Explorer เลือก Meta App ของคุณแล้วสร้าง User Access Token
   พร้อมสิทธิ์ pages_show_list, pages_read_engagement, pages_manage_posts
4. วางโทเคนในช่อง “User Access Token” กด “ค้นหาเพจของฉัน” แล้วเลือกเพจ
5. เขียนข้อความ/ใส่ลิงก์ เลือกเวลา แล้วกด “เพิ่มเข้าคิว”
   หรือกด “ตั้งเป็นโพสต์ทันที” ก่อนเพิ่มเข้าคิว
6. เปิดโปรแกรมและคอมค้างไว้ โปรแกรมไม่ได้ทำงานเมื่อปิดหน้าต่างคำสั่ง

ไม่ต้องติดตั้ง Python ไม่ต้องกรอกรหัสผ่าน Facebook ในโปรแกรม โทเคนอยู่ใน
หน่วยความจำจนปิดโปรแกรม เปิดใหม่ต้องเชื่อมต่อเพจใหม่ Meta App ต้องได้รับสิทธิ์
ที่เหมาะสมตามบทบาทและการอนุมัติของ Meta การค้นหาเพจไม่ได้เพิ่มสิทธิ์ให้บัญชี
ถ้ามี Page Token อยู่แล้ว ใช้ช่องเชื่อมต่อ Page ID + Page Token ได้เช่นเดิม

EXE แตกแอปไว้ที่ %LOCALAPPDATA%\FB-AutoPost\v1.1.0\FB-AutoPost
ข้อมูลคิวอยู่ใน app/data ของโฟลเดอร์นั้น ไม่ได้มีระบบอัปเดตอัตโนมัติ
Windows PowerShell ที่มากับ Windows ใช้แตก ZIP ภายใน EXE ไม่ดาวน์โหลดโค้ดเพิ่ม

ทดสอบคิวและการค้นหาเพจด้วยข้อมูลจำลองแล้ว ตรวจไฟล์ EXE และ ZIP แล้ว
ยังไม่ได้ทดสอบรันจริงบน Windows หรือส่งโพสต์ไป Facebook จริง
รองรับโพสต์ข้อความ/ลิงก์ลง Page ไม่รองรับโพสต์กลุ่ม/บัญชีส่วนตัว/ดันคอมเมนต์

---

# Download Windows program

[Download FB AutoPost for Windows x64](https://github.com/bouricx/fb-autopost/raw/refs/heads/main/downloads/FB-AutoPost-Windows-x64.zip)

Extract the whole ZIP and open FB-AutoPost.exe. No Python install is required.
The package has not yet been runtime-tested on Windows or against a live Facebook Page.

---

# FB AutoPost — runnable Page publishing edition

## Windows
1. Install Python 3.11+ and select Add Python to PATH.
2. Extract the ZIP into `C:\Users\wavezaza\Documents\Default Project`.
3. Double-click `fb-autopost\run.bat`. On first start, dependencies download from PyPI.
4. The browser opens http://127.0.0.1:8765. Keep the command window and computer running.
5. Enter your Facebook Page ID and Page Access Token, connect, write a message,
   optionally add an HTTPS link, choose a local time, and queue the post.
6. Edit/cancel queued jobs. Successful jobs show the returned Facebook post ID.

## Facebook setup
Use a Page Access Token issued for a Page you administer, with the permissions
Meta requires for publishing (including pages_manage_posts and pages_read_engagement).
App access level/review and Page tasks must permit publishing. This package does
not supply a token or create permissions. Graph API version defaults to v25.0;
set FB_GRAPH_VERSION to another supported version before running if needed.
Tokens stay in process memory and must be re-entered after restarting.
Text/link Page feed posts are supported. Images, personal-profile/group posts,
automated likes/comment bumps and Discord user-token posting are not implemented.

## Discord notification (optional)
Set DISCORD_WEBHOOK_URL in the terminal that launches the app to a webhook you own.
Each successful Facebook post triggers one notification; mentions are disabled.
Webhook failures do not cause a Facebook post to be resent.

## Queue behavior
SQLite data is stored in data/queue.sqlite3. Times are normalized to UTC and
shown using the computer timezone. Overdue queued jobs run when the app resumes.
If a send is interrupted, status becomes uncertain: inspect the Page before retry.
There is no automatic retry after a potentially successful remote send.
Exports contain job text and IDs, never API tokens. Import creates NEW queued
jobs, even from an export of sent jobs: remove unwanted rows before importing.
Closing the program stops scheduling; it is not a background Windows service.

## Source
The 13 supplied original files are retained (README and requirements also have
-original/-legacy copies). New engine.py, discord_promote.py, manager.py, api.py,
main.py and ui files provide the runnable Page API edition. queue_storage.py,
page_client.py, queue_importer.py and runtime_config.py isolate new behavior from
legacy data/config/browser helpers. Original browser/cookie/human/stealth helpers
are retained as source but are NOT invoked by this edition.
Legacy helpers require requirements-legacy.txt if developing them separately.
This is not an implementation of every feature listed in README-original.md.

## Development and verification
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
python main.py

The HTTP server binds only to 127.0.0.1. Host checks and an ephemeral local token
protect write endpoints from cross-site browser requests. Do not expose this
service on the internet. Job text/data are plaintext on the local disk.
Automated tests use a fake Facebook client; live publishing needs your account.
