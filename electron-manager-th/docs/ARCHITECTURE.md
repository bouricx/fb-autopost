# สถาปัตยกรรม AutoPost Manager TH

```text
┌──────────────── Electron Desktop ────────────────┐
│ React UI (ภาษาไทย)                               │
│ Dashboard · Accounts · Composer · Queue · Logs   │
└──────────────────────┬───────────────────────────┘
                       │ typed IPC / contextBridge
┌──────────────────────▼───────────────────────────┐
│ Electron Main Process                            │
│ IPC validation (Zod) · SecretVault (DPAPI)       │
│ QueueEngine · Scheduler · Retry · Notifications  │
└──────────────┬───────────────────────┬───────────┘
               │                       │
┌──────────────▼────────────┐  ┌───────▼───────────┐
│ SQLite                    │  │ Adapter Registry   │
│ accounts/destinations     │  │ FacebookBrowser   │
│ content/jobs/attempts     │  │ DiscordWebhook    │
│ logs/settings/team-ready  │  │ DiscordBot        │
└───────────────────────────┘  └───────────────────┘
```

## โครงสร้างโฟลเดอร์

```text
electron/
  adapters/       อินเทอร์เฟซและตัวเชื่อมต่อแพลตฟอร์ม
  core/           SQLite, queue, retry, secrets, templates
  main.ts         lifecycle, tray และ IPC
  preload.ts      API ที่อนุญาตให้ UI เรียก
src/
  shared/         type contract ระหว่าง main/renderer
  styles/         ธีม UI
  App.tsx         หน้าจอภาษาไทย
tests/            unit tests
docs/             เอกสารสถาปัตยกรรมและ adapter
```

## Database schema

- `workspaces`, `users`: เตรียมพร้อมสำหรับทีม โดยค่าเริ่มต้นเป็น workspace ส่วนตัว
- `accounts`: บัญชี Facebook/Discord และ secret ที่เข้ารหัส
- `destinations`: กลุ่ม เพจ โปรไฟล์ ช่อง หรือ webhook
- `content_items`: caption และรายการ media
- `jobs`: เวลา, recurrence, priority, status และ retry state
- `post_attempts`: ประวัติแต่ละครั้งและ screenshot เมื่อผิดพลาด
- `event_logs`: log แบบเรียลไทม์
- `settings`: ค่าระบบแบบ key/value

## Queue state machine

`pending → running → succeeded`

เมื่อผิดพลาด: `running → pending` พร้อม exponential backoff จนเต็ม `max_attempts` แล้วเป็น `failed`.
งาน recurring จะสร้างเวลารอบถัดไปหลังสำเร็จโดยไม่ต้องใช้อินเทอร์เน็ตระหว่างรอ.

## ความปลอดภัย

- Facebook ใช้ persistent Chrome profile แยกบัญชี ผู้ใช้ล็อกอินเอง
- Discord secrets เข้ารหัสด้วย Electron `safeStorage`/Windows DPAPI
- Renderer ไม่มี Node access และเรียกได้เฉพาะ API ใน preload
- ไม่เก็บรหัสผ่าน Facebook, ไม่ bypass CAPTCHA, ไม่ spoof fingerprint
- Browser automation จำกัดเฉพาะปลายทางที่ผู้ใช้เพิ่มและมีสิทธิ์โพสต์
