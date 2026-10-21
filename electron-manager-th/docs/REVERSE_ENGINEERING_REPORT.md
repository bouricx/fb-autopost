# รายงาน Static Reverse Engineering — AutoPost v1.3.3

## ขอบเขตและหลักฐาน

วิเคราะห์แบบ static จากไฟล์ที่ผู้ใช้ให้มา โดยไม่ bypass License, ไม่ถอดรหัส backend ที่ถูกป้องกัน,
ไม่ล็อกอินบัญชี และไม่ส่ง request โพสต์จริง

หลักฐานที่ตรวจ:

- `AutoPost.exe` SHA-256: `32F2FB073AB14B6EA64256D40A3C2778A23D2C2949C08B2266B9247B9FFF0150`
- PE metadata: Product `Auto Post`, File version `1.3.3`, ไม่มี Authenticode signature
- `_internal/python315.dll`: Python 3.15 bundle
- `_internal/playwright`: Playwright Python driver
- `_internal/webview`: pywebview/WebView2
- `_internal/ui/index.html`, `app.js`, `style.css`: UI web ภาษาไทย
- `config.json` และ `คู่มือการใช้งาน.txt`

## สิ่งที่พบจริง

```text
PyInstaller one-directory executable
  ├─ Python 3.15 backend (อยู่ใน AutoPost.exe)
  ├─ pywebview + WebView2 desktop shell
  ├─ Playwright + Google Chrome persistent profile
  ├─ HTML/CSS/JavaScript Thai UI
  └─ JSON file persistence
```

ฟีเจอร์ที่เห็นจาก UI/config/API bridge:

- หลายบัญชี Facebook และ persistent profile แยกบัญชี
- โพสต์กลุ่ม, comment push, like, share, joined groups และตรวจลิงก์
- โปรไฟล์ข้อความหลายชุดและแนบรูปจากโฟลเดอร์
- Discord promote, Discord server/channel discovery และ webhook notifications
- loop, random delay, per-account worker และ log polling
- license/HWID/update gate

ชื่อ bridge methods ที่ UI เรียกมี 68 จุด เช่น `start`, `stop`, `save`, `fb_accounts`,
`login_fb_account`, `apply_cookie`, `export_cookie`, `discord_guilds`, `discord_channels`,
`start_share`, `start_check`, `poll` และ `start_update`.

## ความเสี่ยงของต้นฉบับที่ไม่ทำซ้ำ

- Discord user token/self-bot เสี่ยงผิดข้อกำหนด Discord จึงเปลี่ยนเป็น Bot API/Webhook
- Cookie import/export และ plaintext JSON เพิ่มความเสี่ยงขโมย session จึงใช้ Chrome profile + DPAPI
- Engagement automation (like/comment/share จำนวนมาก) ไม่อยู่ใน clean-room version
- ไม่ทำ License bypass, CAPTCHA bypass, fingerprint spoof หรือ anti-detect

## ข้อสรุปเชิงอนุมาน

จากไฟล์ dependency, manual และ UI bridge มีหลักฐานเพียงพอว่าต้นฉบับใช้ Playwright ควบคุม Chrome
และเก็บ session ใน `fb_profile`. รายละเอียด selector และ workflow ของ Python backend ยังไม่ถือว่าได้รับการยืนยัน
เพราะไม่ได้ถอดหรือรัน backend ผ่าน License gate.

## การออกแบบใหม่

เลือก Electron + TypeScript + React + SQLite + Playwright เพื่อให้:

- มี typed IPC และ isolation ชัดเจนกว่า pywebview bridge
- ใช้ SQLite transaction สำหรับ queue/retry/history
- ใช้ adapter interface เพิ่มแพลตฟอร์มได้ง่าย
- เตรียม schema workspace/users สำหรับหลายคนในอนาคต
- ใช้ official Discord API และเข้ารหัส secret ด้วย Windows DPAPI

รายละเอียดอยู่ใน `ARCHITECTURE.md` และ `ADD_ADAPTER.md`.
