# Twitter Unleashed

> The public square of the internet shouldn't be censored and controlled by a single human being.

---

It's bad enough that one man owns the town square, curates your feed, and decides what you see first. He controls the platform. He controls the algorithm. He controls the For You page. Fine — we can't change that today.

But the **comments**? The replies? The actual conversation?

No. That's ours!

Twitter Unleashed is a Chrome Extension that takes back the small freedoms X quietly removed — starting with **persistent reply sorting**. Every time you open a tweet, X resets your sort to whatever *it* decides is "relevant." This extension remembers what *you* chose and applies it automatically. Every. Single. Time.

It's a small act of defiance. But it's a start.

---

## What It Does

| Feature | Description |
|---|---|
| 🔓 **Persistent Reply Sort** | Choose **Likes**, **Newest**, or **Relevant** once — it sticks. On every tweet. Forever. |
| ⚡ **Zero friction** | Works silently in the background. No clicks, no popups, no interruptions. |
| 🧱 **Built to grow** | Modular architecture — new features drop in with one line of code. |

---

## Install

```bash
git clone https://github.com/AbrahamBisrat/Twitter-Unleashed.git
```

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `Twitter-Unleashed/` folder
4. Pin it. Use it. Take back your feed.

---

## Usage

Click the extension icon:

- **Master toggle** — kill switch for all features
- **Reply Sort** — pick your default: `Likes` · `Newest` · `Relevant`

Your choice syncs across Chrome profiles and survives restarts.

---

## Project Structure

```
Twitter-Unleashed/
├── manifest.json      # Chrome MV3 manifest
├── content.js         # Feature host — SPA navigation + lifecycle router
├── popup.html         # Extension popup
├── popup.css          # Dark theme (matches X's aesthetic, ironically)
├── popup.js           # Settings logic
└── icons/
    └── twitter.png    # Extension icon
```

---

## Adding Features

Every feature is a self-contained module. The contract:

```js
const myFeature = {
  id: 'myFeature',
  init(store) { },
  onNavigate(url, store) { },
  onStorageChange(changes, store) { },
  cleanup() { },
};
```

To activate it, one line in `content.js`:

```js
register(myFeature);
```

The host handles SPA navigation, storage broadcasting, and lifecycle management. Your feature just responds.

---

## How It Works (Technical)

- **No class name selectors** — X obfuscates everything. We use ARIA labels, `data-testid`, SVG path matching, and text scanning.
- **Infinite loop guard** — our own clicks don't re-trigger the automation.
- **Race condition safe** — `MutationObserver` waits for X's lazy-loaded reply section.
- **SPA-aware** — intercepts `history.pushState` and `popstate` to catch React navigation.
- **Lightweight** — no background worker. One permission: `storage`.

---

## Permissions

| Permission | Why |
|---|---|
| `storage` | Save your preferences. That's it. |

---

## The Point

This isn't about one feature. It's about the principle.

When a platform removes your ability to control your own experience — even something as small as how comments are sorted — that's not a product decision. That's control.

Twitter Unleashed exists because you should decide what you see. Not an algorithm. Not a billionaire. **You.**

---

<p align="center"><i>"The internet routes around censorship."</i></p>
<p align="center">— John Gilmore</p>
