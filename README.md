# Doctor WOYZ - Secure Firebase Edition

This version uses:

- GitHub Pages for the website
- Firebase Anonymous Authentication for each device
- Firebase Email/Password Authentication for the administrator
- Cloud Firestore for device approval
- A Firebase callable Cloud Function for Gemini processing
- Google Cloud Secret Manager for the private Gemini API key

The Gemini API key is not stored in `index.html`, GitHub, Firestore, or the
browser.

## Project

Firebase project:

```text
woyz-be9e5
```

Cloud Function region:

```text
asia-south1
```

## 1. Create The Default Firestore Database

The Firebase Console showing a **Firestore** shortcut does not necessarily mean
that a database has been created.

1. Open **Firebase Console > WOYZ > Firestore**.
2. Select **Create database**.
3. Choose **Standard edition** and **Native mode**.
4. Choose **Start in production mode**.
5. Select a nearby region. Use an India region when it is available.
6. Create the database with the name `(default)`.

Do not manually create the `devices` collection. The website creates it when
the first device requests approval.

## 2. Firebase Authentication

In Firebase Console:

1. Open **Authentication > Sign-in method**.
2. Enable **Anonymous**.
3. Enable **Email/Password** for the administrator.
4. Open **Authentication > Users**.
5. Add the administrator account `drgigy@gmail.com` with a strong password.
6. Open **Authentication > Settings > Authorized domains**.
7. Add `drgigy.github.io`.

## 3. Publish Firestore Rules

1. Open **Firestore Database > Rules**.
2. Replace the current rules with the contents of `firestore.rules`.
3. Select **Publish**.

The rules allow an anonymous user to create and read only that device's
approval request. Only `drgigy@gmail.com` can list, approve, or block devices.

## 4. Install Firebase CLI

Open Terminal and run:

```bash
npm install -g firebase-tools
firebase login
```

Move into this folder:

```bash
cd "/path/to/doctor-woyz-github-pages"
```

Confirm that the correct project is selected:

```bash
firebase use woyz-be9e5
```

## 5. Store The Gemini Key Securely

Run:

```bash
firebase functions:secrets:set GEMINI_API_KEY
```

Paste the paid Gemini API key when prompted. The typed key is hidden and is
stored in Google Cloud Secret Manager.

Never add the Gemini key to any file in this folder.

## 6. Deploy The Backend

Install the function dependencies:

```bash
cd functions
npm install
cd ..
```

Deploy the Firestore rules and Cloud Function:

```bash
firebase deploy --only firestore:rules,functions
```

Wait until Firebase reports that `generateVisitNote` was deployed
successfully.

## 7. Upload The Website To GitHub

Upload these public website files to the repository root:

```text
index.html
main.html
admin.html
.nojekyll
manifest.webmanifest
sw.js
offline.html
icon-192.png
icon-512.png
icon-maskable-512.png
```

The `functions` folder, `.firebaserc`, `firebase.json`, `firestore.rules`, and
this README should also remain in the repository so future backend updates can
be deployed. GitHub Pages ignores these backend files.

Do not upload `functions/node_modules`.

## 8. Approve A Device

1. Open the main Doctor WOYZ page.
2. Enter the doctor and device names.
3. Submit the approval request.
4. Open:

```text
https://drgigy.github.io/doctorwoyz/admin.html
```

5. Sign in as `drgigy@gmail.com`.
6. Approve the device.
7. Return to the main page and test a short recording.

## Important

- The Firebase web configuration in the HTML identifies the Firebase project
  and is expected to be visible to browsers.
- The Gemini API key is private and exists only in Secret Manager.
- The backend checks Firebase Authentication and confirms that the device
  document has `status: "approved"` before calling Gemini.
- The backend uses stable `gemini-3.5-flash` and falls back to
  `gemini-2.5-flash` for temporary capacity errors.
- Budget alerts notify you about spending but do not automatically stop it.
- Do not use identifiable patient data until you have completed your privacy,
  consent, data-processing, and regulatory review.
