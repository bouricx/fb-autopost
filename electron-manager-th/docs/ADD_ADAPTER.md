# เพิ่มแพลตฟอร์มใหม่

สร้างคลาสที่ทำตาม `PlatformAdapter` แล้วลงทะเบียนใน `AdapterRegistry`:

```ts
import type { PlatformAdapter, PublishContext } from "./types";

export class CustomWebhookAdapter implements PlatformAdapter {
  readonly type = "custom-webhook" as const;

  async publish({ destination, job, secret }: PublishContext) {
    const response = await fetch(destination.url!, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(secret ? { authorization: `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify({ text: job.caption, media: job.media }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    return { remoteId: result.id, publishedUrl: result.url };
  }
}
```

จากนั้นเพิ่มค่า adapter ใน `src/shared/types.ts`, validation ใน `electron/main.ts` และ instance ใน
`electron/adapters/registry.ts`. Queue, retry, logging และ history จะทำงานให้อัตโนมัติ.
