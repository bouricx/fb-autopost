# ผลตรวจและแก้ไขวันที่ 25 ตุลาคม 2026

## รุ่นและขอบเขต

เริ่มตรวจจาก main commit 67ffd08 (Electron 0.5.0) แล้วระหว่างทำงาน upstream เพิ่ม commit 755689c พร้อม tag v0.6.10 จึงรวม source 0.6.10 เข้ามาทั้งหมดและรันทดสอบใหม่ รุ่นแก้ไขนี้เป็น 0.6.11 พร้อม Python Desktop 1.3.1 ที่ราก repository
ไฟล์ D:\AutoPost Manager\AutoPost Manager TH Setup 0.6.10.exe อยู่บนเครื่องผู้ใช้ ไม่ได้อยู่ใน environment นี้ จึงไม่ได้แก้หรือรับรอง executable ที่ติดตั้งอยู่โดยตรง
การคอมไพล์/ทดสอบไม่ใช่หลักฐานว่าทุกบรรทัดปราศจากบั๊ก หรือฟีเจอร์ทุก release ทำงานครบ

## บั๊กที่แก้

1. Discord Webhook/Bot บันทึกเริ่ม submission ก่อน fetch; timeout, network loss, 5xx, malformed JSON หรือ success ที่ขาด message id ให้ผล uncertain ป้องกัน retry ที่อาจซ้ำ มี timeout 30 วินาทีและไม่ตาม redirect
2. Explicit 4xx แยกจากผลไม่แน่นอน; 429 รอเวลาที่กำหนด ตรวจ retry_after ให้เป็นตัวเลขบวกที่มีขอบเขต ป้องกัน Invalid Date; Webhook บังคับ wait=true ด้วย URL API
3. ตรวจความยาวข้อความ Discord, local media และ URL ก่อนเริ่มส่ง
4. หยุดตารางแล้วยกเลิกทั้ง pending และ review_required รวมขั้นตอนลูก คงงานที่กำลังส่งกับประวัติสำเร็จไว้
5. งานที่กำลังส่งจบหลังหยุดตารางจะไม่สร้าง follow-up ใหม่ของตารางที่ถูกหยุด
6. Queue start/stop serialize การ drain; start รอ stop จบ, stop ซ้ำใช้ Promise เดียว และคำสั่ง stop ที่มาทีหลังยกเลิก restart ที่ค้าง
7. ปิดโปรแกรมผ่าน will-quit โดย preventDefault ทันที รอหยุดคิว ปิด adapter และฐานข้อมูล แล้วจึง quit อีกครั้ง; cleanup ล้มเหลวไม่แสร้งปิดสำเร็จ
8. 429 ไม่ทำให้บัญชีถูก rate_limited ถาวร เก็บ cooldown ของบัญชีโดยไม่ถูก minimum delay เขียนทับ
9. ไม่ claim งานของบัญชี inactive/ปลายทาง disabled และป้องกันลบบัญชี/ปลายทางระหว่างงาน running
10. เปิด Chrome เพื่อล็อกอินไม่ทำให้สถานะ active ก่อนผู้ใช้ล็อกอินและตรวจ Session สำเร็จ; ต้องหยุดคิวก่อนเปิดหน้าล็อกอิน
11. งาน recurring เดิมเลื่อนรอบถัดไปเป็นเวลาในอนาคต ไม่ไล่ยิงทุกรอบที่ขาดหายย้อนหลัง
12. Desktop Notification และ progress observer ที่ล้มเหลวไม่เปลี่ยนงานสำเร็จเป็นล้มเหลวหรือขัดจังหวะ worker
13. Cookie JSON ที่มี null/primitive ถูกปฏิเสธด้วยข้อความตรวจข้อมูลที่ปลอดภัย
14. Startup failure แสดงข้อความแทน unhandled rejection; ขนาดหน้าต่างคำนวณจาก work area และมี layout สำหรับหน้าจอเล็ก/Windows scaling
15. สำรองฐานข้อมูลก่อน migration 9 เมื่ออัปเกรดจาก schema 7/8 ไม่ใช่สำรองเฉพาะก่อน schema 7; ทดสอบด้วยไฟล์ SQLite จริง ยืนยันทั้งไฟล์ backup และการเปิดใหม่
16. Browser fixture tests เลือก Chromium สำหรับ CI ผ่าน environment ได้ โดย default ยังใช้ Chrome ตามเดิม

## หลักฐานการตรวจ

- TypeScript: npm run typecheck ผ่าน
- Electron build: npm run build ผ่าน (main/preload/renderer)
- Electron: 37 test files / 111 tests ผ่าน รวม native SQLite integration, queue lifecycle, Discord mock network, shutdown, migration, project import/export, backup encryption และ browser DOM fixtures
- Python เดิม: unittest discover ผ่าน 19 tests
- Python เดิม: check_ui.py ผ่าน account isolation/cache/images+fallback/search/selection/composer/themes/mobile
- Electron renderer: สลับ 6 หน้าหลักที่ 800/1024/1440px ผ่าน ไม่มี page error หรือ document horizontal overflow ใช้ IPC จำลอง ไม่ใช่ Electron/Windows E2E
- syntax check Python source ทุกไฟล์ และ node --check สำหรับ UI/metadata JS และ generated Electron main/preload ผ่าน
- มี source inventory/hash แยกในชุดรายงาน ไม่นับ dependencies, generated output หรือ binary; ไม่ใช่คำรับรองว่าอ่านยืนยันพฤติกรรมทุกบรรทัดแล้ว

คำสั่งตรวจ Electron ใน Linux environment นี้:

```sh
npm run typecheck
AUTOPOST_TEST_CHROME=/usr/bin/chromium AUTOPOST_TEST_NO_SANDBOX=1 npm test
npm run build
```

ใช้ AUTOPOST_TEST_NO_SANDBOX เฉพาะการตรวจใน sandbox container นี้ ค่า default ไม่ปิด browser sandbox บนเครื่องผู้ใช้
Node ใช้ better-sqlite3 native ABI; หลัง build installer ที่ rebuild native module ให้ Electron อาจต้อง npm rebuild better-sqlite3 ก่อนรัน Node integration tests อีกครั้ง

## การใช้หลังแก้

หยุดคิวและรอให้งานจบก่อนเปิด Chrome เพื่อล็อกอิน จากนั้นล็อกอินด้วยตนเอง กดตรวจ Session และเปิดคิวเมื่อสถานะพร้อม
งาน Discord uncertain ต้องตรวจห้องจริงก่อนสร้างงานใหม่ ระบบไม่อนุญาต retry โดยถือว่ายังไม่ส่ง
การหยุดคิวรอให้งานปัจจุบันจบ ไม่ยกเลิกคำสั่งที่ส่งไปแล้ว
การกด X ซ่อนหน้าต่างลง Tray ตามเดิม; การเลือกออกจาก Tray ใช้ graceful shutdown

## ยังตรวจยืนยันไม่ได้

- ติดตั้ง/อัปเกรด/ถอนติดตั้ง EXE 0.6.10 บน Windows จริง; ยังไม่ได้สร้าง installer ใหม่
- Windows autostart/Tray และ DPAPI จริง: ยังต้องตรวจบนเครื่องผู้ใช้; เพิ่ม Windows CI สำหรับ build NSIS และตรวจ packaged Electron ด้วย user data ชั่วคราวและโหมดห้ามโพสต์แล้ว ผล CI ต้องดูจาก run ของ commit นี้
- ล็อกอิน Facebook จริง, 2FA/checkpoint, selectors ทุก layout, ผลโพสต์/คอมเมนต์/แชร์/ไลก์จริง หรือ permission ของทุกกลุ่ม
- ไม่ได้ส่ง Discord/Telegram/Facebook จริงระหว่างตรวจ
- src/shared/features.ts ของ 0.6.10 ปิด comment/share/like/workflowFollowUp/pendingApprovalDetector/groupPermissionCheck ไว้ทั้งหมด คง flags ตาม upstream; ไม่เปิดฟีเจอร์ที่ยังไม่ได้ตรวจ live เพียงเพื่อให้ดูว่าครบ
- มีโค้ดและ unit tests ของ pending approval/group permissions แต่ production flags ปิดอยู่ จึงไม่อ้างว่าระบบเหล่านี้ทำงานจริงแล้ว

ไฟล์ซอร์สที่แก้ต้อง rebuild installer ให้ตรงกับ source revision นี้ก่อนจะแสดงผลบนเครื่องผู้ใช้ การอัปเดต GitHub ไม่แก้ไฟล์ EXE ที่ติดตั้งไว้เอง

## Windows installer 0.6.11

เพิ่ม .github/workflows/electron-windows.yml สำหรับ typecheck/tests/build NSIS และตรวจ packaged Electron ใน session-test mode โดยไม่ส่งโพสต์ ไฟล์ติดตั้งจะเป็น artifact ชื่อ AutoPost-Manager-TH-Windows เมื่อ job สำเร็จ ไม่ใช่การอัปเดตไฟล์ D: โดยอัตโนมัติ
