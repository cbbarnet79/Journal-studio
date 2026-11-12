# Journal Studio

Students sign in with a verified Gmail account, start a timed writing session, and submit their journal to a professor’s email address. Journal Studio saves the submission in Cloud Storage for Firebase, then sends the report through Resend. There are no AI features.

The report includes the student’s Google profile name and Gmail address, the full journal, session start and finish, final word count, elapsed time, average words per minute, focus interruptions, time away, and blocked paste/drop attempts. Pace is final words divided by total elapsed minutes, including pauses and time away. Browser focus and visibility signals overlap, so one continuous interruption counts once. Other open windows, extensions, devices, and external help cannot be verified. Session measurements are browser-reported and can be modified by someone controlling their browser. The app records neither keystroke contents nor other window titles. Drafts are kept in the current browser tab’s session storage. Cloud Storage receives finished submissions.

## Firebase deployment

1. In the [Firebase console](https://console.firebase.google.com/), choose or create a project on the Blaze plan. Set up Authentication with the **Google** provider and create a default Cloud Storage bucket. The app accepts verified `@gmail.com` accounts.
2. Set up the project’s default Firebase Hosting site and register a Firebase web app. Verify that the app’s Hosting domain is listed under Authentication → Settings → Authorized domains. The frontend loads its configuration from Firebase Hosting’s reserved `/__/firebase/init.json` endpoint.
3. In [Resend](https://resend.com/domains), verify a sending domain and create a sending API key. From the repository root, sign into the Firebase CLI and run the commands below with your actual Firebase project ID. Enter the key at the secret prompt.

   ```sh
   npx firebase-tools login
   npx firebase-tools functions:secrets:set RESEND_API_KEY --project PROJECT_ID
   npx firebase-tools deploy --only hosting,functions,storage --project PROJECT_ID
   ```

4. At deployment, set `JOURNAL_FROM_EMAIL` to the sender on your verified Resend domain and `JOURNAL_STORAGE_BUCKET` to the exact bucket name shown in Firebase Storage, without the `gs://` prefix. You can set `JOURNAL_PROFESSOR_EMAILS` to a comma-separated list of enabled recipients or leave it blank to accept any valid email address. Each Gmail account can submit up to five entries per UTC day.
5. Open the deployed Hosting URL. Sign in with a test Gmail account and submit a short entry to your own inbox. Confirm receipt and verify that the Firebase bucket contains a JSON report under `students/{uid}/submissions/`. The app confirms the email provider’s acceptance. Final delivery is verified in the recipient inbox or Resend dashboard.

The callable function handles writes and email delivery. Its runtime service account must have object create and read access to the selected bucket. Storage Rules deny client writes and allow authenticated students to read only their own submission objects by path. A retry reuses the saved submission and its email idempotency key. Resend API keys stay in Secret Manager.
