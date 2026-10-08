# Deploying to Netlify

Fifteen minutes, once. After this, ten to twenty medical posts share one live
board and every patient PDF lands in your Drive folder with no Google login on
any field device.

---

## 1. Build

```bash
python3 build/build_dist.py
```

Produces `dist/` — that is the publish directory. There is no npm install, no
bundler and no lockfile; the app is plain JavaScript on purpose, because the
thing that must never fail at 2 a.m. is the build you did not re-run.

## 2. Create the site

**Drag and drop (fastest):** open <https://app.netlify.com/drop> and drop the
`dist` folder. Then go to **Site configuration → Build & deploy → Functions**
and point the functions directory at `netlify/functions` — or use the Git route
below, which wires it up for you.

**From Git (recommended for a real event):** push this folder to a repository
and connect it. `netlify.toml` already declares everything:

| setting | value |
|---|---|
| Build command | `python3 build/build_dist.py` |
| Publish directory | `dist` |
| Functions directory | `netlify/functions` |

No dependencies are installed, so the build takes a couple of seconds.

## 3. Switch on Netlify Blobs

The shared live board uses Netlify Blobs. On current Netlify sites it is on by
default and needs no configuration. If `/api/sync` returns a 500 mentioning
blobs, enable it under **Site configuration → Blobs**.

Each device writes only its own blob, so twenty posts writing at once never
collide. A post with no signal keeps working from IndexedDB and drains its
queue when the signal returns.

## 4. Wire up Google Drive

This is the part worth doing carefully. The field devices never see a Google
credential — one service account on the server does all the writing.

### 4.1 Make a service account

1. <https://console.cloud.google.com/> → create or pick a project.
2. **APIs & Services → Library** → enable **Google Drive API**.
3. **APIs & Services → Credentials → Create credentials → Service account**.
   Name it something you will recognise in a share dialog, e.g.
   `event-emr-writer`.
4. Open the service account → **Keys → Add key → Create new key → JSON**.
   Download it. This file is a password: do not commit it.
5. Copy the service account's email — it looks like
   `event-emr-writer@your-project.iam.gserviceaccount.com`.

### 4.2 Share the destination folder

1. In Google Drive, create the folder the event should write into.
2. **Share** it with the service account email, as **Editor**.
3. Open the folder and copy its id out of the URL:
   `https://drive.google.com/drive/folders/`**`1AbC...xyz`**

> A service account has no Drive storage of its own. It can only write into
> folders a human has shared with it — which is exactly the "one folder, and
> only that folder" behaviour the brief asks for.

### 4.3 Set the environment variables

**Site configuration → Environment variables:**

| key | value |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | the entire contents of the downloaded JSON key |
| `GDRIVE_FOLDER_ID` | the folder id from step 4.2 |
| `GDRIVE_SHARED_DRIVE_ID` | *(optional)* only if the folder lives on a Shared Drive |

Paste the JSON exactly as downloaded, newlines and all — Netlify handles it.

Redeploy so the functions pick the variables up.

### 4.4 Test it

Open the app → **Settings → Google Drive → Test the connection**. A green light
naming your folder means every post can now write to it. A red light says
exactly what is wrong.

---

## What lands in Drive

```
<your shared folder>/
└── <Event name>/
    ├── Recap - <Event name>.xlsx      rewritten in place, so its link never changes
    └── Patients/
        ├── JRF-ICU-0001-andi-pratama.pdf
        ├── JRF-P01-0002-siti-rahayu.pdf
        └── …
```

Editing a patient and re-uploading **overwrites that patient's own PDF** — the
app remembers the Drive file id on the record, so the link you gave the
receiving hospital keeps resolving to the current chart. The same is true of
the recap: one file, updated, never a pile of `Recap (3).xlsx`.

Turn on **Settings → Google Drive → Upload automatically when a record closes**
and the field team never has to think about any of this.

---

## Running the posts

1. Deploy once. Send every post the same URL.
2. On each device: **Settings → This device → posted at** — choose the post.
   This is the only per-device setup, and it is what makes the MRNs unique
   (`JRF-P03-0007`) while every post is offline.
3. Put the device's user in **Who is using this device** so vitals, orders and
   notes sign themselves.
4. The command post leaves the **Board** open. It shows every post's beds and
   pulls anyone who needs a decision to the top.

Add the app to the home screen (Share → Add to Home Screen) and it runs
full-screen with the service worker caching the shell, so a post that opened it
once keeps working through a total signal blackout.

---

## Security notes, honestly stated

- The configuration passcode (**89370** by default) guards bed, post,
  ambulance and formulary changes on the device. It is a *workflow* lock that
  stops a volunteer reshaping the bed board mid-event — it is not
  authentication, and it does not protect the data from someone holding the
  unlocked tablet.
- `/api/sync` and `/api/drive` are **unauthenticated** by default. Anyone who
  knows the URL and the event id can read and write that event's records.
  For a real event with real patients, put the site behind Netlify's
  password protection or Identity before you hand the link out, and treat the
  event id as a secret.
- Patient data lives in each device's IndexedDB, in Netlify Blobs, and in your
  Drive folder. Clearing a device (**Settings → Data → Clear all data**) does
  not touch the other two.
- The service account key is a credential with write access to that folder.
  Rotate it after the event if the Netlify site was shared widely.
