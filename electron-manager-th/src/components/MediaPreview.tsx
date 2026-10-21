import { useEffect, useState } from "react";

export function MediaPreview({ paths }: { paths: string[] }) {
  const [items, setItems] = useState<Awaited<ReturnType<typeof window.autopost.previewMedia>>>([]);
  const [reload, setReload] = useState(0);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    void window.autopost.previewMedia(paths).then(rows => { if (active) { setItems(rows); setMessage(""); } }).catch(() => { if (active) setMessage("โหลดตัวอย่างไม่สำเร็จ"); });
    return () => { active = false; };
  }, [paths, reload]);
  if (!paths.length) return null;
  return <div><button type="button" className="secondary small" onClick={() => setReload(value => value + 1)}>โหลดรูปใหม่</button>{message && <p role="alert">{message}</p>}<div className="media-previews">{items.map(item => <div key={item.path}>
    {item.url ? item.kind === "video" ? <video src={item.url} controls preload="metadata" style={{ width: "100%", maxHeight: 180 }}/> : <img src={item.url} alt="ตัวอย่างรูปก่อนโพสต์"/> : <div>{item.missing ? "ไม่พบไฟล์ / ชนิดไม่รองรับ" : "แสดงตัวอย่างไม่ได้"}</div>}
    <small>{item.path.split(/[\\/]/).pop()}</small><button type="button" className="secondary small" onClick={() => void window.autopost.openMediaFolder(item.path).catch(() => setMessage("เปิดโฟลเดอร์ไม่สำเร็จ"))}>เปิดโฟลเดอร์</button>
  </div>)}</div></div>;
}
