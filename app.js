/* PocketBridge v0.1.5
   - URLを貼る → 本文を抽出して表示
   - 単語：タップで収集
   - フレーズ：長押しで選択 → 収集
   - 収集箱 → TANGO-CHOへ送る
*/

const APP_VERSION = "0.1.5";
const STORE_KEY = "pocketbridge_store_v1";

const els = {
  urlInput: document.getElementById("urlInput"),
  btnLoad: document.getElementById("btnLoad"),
  btnClear: document.getElementById("btnClear"),
  status: document.getElementById("status"),
  useJina: document.getElementById("useJina"),
  wrapWords: document.getElementById("wrapWords"),
  articleTitle: document.getElementById("articleTitle"),
  articleMeta: document.getElementById("articleMeta"),
  reader: document.getElementById("reader"),
  btnPocket: document.getElementById("btnPocket"),
  pocketCount: document.getElementById("pocketCount"),
  drawer: document.getElementById("drawer"),
  drawerOverlay: document.getElementById("drawerOverlay"),
  btnCloseDrawer: document.getElementById("btnCloseDrawer"),
  pocketList: document.getElementById("pocketList"),
  btnCopyAll: document.getElementById("btnCopyAll"),
  btnClearSent: document.getElementById("btnClearSent"),
  phraseBar: document.getElementById("phraseBar"),
  phrasePreview: document.getElementById("phrasePreview"),
  btnCollectPhrase: document.getElementById("btnCollectPhrase"),
  btnCancelPhrase: document.getElementById("btnCancelPhrase"),
  btnHistory: document.getElementById("btnHistory"),
  historyModal: document.getElementById("historyModal"),
  btnCloseHistory: document.getElementById("btnCloseHistory"),
  btnClearHistory: document.getElementById("btnClearHistory"),
  historyList: document.getElementById("historyList"),
  toast: document.getElementById("toast"),
};

const state = {
  settings: {
    useJinaFallback: true,
    wrapWords: true,
    openMode: "newtab", // "newtab" | "same"
  },
  current: {
    url: "",
    title: "",
    text: "",
    source: "",
    fetchedAt: 0,
  },
  pocket: {
    items: [], // {id,key,text,kind,count,createdAt,lastAt,sentCount,lastSentAt}
    filter: "all", // all|unsent|sent
  },
  history: [], // {url,title,at}
  cache: {}, // { [url]: {url,title,text,source,fetchedAt} }
};

function now() { return Date.now(); }

const FETCH_TIMEOUT_MS = 9000; // Android体感のため少し短め

function pruneCache(maxEntries = 10) {
  try {
    const entries = Object.entries(state.cache || {});
    if (entries.length <= maxEntries) return;
    entries.sort((a,b) => (b[1]?.fetchedAt||0) - (a[1]?.fetchedAt||0));
    const keep = new Set(entries.slice(0, maxEntries).map(e => e[0]));
    for (const k of Object.keys(state.cache)) {
      if (!keep.has(k)) delete state.cache[k];
    }
  } catch {}
}

function setCacheItem(item) {
  if (!item?.url) return;
  state.cache[item.url] = { url: item.url, title: item.title||"", text: item.text||"", source: item.source||"", fetchedAt: item.fetchedAt||now() };
  pruneCache(10);
}

function getCacheItem(url) {
  return (state.cache && state.cache[url]) ? state.cache[url] : null;
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort("timeout"), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

function showArticle(item, toastMsg) {
  if (!item?.text) return;
  els.articleTitle.textContent = item.title || (item.url ? new URL(item.url).hostname : "");
  els.articleMeta.textContent = `${item.url ? new URL(item.url).hostname : ""} • ${item.source === "jina" ? "抽出" : "直取得"} • ${fmtDate(item.fetchedAt || now())}`;
  setReaderText(item.text, els.wrapWords.checked);
  setStatus("");
  if (toastMsg) toast(toastMsg);
}

function saveStore() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      v: APP_VERSION,
      settings: state.settings,
      pocket: state.pocket,
      history: state.history,
      cache: state.cache,
    }));
  } catch {}
}

function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data?.settings) state.settings = { ...state.settings, ...data.settings };
    if (data?.pocket?.items) state.pocket.items = data.pocket.items;
    if (data?.history) state.history = data.history;
    if (data?.cache) state.cache = data.cache;
  } catch {}
}

function setStatus(msg) {
  els.status.textContent = msg || "";
}

let toastTimer = null;
function toast(msg) {
  if (!msg) return;
  els.toast.textContent = msg;
  els.toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add("hidden"), 1600);
}

function normalizeSpaces(s) {
  return (s ?? "").replace(/\u3000/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeUrl(u) {
  let s = (u ?? "").trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try { new URL(s); return s; } catch { return ""; }
}

// Pasteや共有で「タイトル + URL」が混ざることがあるため、最初のURLだけを抜き出す
function extractFirstUrlFromText(text) {
  const s = (text ?? "").trim();
  if (!s) return "";

  // 1) http(s)://... を優先
  const m1 = s.match(/https?:\/\/[^\s]+/i);
  if (m1) return m1[0];

  // 2) スキームなしドメイン（例: bbc.com/news..., share.google/..., example.co.uk/...）
  const m2 = s.match(/(?:^|\s)((?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[\w\-\._~%!$&'()*+,;=:@\/?#\[\]]*)?)/i);
  if (m2) return m2[1];

  return "";
}

function normalizeUrlFromMixedText(text) {
  const u = extractFirstUrlFromText(text);
  return normalizeUrl(u);
}

function looksLikeUrl(s) {
  const t = (s ?? "").trim();
  return /^https?:\/\//i.test(t) || /^[a-z0-9.-]+\.[a-z]{2,}\//i.test(t) || /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(t);
}

function cleanJinaOutput(text) {
  let t = (text ?? "").replace(/\r\n/g, "\n");
  // Optional: cut off common "Buttons & Links" or "Images" sections if present
  const cutMarkers = ["\nButtons & Links\n", "\nImages\n", "\nリンク\n", "\nButtons and Links\n"];
  let cutAt = -1;
  for (const m of cutMarkers) {
    const i = t.indexOf(m);
    if (i !== -1) cutAt = cutAt === -1 ? i : Math.min(cutAt, i);
  }
  if (cutAt !== -1) t = t.slice(0, cutAt);
  return t.trim();
}

function extractTitleFromText(text) {
  const lines = (text ?? "").split("\n").map(l => l.trim()).filter(Boolean);
  for (const l of lines.slice(0, 10)) {
    const m = l.match(/^#{1,3}\s+(.{3,120})$/);
    if (m) return m[1].trim();
  }
  // sometimes: "Title: ..."
  for (const l of lines.slice(0, 10)) {
    const m = l.match(/^Title:\s*(.{3,120})$/i);
    if (m) return m[1].trim();
  }
  return "";
}

function htmlToText(html, baseUrl) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  // remove noisy / dangerous nodes
  const kill = ["script","style","noscript","iframe","svg","canvas","form","input","button","nav","footer","header","aside","dialog"];
  kill.forEach(sel => doc.querySelectorAll(sel).forEach(n => n.remove()));

  // best effort: pick main content
  let root = doc.querySelector("article") || doc.querySelector("main") || doc.body;
  if (!root) root = doc.body;

  // Convert links to show as text with URL at end (readable)
  root.querySelectorAll("a[href]").forEach(a => {
    const href = a.getAttribute("href");
    let abs = "";
    try { abs = new URL(href, baseUrl).toString(); } catch {}
    const label = (a.textContent || "").trim();
    const rep = doc.createElement("span");
    rep.textContent = label ? label : abs;
    a.replaceWith(rep);
  });

  // Keep paragraphs and line breaks
  root.querySelectorAll("br").forEach(br => br.replaceWith(doc.createTextNode("\n")));
  root.querySelectorAll("p").forEach(p => {
    p.appendChild(doc.createTextNode("\n\n"));
  });
  root.querySelectorAll("li").forEach(li => {
    li.insertBefore(doc.createTextNode("• "), li.firstChild);
    li.appendChild(doc.createTextNode("\n"));
  });

  const text = (root.innerText || root.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
  const title =
    doc.querySelector('meta[property="og:title"]')?.getAttribute("content")?.trim() ||
    doc.querySelector("title")?.textContent?.trim() ||
    "";
  return { title, text };
}

async function fetchDirect(url) {
  const res = await fetchWithTimeout(url, { cache: "no-store" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("text/html") && !ct.includes("application/xhtml+xml")) {
    // still try to read as text
  }
  const html = await res.text();
  return html;
}

async function fetchViaJina(url) {
  // Jina Reader: simply prepend r.jina.ai
  // docs: https://jina.ai/reader/  (public URLs向け)
  const target = "https://r.jina.ai/" + url;
  const res = await fetchWithTimeout(target, { cache: "no-store" });
  if (!res.ok) throw new Error("Jina HTTP " + res.status);
  return await res.text();
}

function setReaderText(text, wrapWords) {
  els.reader.innerHTML = "";
  if (!wrapWords) {
    els.reader.textContent = text;
    return;
  }

  const t = text ?? "";
  const frag = document.createDocumentFragment();

  const wordRe = /[A-Za-z0-9]+(?:[-’'][A-Za-z0-9]+)*/g;
  let last = 0;
  let m;
  while ((m = wordRe.exec(t)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (start > last) frag.appendChild(document.createTextNode(t.slice(last, start)));
    const sp = document.createElement("span");
    sp.className = "w";
    sp.textContent = m[0];
    sp.dataset.t = m[0];
    frag.appendChild(sp);
    last = end;
  }
  if (last < t.length) frag.appendChild(document.createTextNode(t.slice(last)));

  els.reader.appendChild(frag);
}

function pocketKey(text, kind) {
  const base = normalizeSpaces(text)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .toLowerCase();
  return kind + "::" + base;
}

function stripEdgePunct(s) {
  let t = normalizeSpaces(s);
  t = t.replace(/^[\s"'“”‘’\(\)\[\]\{\}<>.,;:!?、。]+/g, "");
  t = t.replace(/[\s"'“”‘’\(\)\[\]\{\}<>.,;:!?、。]+$/g, "");
  return t.trim();
}

function addToPocket(rawText, forcedKind = null) {
  let text = stripEdgePunct(rawText);
  if (!text) return;

  const kind = forcedKind || (/\s/.test(text) ? "phrase" : "word");
  const key = pocketKey(text, kind);

  const idx = state.pocket.items.findIndex(it => it.key === key);
  if (idx !== -1) {
    const it = state.pocket.items[idx];
    it.count = (it.count || 1) + 1;
    it.lastAt = now();
  } else {
    state.pocket.items.unshift({
      id: crypto.randomUUID ? crypto.randomUUID() : String(now()) + Math.random().toString(16).slice(2),
      key,
      text,
      kind,
      count: 1,
      createdAt: now(),
      lastAt: now(),
      sentCount: 0,
      lastSentAt: 0
    });
  }

  saveStore();
  updatePocketBadge();
  renderPocket();
  toast(kind === "word" ? `収集：${text}` : `フレーズ収集：${text}`);
}

function updatePocketBadge() {
  const n = state.pocket.items.length;
  els.pocketCount.textContent = String(n);
}

function isSent(it) {
  return (it.sentCount || 0) > 0;
}

function renderPocket() {
  const filter = state.pocket.filter;
  const list = state.pocket.items.filter(it => {
    if (filter === "all") return true;
    if (filter === "unsent") return !isSent(it);
    if (filter === "sent") return isSent(it);
    return true;
  });

  els.pocketList.innerHTML = "";
  if (list.length === 0) {
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.textContent = "まだ何も入っていません。本文の単語をタップすると入ります。";
    els.pocketList.appendChild(empty);
    return;
  }

  for (const it of list) {
    const card = document.createElement("div");
    card.className = "item";

    const top = document.createElement("div");
    top.className = "item__top";

    const txt = document.createElement("div");
    txt.className = "item__text";
    txt.textContent = it.text;

    top.appendChild(txt);
    card.appendChild(top);

    const meta = document.createElement("div");
    meta.className = "item__meta";

    const pKind = document.createElement("span");
    pKind.className = "pill";
    pKind.textContent = it.kind === "word" ? "単語" : "フレーズ";
    meta.appendChild(pKind);

    const pCount = document.createElement("span");
    pCount.className = "pill";
    pCount.textContent = `回数：${it.count || 1}`;
    meta.appendChild(pCount);

    const sent = document.createElement("span");
    sent.className = "pill" + (isSent(it) ? " is-sent" : "");
    sent.textContent = isSent(it) ? `送信済（${it.sentCount}）` : "未送信";
    meta.appendChild(sent);

    card.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "item__actions";

    const btnSend = document.createElement("button");
    btnSend.className = "btn btn--primary btn--small";
    btnSend.type = "button";
    btnSend.textContent = "TANGO-CHOへ送る";
    btnSend.addEventListener("click", () => {
      openTangoCho(it.text);
      it.sentCount = (it.sentCount || 0) + 1;
      it.lastSentAt = now();
      saveStore();
      renderPocket();
    });
    actions.appendChild(btnSend);

    const btnCopy = document.createElement("button");
    btnCopy.className = "btn btn--ghost btn--small";
    btnCopy.type = "button";
    btnCopy.textContent = "コピー";
    btnCopy.addEventListener("click", async () => {
      await copyText(it.text);
      toast("コピーしました");
    });
    actions.appendChild(btnCopy);

    const btnDel = document.createElement("button");
    btnDel.className = "btn btn--ghost btn--small";
    btnDel.type = "button";
    btnDel.textContent = "削除";
    btnDel.addEventListener("click", () => {
      state.pocket.items = state.pocket.items.filter(x => x.id !== it.id);
      saveStore();
      updatePocketBadge();
      renderPocket();
      toast("削除しました");
    });
    actions.appendChild(btnDel);

    card.appendChild(actions);
    els.pocketList.appendChild(card);
  }
}

async function copyText(s) {
  try {
    await navigator.clipboard.writeText(s);
  } catch {
    // fallback
    const ta = document.createElement("textarea");
    ta.value = s;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

function openTangoCho(text) {
  const url = "https://masato-nasu.github.io/TANGO-CHO/?word=" + encodeURIComponent(text);
  if (state.settings.openMode === "same") {
    location.href = url;
  } else {
    window.open(url, "_blank", "noopener");
  }
}

function openDrawer() {
  els.drawerOverlay.classList.remove("hidden");
  els.drawer.classList.remove("hidden");
  renderPocket();
}
function closeDrawer() {
  els.drawerOverlay.classList.add("hidden");
  els.drawer.classList.add("hidden");
}

function openHistory() {
  renderHistory();
  els.historyModal.classList.remove("hidden");
}
function closeHistory() {
  els.historyModal.classList.add("hidden");
}

function addHistory(url, title) {
  const t = title?.trim() || url;
  const existing = state.history.find(h => h.url === url);
  const at = now();
  if (existing) {
    existing.title = t;
    existing.at = at;
    state.history = [existing, ...state.history.filter(h => h.url !== url)];
  } else {
    state.history.unshift({ url, title: t, at });
  }
  state.history = state.history.slice(0, 30);
  saveStore();
}

function fmtDate(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleString("ja-JP", { month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" });
  } catch { return ""; }
}

function renderHistory() {
  els.historyList.innerHTML = "";
  if (state.history.length === 0) {
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.textContent = "履歴はまだありません。";
    els.historyList.appendChild(empty);
    return;
  }

  for (const h of state.history) {
    const row = document.createElement("div");
    row.className = "hrow";
    row.tabIndex = 0;

    const t = document.createElement("div");
    t.className = "hrow__title";
    t.textContent = h.title || "Untitled";
    row.appendChild(t);

    const u = document.createElement("div");
    u.className = "hrow__url";
    u.textContent = h.url;
    row.appendChild(u);

    const m = document.createElement("div");
    m.className = "hrow__meta";
    m.textContent = fmtDate(h.at);
    row.appendChild(m);

    row.addEventListener("click", () => {
      els.urlInput.value = h.url;
      closeHistory();
      loadFromInput();
    });

    els.historyList.appendChild(row);
  }
}

async function loadFromInput() {
  const url = normalizeUrlFromMixedText(els.urlInput.value);
  if (!url) {
    toast("URLが正しくありません");
    return;
  }

  // 入力欄もURLだけに整形（タイトル混入を見た目から消す）
  els.urlInput.value = url;

  // まずはキャッシュがあれば即表示（体感改善）
  const cached = getCacheItem(url);
  if (cached && cached.text && cached.text.length >= 80) {
    state.current = cached;
    showArticle(cached, "キャッシュから表示");
    setStatus("更新中…");
  } else {
    setStatus("読み込み中…");
  }

  els.btnLoad.disabled = true;

  try {
    const tasks = [];

    // Direct fetch（CORSが通る場合は速い）
    tasks.push((async () => {
      const html = await fetchDirect(url);
      const out = htmlToText(html, url);
      return { title: out.title || "", text: out.text || "", source: "direct" };
    })());

    // Jina fallback（多くのサイトで安定。ただし遅い場合あり）
    if (els.useJina.checked) {
      tasks.push((async () => {
        const raw = await fetchViaJina(url);
        const cleaned = cleanJinaOutput(raw);
        return { title: extractTitleFromText(cleaned) || "", text: cleaned, source: "jina" };
      })());
    }

    // 先に成功したものを採用
    let result;
    try {
      result = await Promise.any(tasks);
    } catch (e) {
      // すべて失敗
      throw e;
    }

    let title = result.title || "";
    let text = result.text || "";
    let source = result.source || "direct";

    if (!text || text.length < 80) {
      throw new Error("本文が取れませんでした");
    }

    if (!title) title = new URL(url).hostname;
    state.current = { url, title, text, source, fetchedAt: now() };

    els.articleTitle.textContent = title;
    els.articleMeta.textContent = `${new URL(url).hostname} • ${source === "jina" ? "抽出" : "直取得"} • ${fmtDate(state.current.fetchedAt)}`;

    setReaderText(text, els.wrapWords.checked);
    addHistory(url, title);

    // キャッシュ保存（次回は即表示）
    setCacheItem(state.current);
    saveStore();

    setStatus("");
    toast("読み込みました");
  } catch (e) {
    console.error(e);
    setStatus("読み込みに失敗しました。URLを確認してください。");
    toast("読み込み失敗");
  } finally {
    els.btnLoad.disabled = false;
  }
}

/* Phrase capture */
let selRaf = 0;
function updatePhraseBar() {
  selRaf = 0;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) {
    hidePhraseBar();
    return;
  }
  const txt = normalizeSpaces(sel.toString());
  if (!txt) {
    hidePhraseBar();
    return;
  }

  // selection must be inside reader
  const r = sel.getRangeAt(0);
  const inside = els.reader.contains(r.commonAncestorContainer);
  if (!inside) {
    hidePhraseBar();
    return;
  }

  const preview = txt.length > 60 ? (txt.slice(0, 60) + "…") : txt;
  els.phrasePreview.textContent = preview;
  els.phraseBar.classList.remove("hidden");
}

function hidePhraseBar() {
  els.phraseBar.classList.add("hidden");
  els.phrasePreview.textContent = "";
}

function clearSelection() {
  const sel = window.getSelection();
  if (sel) sel.removeAllRanges();
}

/* Events */
els.btnLoad.addEventListener("click", loadFromInput);
els.urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadFromInput();
});
// タイトル + URL を貼り付けた時にURLだけ残す
els.urlInput.addEventListener("paste", (e) => {
  try {
    const text = (e.clipboardData || window.clipboardData)?.getData("text") || "";
    const url = normalizeUrlFromMixedText(text);
    if (url) {
      e.preventDefault();
      els.urlInput.value = url;
      toast("URLだけに整形しました");
    }
  } catch {}
});
els.btnClear.addEventListener("click", () => {
  els.urlInput.value = "";
  setStatus("");
  toast("クリアしました");
});

els.useJina.addEventListener("change", () => {
  state.settings.useJinaFallback = els.useJina.checked;
  saveStore();
});
els.wrapWords.addEventListener("change", () => {
  state.settings.wrapWords = els.wrapWords.checked;
  saveStore();
  if (state.current.text) setReaderText(state.current.text, els.wrapWords.checked);
});

els.btnPocket.addEventListener("click", openDrawer);
els.btnCloseDrawer.addEventListener("click", closeDrawer);
els.drawerOverlay.addEventListener("click", closeDrawer);

els.btnHistory.addEventListener("click", openHistory);
els.btnCloseHistory.addEventListener("click", closeHistory);
els.btnClearHistory.addEventListener("click", () => {
  state.history = [];
  saveStore();
  renderHistory();
  toast("履歴を消しました");
});

document.querySelectorAll(".seg__btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".seg__btn").forEach(b => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    state.pocket.filter = btn.dataset.filter;
    saveStore();
    renderPocket();
  });
});

els.btnCopyAll.addEventListener("click", async () => {
  const list = state.pocket.items.filter(it => !isSent(it));
  if (list.length === 0) { toast("未送信がありません"); return; }
  const text = list.map(it => it.text).join("\n");
  await copyText(text);
  toast("未送信をコピーしました");
});

els.btnClearSent.addEventListener("click", () => {
  const before = state.pocket.items.length;
  state.pocket.items = state.pocket.items.filter(it => !isSent(it));
  saveStore();
  updatePocketBadge();
  renderPocket();
  toast(before === state.pocket.items.length ? "送信済がありません" : "送信済を削除しました");
});

els.reader.addEventListener("click", (e) => {
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed) return; // selecting
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;
  if (!target.classList.contains("w")) return;

  const word = target.dataset.t || target.textContent || "";
  if (!word) return;

  // visual feedback
  target.classList.add("is-hit");
  setTimeout(() => target.classList.remove("is-hit"), 160);

  addToPocket(word, "word");
});

document.addEventListener("selectionchange", () => {
  if (selRaf) return;
  selRaf = requestAnimationFrame(updatePhraseBar);
});

els.btnCollectPhrase.addEventListener("click", () => {
  const sel = window.getSelection();
  const txt = stripEdgePunct(sel ? sel.toString() : "");
  if (!txt) return;
  addToPocket(txt, "phrase");
  clearSelection();
  hidePhraseBar();
});

els.btnCancelPhrase.addEventListener("click", () => {
  clearSelection();
  hidePhraseBar();
});

/* Init */
function init() {
  loadStore();

  els.useJina.checked = !!state.settings.useJinaFallback;
  els.wrapWords.checked = !!state.settings.wrapWords;

  updatePocketBadge();
  renderPocket();

  // share_target / deep link: ?url=... / ?text=... （BBC等で「タイトル + URL」が混ざっていても拾う）
  const sp = new URLSearchParams(location.search);

  // Android共有（Web Share Target）では、アプリによって
  // - url= にURLが入る
  // - text= に「タイトル + 改行 + URL」が入る
  // など揺れがあるため、候補文字列から「最初のURL」を抜き出す。
  const rawCandidates = [
    sp.get("url"),
    sp.get("text"),
    sp.get("title"),
    sp.get("u"),     // 互換用
    sp.get("link"),  // 互換用
    sp.get("href"),  // 互換用
  ].filter(Boolean);

  let incomingUrl = "";
  let incomingHint = "";

  if (rawCandidates.length) {
    for (const raw of rawCandidates) {
      const u = normalizeUrlFromMixedText(raw);
      if (u) {
        incomingUrl = u;
        // 表示メッセージ用（どのパラメータ経由だったか）
        if (raw === sp.get("url")) incomingHint = "共有URLから受け取りました";
        else if (raw === sp.get("text")) incomingHint = "共有テキストからURLを検出しました";
        else if (raw === sp.get("title")) incomingHint = "共有タイトルからURLを検出しました";
        else incomingHint = "共有から受け取りました";
        break;
      }
    }
  }

  if (incomingUrl) {
    els.urlInput.value = incomingUrl;
    setStatus(incomingHint || "共有から受け取りました");

    // 共有URLのクエリが残ると、次回起動時にも自動読み込みが走ることがあるためクリア
    try {
      const clean = new URL(location.href);
      clean.search = "";
      history.replaceState(null, "", clean.pathname + clean.hash);
    } catch {}

    loadFromInput();
  }

  // Register service worker
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

init();
