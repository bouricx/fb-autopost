# AutoPost Manager TH

โปรแกรมตั้งเวลาโพสต์ Facebook และ Discord แบบ local-first สำหรับบัญชีและปลายทางที่คุณดูแลเอง

## ฟีเจอร์เวอร์ชัน 0.1

- Facebook Group, Page และ Profile ผ่าน Chrome/Playwright
- ปิด Chrome อัตโนมัติหลังโพสต์สำเร็จหรือล้มเหลว โดยเก็บ session ล็อกอินไว้ใช้รอบถัดไป
- หน้า Dashboard รวมสถานะระบบ งานถัดไป การแจ้งเตือน และ Log ล่าสุด
- ตั้งเวลาและแสดงผลแบบเวลาไทย Asia/Bangkok (UTC+7) เสมอ
- UI โดย Veltshop พร้อมตัวเลือกปลายทางแบบเลือกทั้งหมด/ล้างทั้งหมด
- Discord Webhook และ Bot API (ไม่รองรับ user token)
- หลายบัญชีและหลายปลายทาง
- ดึงกลุ่ม Facebook พร้อมชื่อ รูป ค้นหา เลือกทั้งหมด และเพิ่มหลายกลุ่มในครั้งเดียว
- ข้อความ + รูป/วิดีโอสูงสุด 10 ไฟล์
- ตัวแปร `{date}`, `{time}`, `{emoji}`, `{random:A|B|C}`
- ตั้งเวลาครั้งเดียว/ทุกวัน/ทุกสัปดาห์
- SQLite queue, priority-ready, retry แบบ exponential backoff
- Log, ประวัติ, success rate, Windows notification และ screenshot เมื่อ Facebook ล้มเหลว
- Token เข้ารหัสด้วย Windows DPAPI
- UI ภาษาไทย, dark theme และ system tray

## เริ่มใช้งานสำหรับนักพัฒนา

```powershell
npm install
npm install-scripts approve better-sqlite3 electron electron-winstaller esbuild
npm run dev
```

ตรวจและ build:

```powershell
npm run typecheck
npm test
npm run build
npm run dist
```

## การใช้ Facebook

1. เพิ่มบัญชีชนิด “Facebook ผ่าน Chrome”
2. กด “เปิด Chrome เพื่อล็อกอิน Facebook” และล็อกอินด้วยตนเอง
3. เพิ่ม URL ของกลุ่ม เพจ หรือโปรไฟล์ที่บัญชีนั้นมีสิทธิ์โพสต์
4. สร้างโพสต์และตั้งเวลา

Facebook เปลี่ยน DOM ได้เสมอ หากหา composer ไม่พบ ระบบจะหยุดงานนั้น บันทึกข้อผิดพลาด และเก็บ screenshot
เพื่อปรับ adapter โดยไม่ยิงซ้ำแบบไม่ทราบผล

## สิ่งที่ไม่รวม

- การข้าม License ของโปรแกรมอื่น
- CAPTCHA bypass, fingerprint spoof หรือ anti-detect
- Discord user token/self-bot
- การกดไลก์/คอมเมนต์/แชร์จำนวนมากเพื่อปั่น engagement

## การตรวจและแก้บั๊ก 25 ตุลาคม 2026

ดู [รายงานการแก้ไขและหลักฐานทดสอบ](docs/AUDIT-FIXES-2026-10-25.md) สำหรับ queue lifecycle, Discord delivery, หยุดตาราง, graceful shutdown และข้อจำกัดของการตรวจ รุ่นแก้ไขนี้เป็น 0.6.11 โดยรวมซอร์ส upstream 0.6.10 แล้ว มี Windows CI build installer; ไฟล์ติดตั้งในเครื่องผู้ใช้จะไม่เปลี่ยนเอง
