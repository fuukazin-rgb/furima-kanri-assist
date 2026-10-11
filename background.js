chrome.runtime.onInstalled.addListener(() => {
  console.log("フリマ管理アシスト installed");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // ── ★追加：画像をバイナリで取得（ラクマ新フォーム用）──
  if (message?.type === "FETCH_IMAGE_BINARY") {
    (async () => {
      try {
        const res = await fetch(message.url, { credentials: "omit" });
        if (!res.ok) {
          sendResponse({ ok: false, error: `HTTP ${res.status}` });
          return;
        }
        const buf = await res.arrayBuffer();
        const bytes = Array.from(new Uint8Array(buf));
        const mime = res.headers.get("content-type") || "image/jpeg";
        const index = typeof message.index === "number" ? message.index : 0;
        sendResponse({
          ok: true,
          bytes,
          mime,
          filenameBase: `mercari_${index + 1}`
        });
      } catch (error) {
        sendResponse({ ok: false, error: String(error) });
      }
    })();
    return true;
  }

  if (message?.type === "BG_FETCH_BLOB") {
    (async () => {
      try {
        const res = await fetch(message.url, { credentials: "omit" });
        const blob = await res.blob();
        const reader = new FileReader();
        reader.onloadend = () => {
          sendResponse({ ok: true, dataUrl: reader.result, mimeType: blob.type || "image/jpeg" });
        };
        reader.readAsDataURL(blob);
      } catch (error) {
        sendResponse({ ok: false, error: String(error) });
      }
    })();
    return true;
  }

  if (message?.type === "BG_DOWNLOAD_IMAGE") {
    (async () => {
      try {
        const res = await fetch(message.url, { credentials: "omit" });
        const blob = await res.blob();
        const mime = blob.type || "image/jpeg";
        const ext  = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
        const filename = message.filename || `furima_img_${Date.now()}.${ext}`;
        const reader = new FileReader();
        reader.onloadend = () => {
          chrome.downloads.download({
            url: reader.result,
            filename: `フリマ画像/${filename}`,
            saveAs: false,
            conflictAction: "uniquify"
          }, (downloadId) => {
            sendResponse({ ok: true, downloadId });
          });
        };
        reader.readAsDataURL(blob);
      } catch (error) {
        sendResponse({ ok: false, error: String(error) });
      }
    })();
    return true;
  }
});

// ── ヤフオク商品名注入 ──
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "BG_INJECT_YAHOO_TITLE") {
    const { tabId, titleVal } = message;
    chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (val) => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        return (async () => {
          const sels = [
            '#fleaTitleForm',
            'input[name="Title"]',
            'input[placeholder*="商品名、ブランド名、型番"]',
            'input[placeholder*="商品名、ブランド名"]',
            'input[placeholder*="商品名"]'
          ];
          let el = null;
          for (const s of sels) { el = document.querySelector(s); if (el) break; }
          if (!el) return "ng_no_element";

          el.scrollIntoView({ block: "center" });
          el.focus();
          el.click();
          await sleep(100);

          el.select?.();
          document.execCommand("selectAll", false, null);
          document.execCommand("delete", false, null);
          await sleep(500);
          document.execCommand("insertText", false, val);
          await sleep(300);

          try {
            if (typeof checkByte === "function" && typeof setCounterError === "function") {
              setCounterError(el, checkByte(el, 65));
            }
          } catch(e) {}

          el.dispatchEvent(new Event("blur", { bubbles: true }));
          return el.value ? "ok" : "ng_empty";
        })();
      },
      args: [titleVal]
    }).then(results => {
      sendResponse({ result: results?.[0]?.result || "ng" });
    }).catch(err => {
      sendResponse({ result: "ng_error", error: String(err) });
    });
    return true;
  }
});

// ═══════════════════════════════════════════════════════════════
//  出品したあとの商品URLを、サイト別管理に自動で保存する
//    ・ラクマ / Yahoo!フリマ / ヤフオク の「出品フォーム」を開いたタブを覚えておく
//    ・そのタブが「商品ページ」に変わったら、そのURLを自動で保存する
//    ・ラクマは、出品後に「出品した商品」の一覧（fril.jp/sell?is_new=1）に移るため、
//      一覧の先頭にある商品（いま出品したもの）のURLを読み取って保存する
//    ・保存したら、拡張機能のアイコンに「URL」の印を出す（ポップアップを開くと消える）
//  ※ 新しい権限は不要（tabs・scripting とサイトへのアクセスは、すでに許可済み）
// ═══════════════════════════════════════════════════════════════
const FX_WATCH_KEY        = "fx_listing_watch";
const FX_LAST_CAPTURE_KEY = "fx_last_capture";
const FX_SITE_META_KEY    = "furima_assist_site_meta";   // popup.js の SITE_META_KEY と同じ
const FX_ITEM_KEY         = "furima_assist_item";        // popup.js の STORAGE_KEY と同じ
const FX_WATCH_TTL_MS     = 90 * 60 * 1000;              // 出品フォームを開いてから90分以内

const FX_RECENT_KEY       = "fx_recent_form";            // サイトごとの「最後に出品フォームを開いた時刻」（別のタブで商品ページが開いた場合の判定用）
const FX_RECENT_TTL_MS    = 30 * 60 * 1000;

// 自分の出品ページにだけ出る文言（編集ボタンなど）。ポップアップから「いまのページ」を読み取るときの目印
const FX_OWNER_MARKERS = {
  yahoo:  ["オークションの編集", "この商品をもっと注目させる"],
  paypay: ["商品の編集", "商品を編集", "出品を停止", "出品を取り消"],
  rakuma: ["商品の編集", "商品を編集", "出品を取り消"]
};

const FX_SITE_FIELD = { rakuma: "rakumaUrl", paypay: "paypayUrl", yahoo: "yahooUrl" };
const FX_SITE_LABEL = { rakuma: "ラクマ", paypay: "Yahoo!フリマ", yahoo: "ヤフオク" };

// URL が「出品フォーム(form)」「商品ページ(item)」「出品した商品の一覧(list)」のどれかを判定する
function fxClassify(urlStr) {
  let u;
  try { u = new URL(urlStr); } catch (e) { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const h = u.hostname.toLowerCase();
  const p = u.pathname;

  // ラクマ
  if (/(^|\.)fril\.jp$/.test(h) || /(^|\.)rakuma\.rakuten\.co\.jp$/.test(h)) {
    if (/\/item\/new/.test(p) || /\/c\/sell/.test(p)) return { site: "rakuma", kind: "form" };
    // 出品が終わると、fril.jp/sell?is_new=1（出品した商品の一覧）に移る
    if (/^\/sell\/?$/.test(p)) return { site: "rakuma", kind: "list", isNew: u.searchParams.get("is_new") === "1" };
    if ((h === "item.fril.jp" && /^\/[0-9a-f]{16,}\/?$/i.test(p)) || /^\/item\/[0-9a-f]{16,}\/?$/i.test(p)) {
      return { site: "rakuma", kind: "item" };
    }
    return null;
  }

  // Yahoo!フリマ（出品フォームは paypayfleamarket-sec、商品ページは paypayfleamarket）
  if (/(^|\.)paypayfleamarket(-sec)?\.yahoo\.co\.jp$/.test(h)) {
    if (/^\/item\/(add|edit)/.test(p) || /\/sell(\/|$)/.test(p)) return { site: "paypay", kind: "form" };
    if (h === "paypayfleamarket.yahoo.co.jp" && /^\/item\/[A-Za-z0-9]{6,}\/?$/.test(p)) {
      return { site: "paypay", kind: "item" };
    }
    return null;
  }

  // ヤフオク
  if (/(^|\.)auctions\.yahoo\.co\.jp$/.test(h)) {
    // 出品完了のページにオークションID（aID）が付いているときは、そこから商品ページのURLを作る
    const aid = u.searchParams.get("aID") || u.searchParams.get("aid") || "";
    if (/complete|finish/i.test(p) && /^[a-z]\d{5,}$/i.test(aid)) {
      return { site: "yahoo", kind: "done", itemUrl: "https://auctions.yahoo.co.jp/jp/auction/" + aid };
    }
    if (/\/sell(\/|$)/.test(p) || /show\/(submit|beforms|amgr)/i.test(p) || /\/submit/.test(p)) return { site: "yahoo", kind: "form" };
    if (/^\/jp\/auction\/[a-z]\d{5,}/i.test(p)) return { site: "yahoo", kind: "item" };
    return null;
  }
  return null;
}

// 追跡用の ?... や #... を取り除いた、すっきりしたURLにする
function fxCleanUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch (e) {
    return urlStr;
  }
}

// ページの中から、商品ページへのリンクを探す（タブの中で実行される。外の変数は使えない）
//   一覧の上から順に見て、いま出品した商品（商品名が近いもの）を優先し、無ければ先頭を返す
function fxFindFirstItemLink(site, wantedTitle, requireText, maxWaitMs) {
  return new Promise((resolve) => {
    const patterns = {
      rakuma: [
        /^https?:\/\/item\.fril\.jp\/[0-9a-f]{16,}\/?$/i,
        /^https?:\/\/(?:[\w-]+\.)?(?:fril\.jp|rakuma\.rakuten\.co\.jp)\/item\/[0-9a-f]{16,}\/?$/i
      ],
      paypay: [/^https?:\/\/paypayfleamarket\.yahoo\.co\.jp\/item\/[A-Za-z0-9]{6,}\/?$/],
      yahoo:  [/^https?:\/\/(?:page\.)?auctions\.yahoo\.co\.jp\/jp\/auction\/[a-z]\d{5,}\/?$/i]
    }[site] || [];
    const norm = (s) => String(s || "").replace(/\s+/g, "").toLowerCase();

    const find = () => {
      // 「出品が完了しました」など、必要な文言がページに出ているときだけ探す（別のページのリンクを拾わないため）
      if (requireText && !(document.body && (document.body.innerText || "").includes(requireText))) return null;
      // ヤフオク：出品完了ページにある「aID=○○」付きのリンクは、いま出品した自分の商品のもの。最優先で使う
      if (site === "yahoo") {
        for (const a of document.querySelectorAll("a[href]")) {
          const m = a.href.match(/[?&]aID=([a-z]\d{5,})/i);
          if (m) return { href: "https://auctions.yahoo.co.jp/jp/auction/" + m[1], matched: true, title: (a.textContent || "").trim() };
        }
      }
      const byBase = new Map();   // 同じ商品のリンク（写真・商品名など）をまとめる
      for (const a of document.querySelectorAll("a[href]")) {
        let href = a.href.split(/[?#]/)[0];
        if (site === "yahoo") href = href.replace("//page.auctions.", "//auctions.");
        if (!patterns.some((re) => re.test(href))) continue;
        const text = (a.textContent || "").trim();
        const cur = byBase.get(href);
        if (!cur) byBase.set(href, { href, text });
        else if (text.length > cur.text.length) cur.text = text;
      }
      const list = [...byBase.values()];
      if (!list.length) return null;
      const want = norm(wantedTitle).slice(0, 8);
      if (want) {
        const hit = list.find((l) => norm(l.text).includes(want));
        if (hit) return { href: hit.href, matched: true, title: hit.text };
      }
      return { href: list[0].href, matched: false, title: list[0].text };
    };

    const maxTries = Math.max(1, Math.ceil((maxWaitMs || 10000) / 500));
    let tries = 0;
    const tick = () => {
      const r = find();
      if (r || ++tries >= maxTries) return resolve(r);   // 通常は最大10秒待つ（一覧が表示されるまで）
      setTimeout(tick, 500);
    };
    tick();
  });
}

// ページの商品名が、いま扱っている商品の名前と合っているか／自分の出品ページか、を調べる（タブの中で実行される。外の変数は使えない）
function fxWaitPageCheck(wantedTitle, ownerMarkers, maxWaitMs) {
  return new Promise((resolve) => {
    const norm = (s) => String(s || "").replace(/\s+/g, "").toLowerCase();
    const tokens = String(wantedTitle || "")
      .split(/[\s\u3000・\/,，|｜\-—–【】\[\]［］()（）]+/)
      .map(norm).filter((t) => t.length >= 3);
    const check = () => {
      const h1 = document.querySelector("h1");
      const pageTitle = norm((document.title || "") + " " + (h1 ? h1.textContent : ""));
      let hit = 0;
      tokens.forEach((t) => { if (pageTitle.includes(t)) hit++; });
      const need = Math.min(2, tokens.length);
      const body = (document.body && document.body.innerText) || "";
      return {
        titleMatch: need > 0 && hit >= need,                       // 商品名の主な言葉が、2つ以上合っている
        strong: tokens.length >= 3 && hit / tokens.length >= 0.7,   // 商品名の言葉の7割以上が合っている（ほぼ同じ商品名）
        owner: (ownerMarkers || []).some((m) => body.includes(m))   // 編集ボタンなど、自分の出品にだけ出る文言がある
      };
    };
    const maxTries = Math.max(1, Math.ceil((maxWaitMs || 6000) / 500));
    let tries = 0;
    const tick = () => {
      const r = check();
      if (r.strong || (r.titleMatch && r.owner) || ++tries >= maxTries) return resolve(r);
      setTimeout(tick, 500);
    };
    tick();
  });
}

async function fxSaveListedUrl(site, url, opts) {
  const clean = fxCleanUrl(url);
  const r     = await chrome.storage.local.get([FX_SITE_META_KEY, FX_ITEM_KEY]);
  const meta  = r[FX_SITE_META_KEY] || {};
  const item  = r[FX_ITEM_KEY] || {};
  meta[FX_SITE_FIELD[site]] = clean;
  if (item.manageId) meta.manageId = item.manageId;
  const ownerId = ((String(item.sourceUrl || "").match(/\/item\/(m\d+)/i) || [])[1] || "").toLowerCase();
  if (ownerId && !meta.ownerItemId) meta.ownerItemId = ownerId;
  const cap = { site, label: FX_SITE_LABEL[site], url: clean, at: Date.now() };
  if (opts && typeof opts.matched === "boolean") cap.matched = opts.matched;
  await chrome.storage.local.set({ [FX_SITE_META_KEY]: meta, [FX_LAST_CAPTURE_KEY]: cap });
  console.log("[furima] 出品後のURLを自動保存:", FX_SITE_LABEL[site], clean);
  try {
    await chrome.action.setBadgeText({ text: "URL" });
    await chrome.action.setBadgeBackgroundColor({ color: "#10b981" });
  } catch (e) {}
}

// 一覧から商品URLを見つけられなかったとき：ポップアップで案内するために記録する
async function fxRecordFailure(site) {
  await chrome.storage.local.set({
    [FX_LAST_CAPTURE_KEY]: { site, label: FX_SITE_LABEL[site], url: "", failed: true, at: Date.now() }
  });
  console.warn("[furima] 出品後のURLを自動で見つけられませんでした:", FX_SITE_LABEL[site]);
  try {
    await chrome.action.setBadgeText({ text: "!" });
    await chrome.action.setBadgeBackgroundColor({ color: "#f59e0b" });
  } catch (e) {}
}

// 「出品した商品」の一覧ページから、いま出品した商品のURLを取り出して保存する
const fxTimers   = {};
const fxInFlight = new Set();

function fxScheduleListCapture(tabId, site) {
  clearTimeout(fxTimers[tabId]);
  // 少し待ってから実行する（ページの読み込みが終わるのを待つ）
  fxTimers[tabId] = setTimeout(() => {
    delete fxTimers[tabId];
    fxCaptureFromList(tabId, site).catch((e) => console.warn("[furima] 一覧からのURL取得エラー:", e));
  }, 2500);
}

async function fxCaptureFromList(tabId, site) {
  if (fxInFlight.has(tabId)) return;
  fxInFlight.add(tabId);
  try {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab || !tab.url) return;
    const c = fxClassify(tab.url);
    if (!c || c.kind !== "list" || c.site !== site) return;   // もう別のページに移っていた

    const store     = await chrome.storage.local.get([FX_ITEM_KEY, FX_WATCH_KEY]);
    const wantTitle = (store[FX_ITEM_KEY] || {}).title || "";

    let found = null;
    try {
      const res = await chrome.scripting.executeScript({
        target: { tabId },
        func: fxFindFirstItemLink,
        args: [site, wantTitle]
      });
      found = res && res[0] && res[0].result;
    } catch (e) {
      console.warn("[furima] 一覧ページの読み取りに失敗:", e);
    }

    const watch = store[FX_WATCH_KEY] || {};
    if (watch[tabId]) {
      delete watch[tabId];
      await chrome.storage.local.set({ [FX_WATCH_KEY]: watch });
    }

    if (found && found.href) await fxSaveListedUrl(site, found.href, { matched: !!found.matched });
    else await fxRecordFailure(site);
  } finally {
    fxInFlight.delete(tabId);
  }
}

// 出品フォームを開いたあと、別のタブで商品ページが開いたときは、商品名が合っているかを確認してから保存する
const fxItemTimers = {};

function fxScheduleItemVerify(tabId, site) {
  clearTimeout(fxItemTimers[tabId]);
  fxItemTimers[tabId] = setTimeout(() => {
    delete fxItemTimers[tabId];
    fxVerifyAndSaveItem(tabId, site).catch((e) => console.warn("[furima] 商品ページの確認エラー:", e));
  }, 2000);
}

async function fxVerifyAndSaveItem(tabId, site) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !tab.url) return;
  const c = fxClassify(tab.url);
  if (!c || c.kind !== "item" || c.site !== site) return;

  const store = await chrome.storage.local.get([FX_ITEM_KEY, FX_RECENT_KEY]);
  const recent = store[FX_RECENT_KEY] || {};
  if (Date.now() - Number(recent[site] || 0) > FX_RECENT_TTL_MS) return;

  const wantTitle = (store[FX_ITEM_KEY] || {}).title || "";
  let check = null;
  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId },
      func: fxWaitPageCheck,
      args: [wantTitle, FX_OWNER_MARKERS[site] || [], 6000]
    });
    check = res && res[0] && res[0].result;
  } catch (e) { return; }
  // 商品名がほぼ同じ、または「商品名が合う＋自分の出品の目印がある」ときだけ保存する（他の人の似た出品を、間違って保存しないため）
  if (!check || !(check.strong || (check.titleMatch && check.owner))) return;

  delete recent[site];
  await chrome.storage.local.set({ [FX_RECENT_KEY]: recent });
  await fxSaveListedUrl(site, tab.url);
}

async function fxHandleTabUrl(tabId, url) {
  const c = fxClassify(url);
  if (!c) return;

  const store = await chrome.storage.local.get([FX_WATCH_KEY]);
  const watch = store[FX_WATCH_KEY] || {};
  const now   = Date.now();
  for (const k of Object.keys(watch)) {
    if (now - Number(watch[k].at || 0) > FX_WATCH_TTL_MS) delete watch[k];
  }

  if (c.kind === "form") {
    // 出品フォームを開いているタブを覚える（サイトごとの「最後に開いた時刻」も記録）
    watch[tabId] = { site: c.site, at: now };
    const recent = (await chrome.storage.local.get([FX_RECENT_KEY]))[FX_RECENT_KEY] || {};
    recent[c.site] = now;
    await chrome.storage.local.set({ [FX_WATCH_KEY]: watch, [FX_RECENT_KEY]: recent });
    return;
  }

  const w = watch[tabId];

  if (c.kind === "done") {
    // 出品完了ページ（ヤフオク）：出品フォームを開いていた直後なら、そのまま保存する
    const recent = (await chrome.storage.local.get([FX_RECENT_KEY]))[FX_RECENT_KEY] || {};
    const active = (w && w.site === c.site) || (now - Number(recent[c.site] || 0) <= FX_WATCH_TTL_MS);
    if (!active) return;
    if (w) { delete watch[tabId]; await chrome.storage.local.set({ [FX_WATCH_KEY]: watch }); }
    delete recent[c.site];
    await chrome.storage.local.set({ [FX_RECENT_KEY]: recent });
    await fxSaveListedUrl(c.site, c.itemUrl);
    return;
  }

  if (c.kind === "list") {
    // 出品フォームを開いていた同じタブ、または「出品直後」の印（is_new=1）があるときだけ
    if (!(w && w.site === c.site) && !c.isNew) return;
    fxScheduleListCapture(tabId, c.site);
    return;
  }

  // 商品ページ：出品フォームを開いていた同じタブ・同じサイトなら、そのまま保存する。
  // 別のタブで開いたときは、商品名が合っているか確認してから保存する
  if (!w || w.site !== c.site) {
    fxScheduleItemVerify(tabId, c.site);
    return;
  }
  delete watch[tabId];
  await chrome.storage.local.set({ [FX_WATCH_KEY]: watch });
  await fxSaveListedUrl(c.site, url);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = changeInfo.url || (changeInfo.status === "complete" ? tab?.url : "");
  if (!url) return;
  fxHandleTabUrl(tabId, url).catch((e) => console.warn("[furima] URL自動保存エラー:", e));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearTimeout(fxTimers[tabId]);
  delete fxTimers[tabId];
  chrome.storage.local.get([FX_WATCH_KEY]).then((store) => {
    const watch = store[FX_WATCH_KEY] || {};
    if (watch[tabId]) {
      delete watch[tabId];
      return chrome.storage.local.set({ [FX_WATCH_KEY]: watch });
    }
  }).catch(() => {});
});


// ═══════════════════════════════════════════════════════════════
//  ポップアップを開いたときに、いま見ているタブが
//    ・Yahoo!フリマの「出品が完了しました」ページ
//    ・ラクマの「出品した商品」の一覧
//  なら、その場で商品URLを読み取って保存する
// ═══════════════════════════════════════════════════════════════
async function fxProbeTab(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !tab.url) return { ok: false };
  let c = fxClassify(tab.url);
  if (!c) {
    // ヤフオクの出品完了ページは、URLの形が変わることがあるため、ヤフオクのページなら出品完了ページとして調べる
    try {
      if (/(^|\.)auctions\.yahoo\.co\.jp$/i.test(new URL(tab.url).hostname)) c = { site: "yahoo", kind: "form" };
    } catch (e) {}
  }
  if (!c) return { ok: false };

  if (c.kind === "done" && c.itemUrl) {
    await fxSaveListedUrl(c.site, c.itemUrl);
    return { ok: true, site: c.site, label: FX_SITE_LABEL[c.site], url: fxCleanUrl(c.itemUrl), matched: true };
  }

  const store     = await chrome.storage.local.get([FX_ITEM_KEY, FX_SITE_META_KEY]);
  const wantTitle = (store[FX_ITEM_KEY] || {}).title || "";

  // 自分の出品ページ（商品ページ）を開いているとき：商品名が合い、編集ボタンなど「自分の出品」の目印があれば保存する
  if (c.kind === "item") {
    const clean = fxCleanUrl(tab.url);
    if (((store[FX_SITE_META_KEY] || {})[FX_SITE_FIELD[c.site]] || "") === clean) return { ok: false };   // すでに保存済み
    let check = null;
    try {
      const res = await chrome.scripting.executeScript({
        target: { tabId },
        func: fxWaitPageCheck,
        args: [wantTitle, FX_OWNER_MARKERS[c.site] || [], 1500]
      });
      check = res && res[0] && res[0].result;
    } catch (e) { return { ok: false }; }
    if (!check || !check.titleMatch || !check.owner) return { ok: false };
    await fxSaveListedUrl(c.site, tab.url);
    return { ok: true, site: c.site, label: FX_SITE_LABEL[c.site], url: clean, matched: true };
  }

  let requireText = "";
  if (c.site === "paypay" && c.kind === "form") requireText = "出品が完了";   // 完了ページのURLは、出品フォームと同じ
  else if (c.site === "yahoo" && c.kind === "form") requireText = "が完了しました";   // ヤフオクの出品完了ページ
  else if (!(c.site === "rakuma" && c.kind === "list")) return { ok: false };
  let found = null;
  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId },
      func: fxFindFirstItemLink,
      args: [c.site, wantTitle, requireText, 1500]
    });
    found = res && res[0] && res[0].result;
  } catch (e) {
    return { ok: false };
  }
  if (!found || !found.href) return { ok: false };

  await fxSaveListedUrl(c.site, found.href, { matched: !!found.matched });
  // このタブの「出品フォームを開いている」記録は不要になる
  const w = (await chrome.storage.local.get([FX_WATCH_KEY]))[FX_WATCH_KEY] || {};
  if (w[tabId]) { delete w[tabId]; await chrome.storage.local.set({ [FX_WATCH_KEY]: w }); }
  return { ok: true, site: c.site, label: FX_SITE_LABEL[c.site], url: fxCleanUrl(found.href), matched: !!found.matched };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "FX_PROBE_TAB") {
    fxProbeTab(message.tabId).then(sendResponse).catch(() => sendResponse({ ok: false }));
    return true;
  }
});