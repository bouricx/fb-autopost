const EMOJIS = ["✨", "📣", "💙", "🔥", "✅", "🎉", "📌", "💬"];

export function renderTemplate(template: string, date = new Date(), random = Math.random): string {
  const choose = <T>(items: T[]): T => items[Math.min(items.length - 1, Math.floor(random() * items.length))];
  return template
    .replaceAll("{date}", new Intl.DateTimeFormat("th-TH", { dateStyle: "medium" }).format(date))
    .replaceAll("{time}", new Intl.DateTimeFormat("th-TH", { hour: "2-digit", minute: "2-digit" }).format(date))
    .replaceAll("{emoji}", () => choose(EMOJIS))
    .replace(/\{random:([^{}]+)\}/g, (_match, choices: string) => {
      const values = choices.split("|").map((value) => value.trim()).filter(Boolean);
      return values.length ? choose(values) : "";
    })
    // Compatible with AutoPostPro's simple bracket tokens; render only at send time.
    .replaceAll("[date]", new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Bangkok" }).format(date))
    .replaceAll("[time]", new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: "Asia/Bangkok" }).format(date))
    .replace(/\[rand\]/g, () => String(1000 + Math.floor(random() * 9000)));
}
