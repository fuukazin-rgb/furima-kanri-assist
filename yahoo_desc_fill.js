// yahoo_desc_fill.js v3.0
// ヤフオク/Yahooフリマ出品フォームの説明欄に入力
// storage: yahooFillDesc (string) → yahooFillDescResult ("ok"|"ng"|"no_target")
// allFrames: true で実行（iframe内のエディタにも対応）

(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const { yahooFillDesc } = await chrome.storage.local.get(["yahooFillDesc"]);
  if (!yahooFillDesc) return;

  // ── ヤフオクのiframeエディタに直接書き込む ──────────────────
  // iframeのsrcがabout:blankでcontentDocumentにアクセスできる
  const iframe = document.querySelector('iframe[id^="rteEditor"]');
  if (iframe && iframe.contentDocument) {
    const iBody = iframe.contentDocument.body;
    if (iBody) {
      iBody.focus();
      // innerHTML でプレーンテキストをセット
      const escaped = yahooFillDesc
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "<br>");
      iBody.innerHTML = escaped;
      iBody.dispatchEvent(new Event("input",  { bubbles: true }));
      iBody.dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(300);
      // hidden inputにも値をセット（submit用）
      const hiddenDesc = document.querySelector('input[name="Description"]')
        || document.querySelector('input[id="Description"]');
      if (hiddenDesc) {
        hiddenDesc.value = yahooFillDesc;
        hiddenDesc.dispatchEvent(new Event("change", { bubbles: true }));
      }
      await chrome.storage.local.set({ yahooFillDescResult: "ok" });
      return;
    }
  }

  // ── 対象要素の探索優先順位 ──────────────────────────────────
  // 1. iframe内のcontenteditable body（リッチテキストエディタ）
  // 2. placeholderで説明系のtextarea
  // 3. 最大面積のcontenteditable div
  // 4. 最初のtextarea（最終フォールバック）

  let target = null;

  // ① iframe内 contenteditable body（ヤフオクのリッチエディタ）
  if (window.self !== window.top && document.body?.isContentEditable) {
    target = document.body;
  }

  // ② placeholder で説明系のtextarea
  if (!target) {
    const keywords = ["特徴", "使用感", "魅力", "説明", "コメント", "状態", "condition"];
    target = [...document.querySelectorAll("textarea")].find(el =>
      keywords.some(k => (el.placeholder || el.name || el.id || "").includes(k))
    );
  }

  // ③ name/id で説明系のtextarea
  if (!target) {
    target = [...document.querySelectorAll("textarea")].find(el =>
      /desc|description|comment|detail/i.test(el.name + el.id)
    );
  }

  // ④ 最大面積のcontenteditable（通常ページ）
  if (!target) {
    let bestArea = 0;
    for (const el of document.querySelectorAll('[contenteditable="true"]')) {
      const { width, height } = el.getBoundingClientRect();
      const area = width * height;
      if (area > bestArea) { bestArea = area; target = el; }
    }
  }

  // ⑤ 最初のtextarea（最終フォールバック）
  if (!target) {
    target = document.querySelector("textarea");
  }

  if (!target) {
    await chrome.storage.local.set({ yahooFillDescResult: "no_target" });
    return;
  }

  // ── 入力処理 ────────────────────────────────────────────────
  target.scrollIntoView({ block: "center" });
  await sleep(100);

  target.click();
  target.focus();
  await sleep(200);

  // contenteditable要素（リッチエディタ）の場合
  if (target.isContentEditable || target === document.body && document.body.isContentEditable) {
    // 全選択→削除→テキスト挿入
    document.execCommand("selectAll", false, null);
    await sleep(50);
    document.execCommand("delete", false, null);
    await sleep(100);
    // insertText で入力（改行も保持）
    const success = document.execCommand("insertText", false, yahooFillDesc);
    await sleep(300);

    // execCommand失敗時は innerHTML で直接セット（プレーンテキスト）
    if (!success || !target.textContent?.trim()) {
      target.innerHTML = yahooFillDesc
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "<br>");
      target.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(200);
    }

    const val = (target.textContent || "").trim();
    await chrome.storage.local.set({
      yahooFillDescResult: val.length > 0 ? "ok" : "ng"
    });
    return;
  }

  // textarea要素の場合
  // ステップ1: execCommand で試す（Reactが管理するtextareaに有効な場合）
  document.execCommand("selectAll", false, null);
  document.execCommand("delete", false, null);
  await sleep(80);
  const execOk = document.execCommand("insertText", false, yahooFillDesc);
  await sleep(300);

  let val = (target.value || "").trim();

  // ステップ2: native setter（Reactのvalue変更検知）
  if (!val || !execOk) {
    const proto  = HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;

    // _valueTrackerに現在値をセット（Reactのdiff検知用）
    const tracker = target._valueTracker;
    if (tracker) tracker.setValue(target.value || "");

    if (setter) {
      setter.call(target, yahooFillDesc);
    } else {
      target.value = yahooFillDesc;
    }

    // イベントを複数発火してReactに変更を伝える
    target.dispatchEvent(new Event("focus",  { bubbles: true }));
    target.dispatchEvent(new Event("input",  { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    target.dispatchEvent(new KeyboardEvent("keydown",  { bubbles: true, key: "a" }));
    target.dispatchEvent(new KeyboardEvent("keyup",    { bubbles: true, key: "a" }));
    target.dispatchEvent(new Event("blur",   { bubbles: true }));

    await sleep(300);
    val = (target.value || "").trim();
  }

  // ステップ3: clipboard API経由（execCommandもnative setterも効かない場合）
  if (!val) {
    try {
      target.focus();
      await sleep(100);
      // クリップボードに入れてCtrl+Aで選択→貼り付け
      await navigator.clipboard.writeText(yahooFillDesc);
      await sleep(100);
      document.execCommand("selectAll", false, null);
      document.execCommand("paste", false, null);
      await sleep(200);
      val = (target.value || "").trim();
    } catch(e) {
      console.warn("[furima] clipboard paste失敗:", e);
    }
  }

  await chrome.storage.local.set({
    yahooFillDescResult: val.length > 0 ? "ok" : "ng"
  });
})();