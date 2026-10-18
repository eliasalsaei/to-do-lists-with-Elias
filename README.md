# ✅ To-dos with Elias

A simple shared to-do list app for the family, built the same way as [Budget with Elias](https://github.com/eliasalsaei/Budget-with-Elias-).

## Features
- **Priorities**: every to-do is **High**, **Medium** or **Low**. The list is grouped by priority, and you can tap a to-do's priority tag to change it.
- **Categories**: Home, Groceries, Errands, Work, Personal and Other to start with. You can add your own (Kids, Car, Garden, Pharmacy and so on) with an emoji and a colour, and rename or delete them.
- **Quick add**: type a to-do, pick a category and priority, then press Enter. "Add with details" lets you set a due date, a quantity (handy for groceries, e.g. "2" or "1 kg"), notes, and who is doing it.
- **Filter and sort**: filter by category, by priority or with search, and sort by priority, due date or newest. Overdue and due-today to-dos are highlighted.
- **Done**: tick a to-do to complete it. The tick can be undone, deleted to-dos can be brought back with **Undo**, and the Done screen shows what was finished each day and by whom.
- **Share with your wife**: both of you see and edit the same list in real time, each signed in with your own Google account.
- **Works offline, on any network**: install it on your phone's home screen and it opens without internet. Changes made offline are saved on the phone and sync when it's back online, on Wi-Fi or mobile data. You don't need to be on the same network.
- Light, dark or auto theme, a JSON backup and restore, and it works on phone and desktop.

## How to use
**Put it on your phone:** enable **GitHub Pages** for this repository (Settings → Pages → Deploy from branch → `main`, folder `/ (root)`). The app will then be at `https://eliasalsaei.github.io/to-do-lists-with-Elias/`. Open that link on your phone, then use **Share → Add to Home Screen** (iPhone) or **Install app** (Android).

**Run on your computer:** serve the folder and open it in a browser:
```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

### Sharing with your wife
1. Open **Settings → Cloud sync → Sign in with Google**.
2. Under **Share with family**, tap **Share invite link** and send it on WhatsApp or by message (or tap **Copy**).
3. She opens the link on her phone and signs in with her own Google account. That's it: you now share one list, and changes show up on both phones within a second or two.

If she already has to-dos of her own, the app offers to move them into the shared list. You can rename the list under **Settings → Share with family → Rename list**.

## Your data & Firebase
Without signing in, to-dos are stored only in that browser. Once you sign in they are saved in Firestore and also cached on the phone, which is what makes offline use work.

This app uses the **same Firebase project as the budget app** (`budget-with-elias`), so Google sign-in and the `eliasalsaei.github.io` authorised domain are already set up. You only need to do one thing:

**Firebase console → Firestore Database → Rules**: replace the rules with the contents of [`firestore.rules`](firestore.rules), then click **Publish**.

This file contains the rules for **both** apps: your budget stays private to you, and a to-do list can only be read by its members. Publish this whole file. Don't publish only the budget app's old rules, because then to-do sync stops working. If you set up a brand-new Firebase project instead, put its settings in `firebase-config.js` and follow the same steps as in the budget app's README.

How the data is stored:
- `spaces/{listId}` holds the list's name, its members, and its categories.
- `spaces/{listId}/items/{todoId}` holds one document per to-do, so two people editing at the same time don't overwrite each other.

The invite link contains the list's ID. Anyone with the link can join, so share it only with people you trust. Members can be seen under **Share with family**.

## Files
| File | What it does |
|---|---|
| `index.html`, `styles.css` | Page layout and design |
| `app.js` | The app: to-dos, categories, filters, forms, local storage |
| `sync.js` | Google sign-in, Firestore sync, sharing and invite links |
| `firebase-config.js` | Firebase project settings (public by design) |
| `firestore.rules` | Security rules for Firestore (shared with the budget app) |
| `sw.js`, `manifest.json`, `icon.svg` | Offline support and home-screen install |
