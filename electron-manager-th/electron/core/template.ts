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
    });
}
