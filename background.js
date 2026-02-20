/**
 * Twitter Unleashed — Background Service Worker
 *
 * Detects SPA navigation on X.com using the webNavigation API
 * and notifies the content script whenever the URL changes.
 * This is necessary because content scripts run in an isolated
 * world and cannot intercept X.com's history.pushState calls.
 */

chrome.webNavigation.onHistoryStateUpdated.addListener(
    (details) => {
        // Only care about top-level frames, not iframes
        if (details.frameId !== 0) return;

        chrome.tabs.sendMessage(details.tabId, {
            type: 'URL_CHANGED',
            url: details.url,
        }).catch(() => {
            // Content script may not be ready yet — that's fine
        });
    },
    {
        url: [
            { hostSuffix: 'x.com' },
            { hostSuffix: 'twitter.com' },
        ],
    }
);
