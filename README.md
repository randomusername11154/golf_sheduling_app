# Sagamore Tee Bot

An app for your Mac that automatically books your weekend golf tee time at the
Sagamore Club. It logs in every Saturday and Sunday morning, grabs your tee
time the instant it opens, and sends you a notification. You set it up once and
then forget about it.

---

## The only step you need: let Claude do it

You do **not** need to understand any of this or use Terminal. If you have the
**Claude** app on your Mac, just do this:

1. Download this project to your Mac (green **Code** button above ->
   **Download ZIP**, then unzip it). Or if you know git: `git clone` it.
2. Open the **Claude** app.
3. Point Claude at the folder you just unzipped and tell it:

   > **"Set up the Sagamore Tee Bot. Follow CLAUDE.md."**

That's it. Claude will:

- build the app,
- install it into your Applications,
- ask you for your member number, password, tee time, and which days,
- run a safe test to make sure it can actually log in and see your tee time,
- and tell you if anything needs your attention.

When Claude says it's done, you're done.

---

## When it's running

- Every Saturday and Sunday morning you'll get a notification like
  **"Tee time booked! 8:10 AM for Saturday!"**
- **Leave your Mac plugged in on Friday night** so it can wake up and book.
  The lid can be closed - just keep it on power, and don't shut it all the way
  down (sleep is fine).

## If a tee time ever doesn't book

Open the **Claude** app again, point it at this folder, and say:

> **"The tee bot didn't book this weekend. Check the logs and fix it."**

Claude keeps detailed logs and screenshots of every attempt, so it can figure
out what went wrong and repair it on its own - without you having to gather any
information.

## To change your tee time, players, or days later

Open the **Sagamore Tee Bot** app from your Applications folder and choose
**Change Settings**.

## To turn it off

Open the app and choose **Turn Off**, or run the **Turn Off Tee Bot** file that
came with it.

---

## Prefer to do it by hand (no Claude)?

Everything is doable manually. See **[FRIEND-SETUP.md](FRIEND-SETUP.md)** for the
step-by-step human guide.

## For the curious / technical

- **[CLAUDE.md](CLAUDE.md)** - the runbook Claude follows to build, install, and
  troubleshoot.
- **[SPEC.md](SPEC.md)** - the full technical specification of how it works.

---

### Notes

- Works on **Apple Silicon Macs** (M1/M2/M3/M4 - any Mac from late 2020 on),
  macOS 12 or newer.
- Your password is stored only on your own Mac, in a private settings file. It
  is never uploaded anywhere and is not part of this project.
- The first time you open the app, macOS shows a one-time security warning
  because the app didn't come from the App Store. Claude (or the manual guide)
  walks you through the 30-second approval. This is normal and only happens once.
