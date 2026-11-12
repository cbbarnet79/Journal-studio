import { initializeApp } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import { defineSecret, defineString } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { buildReport, formatEmail } from "./report.mjs";

initializeApp();

const resendKey = defineSecret("RESEND_API_KEY");
const sender = defineString("JOURNAL_FROM_EMAIL");
const bucketName = defineString("JOURNAL_STORAGE_BUCKET");
const allowedRecipients = defineString("JOURNAL_PROFESSOR_EMAILS", { default: "" });

async function createObject(file, value) {
  try {
    await file.save(JSON.stringify(value), {
      contentType: "application/json",
      resumable: false,
      preconditionOpts: { ifGenerationMatch: 0 }
    });
    return true;
  } catch (error) {
    if (Number(error.code) === 412) return false;
    throw error;
  }
}

async function readObject(file) {
  const [bytes] = await file.download();
  return JSON.parse(bytes.toString("utf8"));
}

async function reserveSend(bucket, uid, id, date) {
  for (let slot = 0; slot < 5; slot++) {
    const file = bucket.file(`delivery-quota/${date}/${uid}/${slot}.json`);
    if (await createObject(file, { id }) || (await readObject(file)).id === id) return;
  }
  throw new HttpsError("resource-exhausted", "This account reached its daily limit of five submissions. Retry tomorrow (UTC).");
}

export const submitJournal = onCall({ secrets: [resendKey], maxInstances: 5 }, async (request) => {
  const account = request.auth?.token;
  if (account?.firebase?.sign_in_provider !== "google.com" || !account.email_verified ||
      !/@gmail\.com$/i.test(account.email || "")) {
    throw new HttpsError("permission-denied", "Sign in with a verified Gmail account.");
  }

  const now = Date.now();
  let report;
  try {
    report = buildReport(request.data, account, now);
  } catch (error) {
    const details = error instanceof RangeError ? { field: "recipient" } : undefined;
    throw new HttpsError("invalid-argument", error.message, details);
  }

  const uid = request.auth.uid;
  const bucket = getStorage().bucket(bucketName.value());
  const file = bucket.file(`students/${uid}/submissions/${report.id}.json`);
  const delivery = bucket.file(`delivery-status/${uid}/${report.id}.json`);
  const [alreadySent] = await delivery.exists();
  if (alreadySent) return { accepted: true };

  const recipients = allowedRecipients.value().split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
  if (recipients.length && !recipients.includes(report.recipient)) {
    throw new HttpsError("invalid-argument", "Use a professor email address enabled for this class.", { field: "recipient" });
  }

  const quotaDate = new Date(now).toISOString().slice(0, 10);
  await reserveSend(bucket, uid, report.id, quotaDate);
  const created = await createObject(file, { report, savedAt: now });
  if (!created) {
    const stored = await readObject(file);
    if (JSON.stringify(report) !== JSON.stringify(stored.report)) {
      throw new HttpsError("already-exists", "This session already has a saved submission with different details.");
    }
    if (now - stored.savedAt >= 23 * 60 * 60 * 1000) {
      throw new HttpsError("failed-precondition", "Your entry is saved. The email retry window has expired. Contact your professor.");
    }
    report = stored.report;
  }

  let response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + resendKey.value(),
        "Content-Type": "application/json",
        "Idempotency-Key": `journal/${uid}/${report.id}`
      },
      body: JSON.stringify({
        from: sender.value(), to: [report.recipient], reply_to: report.student.email,
        subject: "Journal Studio submission", text: formatEmail(report)
      }),
      signal: AbortSignal.timeout(12000)
    });
  } catch {
    throw new HttpsError("unavailable", "Your entry is saved. Email delivery could not be confirmed. Retry this submission.");
  }
  if (!response.ok) {
    throw new HttpsError("unavailable", "Your entry is saved. The email service did not accept the message. Retry this submission.");
  }
  await createObject(delivery, { acceptedAt: Date.now() });
  return { accepted: true };
});
