const emailPattern = /^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;
const segmenter = new Intl.Segmenter("fr", { granularity: "word" });

export function buildReport(data, account, now) {
  if (typeof data?.recipient !== "string" || data.recipient.length > 254 || !emailPattern.test(data.recipient)) {
    throw new RangeError("Enter a valid professor email address.");
  }
  const { id, text, startedAt, endedAt, metrics } = data;
  if (typeof id !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id) ||
      typeof text !== "string" || !text.trim() || text.length > 40000 ||
      !Number.isSafeInteger(startedAt) || !Number.isSafeInteger(endedAt) || startedAt < 0 ||
      endedAt < startedAt || endedAt > now + 300000) {
    throw new TypeError("The journal or session timing is invalid.");
  }
  const elapsedMs = endedAt - startedAt;
  const words = [...segmenter.segment(text)].filter((part) => part.isWordLike).length;
  if (!words || !["awayMs", "interruptions", "blocked"].every((name) =>
    Number.isSafeInteger(metrics?.[name]) && metrics[name] >= 0
  ) || metrics.awayMs > elapsedMs) {
    throw new TypeError("The journal or session summary is invalid.");
  }
  return {
    id, text, recipient: data.recipient.toLowerCase(), startedAt, endedAt,
    student: { name: account.name || account.email, email: account.email },
    metrics: {
      elapsedMs, words, wordsPerMinute: elapsedMs ? Math.round(words * 600000 / elapsedMs) / 10 : 0,
      awayMs: metrics.awayMs, interruptions: metrics.interruptions, blocked: metrics.blocked
    }
  };
}

export function formatEmail(report) {
  const { student, metrics } = report;
  return [
    "Student: " + student.name,
    "Gmail: " + student.email,
    "Session started (UTC): " + new Date(report.startedAt).toISOString(),
    "Session finished (UTC): " + new Date(report.endedAt).toISOString(),
    "",
    "Writing process",
    "Words in final entry: " + metrics.words,
    "Elapsed session (seconds): " + Math.round(metrics.elapsedMs / 1000),
    "Average words per minute over the full session: " + metrics.wordsPerMinute,
    "Focus interruptions: " + metrics.interruptions,
    "Time away (seconds): " + Math.round(metrics.awayMs / 1000),
    "Blocked paste/drop attempts: " + metrics.blocked,
    "",
    "These figures describe browser-reported activity. Other open windows and outside assistance cannot be verified from this report.",
    "",
    "Journal entry",
    report.text
  ].join("\n");
}
