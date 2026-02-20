/**
 * Antigravity — Popup Script
 *
 * Reads from and writes to chrome.storage.sync.
 * Designed to be feature-aware: each feature section in popup.html
 * is independent. Adding a new feature = reading/writing its own
 * storage key, no need to touch other sections.
 */

// ─── Default state ────────────────────────────────────────────────────────────

const DEFAULTS = {
    enabled: true,
    replySort: { preference: 'Likes' },
    // When you add a new feature, add its default here:
    // myFeature: { someOption: 'default' },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function getStorage(keys) {
    return new Promise((resolve) => chrome.storage.sync.get(keys, resolve));
}

function setStorage(items) {
    return new Promise((resolve) => chrome.storage.sync.set(items, resolve));
}

// ─── Master Toggle ────────────────────────────────────────────────────────────

const masterToggle = document.getElementById('masterToggle');

masterToggle.addEventListener('change', async () => {
    const enabled = masterToggle.checked;
    await setStorage({ enabled });
    document.body.classList.toggle('disabled', !enabled);
});

// ─── Reply Sort Feature ───────────────────────────────────────────────────────

const sortOptionCards = document.querySelectorAll('#sortOptions .option-card');

function selectSortCard(value) {
    sortOptionCards.forEach((card) => {
        const isSelected = card.dataset.value === value;
        card.classList.toggle('selected', isSelected);
        card.setAttribute('aria-checked', String(isSelected));
    });
}

sortOptionCards.forEach((card) => {
    card.addEventListener('click', async () => {
        const preference = card.dataset.value;
        selectSortCard(preference);
        await setStorage({ replySort: { preference } });
    });
});

// ─── New Feature Hook (template) ─────────────────────────────────────────────
// When adding a new feature section to popup.html, add a matching
// read block in loadState() and a write block in the event listener above.

// ─── Init: Load saved state ───────────────────────────────────────────────────

async function loadState() {
    const data = await getStorage(DEFAULTS);

    // Master toggle
    const enabled = data.enabled !== false;
    masterToggle.checked = enabled;
    document.body.classList.toggle('disabled', !enabled);

    // Reply sort
    const pref = data.replySort?.preference ?? DEFAULTS.replySort.preference;
    selectSortCard(pref);

    // Future features: read data.myFeature here
}

loadState();
