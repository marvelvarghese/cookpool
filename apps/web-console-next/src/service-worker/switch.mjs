// THE SERVICE WORKER'S KILL SWITCH (Cookpool PW-4).
//
// "on": the build writes the real worker to `/sw.js` and pages register it.
// "off": the build writes a worker that takes over from any installed one
// at once, deletes every Cookpool cache, unregisters itself and reloads the
// pages it controlled from the network; and pages unregister instead of
// registering. Use it when a worker is pinning people to a broken app:
// apps/web-console-next/docs/runbook.md says how.

export const SERVICE_WORKER = "on";
