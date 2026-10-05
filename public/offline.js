/* The public fallback renders only explicitly saved, scoped structured data.
   Keep the IndexedDB protocol aligned with src/lib/offline.ts. No HTML is trusted. */
(() => {
  const DATABASE = "sift-offline-v1", CHANNEL = "sift-offline", DISABLED = "sift-offline-disabled";
  const main = document.getElementById("main");
  let generation = 0, coverUrl, expiryTimer;
  let channel = null;
  try { if ("BroadcastChannel" in window) channel = new BroadcastChannel(CHANNEL); } catch { /* Use storage events instead. */ }
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  }
  function reset() {
    main.replaceChildren();
    if (coverUrl) URL.revokeObjectURL(coverUrl);
    coverUrl = undefined;
    clearTimeout(expiryTimer);
  }
  function empty(message = "No recipes are saved for this account on this device. Reconnect and open a recipe to make it available here.") {
    reset(); main.append(element("h1", "You’re offline."), element("p", message));
    document.title = "Offline · Sift";
  }
  function database() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("meta")) request.result.createObjectStore("meta");
        if (!request.result.objectStoreNames.contains("snapshots")) request.result.createObjectStore("snapshots", { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = request.onblocked = () => reject(new Error("Storage unavailable"));
    });
  }
  async function read() {
    const db = await database();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(["meta", "snapshots"]);
        const active = tx.objectStore("meta").get("active"), snapshots = tx.objectStore("snapshots").getAll();
        tx.oncomplete = () => resolve({ active: active.result, snapshots: snapshots.result });
        tx.onerror = tx.onabort = () => reject(new Error("Storage unavailable"));
      });
    } finally { db.close(); }
  }
  async function clear(announce = true) {
    generation++; empty();
    try { localStorage.setItem(DISABLED, "1"); } catch { /* IndexedDB may still be available. */ }
    if (announce) {
      channel?.postMessage({ type: "cleared" });
      try { localStorage.setItem(CHANNEL, JSON.stringify({ type: "cleared", nonce: crypto.randomUUID() })); } catch { /* Best effort. */ }
    }
    try {
      const db = await database();
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(["meta", "snapshots"], "readwrite");
          tx.objectStore("meta").clear(); tx.objectStore("snapshots").clear();
          tx.oncomplete = resolve; tx.onerror = tx.onabort = reject;
        });
      } finally { db.close(); }
    } catch { /* The tombstone blocks reads if storage cannot be cleared. */ }
  }
  function valid(row, active) {
    return row.scopeKey === active.key && row.epoch === active.epoch && row.expiresAt > Date.now()
      && typeof row.recipeId === "string" && typeof row.versionId === "string"
      && row.content && typeof row.content.title === "string" && Array.isArray(row.content.instructionSections)
      && Array.isArray(row.displayIngredientSections);
  }
  function link(row) {
    return `/recipes/${encodeURIComponent(row.recipeId)}${row.cooking ? `?cook=${encodeURIComponent(row.cooking.id)}` : ""}`;
  }
  function index(rows) {
    reset(); document.title = "Saved recipes · Sift";
    main.append(element("h1", "Your saved recipes."), element("p", "Recently opened recipes on this device. Reconnect for current versions and saved changes."));
    const list = element("ul", undefined, "cards");
    for (const row of rows.sort((a, b) => b.savedAt - a.savedAt)) {
      const item = element("li"), anchor = element("a"); anchor.href = link(row);
      anchor.append(element("strong", row.content.title), element("span", `${row.cooking ? "Cooking session · " : ""}Version ${row.versionNumber} · ${new Date(row.savedAt).toLocaleDateString()}`));
      item.append(anchor); list.append(item);
    }
    main.append(list);
  }
  function recipe(row) {
    reset(); document.title = `${row.content.title} · Offline · Sift`;
    const back = element("a", "← Saved recipes", "back"); back.href = "/offline.html"; main.append(back);
    if (row.cover instanceof Blob && /^image\/(webp|png|jpeg)$/.test(row.cover.type)) {
      const image = element("img", undefined, "cover"); coverUrl = URL.createObjectURL(row.cover);
      image.src = coverUrl; image.alt = row.content.title; main.append(image);
    }
    main.append(element("h1", row.content.title));
    if (row.content.description) main.append(element("p", row.content.description));
    main.append(element("p", `${row.cooking ? `Cooking session (${row.cooking.status}) · ` : ""}Version ${row.versionNumber} · ${row.cooking?.servings ?? row.content.servings} servings · Saved ${new Date(row.savedAt).toLocaleString()}`, "meta"));
    main.append(element("h2", "Ingredients"));
    row.displayIngredientSections.forEach((section, sectionIndex) => {
      if (section.name) main.append(element("h3", section.name));
      const list = element("ul", undefined, "checklist");
      section.items.forEach((text, itemIndex) => {
        const item = element("li"), label = element("label"), checkbox = element("input"); checkbox.type = "checkbox";
        checkbox.checked = row.cooking?.checkedIngredients?.includes(`${sectionIndex}:${itemIndex}`) ?? false;
        label.append(checkbox, element("span", text)); item.append(label); list.append(item);
      }); main.append(list);
    });
    main.append(element("h2", "Instructions"));
    let stepNumber = 0;
    row.content.instructionSections.forEach((section, sectionIndex) => {
      if (section.name) main.append(element("h3", section.name));
      const list = element("ol", undefined, "checklist steps");
      section.steps.forEach((text, itemIndex) => {
        const item = element("li"), label = element("label"), checkbox = element("input"); checkbox.type = "checkbox";
        if (row.cooking?.currentStep === stepNumber) item.className = "current";
        checkbox.checked = row.cooking?.checkedSteps?.includes(`${sectionIndex}:${itemIndex}`) ?? false;
        label.append(checkbox, element("span", `${++stepNumber}.`, "step-number"), element("span", text)); item.append(label); list.append(item);
      }); main.append(list);
    });
  }
  async function load() {
    const run = ++generation;
    try {
      if (localStorage.getItem(DISABLED) === "1") { empty(); return; }
      const data = await read(), active = data.active;
      if (run !== generation) return;
      if (!active || !Number.isFinite(active.expiresAt) || active.expiresAt <= Date.now()) { await clear(); return; }
      // Recheck a reachable server before showing cached data. A failed network
      // request may still use the unexpired, last authenticated local scope.
      if (navigator.onLine) {
        try {
          const response = await fetch("/api/offline/session", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(4000) });
          if (run !== generation) return;
          if (response.status === 401) { await clear(); return; }
          if (response.ok) {
            const current = await response.json();
            if (current.userId !== active.userId || current.workspaceId !== active.workspaceId || Date.parse(current.sessionExpiresAt) <= Date.now()) { await clear(); return; }
          }
        } catch { /* Offline operation is expected here. */ }
      }
      if (run !== generation || localStorage.getItem(DISABLED) === "1") return;
      const rows = data.snapshots.filter((row) => valid(row, active));
      const url = new URL(location.href), match = url.pathname.match(/^\/recipes\/([a-f0-9-]{36})$/i);
      if (match) {
        const sessionId = url.searchParams.get("cook"), key = sessionId ? `cooking:${sessionId}` : `recipe:${match[1]}`;
        const found = rows.find((row) => row.key === key && row.recipeId === match[1]);
        if (found) recipe(found); else empty("This recipe or exact cooking session is not saved on this device. Reconnect and open it once to make it available offline.");
      } else if (["/", "/library", "/offline.html"].includes(url.pathname)) {
        if (rows.length) index(rows); else empty();
      } else empty("This page needs a connection. Your recently opened recipes are available through Saved recipes.");
      expiryTimer = setTimeout(() => { void clear(); }, Math.max(0, Math.min(active.expiresAt, ...rows.map((row) => row.expiresAt)) - Date.now()));
    } catch { if (run === generation) empty("Offline storage is unavailable in this browser. Reconnect to open your cookbook."); }
  }
  document.getElementById("clear").addEventListener("click", () => { void clear(); });
  if (channel) channel.onmessage = (event) => { if (event.data?.type === "cleared") { generation++; empty(); } else void load(); };
  window.addEventListener("storage", (event) => {
    if (event.key === DISABLED && event.newValue === "1") { generation++; empty(); }
    if (event.key === CHANNEL && event.newValue) {
      try { if (JSON.parse(event.newValue).type === "cleared") { generation++; empty(); } else void load(); } catch { /* Ignore malformed browser state. */ }
    }
  });
  window.addEventListener("online", () => { void load(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void load(); });
  void load();
})();
