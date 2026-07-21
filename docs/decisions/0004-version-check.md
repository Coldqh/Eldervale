# ADR 0004: published version verification

The installed client embeds its package version at build time. Vite also emits an uncached `version.json` file.

The application checks this file on launch and when returning to the foreground. A mismatch marks the PWA as outdated. The version control panel can request a service worker update or force a clean reload by clearing application caches and unregistering the old worker. IndexedDB career saves are not removed.
