const segmenter = new Intl.Segmenter("fr", { granularity: "word" });

export function countWords(text) {
  let count = 0;
  for (const part of segmenter.segment(text)) {
    if (part.isWordLike) count++;
  }
  return count;
}

export function updateFocus(session, away, now) {
  if (away && session.awaySince === null) {
    session.awaySince = now;
    session.interruptions++;
  } else if (!away && session.awaySince !== null) {
    session.awayMs += Math.max(0, now - session.awaySince);
    session.awaySince = null;
  }
}

export function summarize(session, now) {
  const elapsedMs = Math.max(0, now - session.startedAt);
  const words = countWords(session.text);
  const currentAwayMs = session.awaySince === null ? 0 : Math.max(0, now - session.awaySince);
  const awayMs = Math.min(elapsedMs, session.awayMs + currentAwayMs);
  return {
    words, elapsedMs, awayMs,
    wordsPerMinute: elapsedMs ? Math.round(words * 600000 / elapsedMs) / 10 : 0,
    interruptions: session.interruptions,
    blocked: session.blocked
  };
}
