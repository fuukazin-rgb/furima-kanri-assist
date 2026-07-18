// yahoo_price_fill.js v12
// ヤフオク／Yahoo!フリマ 価格入力専用（files方式）
//
// v11 の変更点（★重要）
//   - 【修正】 v10 は「価格欄を特定 → 入力 → 検証」を同じ要素参照で行っていたため、
//     ヤフオク側のJSが #price_auction ブロックを作り直すと、
//     DOMから外れた古いノードに値が入ったまま検証が通ってしまい、
//     画面上は空なのに ok を返していた。
//     → 検証のたびに document から要素を取り直すよう変更
//   - 【追加】 document.contains() でノードが生きているか確認
//   - 【追加】「入力 → 0.7秒待つ → 取り直して確認」を最大6回リトライ
//   - 【削除】 インライン onchange の手動呼び出し
//     （Yahoo側のロガーが例外を投げるため、通常のイベント発火のみにする）
//
// v12 の変更点
//   - 【追加】 起動時にバージョンをログ出力（どの版が読まれているか確認用）
//   - 【追加】★入力に成功した後も5秒間見張り、ページ側に値を消されたら入れ直す
//     （ヤフオクは貼り付け後しばらくしてから #price_auction を初期化することがある）
//
// 実際のDOM（ヤフオク・オークション形式）
//   <div class="js-salesFormat" id="price_auction">
//     <input id="auc_StartPrice_auction" type="text" name="StartPrice"
//            onchange="toHankaku(this);setError(this, checkNum(this,1,9999999999))">

(async () => {
  const VERSION = "v12";
  console.log(`[furima] yahoo_price_fill ${VERSION} 起動`);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const digits = (v) => String(v || "").replace(/[^\d]/g, "");

  const finish = async (ok, reason) => {
    console.log("[furima] yahoo_price_fill:", ok ? "ok" : "ng", reason || "");
    try {
      await chrome.storage.local.set({
        yahooFillPriceResult: ok ? "ok" : "ng",
        yahooFillPriceReason: reason || ""
      });
    } catch (_) {}
  };

  // 画面に実際に表示されていて、入力可能かどうか
  function isUsable(el) {
    if (!el) return false;
    if (!document.contains(el)) return false;   // ★DOMから外れた抜け殻を弾く
    if (el.disabled || el.readOnly) return false;
    if (el.type === "hidden") return false;
    if (el.offsetParent === null) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    const style = window.getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") return false;
    if (Number(style.opacity) === 0) return false;
    return true;
  }

  // ★対象欄の候補。上から順に、表示されているものを採用する。
  //   即決価格(BidOrBuyPrice)は「即決価格を設定する」を開かないと非表示なので、
  //   isUsable() によって自動的に後回しになる。
  const SELECTORS = [
    "#auc_StartPrice_auction",
    "#price_auction input[name='StartPrice']",
    "#price_fixed   input[name='StartPrice']",
    "#price_auction input[type='text']",
    "#price_fixed   input[type='text']",
    "input[name='StartPrice']",
    "input[id^='auc_StartPrice']",
    "input[name='Price']",
    "input[name='price']",
    "input[name='BidOrBuyPrice']",
    "input[id^='auc_BidOrBuyPrice']"
  ];

  // ★毎回DOMから取り直す。参照を保持し続けないのがこの版の肝。
  function findPriceInput() {
    for (const sel of SELECTORS) {
      let list = [];
      try { list = [...document.querySelectorAll(sel)]; } catch (_) { continue; }
      for (const el of list) {
        if (isUsable(el)) return el;
      }
    }
    return null;
  }

  async function waitForPriceInput(timeoutMs = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const el = findPriceInput();
      if (el) return el;
      await sleep(200);
    }
    return null;
  }

  function setNativeValue(el, value) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype, "value"
    )?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    if (el._valueTracker && typeof el._valueTracker.setValue === "function") {
      el._valueTracker.setValue("");
    }
  }

  // 通常のイベントのみ発火する（インライン onchange の手動呼び出しはしない）
  function fireEvents(el) {
    el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "0" }));
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "0" }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    el.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
  }

  async function writeOnce(el, priceVal) {
    try { el.scrollIntoView({ block: "center" }); } catch (_) {}

    el.focus();
    el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    el.dispatchEvent(new FocusEvent("focus", { bubbles: false }));
    await sleep(120);

    // 方法1: execCommand（旧来型ページに最も相性が良い）
    try {
      el.select?.();
      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
      await sleep(50);
      document.execCommand("insertText", false, priceVal);
      await sleep(120);
    } catch (_) {}

    // 方法2: native setter
    if (digits(el.value) !== priceVal) {
      setNativeValue(el, priceVal);
      await sleep(100);
    }

    fireEvents(el);
    el.blur();
  }

  // ★入力後の見張り。消されたら入れ直す。
  async function guardValue(priceVal, durationMs) {
    const start = Date.now();
    let refills = 0;
    while (Date.now() - start < durationMs) {
      await sleep(300);
      const el = findPriceInput();
      if (!el) continue;
      if (digits(el.value) !== priceVal) {
        refills++;
        console.warn(`[furima] 見張り中に値が消えたため再入力します(${refills}回目)`);
        await writeOnce(el, priceVal);
        await sleep(300);
      }
    }
    const last = findPriceInput();
    const kept = digits(last?.value) === priceVal;
    console.log(`[furima] 見張り終了: ${kept ? "値は保持されています" : "値が消えています"} / 再入力${refills}回`);
    return kept;
  }

  try {
    const res = await chrome.storage.local.get(["yahooFillPrice"]);
    const priceVal = digits(res.yahooFillPrice);
    if (!priceVal) {
      await finish(false, "価格データが空");
      return;
    }

    const first = await waitForPriceInput(5000);
    if (!first) {
      await finish(false, "価格欄が5秒以内に表示されなかった（販売形式が未選択の可能性）");
      return;
    }
    console.log("[furima] 価格欄を特定:", first.id || first.name || "input");

    const MAX_TRY = 6;
    let lastState = "";

    for (let i = 1; i <= MAX_TRY; i++) {
      // ★毎回DOMから取り直す
      const el = findPriceInput();
      if (!el) {
        lastState = "価格欄が見つからない";
        console.warn(`[furima] 試行${i}: ${lastState}`);
        await sleep(700);
        continue;
      }

      await writeOnce(el, priceVal);
      await sleep(700);

      // ★検証も取り直した要素で行う（古いノードを見ない）
      const check = findPriceInput();
      const nowVal = digits(check?.value);
      const alive = check ? document.contains(check) : false;
      console.log(`[furima] 試行${i}: 値="${check?.value ?? "(要素なし)"}" DOM上に存在=${alive}`);

      if (nowVal === priceVal) {
        // ★入った後にページ側へ消されることがあるので、5秒間見張る
        const guarded = await guardValue(priceVal, 5000);
        await finish(true,
          `${check.id || check.name || "input"} に入力（試行${i}回目 / 見張り後:${guarded ? "保持" : "消失"}）`);
        return;
      }
      lastState = `現在値:"${check?.value ?? ""}"`;
    }

    await finish(false, `${MAX_TRY}回試しても値が残らなかった（ページ側に消されている可能性）/ ${lastState}`);

  } catch (e) {
    await finish(false, "例外: " + (e.message || String(e)));
  }
})();