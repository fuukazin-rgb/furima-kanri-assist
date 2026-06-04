// yahoo_price_fill.js v8
// ヤフオク 価格入力専用（files方式）

(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  try {
    const res = await chrome.storage.local.get(["yahooFillPrice"]);
    const priceVal = (res.yahooFillPrice || "").replace(/[^\d]/g, "");
    if (!priceVal) {
      await chrome.storage.local.set({ yahooFillPriceResult: "ng" });
      return;
    }

    const selectors = [
      'input[name="BidOrBuyPrice"]',
      'input[id="auc_BidOrBuyPrice_buynow"]',
      'input[id="BidOrBuyPrice"]',
      'input[name="price"]',
      'input[name="StartPrice"]'
    ];

    let priceEl = null;
    for (const sel of selectors) {
      priceEl = document.querySelector(sel);
      if (priceEl) break;
    }

    if (!priceEl) {
      await chrome.storage.local.set({ yahooFillPriceResult: "ng" });
      return;
    }

    priceEl.scrollIntoView({ block: "center" });
    priceEl.focus();
    await sleep(200);

    // 方法1: execCommand
    priceEl.select?.();
    document.execCommand("selectAll", false, null);
    document.execCommand("delete", false, null);
    await sleep(50);
    document.execCommand("insertText", false, priceVal);
    await sleep(200);

    // 方法2: native setter
    if (!priceEl.value) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (setter) setter.call(priceEl, priceVal);
      else priceEl.value = priceVal;
      const tracker = priceEl._valueTracker;
      if (tracker) tracker.setValue("");
      priceEl.dispatchEvent(new InputEvent("input", { bubbles: true, data: priceVal }));
      priceEl.dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(200);
    }

    // 方法3: クリップボード経由
    if (!priceEl.value) {
      try {
        await navigator.clipboard.writeText(priceVal);
        priceEl.focus();
        await sleep(100);
        document.execCommand("selectAll", false, null);
        document.execCommand("paste", false, null);
        await sleep(200);
      } catch(e) {}
    }

    const ok = !!priceEl.value;
    await chrome.storage.local.set({ yahooFillPriceResult: ok ? "ok" : "ng" });

  } catch (e) {
    await chrome.storage.local.set({ yahooFillPriceResult: "ng" });
  }
})();