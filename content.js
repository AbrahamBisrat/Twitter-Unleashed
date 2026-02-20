/**
 * Antigravity — Content Script Host
 *
 * This file is the lightweight router/host for all feature modules.
 * It handles SPA navigation detection and broadcasts lifecycle events
 * to every registered feature.
 *
 * ─────────────────────────────────────────────
 * HOW TO ADD A NEW FEATURE
 * ─────────────────────────────────────────────
 * 1. Create a new file in features/ that implements the feature contract:
 *
 *    const myFeature = {
 *      id: 'myFeature',                    // unique storage namespace key
 *      init(store) { ... },               // called once on page load
 *      onNavigate(url, store) { ... },    // called on every SPA URL change
 *      onStorageChange(changes) { ... },  // called when chrome.storage changes
 *      cleanup() { ... },                 // called before re-navigation / teardown
 *    };
 *    export default myFeature;
 *
 * 2. Import and register it here:
 *    import myFeature from './features/myFeature.js';
 *    register(myFeature);
 * ─────────────────────────────────────────────
 *
 * NOTE: Chrome MV3 content scripts don't support ES module imports natively
 * when using content_scripts in manifest.json. Features are inlined below.
 * If you switch to a bundler (e.g. esbuild/rollup), you can use real imports.
 */

// ─── Feature Registry ────────────────────────────────────────────────────────

const _features = [];

/**
 * Registers a feature module with the host.
 * @param {Object} feature - must implement the feature contract
 */
function register(feature) {
    if (!feature.id) {
        console.error('[Antigravity] Feature missing required "id" field:', feature);
        return;
    }
    _features.push(feature);
}

// ─── Shared Storage Proxy ────────────────────────────────────────────────────

/**
 * A simple async wrapper around chrome.storage.sync.
 * Features interact with storage exclusively through this proxy.
 */
const store = {
    async get(keys) {
        return new Promise((resolve) => chrome.storage.sync.get(keys, resolve));
    },
    async set(items) {
        return new Promise((resolve) => chrome.storage.sync.set(items, resolve));
    },
};

// ─── Lifecycle Broadcasts ────────────────────────────────────────────────────

function broadcastInit() {
    _features.forEach((f) => {
        try { f.init(store); }
        catch (e) { console.error(`[Antigravity] ${f.id}.init() error:`, e); }
    });
}

function broadcastNavigate(url) {
    _features.forEach((f) => {
        try {
            if (typeof f.cleanup === 'function') f.cleanup();
            f.onNavigate(url, store);
        }
        catch (e) { console.error(`[Antigravity] ${f.id}.onNavigate() error:`, e); }
    });
}

function broadcastStorageChange(changes) {
    _features.forEach((f) => {
        try { f.onStorageChange(changes, store); }
        catch (e) { console.error(`[Antigravity] ${f.id}.onStorageChange() error:`, e); }
    });
}

// ─── SPA Navigation Detection ─────────────────────────────────────────────────

let _currentUrl = location.href;

function handleUrlChange() {
    const newUrl = location.href;
    if (newUrl !== _currentUrl) {
        _currentUrl = newUrl;
        broadcastNavigate(newUrl);
    }
}

// Override pushState to catch React/SPA navigation
const _originalPushState = history.pushState.bind(history);
history.pushState = function (...args) {
    _originalPushState(...args);
    handleUrlChange();
};

// Also catch browser back/forward
window.addEventListener('popstate', handleUrlChange);

// ─── Storage Change Listener ──────────────────────────────────────────────────

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') broadcastStorageChange(changes);
});

// =============================================================================
// FEATURE: Reply Sort (features/replySort.js — inlined)
// =============================================================================
//
// Features MUST be defined before being registered below.
// The boot block runs last, after all registrations.

/**
 * replySortFeature
 *
 * Automatically applies the user's preferred reply sort order on X.com
 * tweet detail pages (/status/ URLs).
 *
 * Storage shape:
 *   { enabled: boolean, replySort: { preference: 'Likes' | 'Newest' | 'Relevant' } }
 *
 * 2025 X.com UI Notes:
 *   - The sort button is ICON-ONLY (a "sliders" SVG), no text or accessible label.
 *   - The dropdown menu items are: "Likes", "Newest", "Relevant".
 *   - We find the button by matching the SVG path data of the sliders icon.
 */
const replySortFeature = (() => {
    // ── Constants ──────────────────────────────────────────────────────
    const SORT_OPTIONS = ['Likes', 'Newest', 'Relevant'];
    const DEFAULT_PREF = 'Likes';
    const CLICK_DELAY_MS = 300;   // ms to wait for the dropdown to open
    const GUARD_RESET_MS = 3000;  // ms to suppress re-triggering after a sort
    const RETRY_DELAY_MS = 500;   // ms between retries to find dropdown items

    // Known SVG path fragments for X's "sliders" sort icon.
    // We keep partial strings so minor path changes don't break detection.
    const SORT_ICON_SVG_HINTS = [
        'M3 4h3.5',          // Typical horizontal-sliders icon start
        'M9.5 4H21',         // Middle segment of the sliders icon
        'M3 12h8.5',         // Second slider bar
        'M14.5 12H21',       // Second slider bar continued
        'adjustments',       // Potential aria-label keyword
        'M.5 3.5',           // Alternative sliders icon variant
        'sliders',           // Potential title/label
        'sort',              // Potential data-testid
    ];

    // ── State ──────────────────────────────────────────────────────────
    let observer = null;
    let isSorting = false;
    let guardTimeout = null;
    let currentPref = DEFAULT_PREF;
    let isEnabled = true;
    let lastSortedUrl = '';  // Prevent re-sorting same page

    // ── Helpers ────────────────────────────────────────────────────────

    function isStatusPage(url) {
        return /x\.com\/.+\/status\/\d+|twitter\.com\/.+\/status\/\d+/.test(url);
    }

    /**
     * Finds the sort button using multiple strategies (most → least specific).
     * Never relies on obfuscated CSS class names.
     */
    function findSortButton() {
        // Strategy 1: aria-label (may still work on some locales/versions)
        let btn = document.querySelector(
            '[aria-label*="Sort" i], [aria-label*="sort" i]'
        );
        if (btn) return btn;

        // Strategy 2: data-testid containing "sort"
        btn = document.querySelector('[data-testid*="sort" i], [data-testid*="Sort" i]');
        if (btn) return btn;

        // Strategy 3: Find the sliders SVG icon by its path data
        const allSvgs = document.querySelectorAll('svg');
        for (const svg of allSvgs) {
            const paths = svg.querySelectorAll('path');
            for (const path of paths) {
                const d = path.getAttribute('d') || '';
                // Check if ANY of our hint fragments match the path data
                for (const hint of SORT_ICON_SVG_HINTS) {
                    if (d.includes(hint)) {
                        // The clickable button is an ancestor of the SVG
                        const clickable =
                            svg.closest('[role="button"]') ||
                            svg.closest('button') ||
                            svg.closest('[tabindex]') ||
                            svg.parentElement;
                        if (clickable) return clickable;
                    }
                }
            }
            // Also check aria-label on the SVG itself
            const svgLabel = (svg.getAttribute('aria-label') || '').toLowerCase();
            if (svgLabel.includes('sort') || svgLabel.includes('adjust') || svgLabel.includes('slider')) {
                const clickable =
                    svg.closest('[role="button"]') ||
                    svg.closest('button') ||
                    svg.closest('[tabindex]') ||
                    svg.parentElement;
                if (clickable) return clickable;
            }
        }

        // Strategy 4: Text scan fallback (older UI)
        const spans = document.querySelectorAll('span');
        for (const span of spans) {
            const text = span.textContent.trim().toLowerCase();
            if (
                (text.includes('sort') && text.includes('repl')) ||
                text === 'sort by'
            ) {
                const clickable = span.closest('[role="button"]') || span.closest('button');
                if (clickable) return clickable;
            }
        }

        return null;
    }

    /**
     * Finds a dropdown menu option by its visible text label.
     * Searches broadly across multiple possible container roles.
     */
    function findMenuOption(label) {
        const labelLower = label.toLowerCase();

        // Search in menu items (role=menuitem, role=option, or generic div menu items)
        const candidates = document.querySelectorAll(
            '[role="menuitem"], [role="option"], [role="menu"] [role="menuitemradio"], ' +
            '[role="listbox"] [role="option"], [data-testid*="sort"], ' +
            '[role="menu"] div, [role="listbox"] div'
        );
        for (const item of candidates) {
            if (item.textContent.trim().toLowerCase() === labelLower) return item;
        }

        // Broad fallback: scan all visible spans inside any overlay/dropdown layer
        const allSpans = document.querySelectorAll(
            '[role="menu"] span, [role="listbox"] span, ' +
            '[data-testid*="Dropdown"] span, [data-testid*="dropdown"] span, ' +
            '[id*="layers"] span'
        );
        for (const span of allSpans) {
            if (span.textContent.trim().toLowerCase() === labelLower) return span;
        }

        return null;
    }

    /**
     * Main sort action: opens the dropdown and selects the preference.
     */
    async function applySort(preference) {
        if (isSorting) return;

        const sortBtn = findSortButton();
        if (!sortBtn) return;

        isSorting = true;
        clearTimeout(guardTimeout);

        try {
            // Click to open the dropdown
            sortBtn.click();

            // Wait for the dropdown to render (X animates it in)
            await new Promise((r) => setTimeout(r, CLICK_DELAY_MS));

            // Try to find the option, with one retry if not found immediately
            let option = findMenuOption(preference);
            if (!option) {
                // X can be slow to render the menu — retry once
                await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
                option = findMenuOption(preference);
            }

            if (option) {
                option.click();
                lastSortedUrl = location.href;
                console.log(`[Twitter Unleashed:replySort] Sorted by "${preference}"`);
            } else {
                console.warn(
                    `[Twitter Unleashed:replySort] Could not find menu option: "${preference}". ` +
                    `Available items:`, getVisibleMenuItems()
                );
                // Try to close the dropdown gracefully
                const escEvent = new KeyboardEvent('keydown', {
                    key: 'Escape', code: 'Escape', keyCode: 27,
                    bubbles: true, cancelable: true,
                });
                document.body.dispatchEvent(escEvent);
                // Also try clicking the sort button again to close it
                setTimeout(() => { try { sortBtn.click(); } catch (_) { } }, 100);
            }
        } catch (e) {
            console.error('[Twitter Unleashed:replySort] Error during sort:', e);
        }

        // Reset guard after a safe delay
        guardTimeout = setTimeout(() => { isSorting = false; }, GUARD_RESET_MS);
    }

    /**
     * Debug helper: lists all visible text in menu/dropdown areas.
     */
    function getVisibleMenuItems() {
        const items = [];
        document.querySelectorAll(
            '[role="menuitem"], [role="option"], [role="menu"] span, [role="listbox"] span'
        ).forEach((el) => {
            const text = el.textContent.trim();
            if (text && !items.includes(text)) items.push(text);
        });
        return items;
    }

    /**
     * Starts a MutationObserver that waits for the sort button to appear,
     * applies the sort, then disconnects.
     */
    function startObserver(preference) {
        if (observer) { observer.disconnect(); observer = null; }

        // Don't re-sort if we already sorted this exact URL
        if (lastSortedUrl === location.href) return;

        // Quick synchronous check first (button might already be in DOM)
        const existing = findSortButton();
        if (existing) { applySort(preference); return; }

        let attempts = 0;
        const MAX_ATTEMPTS = 80; // ~40s at MutationObserver cadence

        observer = new MutationObserver(() => {
            if (isSorting) return;
            if (++attempts > MAX_ATTEMPTS) {
                observer.disconnect();
                observer = null;
                console.log('[Twitter Unleashed:replySort] Gave up waiting for sort button.');
                return;
            }

            const sortBtn = findSortButton();
            if (sortBtn) {
                observer.disconnect();
                observer = null;
                applySort(preference);
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    // ── Feature Contract ───────────────────────────────────────────────

    async function init(store) {
        const data = await store.get(['enabled', 'replySort']);
        isEnabled = data.enabled !== false; // default true
        currentPref = data.replySort?.preference ?? DEFAULT_PREF;
    }

    function onNavigate(url, store) {
        lastSortedUrl = '';  // Reset on navigation so new page gets sorted
        if (!isEnabled) return;
        if (!isStatusPage(url)) return;
        startObserver(currentPref);
    }

    function onStorageChange(changes) {
        if ('enabled' in changes) {
            isEnabled = changes.enabled.newValue !== false;
        }
        if ('replySort' in changes) {
            currentPref = changes.replySort.newValue?.preference ?? DEFAULT_PREF;
        }
    }

    function cleanup() {
        if (observer) { observer.disconnect(); observer = null; }
        clearTimeout(guardTimeout);
        isSorting = false;
    }

    return { id: 'replySort', init, onNavigate, onStorageChange, cleanup };
})();

// ─── Feature Registrations ───────────────────────────────────────────────────
// Add new features here, one register() call per feature.

register(replySortFeature);
// register(myNextFeature);  // ← drop your next feature in here

// ─── Boot ────────────────────────────────────────────────────────────────────
// Must run AFTER all features are registered.

broadcastInit();
broadcastNavigate(location.href);
