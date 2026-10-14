# AutoPost-Free

โปรแกรมโพสต์/ดันเมนต์/กดไลค์/แชร์ Facebook + โปรโมท Discord
สร้างใหม่จากข้อมูลที่ดึงออกจาก AutoPost v1.3.3 — ไม่มี license, ไม่มีรหัส, ไม่มี telemetry

## รัน

```bat
run.bat
```

หรือ:

```bat
pip install -r requirements.txt
playwright install chromium
python main.py
```

ใช้ Chrome ที่ติดตั้งในเครื่องถ้ามี (try channel=chrome ก่อน) ไม่มีก็ใช้ chromium ที่ playwright ติดตั้งให้

## โครงไฟล์ (ชั้นโปรแกรม)

```
main.py                  entry: เปิด window + wire API
autopost/
  config.py              ชั้นข้อมูล: config.json load/save/merge defaults
  storage.py             ชั้นข้อมูล: post_links.txt, joined_groups.json, cookies.json
  fb_accounts.py         ชั้นข้อมูล: หลายบัญชี (เพิ่ม/ลบ/แก้/เลือก)
  importer.py            ชั้นข้อมูล: import ไฟล์ export (JSON/CSV) + config เก่า
  browser.py             ชั้น platform: Playwright persistent context
  stealth.py             ชั้น platform: stealth JS patches
  human.py               ชั้น platform: เมาส์/สกรอล/ดีเลย์แบบมนุษย์
  fb_cookies.py          ชั้น platform: แปลง cookie ทุกรูปแบบ + เช็คล็อกอิน
  engine.py              ชั้น service: AutoPoster (โพสต์/เมนต์/ไลค์/แชร์/กลุ่ม/เช็ค)
  discord_promote.py     ชั้น service: Discord token + webhook
  notify.py              ชั้น service: webhook แจ้งผล
  manager.py             ชั้น service: worker/queue/log/poll
  api.py                 ชั้น API: js_api ทั้งหมดที่ UI เรียก
  ui/                    ชั้น presentation: index.html + style.css + app.js
data/<account>/          post_links.txt, joined_groups.json, cookies.json
fb_profile/account-N     Chrome profile ต่อบัญชี
images/, images_discord/ โฟลเดอร์รูป
config.json              สร้างตอนกดบันทึก
```

## Import ข้อมูลจากโปรแกรมเดิม

หน้า "นำเข้าข้อมูล" รับได้ทั้ง:
- `autopost_settings_export.json` / `.csv` ที่ export จาก `export_autopost_settings.py`
- `config.json` ของ AutoPost v1.3.3 (แบบ flat หรือแบบ fb_accounts)

## Build exe

```bat
pip install pyinstaller
pyinstaller -y -n AutoPost --add-data "fb-autopost\ui;ui" --collect-all playwright fb-autopost\main.py
```

## หมายเหตุทางเทคนิค

- การโพสต์อัตโนมัติขัดกับข้อตกลง Facebook — ใช้บัญชีสำรอง ตั้งพักไม่ให้ถี่
- Facebook เปลี่ยนหน้าเว็บเมื่อไหร่ selectors ใน `engine.py` ต้องอัปเดต
- ทุก flow ออกแบบ fail-soft: ผิดขั้นเดียว ข้ามรายการ ไปต่อ ไม่ตายทั้งรอบ
