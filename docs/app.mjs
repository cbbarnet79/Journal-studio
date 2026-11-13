import config from "./firebase-config.js";
import { countWords, summarize, updateFocus } from "./session.mjs";

const byId = (id) => document.getElementById(id);
const editor = byId("editor");
const professor = byId("professor");
const finish = byId("finish");
const status = byId("status");
let user;
let session;
let sending = false;

const key = () => "journal-studio:" + user.uid;
const isWriting = () => session?.phase === "writing";

function persist() {
  try {
    if (session) sessionStorage.setItem(key(), JSON.stringify(session));
    else sessionStorage.removeItem(key());
  } catch {
    status.textContent = "Draft recovery is unavailable in this browser. Keep this tab open.";
  }
}

function restore() {
  try {
    return JSON.parse(sessionStorage.getItem(key()));
  } catch {
    return null;
  }
}

function formatTime(ms) {
  const seconds = Math.floor(ms / 1000);
  return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
}

function renderStats() {
  const stats = session?.report?.metrics || (session && summarize(session, Date.now()));
  byId("words").textContent = stats?.words ?? 0;
  byId("elapsed").textContent = formatTime(stats?.elapsedMs ?? 0);
  byId("pace").textContent = stats?.wordsPerMinute ?? 0;
  byId("interruptions").textContent = stats?.interruptions ?? 0;
  byId("away").textContent = formatTime(stats?.awayMs ?? 0);
  byId("blocked").textContent = stats?.blocked ?? 0;
}

function render() {
  const sent = session?.phase === "sent";
  const pending = session?.phase === "pending";
  editor.value = session?.text || "";
  editor.readOnly = !isWriting();
  byId("start").hidden = Boolean(session);
  professor.value = session?.recipient || "";
  professor.readOnly = pending || sent;
  finish.disabled = sending || sent || (!pending && (!isWriting() || !countWords(editor.value)));
  finish.textContent = sending ? "Sending…" : pending ? "Retry email" : sent ? "Email submitted" : "Finish and email";
  byId("sign-out").disabled = sending;
  byId("new-session").hidden = !sent;
  byId("submission-note").textContent = pending
    ? "Your entry is locked. Retry the same submission if sending fails."
    : "Finishing saves a copy and emails your entry and session summary.";
  renderStats();
}

function recordFocus(away = document.hidden || !document.hasFocus()) {
  if (!isWriting()) return;
  updateFocus(session, away, Date.now());
  persist();
  renderStats();
}

window.addEventListener("blur", () => recordFocus(true));
window.addEventListener("focus", () => recordFocus());
window.addEventListener("pagehide", () => recordFocus(true));
window.addEventListener("pageshow", () => recordFocus());
document.addEventListener("visibilitychange", () => recordFocus());
setInterval(renderStats, 1000);

byId("start").addEventListener("click", () => {
  session = {
    id: crypto.randomUUID(), phase: "writing", startedAt: Date.now(), text: "",
    awaySince: null, awayMs: 0, interruptions: 0, blocked: 0, recipient: professor.value.trim()
  };
  status.textContent = "";
  persist();
  render();
  editor.focus();
});

editor.addEventListener("input", () => {
  if (!isWriting()) return;
  session.text = editor.value;
  finish.disabled = !countWords(editor.value);
  persist();
  renderStats();
});

function blockTransfer(event) {
  if (!isWriting()) return;
  event.preventDefault();
  session.blocked++;
  status.textContent = "Paste and drop are disabled in the journal editor.";
  persist();
  renderStats();
}

editor.addEventListener("paste", blockTransfer);
editor.addEventListener("drop", blockTransfer);
editor.addEventListener("dragover", (event) => event.preventDefault());
editor.addEventListener("beforeinput", (event) => {
  if (event.cancelable && ["insertFromPaste", "insertFromDrop", "insertFromPasteAsQuotation"].includes(event.inputType)) {
    blockTransfer(event);
  }
});

professor.addEventListener("input", () => {
  if (isWriting()) {
    session.recipient = professor.value.trim();
    persist();
  }
});

byId("new-session").addEventListener("click", () => {
  session = null;
  persist();
  status.textContent = "";
  render();
});

async function connectFirebase() {
  const base = "https://www.gstatic.com/firebasejs/12.7.0/";
  const [{ initializeApp }, authSdk, functionsSdk] = await Promise.all([
    import(base + "firebase-app.js"),
    import(base + "firebase-auth.js"),
    import(base + "firebase-functions.js")
  ]);
  const auth = authSdk.getAuth(initializeApp(config));
  await authSdk.setPersistence(auth, authSdk.browserSessionPersistence);
  const submit = functionsSdk.httpsCallable(functionsSdk.getFunctions(), "submitJournal");
  const provider = new authSdk.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  authSdk.onAuthStateChanged(auth, async (account) => {
    if (account && (!account.emailVerified || !/@gmail\.com$/i.test(account.email || "") ||
        !account.providerData.some((item) => item.providerId === "google.com"))) {
      status.textContent = "Choose a verified Gmail account ending in @gmail.com.";
      await authSdk.signOut(auth);
      return;
    }
    user = account;
    session = user ? restore() : null;
    byId("workspace").hidden = !user;
    byId("account").hidden = !user;
    byId("welcome").hidden = Boolean(user);
    byId("identity").textContent = user?.displayName || user?.email || "";
    byId("sign-in").disabled = false;
    render();
    recordFocus();
    if (session?.phase === "sent") status.textContent = "Your entry was saved and accepted for email delivery.";
  });

  byId("sign-in").addEventListener("click", async () => {
    byId("sign-in").disabled = true;
    status.textContent = "";
    try {
      await authSdk.signInWithPopup(auth, provider);
    } catch {
      status.textContent = "Google sign-in did not complete. Try again and allow the sign-in pop-up.";
      byId("sign-in").disabled = false;
    }
  });

  byId("sign-out").addEventListener("click", async () => {
    if (session && session.phase !== "sent" && !confirm("Sign out and discard this browser’s current entry?")) return;
    session = null;
    persist();
    status.textContent = "";
    try {
      await authSdk.signOut(auth);
    } catch {
      status.textContent = "Sign-out failed. Try again.";
      render();
    }
  });

  byId("submission").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (sending || !session || session.phase === "sent") return;
    if (isWriting()) {
      if (!countWords(session.text) || !confirm("Finish this session and email your entry to " + professor.value + "?")) return;
      const endedAt = Date.now();
      session.report = {
        id: session.id, recipient: professor.value.trim().toLowerCase(), text: session.text,
        startedAt: session.startedAt, endedAt, metrics: summarize(session, endedAt)
      };
      session.recipient = session.report.recipient;
      session.phase = "pending";
      persist();
    }
    sending = true;
    status.textContent = "Saving your entry and submitting the email…";
    render();
    try {
      await submit(session.report);
      session.phase = "sent";
      persist();
      status.textContent = "Your entry was saved and accepted for email delivery.";
    } catch (error) {
      status.textContent = error.code?.startsWith("functions/") && error.message !== "internal"
        ? error.message : "The submission could not be confirmed. Retry to send the same entry.";
      if (error.code === "functions/invalid-argument" && error.details?.field === "recipient") {
        session.phase = "writing";
        delete session.report;
        persist();
      }
    } finally {
      sending = false;
      render();
    }
  });
}

connectFirebase().catch(() => {
  status.textContent = "Google sign-in could not load. Check your connection and reload the page.";
});
