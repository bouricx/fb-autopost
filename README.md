# FB AutoPost 1.2 — Browser Edition

[ดาวน์โหลด FB-AutoPost-Setup.exe](https://github.com/bouricx/fb-autopost/raw/refs/heads/main/downloads/FB-AutoPost-Setup.exe)

## ใช้บน Windows 10/11 x64
1. ติดตั้ง Google Chrome ให้เรียบร้อย (https://www.google.com/chrome/)
2. ดาวน์โหลด EXE แล้วดับเบิลคลิก รอแตกไฟล์ครั้งแรกและเปิดหน้าจอในเบราว์เซอร์
3. พิมพ์ชื่อบัญชี เช่น Veltshop แล้วกด เพิ่มบัญชี → ล็อกอิน
4. Chrome หน้าต่างแยกเปิด facebook.com ให้เข้าสู่ระบบบน Facebook เอง รวมถึง 2FA
5. กลับโปรแกรมแล้วกด ตรวจล็อกอิน สถานะ “พบเซสชันล็อกอิน” เป็นการตรวจ cookie
   บ่งชี้เซสชัน ไม่รับประกันว่า Facebook จะไม่ขอยืนยันตัวตนอีก
6. เลือกบัญชี กด โหลดกลุ่มที่ฉันเข้าร่วม หรือวางลิงก์กลุ่มเอง
7. พิมพ์ข้อความ แล้วกด เปิดและเตรียมร่าง เพื่อตรวจและกดโพสต์เองใน Facebook
8. หากต้องการส่งหนึ่งรอบ กด เริ่มรอบโพสต์ แล้วยืนยันกลุ่มและข้อความ
   แต่ละรอบจำกัด 20 กลุ่ม พักตามเวลาที่ตั้ง ปุ่มหยุดกันการส่งงานถัดไป

ไม่ต้องวาง User Access Token ไม่ต้องมี Meta App ไม่กรอกรหัสผ่านในโปรแกรม
เซสชันเก็บในโปรไฟล์ Chrome แยกต่อบัญชี ใช้บัญชีที่มีสิทธิ์โพสต์ในกลุ่มนั้น
กรณี CAPTCHA/2FA ต้องดำเนินการบน Facebook เอง ไม่มีระบบข้ามการตรวจสอบ
Chrome ที่ใช้เป็นโปรไฟล์ของแอป ไม่อ่านหรือคัดลอกโปรไฟล์ Chrome ส่วนตัว

## งานที่รองรับจริง
หลายบัญชี, เปิดล็อกอิน, ตรวจเซสชัน, โปรไฟล์แยก, โหลดลิงก์กลุ่มที่เห็นในหน้า,
เตรียมข้อความ, ส่งข้อความลงกลุ่มหนึ่งรอบ, หยุดงาน, ปิดเบราว์เซอร์, Log
หากโพสต์กลุ่มต้องรออนุมัติ ผลใน Log ไม่ได้หมายความว่าผู้ดูแลอนุมัติแล้ว
หากปุ่ม/หน้า Facebook เปลี่ยนหรือไม่ยืนยันผล โปรแกรมหยุดรอบและไม่ลองส่งซ้ำเอง
โหลดกลุ่มได้เฉพาะที่หน้าจอแสดงในช่วงเลื่อน 5 ครั้ง อาจไม่ครบทุกกลุ่ม
ยังไม่มีรูปแนบ, ดันคอมเมนต์, กดไลค์, แชร์, วนรอบ, ตั้งเวลาแบบ browser หรือ
Discord user-token แบบโปรแกรมในคลิป ระบบ Page API เดิมยังอยู่ในซอร์สแต่ไม่อยู่
ในหน้าจอหลักของ Browser Edition เว็บ API โหมดเดิมยังต้องใช้โทเคน

## ที่เก็บข้อมูล
EXE แตกไฟล์ใน %LOCALAPPDATA%\FB-AutoPost\v1.2.0\FB-AutoPost
โปรไฟล์อยู่ใน app/fb_profile, บัญชีใน app/config.json, Log กลุ่มใน app/data
ห้ามส่งโปรไฟล์/cookies/config ที่มีความลับขึ้น GitHub สำรองข้อมูลก่อนอัปเกรด
รุ่นนี้แยกโฟลเดอร์จากรุ่น 1.1 เพื่อไม่เปิดคิว Page API เก่าโดยไม่ตั้งใจ
หยุดโปรแกรม = หยุดงาน ไม่ใช่ Windows service ไม่มีอัปเดตอัตโนมัติ

## พัฒนา
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
python main.py

ต้นฉบับจากผู้ใช้เก็บไว้ใน README-original.md, requirements-legacy.txt และโมดูล
config, fb_accounts, storage, importer, fb_cookies, human, stealth, notify
browser.py ปรับให้เปิด Chrome แบบมองเห็นได้ โดยไม่ใช้ stealth/human patches
browser_manager.py เชื่อมการทำงานกับ api.py และ UI ใหม่
sfx.c เป็นตัวแตกแพ็กเกจ Windows, launcher.c เป็นตัวเปิด Python ที่บันเดิล

การตรวจ: unit tests 13 รายการผ่านด้วย mock client/browser; Python/JS syntax
และ EXE payload ผ่าน ไม่มีบัญชี/รหัสผ่าน/cookiesจริงในชุดทดสอบ
ยังไม่ได้รัน EXE บน Windows จริงหรือทดสอบ selectors กับบัญชี Facebook จริง
