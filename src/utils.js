export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function formatDate(value) {
  return new Date(value).toLocaleString("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function now() {
  return new Date().toISOString();
}

export function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function containsAny(value, keywords) {
  const source = String(value).toLowerCase();
  return keywords.some((keyword) => source.includes(String(keyword).toLowerCase()));
}

export function prioritizeMetric(metrics, keyword) {
  const found = metrics.find((metric) => metric.includes(keyword));
  if (found) return [found, ...metrics.filter((metric) => metric !== found)];
  return [`${keyword} 또는 핵심 행동 완료율`, ...metrics];
}
