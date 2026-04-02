# Twitter Unleashed

> A Chrome Extension that gives you persistent control over your X.com experience.

---

X resets your reply sort order to "Relevant" every time you open a tweet. That's annoying. Twitter Unleashed remembers your preference and applies it automatically — on every tweet, every time.

## Features

| Feature | Description |
|---|---|
| **Persistent Reply Sort** | Choose **Likes**, **Recent**, or **Relevant** once — it sticks on every tweet. |
| **Zero friction** | Works silently in the background. No clicks, no interruptions. |
| **Built to grow** | Modular architecture — new features drop in with one line of code. |

## Upcoming features
- `Blocking` & `Unfollowing` with `one tap` and not even a confirmation; If a single tap allows me to follow the same should apply for unfollow and block.


## Usage

Click the extension icon:

- **Master toggle** — enable/disable all features
- **Reply Sort** — pick your default: `Likes` · `Recent` · `Relevant`

Your choice syncs across Chrome profiles and survives restarts.

---

## Project Structure

```
Twitter-Unleashed/
├── manifest.json      # Chrome MV3 manifest
├── background.js      # SPA navigation detection
├── content.js         # Feature host + automation logic
├── popup.html/css/js  # Extension popup UI
└── icons/
    └── twitter.png
```

---

## Adding Features

Every feature is a self-contained module:

```js
const myFeature = {
  id: 'myFeature',
  init(store) { },
  onNavigate(url, store) { },
  onStorageChange(changes, store) { },
  cleanup() { },
};
```

One line to activate: `register(myFeature);`

---

## How It Works

- **No class name selectors** — uses ARIA attributes and text content, resilient to X's obfuscated CSS
- **SPA-aware** — background script detects navigation via `webNavigation` API
- **Race condition safe** — `MutationObserver` + delayed retries wait for lazy-loaded content
- **Lightweight** — two permissions: `storage` + `webNavigation`

---

## Contributing

This is an open-source project — contributions, ideas, and bug reports are welcome.  
Open an issue or submit a PR on [GitHub](https://github.com/AbrahamBisrat/Twitter-Unleashed).

---

## Permissions

| Permission | Why |
|---|---|
| `storage` | Save your preferences |
| `webNavigation` | Detect page navigation in X's single-page app |

---

<p align="center"><b>Your feed. Your rules!</b></p>
