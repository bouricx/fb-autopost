(anchors) => {
  const groupKey = (href) => {
    try {
      const u = new URL(href, location.href);
      if (u.protocol !== 'https:' || !['facebook.com', 'www.facebook.com'].includes(u.hostname) || u.username || u.port) return null;
      const match = u.pathname.match(/^\/groups\/([A-Za-z0-9_.-]+)\/?$/);
      if (!match || ['joins','feed','discover','create','notifications','search','your_groups'].includes(match[1])) return null;
      return `https://www.facebook.com/groups/${match[1]}/`;
    } catch { return null; }
  };
  const label = (node) => (node.innerText || node.getAttribute('aria-label') || '').split('\n').map(t => t.trim()).find(Boolean) || '';
  const photo = (node) => {
    const candidates = [...node.querySelectorAll('img,svg image')].map(img => {
      const url = img.currentSrc || img.getAttribute('src') || img.getAttribute('href') || img.getAttribute('xlink:href') || '';
      const bounds = img.getBoundingClientRect();
      return {url, area: bounds.width * bounds.height};
    }).filter(img => img.area >= 400).sort((a, b) => b.area - a.area);
    return candidates[0]?.url || '';
  };
  const output = new Map();
  for (const a of anchors) {
    const url = groupKey(a.href);
    if (!url || !a.getClientRects().length) continue;
    let name = label(a);
    let image_url = photo(a);
    // Only climb within a card containing links to this ONE group. This prevents
    // pairing a group name with a neighbouring group's thumbnail or user avatar.
    let card = a;
    for (let depth = 0; depth < 4 && card.parentElement; depth++) {
      const parent = card.parentElement;
      const siblings = [...parent.querySelectorAll('a[href]')];
      const keys = new Set(siblings.map(n => groupKey(n.href)).filter(Boolean));
      if (keys.size !== 1 || !keys.has(url) || siblings.length > 16) break;
      const matching = siblings.filter(n => groupKey(n.href) === url);
      if (!name) name = matching.map(label).find(Boolean) || '';
      if (!image_url) image_url = matching.map(photo).find(Boolean) || '';
      card = parent;
    }
    const prev = output.get(url) || {url, name: '', image_url: ''};
    if (name && !prev.name) prev.name = name.slice(0, 180);
    if (image_url && !prev.image_url) prev.image_url = image_url;
    output.set(url, prev);
  }
  return [...output.values()].filter(row => row.name);
}
