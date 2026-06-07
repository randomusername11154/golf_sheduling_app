# Sagamore Tee Bot - Setup (5 minutes, one time)

This app books your Saturday/Sunday tee time for you automatically.
You set it up once. After that it runs by itself every weekend.

There is no Terminal, no installing Node, no editing code. Just follow
the four steps below in order.

---

## Easiest option: let Claude set it up for you

If you have Claude (the AI app) on this Mac, you don't have to do any of
the steps below yourself. Just open Claude, point it at this project
folder, and tell it:

> "Set up the Sagamore Tee Bot. Follow CLAUDE.md."

Claude will build the app, install it, run a safe test to make sure the
login works, and tell you if anything needs your attention. It will ask
you for your member number, password, and tee-time preferences when it's
ready. If a tee time ever fails to book, you can open Claude again and
say "the tee bot didn't work this weekend, check the logs" and it will
diagnose and fix it.

If you'd rather do it by hand, follow the four steps below instead.

---

## Step 1 - Put the app where it lives

1. Open the folder you unzipped.
2. Drag **Sagamore Tee Bot** into your **Applications** folder.

(Keep the two `.command` files near it - you'll only ever need them if
you want to turn the bot off later.)

---

## Step 2 - First launch (clears Apple's one-time security warning)

Because this app was made by a friend and not bought from the App Store,
macOS shows a one-time warning. This is normal. Here's how to get past it:

1. Open **Applications**, find **Sagamore Tee Bot**.
2. **Right-click** it (or Control-click) and choose **Open**.
3. If macOS says it can't be opened:
   - Open the Apple menu -> **System Settings** -> **Privacy & Security**.
   - Scroll to the bottom. You'll see a line about "Sagamore Tee Bot was
     blocked." Click **Open Anyway**.
   - Enter your Mac password if asked, then click **Open** again.

You only ever do this once.

> If it still says the app is "damaged": open the **Applications** folder,
> and there is a file in your download called **"Fix Security (run if blocked).command"** -
> double-click it. Then try opening the app again. (Only needed on some Macs.)

---

## Step 3 - Enter your details

When the app opens, it asks you a few simple questions:

- Your **member number** (e.g. `12345`, or `12345-S` for a spouse account)
- Your **portal password**
- The **tee time** you want (e.g. `8:10`)
- **How many players** (1-4)
- **Which days** (Saturday and Sunday / Saturday only / Sunday only)

When you're done it will say **"All set!"**

It may also:
- Ask for your **Mac password** once - this lets it wake your Mac on
  weekend mornings. Click OK and enter it.
- Show a **notifications** permission pop-up - click **Allow** so it can
  tell you when it books your tee time.

---

## Step 4 - Leave the Mac plugged in on Friday nights

For the bot to wake up and book at 7:00 AM, your Mac needs power.

- **Plug it in Friday night.** The lid can be closed - that's fine.
- Do **not** fully shut it down (sleep is fine, shut down is not).

That's it. Every Saturday and Sunday morning it logs in, grabs your tee
time the instant it opens, and sends you a notification like:

> **Tee time booked!** Booked 8:10 AM for Saturday!

---

## How do I know it's working?

- You'll get a **notification** each weekend morning (success or "couldn't
  get it this time").
- To see a history, open **Finder**, press **Cmd+Shift+G**, and paste:
  `~/Library/Application Support/SagamoreTeeBot/activity.log`

## Changing your time, players, or days later

Just open the **Sagamore Tee Bot** app again and choose **Change Settings**.

## Turning it off

- **Pause it:** open the app, choose **Turn Off**. (Or double-click
  **Turn Off Tee Bot.command**.)
- **Remove it completely:** double-click **Uninstall Tee Bot.command**,
  then drag the app to the Trash.

---

## A few honest notes

- The very first weekend, watch for the notification. If it says it
  couldn't log in, double-check your member number and password by
  opening the app and choosing **Change Settings**.
- If your Mac is on battery with the lid closed, macOS may refuse to wake
  it. Keep it plugged in on Friday night and you're golden.
