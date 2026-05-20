const findingSeverities = ["critical", "high", "medium", "low", "info"];

export function normalizeFindings(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeFinding)
    .filter((finding) => (typeof finding === "string" ? finding : finding.title || finding.recommendation || finding.file));
}

export function formatFindingText(finding) {
  if (typeof finding === "string") return finding;
  const location = [finding.file, finding.line ? `:${finding.line}` : ""].filter(Boolean).join("");
  const severity = finding.severity ? `[${finding.severity}] ` : "";
  const title = finding.title || finding.description || finding.recommendation || "Finding";
  const recommendation = finding.recommendation ? ` Recommendation: ${finding.recommendation}` : "";
  return `${severity}${location ? `${location} ` : ""}${title}${recommendation}`.trim();
}

export function findingSeverity(finding) {
  if (typeof finding === "string") return "medium";
  return normalizeSeverity(finding?.severity);
}

function normalizeFinding(value) {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";

  const line = Number(value.line);
  const severity = normalizeSeverity(value.severity);
  const finding = {
    severity,
    title: normalizeText(value.title || value.summary || value.message),
    recommendation: normalizeText(value.recommendation || value.recommendedChange),
  };

  const file = normalizeText(value.file || value.path || value.filename);
  const description = normalizeText(value.description || value.detail || value.reason);
  if (file) finding.file = file;
  if (Number.isInteger(line) && line > 0) finding.line = line;
  if (description) finding.description = description;
  return finding;
}

function normalizeSeverity(value) {
  const severity = String(value || "medium").trim().toLowerCase();
  return findingSeverities.includes(severity) ? severity : "medium";
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}
