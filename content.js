/**
 * Twitter Unleashed — Content Script
 *
 * SPA NAVIGATION DETECTION (Chrome Extension isolated world):
 *   Content scripts CANNOT override history.pushState. We use:
 *     1. Messages from background.js (webNavigation.onHistoryStateUpdated)
 *     2. URL polling every second (fallback)
 *
 * ─────────────────────────────────────────────
 * HOW TO ADD A NEW FEATURE
 * ─────────────────────────────────────────────
 * 1. Define a feature object:
 *    { id, init(store), onNavigate(url, store), onStorageChange(changes), cleanup() }
 * 2. Register at the bottom: register(myFeature);
 * ─────────────────────────────────────────────
 */

(function () {
    'use strict';

    // ─── Feature Registry ────────────────────────────────────────────

    const _features = [];

    function register(feature) {
        if (!feature.id) return;
        _features.push(feature);
        console.log(`[TU] Registered: ${feature.id}`);
    }

    // ─── Storage Proxy ───────────────────────────────────────────────

    const store = {
        get(keys) { return new Promise(r => chrome.storage.sync.get(keys, r)); },
        set(items) { return new Promise(r => chrome.storage.sync.set(items, r)); },
    };

    // ─── Lifecycle Broadcasts ────────────────────────────────────────

    function broadcastInit() {
        _features.forEach(f => {
            try { f.init(store); } catch (e) { console.error(`[TU] ${f.id}.init:`, e); }
        });
    }

    function broadcastNavigate(url) {
        _features.forEach(f => {
            try {
                if (typeof f.cleanup === 'function') f.cleanup();
                f.onNavigate(url, store);
            } catch (e) { console.error(`[TU] ${f.id}.onNavigate:`, e); }
        });
    }

    function broadcastStorageChange(changes) {
        _features.forEach(f => {
            try { f.onStorageChange(changes, store); } catch (e) { console.error(`[TU] ${f.id}.onStorageChange:`, e); }
        });
    }

    // ─── SPA Navigation ──────────────────────────────────────────────

    let _currentUrl = location.href;

    function checkUrl() {
        const u = location.href;
        if (u !== _currentUrl) {
            _currentUrl = u;
            console.log('[TU] URL changed:', u);
            broadcastNavigate(u);
        }
    }

    // Method 1: background.js messages
    chrome.runtime.onMessage.addListener(msg => {
        if (msg.type === 'URL_CHANGED' && msg.url !== _currentUrl) {
            _currentUrl = msg.url;
            console.log('[TU] URL changed (bg):', msg.url);
            broadcastNavigate(msg.url);
        }
    });

    // Method 2: polling fallback
    setInterval(checkUrl, 1000);

    // Method 3: popstate (back/forward)
    window.addEventListener('popstate', () => setTimeout(checkUrl, 50));

    // ─── Storage listener ────────────────────────────────────────────

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync') broadcastStorageChange(changes);
    });

    // =================================================================
    // FEATURE: Reply Sort
    // =================================================================
    //
    // X.com 2025 DOM (confirmed via live inspection):
    //
    //   Sort button:
    //     <button role="button" aria-haspopup="menu">
    //       <span>Relevant</span>  ← or "Recent" or "Likes"
    //       <svg> (chevron-down) </svg>
    //     </button>
    //
    //   Dropdown menu:
    //     <div role="menu">
    //       <div role="menuitem">Relevant</div>
    //       <div role="menuitem">Recent</div>
    //       <div role="menuitem">Likes</div>
    //     </div>
    //
    //   Menu option labels: "Relevant", "Recent", "Likes"
    //   (NOT "Newest", NOT "Most Liked", NOT "Top")
    //
    // Storage: { enabled: bool, replySort: { preference: 'Likes'|'Recent'|'Relevant' } }

    const replySortFeature = (() => {
        const DEFAULT_PREF = 'Likes';
        const CLICK_DELAY = 400;
        const GUARD_MS = 3000;
        const SORT_LABELS = ['relevant', 'recent', 'likes'];

        let observer = null;
        let isSorting = false;
        let guardTimer = null;
        let preference = DEFAULT_PREF;
        let enabled = true;
        let sortedUrl = '';

        function isStatusPage(url) {
            return /\/(x|twitter)\.com\/.+\/status\/\d/.test(url);
        }

        // ── Find the sort button ─────────────────────────────────────
        //
        // The sort button is a <button> with:
        //   - role="button"
        //   - aria-haspopup="menu"
        //   - Inner text is one of: "Relevant", "Recent", "Likes"
        //   - Contains a chevron-down SVG
        //
        // This is the most reliable selector because it targets the
        // exact semantic structure X uses.

        function findSortButton() {
            // Strategy 1: button with aria-haspopup="menu" whose text
            //             matches a known sort label
            const buttons = document.querySelectorAll(
                'button[aria-haspopup="menu"], [role="button"][aria-haspopup="menu"]'
            );
            for (const btn of buttons) {
                const text = btn.textContent.trim().toLowerCase();
                if (SORT_LABELS.includes(text)) {
                    return btn;
                }
            }

            // Strategy 2: any clickable element whose text is a sort label
            //             and sits near the reply section (below the main tweet)
            for (const el of document.querySelectorAll('[role="button"], button')) {
                const text = el.textContent.trim().toLowerCase();
                if (SORT_LABELS.includes(text) && looksLikeSortButton(el)) {
                    return el;
                }
            }

            // Strategy 3: look for aria-label containing "sort"
            const ariaBtn = document.querySelector('[aria-label*="Sort" i], [aria-label*="sort" i]');
            if (ariaBtn) return ariaBtn;

            // Strategy 4: data-testid fallback
            const testIdBtn = document.querySelector('[data-testid*="sort" i], [data-testid*="Sort" i]');
            if (testIdBtn) return testIdBtn;

            return null;
        }

        // Heuristic: is this element likely the sort button (not a random button)?
        function looksLikeSortButton(el) {
            // Must contain an SVG (the chevron icon)
            if (el.querySelector('svg')) return true;
            // Or be small (sort button is compact, not a big action button)
            const rect = el.getBoundingClientRect();
            return rect.width < 200 && rect.height < 50;
        }

        // ── Find a menu option ───────────────────────────────────────

        function findMenuOption(label) {
            const lower = label.toLowerCase();

            // menuitem / option elements
            for (const el of document.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="option"]')) {
                if (el.textContent.trim().toLowerCase() === lower) return el;
            }

            // X renders overlays inside #layers
            for (const el of document.querySelectorAll('#layers [role="menu"] div, #layers [role="listbox"] div, #layers span')) {
                if (el.textContent.trim().toLowerCase() === lower) {
                    // Prefer the menuitem parent if it exists
                    const mi = el.closest('[role="menuitem"]') || el.closest('[role="option"]') || el;
                    return mi;
                }
            }

            return null;
        }

        // ── Apply sort ───────────────────────────────────────────────

        async function applySort() {
            if (isSorting) return;

            const btn = findSortButton();
            if (!btn) {
                console.log('[TU:sort] Sort button not found yet');
                return;
            }

            // Check if already sorted to the desired preference
            const currentSort = btn.textContent.trim().toLowerCase();
            if (currentSort === preference.toLowerCase()) {
                console.log(`[TU:sort] Already sorted by "${preference}", skipping`);
                sortedUrl = location.href;
                return;
            }

            isSorting = true;
            clearTimeout(guardTimer);

            try {
                console.log(`[TU:sort] Current: "${currentSort}" → Want: "${preference}". Clicking...`);
                btn.click();

                await sleep(CLICK_DELAY);

                // Find and click the desired option
                let opt = findMenuOption(preference);
                if (!opt) {
                    // Retry after a bit more time
                    await sleep(500);
                    opt = findMenuOption(preference);
                }

                if (opt) {
                    opt.click();
                    sortedUrl = location.href;
                    console.log(`[TU:sort] ✓ Sorted by "${preference}"`);
                } else {
                    console.warn(`[TU:sort] Option "${preference}" not found. Visible:`, getMenuItems());
                    pressEscape();
                }
            } catch (e) {
                console.error('[TU:sort] Error:', e);
            }

            guardTimer = setTimeout(() => { isSorting = false; }, GUARD_MS);
        }

        function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

        function pressEscape() {
            document.body.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true,
            }));
        }

        function getMenuItems() {
            const s = new Set();
            document.querySelectorAll('[role="menuitem"], [role="option"], [role="menu"] span, #layers span')
                .forEach(el => { const t = el.textContent.trim(); if (t) s.add(t); });
            return [...s];
        }

        // ── Observer ─────────────────────────────────────────────────

        function startObserver() {
            stopObserver();
            if (sortedUrl === location.href) return;

            // Immediate check
            if (findSortButton()) { applySort(); return; }

            let checks = 0;
            observer = new MutationObserver(() => {
                if (isSorting) return;
                if (++checks > 120) { stopObserver(); return; }
                if (findSortButton()) { stopObserver(); applySort(); }
            });
            observer.observe(document.body, { childList: true, subtree: true });

            // Delayed retries (in case observer fires too early before button is interactive)
            setTimeout(() => trySort(), 2000);
            setTimeout(() => trySort(), 4000);
            setTimeout(() => trySort(), 7000);
        }

        function trySort() {
            if (!isSorting && sortedUrl !== location.href && findSortButton()) {
                stopObserver();
                applySort();
            }
        }

        function stopObserver() {
            if (observer) { observer.disconnect(); observer = null; }
        }

        // ── Feature Contract ─────────────────────────────────────────

        async function init(st) {
            const data = await st.get({ enabled: true, replySort: { preference: DEFAULT_PREF } });
            enabled = data.enabled !== false;
            preference = data.replySort?.preference || DEFAULT_PREF;
            console.log(`[TU:sort] Init — enabled=${enabled}, pref=${preference}`);
        }

        function onNavigate(url) {
            sortedUrl = '';
            if (!enabled) return;
            if (!isStatusPage(url)) return;
            console.log('[TU:sort] Status page → watching for sort button...');
            startObserver();
        }

        function onStorageChange(changes) {
            if ('enabled' in changes) enabled = changes.enabled.newValue !== false;
            if ('replySort' in changes) preference = changes.replySort.newValue?.preference || DEFAULT_PREF;
        }

        function cleanup() {
            stopObserver();
            clearTimeout(guardTimer);
            isSorting = false;
        }

        return { id: 'replySort', init, onNavigate, onStorageChange, cleanup };
    })();

    // ─── Register & Boot ─────────────────────────────────────────────

    register(replySortFeature);

    broadcastInit();
    broadcastNavigate(location.href);

    console.log('[TU] Twitter Unleashed loaded.');
})();
