// フリマ出品アシスト Pro - paypay_fill.js
// Yahoo!フリマ (paypayfleamarket-sec.yahoo.co.jp) 用の統合フィルスクリプト
// v4.0.16 (フリマ管理アシスト v1.5.2 対応版)
//   - 【修正】 価格入力に focusin/focusout を追加。React17以降は focus/blur ではなく
//     focusin/focusout を監視しているため、これを発火させないと onBlur が呼ばれず
//     販売手数料・販売利益が自動計算されなかった
//   - 【修正】 v4.0.14 の「1文字ずつ入力」は最低金額300円の判定に弾かれるため撤回し、
//     v4.0.13 と同じ一括セット方式に戻した
//   - 【追加】 setNativeValue / fillReactPriceInput / isFeeReflected
//   - 【追加】 一括セットで入らなかった場合の execCommand フォールバック
//   - 【修正】 v4.0.16: 手数料の反映判定が「販売手数料を変更する場合は…」の
//     説明文を誤って拾い、赤いフキダシが常に出ていた問題を修正
//   - 【改善】 手数料が反映された場合は「価格欄をクリック」誘導UIを表示しない
// v4.0.13 (フリマ管理アシスト v1.5.0 対応版)
//   - 【追加】 起動ハートビート paypayFillStarted（popupの高速エラー判定用）
//   - 【修正】 paypayFillData を優先読み込み（管理アシストの商品DB対応）
//   - 【修正】 中断時も paypayFillResult を必ず保存（popupが40秒固まる問題）
//   - 【修正】 英字略称ブランド (DJI, SE, SONY等) を最優先扱いに
//     カタカナ語に押し出されないよう priority を引き上げ
//   - 【追加】 英数字型番 (OM4, M3, S22等) も候補に含める
//   - 【UI改善】 ブランド欄に値が入ったらフキダシ自動消去 (v4.0.10)
//   - 【UI改善】 候補パネルから「発送日数」「発送元の地域」削除 (v4.0.9)
//   - 【UI改善】 参考表示の文字サイズ拡大 (v4.0.9)
//   - Yahoo!フリマ商品名候補ボタンの取得をリトライ式 (v4.0.8)
//   - ブランドコピーボタンクリック時にブランド欄を自動focus (v4.0.8)

(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function toast(message) {
    const old = document.getElementById("furima-paypay-toast");
    if (old) old.remove();

    const el = document.createElement("div");
    el.id = "furima-paypay-toast";
    el.textContent = message;
    el.style.position = "fixed";
    el.style.left = "50%";
    el.style.bottom = "24px";
    el.style.transform = "translateX(-50%)";
    el.style.zIndex = "2147483647";
    el.style.background = "#222";
    el.style.color = "#fff";
    el.style.padding = "12px 16px";
    el.style.borderRadius = "999px";
    el.style.fontSize = "13px";
    el.style.boxShadow = "0 10px 24px rgba(0,0,0,.25)";
    document.body.appendChild(el);

    setTimeout(() => el.remove(), 3500);
  }

  function setReactInputValue(el, value) {
    if (!el) return false;
    const tag = el.tagName;
    const proto = tag === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) {
      setter.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  // 値だけをネイティブsetterでセットする（イベントは投げない）
  function setNativeValue(el, value) {
    const tag = el.tagName;
    const proto = tag === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) {
      setter.call(el, value);
    } else {
      el.value = value;
    }
    // React の _valueTracker を空にして、必ず「変化した」と判定させる
    if (el._valueTracker && typeof el._valueTracker.setValue === "function") {
      el._valueTracker.setValue("");
    }
  }

  // ★v4.0.15 価格欄の入力
  //   ・値は「一括セット」する（1文字ずつだと最低金額300円の判定に弾かれるため）
  //   ・React 17以降は focus/blur ではなく focusin/focusout を見ているので、
  //     これを発火させないと onBlur が呼ばれず販売手数料・販売利益が計算されない
  async function fillReactPriceInput(el, value) {
    if (!el) return false;
    const text = String(value);
    const digitsOf = (v) => String(v || "").replace(/[^\d]/g, "");

    try { el.scrollIntoView({ block: "center" }); } catch (_) {}

    // --- フォーカス（focusin が本命）---
    el.focus();
    el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    el.dispatchEvent(new FocusEvent("focus", { bubbles: false }));
    await sleep(80);

    // --- 一括セット（v4.0.13 と同じやり方）---
    setNativeValue(el, text);
    el.dispatchEvent(new InputEvent("input", {
      bubbles: true, inputType: "insertText", data: text
    }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(150);

    // --- 入らなかった場合のフォールバック: execCommand ---
    if (digitsOf(el.value) !== digitsOf(text)) {
      try {
        el.focus();
        el.select?.();
        document.execCommand("selectAll", false, null);
        document.execCommand("delete", false, null);
        await sleep(50);
        document.execCommand("insertText", false, text);
        await sleep(150);
      } catch (e) {
        console.warn("[PayPay] execCommand fallback failed:", e);
      }
    }

    // --- キー入力があったように見せる（手数料再計算のトリガー用）---
    el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "0" }));
    el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "0" }));
    await sleep(50);

    // --- フォーカスを外す（focusout が本命）---
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    el.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
    el.blur();
    await sleep(150);

    // 「32,000」のようにカンマ整形される場合があるため、数字だけで比較する
    return digitsOf(el.value) === digitsOf(text);
  }

  function fireEnterKey(el) {
    const opts = {
      bubbles: true, cancelable: true,
      key: "Enter", code: "Enter", keyCode: 13, which: 13
    };
    el.dispatchEvent(new KeyboardEvent("keydown", opts));
    el.dispatchEvent(new KeyboardEvent("keypress", opts));
    el.dispatchEvent(new KeyboardEvent("keyup", opts));
  }

  async function waitForElement(selectorFn, timeoutMs = 5000, intervalMs = 100) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const el = selectorFn();
      if (el) return el;
      await sleep(intervalMs);
    }
    return null;
  }

  function findTitleInput() {
    const inputs = [...document.querySelectorAll('input[type="text"]')];
    return inputs.find((el) => (el.placeholder || "").includes("商品名")) || null;
  }

  function findDescriptionTextarea() {
    const tas = [...document.querySelectorAll("textarea")];
    return (
      tas.find((el) => (el.placeholder || "").startsWith("（任意）")) ||
      tas.find((el) => (el.placeholder || "").includes("例：1年ほど前")) ||
      null
    );
  }

  function findPriceInput() {
    const inputs = [...document.querySelectorAll('input[type="tel"]')];
    return inputs.find((el) => (el.placeholder || "") === "0") || inputs[0] || null;
  }

  // ★v4.0.16 「販売手数料」のすぐ近くに金額が表示されているか判定する
  //   注意: ページ下部に「販売手数料を変更する場合は、販売価格を修正してください」
  //   という説明文があり、単純な文字列一致だと誤判定するため、
  //   「販売手数料」の直後30文字以内に金額があるかで判定する
  function isFeeReflected() {
    try {
      const re = /販売手数料[\s\S]{0,30}?[-−▲]?\s*[1-9][\d,]*\s*円/;
      const nodes = [...document.querySelectorAll("div, span, p, td, li, section")];
      return nodes.some((el) => el.children.length <= 6 && re.test(el.textContent || ""));
    } catch (e) {
      console.warn("[PayPay] isFeeReflected failed:", e);
      return false;
    }
  }

  function findHashtagInput() {
    const inputs = [...document.querySelectorAll('input[type="text"]')];
    return (
      inputs.find((el) => (el.placeholder || "").includes("ハッシュタグ")) ||
      inputs.find((el) => el.maxLength === 20) ||
      null
    );
  }

  function findBrandInput() {
    const inputs = [...document.querySelectorAll('input[type="text"]')];
    return (
      inputs.find((el) => (el.placeholder || "").includes("ブランドを入力")) ||
      inputs.find((el) => (el.placeholder || "").includes("ブランド")) ||
      null
    );
  }

  function findShippingRadio(name) {
    return document.querySelector(`input[type="radio"][name="${name}"]`);
  }

  function findImageAddButton() {
    const buttonLikes = [...document.querySelectorAll("button, [role='button']")];
    const exact = buttonLikes.find((el) => {
      const t = (el.textContent || "").trim();
      if (t.length > 30) return false;
      return t === "画像を追加する" || t === "📷 画像を追加する" || t === "画像を追加" || /^[📷📸\s]*画像を追加(する)?$/.test(t);
    });
    if (exact) return exact;

    const others = [...document.querySelectorAll("div, span, a")];
    const exactOther = others.find((el) => {
      const t = (el.textContent || "").trim();
      if (t.length > 30) return false;
      if (el.children.length > 5) return false;
      return t === "画像を追加する" || t === "📷 画像を追加する" || t === "画像を追加" || /^[📷📸\s]*画像を追加(する)?$/.test(t);
    });
    if (exactOther) return exactOther;

    const all = [...document.querySelectorAll("button, [role='button'], div, span, a")];
    const leaf = all.find((el) => {
      const t = (el.textContent || "").trim();
      if (t.length > 30) return false;
      if (el.children.length > 5) return false;
      return /画像を追加/.test(t);
    });
    return leaf || null;
  }

  function findAlbumFileInput() {
    return document.getElementById("album");
  }

  function findImageModalCloseButton() {
    const modal = document.querySelector('.ReactModal__Content[role="dialog"]');
    if (!modal) return null;
    const buttons = [...modal.querySelectorAll("button, [role='button'], div, span")];
    return (
      buttons.find((el) => (el.textContent || "").trim() === "閉じる") ||
      modal.querySelector('[aria-label="close"]') ||
      modal.querySelector('[aria-label="閉じる"]') ||
      null
    );
  }

  const MERCARI_UI_LABELS = [
    "商品の情報", "商品の状態", "カテゴリー", "カテゴリ", "ブランド",
    "発送までの日数", "発送元の地域", "配送の方法", "配送料の負担",
    "出品者", "いいね", "コメント", "もっと見る", "閉じる"
  ];

  function isLikelyMercariUiLabel(text) {
    const t = String(text || "").trim();
    if (!t) return true;
    let hits = 0;
    for (const label of MERCARI_UI_LABELS) {
      if (t.includes(label)) hits++;
      if (hits >= 2) return true;
    }
    if (t.includes("商品の情報")) return true;
    if (t.includes("商品の状態")) return true;
    return false;
  }

  function sanitizeBrand(rawBrand) {
    const t = String(rawBrand || "").trim();
    if (!t) return "";
    if (isLikelyMercariUiLabel(t)) return "";
    if (t.length > 30) return "";
    return t;
  }

  function sanitizeDescription(rawDesc) {
    let t = String(rawDesc || "").trim();
    if (!t) return "";
    const patterns = [
      /もっと見る[\s\S]*$/,
      /\n\s*\d+\s*(年|か月|ヶ月|ヵ月|週間|日|時間|分)\s*前[\s\S]*$/,
      /\n\s*商品の情報[\s\S]*$/,
      /\n\s*商品の状態[\s\S]*$/
    ];
    for (const p of patterns) {
      t = t.replace(p, "");
    }
    return t.trim();
  }

  const HASHTAG_SKIP_WORDS = [
    "新品", "未使用", "美品", "中古", "正規品", "送料無料", "限定",
    "新品未使用", "未使用に近い", "新品同様", "ほぼ新品",
    "送料込み", "匿名配送", "即購入OK", "値下げ", "値引き",
    "希少", "レア", "人気", "おすすめ", "セール", "格安",
    "おまけ付き", "美品です"
  ];

  function isSkipWord(token) {
    return HASHTAG_SKIP_WORDS.includes(token);
  }

  function pickHashtagFromTitle(title) {
    const t = String(title || "").trim();
    if (!t) return "";
    const tokens = t.split(/[\s　・/,，|｜]+/).filter(Boolean);

    for (const tok of tokens) {
      if (tok.length < 2) continue;
      if (isSkipWord(tok)) continue;
      let strippedTok = tok;
      for (const skip of HASHTAG_SKIP_WORDS) {
        strippedTok = strippedTok.replace(skip, "").trim();
      }
      if (strippedTok.length >= 2) {
        return tok.slice(0, 20);
      }
    }

    for (const tok of tokens) {
      if (tok.length < 4) continue;
      if (isSkipWord(tok)) continue;
      return tok.slice(0, 20);
    }

    return (tokens[0] || t).slice(0, 20);
  }

  function buildHashtagFromData(data) {
    const cleanBrand = sanitizeBrand(data.brand);
    if (cleanBrand) {
      return cleanBrand.slice(0, 20);
    }
    const fromTitle = pickHashtagFromTitle(data.title);
    if (fromTitle) {
      return fromTitle;
    }
    return "";
  }

  function buildHashtagCandidates(data, maxCount) {
    if (!maxCount) maxCount = 5;
    const candidates = [];
    const seen = new Set();

    const pushCandidate = (raw) => {
      if (!raw) return;
      let t = String(raw).trim();
      if (!t) return;
      if (isLikelyMercariUiLabel(t)) return;
      if (isSkipWord(t)) return;
      if (t.length < 2) return;
      if (t.length > 20) t = t.slice(0, 20);
      if (seen.has(t)) return;
      seen.add(t);
      candidates.push(t);
    };

    const cleanBrand = sanitizeBrand(data.brand);
    if (cleanBrand) pushCandidate(cleanBrand);

    const title = String(data.title || "").trim();
    if (title) {
      const tokens = title.split(/[\s　・/,，|｜\-—–]+/).filter(Boolean);
      for (const tok of tokens) {
        if (candidates.length >= maxCount) break;
        if (tok.length < 2) continue;
        if (isSkipWord(tok)) continue;
        let cleaned = tok;
        for (const skip of HASHTAG_SKIP_WORDS) {
          if (cleaned.startsWith(skip) && cleaned.length > skip.length) {
            cleaned = cleaned.slice(skip.length);
          }
        }
        if (cleaned.length >= 2 && !isSkipWord(cleaned)) {
          pushCandidate(cleaned);
        } else if (tok.length >= 2 && !isSkipWord(tok)) {
          pushCandidate(tok);
        }
      }
    }

    const categoryPath = String(data.categoryPath || data.category || "").trim();
    if (categoryPath && candidates.length < maxCount) {
      const segs = categoryPath.split(">").map((s) => s.trim()).filter(Boolean);
      for (let i = segs.length - 1; i >= 0; i--) {
        if (candidates.length >= maxCount) break;
        pushCandidate(segs[i]);
      }
    }

    return candidates.slice(0, maxCount);
  }

  // ═══════════════════════════════════════════════════════════════
  // ブランド候補ロジック
  // ═══════════════════════════════════════════════════════════════

  function getYahooTitleCandidateTextsOnce() {
    const texts = [];

    const labels = [...document.querySelectorAll("div, span, label, p")].filter((el) => {
      const t = (el.textContent || "").trim();
      return t === "商品名の候補" && el.children.length <= 2;
    });

    for (const label of labels) {
      let parent = label.parentElement;
      for (let i = 0; i < 5 && parent; i++) {
        const buttons = [...parent.querySelectorAll("button")];
        for (const btn of buttons) {
          const t = (btn.textContent || "").trim();
          if (t.length > 0 && t.length < 30 && !t.includes("画像") && !t.includes("追加")) {
            let cleaned = t.replace(/^[+＋\s]+/, "").trim();
            if (cleaned.length >= 2) {
              texts.push(cleaned);
            }
          }
        }
        if (texts.length > 0) break;
        parent = parent.parentElement;
      }
      if (texts.length > 0) break;
    }

    if (texts.length === 0) {
      const altButtons = [...document.querySelectorAll('button[class*="sc-2a7a6bc"]')];
      for (const btn of altButtons) {
        const t = (btn.textContent || "").trim();
        if (t.length >= 2 && t.length < 30) {
          texts.push(t.replace(/^[+＋\s]+/, "").trim());
        }
      }
    }

    return texts;
  }

  async function getYahooTitleCandidateTextsWithRetry(maxWaitMs = 3000, intervalMs = 200) {
    const start = Date.now();
    let lastTexts = [];
    let stableCount = 0;
    while (Date.now() - start < maxWaitMs) {
      const texts = getYahooTitleCandidateTextsOnce();
      if (texts.length > 0 && texts.length === lastTexts.length) {
        stableCount++;
        if (stableCount >= 1) {
          console.log(`[PayPay] 候補ボタン安定 (${texts.length}個):`, texts);
          return texts;
        }
      } else {
        stableCount = 0;
      }
      lastTexts = texts;
      await sleep(intervalMs);
    }
    console.log(`[PayPay] 候補ボタン取得タイムアウト, 最終結果 (${lastTexts.length}個):`, lastTexts);
    return lastTexts;
  }

  // 【v4.0.11】 ブランド判定 (英字略称・型番を最優先に)
  function isBrandLikeWord(text) {
    const t = String(text || "").trim();
    if (!t) return { ok: false, priority: 0 };
    if (t.length < 2 || t.length > 30) return { ok: false, priority: 0 };
    if (isSkipWord(t)) return { ok: false, priority: 0 };
    if (isLikelyMercariUiLabel(t)) return { ok: false, priority: 0 };

    // 除外: 純粋な数字、「N点セット」「N周年」のような数字混じり
    if (/^\d+$/.test(t)) return { ok: false, priority: 0 };
    if (/^\d+(点セット|周年|本|個|枚|円|円超)/.test(t)) return { ok: false, priority: 0 };
    if (/(年記念|周年記念|限定品|限定版|セット$|の$)/.test(t)) return { ok: false, priority: 0 };

    // 【v4.0.11】 優先度5 (最高): 英字 2〜5文字の略称ブランド (DJI, SE, SONY, BMW, GAP)
    if (/^[A-Z]{2,5}$/.test(t)) {
      return { ok: true, priority: 5 };
    }
    // 大文字小文字混在の短い英字 (Sony, Apple, Asus 等)
    if (/^[A-Za-z]{2,6}$/.test(t)) {
      return { ok: true, priority: 5 };
    }

    // 【v4.0.11】 優先度4: 英数字型番系 (OM4, M3, S22, R5, EOS5D等)
    if (/^[A-Za-z][A-Za-z0-9]{1,5}$/.test(t) && /\d/.test(t)) {
      return { ok: true, priority: 4 };
    }

    // 優先度3: カタカナのみ (例: サンリオ、ポーター、ハローキティ)
    if (/^[ァ-ヴーぁ-ん]+$/.test(t) && /[ァ-ヴー]/.test(t)) {
      return { ok: true, priority: 3 };
    }

    // 優先度2: 英字のみ 7文字以上 (PORTER, KITTY等の単語ブランド)
    if (/^[A-Za-z]+$/.test(t)) {
      return { ok: true, priority: 2 };
    }

    // 優先度2: カタカナ+英字混在
    if (/^[ァ-ヴーA-Za-z\s]+$/.test(t)) {
      return { ok: true, priority: 2 };
    }

    return { ok: false, priority: 0 };
  }

  async function buildBrandCandidatesAsync(data, maxCount) {
    if (!maxCount) maxCount = 3;
    const candidates = [];
    const seen = new Set();

    const pushCandidate = (raw, priority) => {
      if (!raw) return;
      let t = String(raw).trim();
      if (!t) return;
      if (isLikelyMercariUiLabel(t)) return;
      if (isSkipWord(t)) return;
      if (t.length < 2) return;
      if (t.length > 30) t = t.slice(0, 30);
      const key = t.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push({ text: t, priority: priority || 1 });
    };

    // 第1候補: メルカリ側のブランドデータ (最優先)
    const cleanBrand = sanitizeBrand(data.brand);
    if (cleanBrand) pushCandidate(cleanBrand, 10);

    // 第2候補: Yahoo!フリマ側の「商品名の候補」ボタン
    const yahooTitleTexts = await getYahooTitleCandidateTextsWithRetry();
    console.log("[PayPay] Yahoo!フリマ商品名候補テキスト (最終):", yahooTitleTexts);
    for (const text of yahooTitleTexts) {
      const check = isBrandLikeWord(text);
      if (check.ok) {
        pushCandidate(text, check.priority);
      }
    }

    // 第3候補: メルカリの商品名から抽出 (フォールバック)
    const title = String(data.title || "").trim();
    if (title) {
      const tokens = title.split(/[\s　・/,，|｜\-—–]+/).filter(Boolean);
      for (const tok of tokens) {
        if (tok.length < 2) continue;
        if (isSkipWord(tok)) continue;
        const check = isBrandLikeWord(tok);
        if (check.ok) {
          pushCandidate(tok, check.priority - 1);
        }
      }
    }

    candidates.sort((a, b) => b.priority - a.priority);
    console.log("[PayPay] ブランド候補 (ソート後):", candidates);
    return candidates.slice(0, maxCount).map((c) => c.text);
  }

  function copyToClipboardSync(text) {
    let success = false;

    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.top = "0";
      ta.style.left = "-9999px";
      ta.style.opacity = "0";
      ta.setAttribute("readonly", "");
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      success = document.execCommand("copy");
      document.body.removeChild(ta);
    } catch (e) {
      console.warn("[PayPay] execCommand copy failed:", e);
      success = false;
    }

    if (!success && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => { console.log("[PayPay] navigator.clipboard fallback succeeded"); },
        (e) => { console.warn("[PayPay] navigator.clipboard fallback failed:", e); }
      );
      success = true;
    }

    return success;
  }

  function focusBrandInput() {
    const el = findBrandInput();
    if (!el) {
      console.warn("[PayPay] brand input not found, skipping autofocus");
      return false;
    }

    try {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => {
        el.focus();
        try {
          el.click();
        } catch (e) {}
      }, 100);
      return true;
    } catch (e) {
      console.warn("[PayPay] focusBrandInput failed:", e);
      return false;
    }
  }

  function showBrandPasteHint(brandText) {
    const old = document.getElementById("furima-paypay-brand-hint");
    if (old) old.remove();

    const brandInput = findBrandInput();
    if (!brandInput) {
      console.warn("[PayPay] brand input not found, skipping brand hint UI");
      return;
    }

    let insertTarget = brandInput;
    let parent = brandInput.parentElement;
    for (let i = 0; i < 4 && parent; i++) {
      const rect = parent.getBoundingClientRect();
      if (rect.width > 200) {
        insertTarget = parent;
        break;
      }
      parent = parent.parentElement;
    }

    const hint = document.createElement("div");
    hint.id = "furima-paypay-brand-hint";
    Object.assign(hint.style, {
      display: "inline-block",
      background: "#ff4b6e",
      color: "#fff",
      padding: "10px 18px",
      borderRadius: "999px",
      fontSize: "14px",
      fontWeight: "700",
      boxShadow: "0 4px 16px rgba(255,75,110,.35)",
      margin: "16px 0 8px 0",
      position: "relative",
      animation: "furimaPulse 1.2s ease-in-out infinite",
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    });
    hint.textContent = `👇 「${brandText}」をコピー済み！ Cmd+V で貼り付け`;

    const arrow = document.createElement("div");
    Object.assign(arrow.style, {
      position: "absolute",
      bottom: "-8px",
      left: "24px",
      width: "0",
      height: "0",
      borderLeft: "8px solid transparent",
      borderRight: "8px solid transparent",
      borderTop: "8px solid #ff4b6e"
    });
    hint.appendChild(arrow);

    if (!document.getElementById("furima-paypay-price-hint-style")) {
      const style = document.createElement("style");
      style.id = "furima-paypay-price-hint-style";
      style.textContent = "@keyframes furimaPulse { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }";
      document.head.appendChild(style);
    }

    try {
      insertTarget.parentElement.insertBefore(hint, insertTarget);
    } catch (e) {
      document.body.appendChild(hint);
    }

    const removeHint = () => {
      const h = document.getElementById("furima-paypay-brand-hint");
      if (h) h.remove();
      brandInput.removeEventListener("input", onInputRemove);
      brandInput.removeEventListener("click", onClickRemove);
    };

    const onInputRemove = () => {
      if (brandInput.value && brandInput.value.length > 0) {
        removeHint();
      }
    };
    brandInput.addEventListener("input", onInputRemove);

    const onClickRemove = () => {
      setTimeout(() => {
        if (brandInput.value && brandInput.value.length > 0) {
          removeHint();
        }
      }, 1000);
    };
    brandInput.addEventListener("click", onClickRemove);

    setTimeout(removeHint, 60000);
  }

  async function addOneHashtag(tagText) {
    const el = findHashtagInput();
    if (!el) return false;

    el.focus();
    await sleep(80);
    setReactInputValue(el, tagText);
    await sleep(300);
    fireEnterKey(el);
    await sleep(250);

    return true;
  }

  async function fillTitle(data) {
    const el = findTitleInput();
    if (!el) return { key: "title", ok: false, reason: "要素が見つからない" };
    const title = String(data.title || "").slice(0, 65);
    setReactInputValue(el, title);
    return { key: "title", ok: true, value: title };
  }

  async function fillDescription(data) {
    const el = findDescriptionTextarea();
    if (!el) return { key: "description", ok: false, reason: "要素が見つからない" };
    const cleaned = sanitizeDescription(data.description);
    const desc = cleaned.slice(0, 1000);
    setReactInputValue(el, desc);
    return { key: "description", ok: true, value: desc };
  }

  async function fillPrice(data) {
    const el = findPriceInput();
    if (!el) return { key: "price", ok: false, reason: "要素が見つからない" };
    const raw = String(data.price || "").replace(/[^\d]/g, "");
    if (!raw) return { key: "price", ok: false, reason: "価格データなし" };
    const clamped = Math.max(300, Math.min(300000, Number(raw)));

    // ★v4.0.15 一括セット＋focusin/focusout 方式
    const filled = await fillReactPriceInput(el, String(clamped));
    if (!filled) {
      return { key: "price", ok: false, reason: `入力後に値が反映されなかった(現在値:"${el.value}")` };
    }
    return { key: "price", ok: true, value: clamped };
  }

  async function fillHashtag(data) {
    const el = findHashtagInput();
    if (!el) return { key: "hashtag", ok: false, reason: "要素が見つからない" };
    const tag = buildHashtagFromData(data);
    if (!tag) return { key: "hashtag", ok: false, reason: "ハッシュタグ生成不可" };

    el.focus();
    setReactInputValue(el, tag);
    await sleep(400);
    fireEnterKey(el);
    await sleep(150);
    el.blur();

    return { key: "hashtag", ok: true, value: tag + "（チップ化はユーザー側で確認）" };
  }

  async function fillShipping(data) {
    const yamato = findShippingRadio("YAMATO");
    const jp = findShippingRadio("JAPAN_POST");
    if (yamato) {
      yamato.click();
      return { key: "shipping", ok: true, value: "YAMATO (おてがる配送)" };
    }
    if (jp) {
      jp.click();
      return { key: "shipping", ok: true, value: "JAPAN_POST (おてがるパック)" };
    }
    return { key: "shipping", ok: false, reason: "配送ラジオが見つからない" };
  }

  async function fetchImageAsFile(url, index) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: "FETCH_IMAGE_BINARY", url, index },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!response || !response.ok) {
            reject(new Error((response && response.error) || "画像取得失敗"));
            return;
          }
          try {
            const bytes = new Uint8Array(response.bytes);
            const blob = new Blob([bytes], { type: response.mime || "image/jpeg" });
            const ext = (response.mime || "image/jpeg").split("/")[1] || "jpg";
            const filename = `${response.filenameBase || "image_" + index}.${ext}`;
            const file = new File([blob], filename, { type: blob.type });
            resolve(file);
          } catch (e) {
            reject(e);
          }
        }
      );
    });
  }

  async function blobToJpegFileFallback(blob, index) {
    const img = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    const jpegBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.95));
    return new File([jpegBlob], `mercari_${index + 1}.jpg`, { type: "image/jpeg" });
  }

  // background経由で失敗した場合の直接fetchフォールバック
  async function fetchImageAsFileDirect(url, index) {
    const res = await fetch(url);
    const blob = await res.blob();
    if (blob.type === "image/jpeg" || blob.type === "image/png") {
      const ext = blob.type === "image/png" ? "png" : "jpg";
      return new File([blob], `mercari_${index + 1}.${ext}`, { type: blob.type });
    }
    return await blobToJpegFileFallback(blob, index);
  }

  const fireMouseEvent = (el, type) => {
    const ev = new MouseEvent(type, {
      view: window, bubbles: true, cancelable: true, button: 0
    });
    el.dispatchEvent(ev);
  };

  const fireFullClickSequence = (el) => {
    fireMouseEvent(el, "pointerdown");
    fireMouseEvent(el, "mousedown");
    fireMouseEvent(el, "pointerup");
    fireMouseEvent(el, "mouseup");
    fireMouseEvent(el, "click");
  };

  async function openImageModalAndGetFileInput() {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const existing = findAlbumFileInput();
      if (existing) {
        console.log(`[PayPay] file input found without click (attempt ${attempt})`);
        return existing;
      }
      const addBtn = findImageAddButton();
      if (!addBtn) {
        console.warn(`[PayPay] add button not found (attempt ${attempt})`);
        await sleep(400);
        continue;
      }
      console.log(`[PayPay] (attempt ${attempt}) add button:`, addBtn.tagName, "text:", (addBtn.textContent || "").trim().slice(0, 40));
      fireFullClickSequence(addBtn);
      try { addBtn.click(); } catch (e) {}
      await sleep(600);
      const fi = await waitForElement(() => findAlbumFileInput(), 3000, 200);
      if (fi) {
        console.log(`[PayPay] file input appeared on attempt ${attempt}`);
        return fi;
      }
      console.warn(`[PayPay] file input did not appear (attempt ${attempt}), retrying...`);
      await sleep(500);
    }
    return null;
  }

  async function uploadImages(data) {
    const images = Array.isArray(data.images) ? data.images : [];
    if (images.length === 0) {
      return { key: "images", ok: false, reason: "画像データなし" };
    }
    const maxImages = Math.min(images.length, 20);
    const files = [];
    for (let i = 0; i < maxImages; i++) {
      try {
        const file = await fetchImageAsFile(images[i], i);
        files.push(file);
      } catch (e) {
        console.warn(`[PayPay] image ${i} fetch failed（background経由）:`, e);
        // background経由で失敗した場合のフォールバック（直接fetch）
        try {
          const file = await fetchImageAsFileDirect(images[i], i);
          files.push(file);
        } catch (e2) {
          console.warn(`[PayPay] image ${i} fetch failed（フォールバックも失敗）:`, e2);
        }
      }
    }
    console.log(`[PayPay] 画像取得: ${files.length}/${maxImages}枚 成功`);
    if (files.length === 0) {
      return { key: "images", ok: false, reason: "画像ファイル作成に全て失敗" };
    }
    const fileInput = await openImageModalAndGetFileInput();
    if (!fileInput) {
      return { key: "images", ok: false, reason: "file input が出現せず（モーダル開かない）" };
    }
    console.log("[PayPay] file input found, files to upload:", files.length);
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "files")?.set;
    if (setter) {
      setter.call(fileInput, dt.files);
    } else {
      fileInput.files = dt.files;
    }
    fileInput.dispatchEvent(new Event("input", { bubbles: true }));
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(2000);
    const closeBtn = findImageModalCloseButton();
    if (closeBtn) {
      fireMouseEvent(closeBtn, "click");
      await sleep(300);
    }
    return { key: "images", ok: true, value: `${files.length}枚アップロード` };
  }

  const MERCARI_TO_YAHOO_FURIMA_CONDITION = {
    "新品、未使用": "未使用",
    "未使用に近い": "未使用に近い",
    "目立った傷や汚れなし": "目立った傷や汚れなし",
    "やや傷や汚れあり": "やや傷や汚れあり",
    "傷や汚れあり": "傷や汚れあり",
    "全体的に状態が悪い": "傷や汚れあり"
  };

  function getCategoryHints(categoryPath) {
    const path = String(categoryPath || "");
    if (!path) return [];
    return path.split(">").map((s) => s.trim()).filter(Boolean);
  }

  function pickYahooFurimaCondition(mercariCondition) {
    const mapped = MERCARI_TO_YAHOO_FURIMA_CONDITION[mercariCondition];
    if (mapped) return mapped;
    return "目立った傷や汚れなし";
  }

  // ═══════════════════════════════════════════════════════════════
  // 商品の状態 自動選択
  // ═══════════════════════════════════════════════════════════════

  function findConditionTrigger() {
    const allElements = [...document.querySelectorAll("div, span, label")];
    let conditionLabel = null;
    for (const el of allElements) {
      const t = (el.textContent || "").trim();
      if (t === "商品の状態" && el.children.length <= 2) {
        conditionLabel = el;
        break;
      }
    }
    if (!conditionLabel) return null;

    let parent = conditionLabel.parentElement;
    for (let i = 0; i < 6 && parent; i++) {
      const clickables = [...parent.querySelectorAll("div, button, [role='button']")];
      for (const c of clickables) {
        const ct = (c.textContent || "").trim();
        if (
          ct.includes("選択してください") ||
          Object.values(MERCARI_TO_YAHOO_FURIMA_CONDITION).some((v) => ct === v)
        ) {
          if (c.textContent && c.textContent.length < 40) {
            return c;
          }
        }
      }
      parent = parent.parentElement;
    }
    return null;
  }

  function findConditionModal() {
    const allDivs = [...document.querySelectorAll("div")];
    for (const d of allDivs) {
      const style = window.getComputedStyle(d);
      if (style.position !== "fixed") continue;
      const z = parseInt(style.zIndex || "0", 10);
      if (z < 100) continue;
      const t = (d.textContent || "");
      if (t.includes("商品の状態") && t.includes("未使用")) {
        return d;
      }
    }
    return null;
  }

  async function selectConditionInModal(modal, targetText) {
    if (!modal) return false;

    const candidates = [...modal.querySelectorAll("div, button, [role='button'], li, label, span")];
    let targetEl = null;

    for (const c of candidates) {
      const t = (c.textContent || "").trim();
      if (t === targetText && c.children.length <= 3) {
        targetEl = c;
        break;
      }
    }

    if (!targetEl) {
      for (const c of candidates) {
        const t = (c.textContent || "").trim();
        if (t.startsWith(targetText) && t.length < 120 && c.children.length <= 8) {
          targetEl = c;
          break;
        }
      }
    }

    if (!targetEl) {
      for (const c of candidates) {
        const t = (c.textContent || "").trim();
        if (t.includes(targetText) && t.length < 150 && c.children.length <= 10) {
          targetEl = c;
          break;
        }
      }
    }

    if (!targetEl) {
      console.warn("[PayPay] condition option not found for:", targetText);
      return false;
    }

    console.log("[PayPay] clicking condition option:", targetText, targetEl.tagName);
    fireFullClickSequence(targetEl);
    try { targetEl.click(); } catch (e) {}
    return true;
  }

  async function fillCondition(data) {
    const mercariCond = data.condition || "";
    if (!mercariCond) {
      return { key: "condition", ok: false, reason: "メルカリ状態データなし" };
    }
    const targetText = pickYahooFurimaCondition(mercariCond);

    const trigger = findConditionTrigger();
    if (!trigger) {
      return { key: "condition", ok: false, reason: "商品の状態欄が見つからない" };
    }

    console.log("[PayPay] opening condition modal...");
    fireFullClickSequence(trigger);
    try { trigger.click(); } catch (e) {}

    const modal = await waitForElement(() => findConditionModal(), 2000, 150);
    if (!modal) {
      return { key: "condition", ok: false, reason: "モーダルが開かない" };
    }

    await sleep(200);
    const clicked = await selectConditionInModal(modal, targetText);
    if (!clicked) {
      return { key: "condition", ok: false, reason: `「${targetText}」の選択肢が見つからない` };
    }

    await sleep(500);

    return { key: "condition", ok: true, value: `${mercariCond} → ${targetText}` };
  }

  // ═══════════════════════════════════════════════════════════════
  // 価格の「ここを1回クリック」誘導UI
  // ═══════════════════════════════════════════════════════════════

  function showPriceClickHint() {
    const old = document.getElementById("furima-paypay-price-hint");
    if (old) old.remove();

    const priceInput = findPriceInput();
    if (!priceInput) {
      console.warn("[PayPay] price input not found, skipping hint UI");
      return;
    }

    let insertTarget = priceInput;
    let parent = priceInput.parentElement;
    for (let i = 0; i < 4 && parent; i++) {
      const rect = parent.getBoundingClientRect();
      if (rect.width > 200) {
        insertTarget = parent;
        break;
      }
      parent = parent.parentElement;
    }

    const hint = document.createElement("div");
    hint.id = "furima-paypay-price-hint";
    Object.assign(hint.style, {
      display: "inline-block",
      background: "#ff4b6e",
      color: "#fff",
      padding: "10px 18px",
      borderRadius: "999px",
      fontSize: "14px",
      fontWeight: "700",
      boxShadow: "0 4px 16px rgba(255,75,110,.35)",
      margin: "16px 0 8px 0",
      position: "relative",
      animation: "furimaPulse 1.2s ease-in-out infinite",
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    });
    hint.textContent = "👇 ここを1回クリック（手数料反映）";

    const arrow = document.createElement("div");
    Object.assign(arrow.style, {
      position: "absolute",
      bottom: "-8px",
      left: "24px",
      width: "0",
      height: "0",
      borderLeft: "8px solid transparent",
      borderRight: "8px solid transparent",
      borderTop: "8px solid #ff4b6e"
    });
    hint.appendChild(arrow);

    if (!document.getElementById("furima-paypay-price-hint-style")) {
      const style = document.createElement("style");
      style.id = "furima-paypay-price-hint-style";
      style.textContent = "@keyframes furimaPulse { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }";
      document.head.appendChild(style);
    }

    try {
      insertTarget.parentElement.insertBefore(hint, insertTarget);
      console.log("[PayPay] price hint inserted before:", insertTarget.tagName);
    } catch (e) {
      console.warn("[PayPay] price hint insert failed, fallback to body:", e);
      document.body.appendChild(hint);
    }

    const removeHint = () => {
      const h = document.getElementById("furima-paypay-price-hint");
      if (h) h.remove();
      priceInput.removeEventListener("click", removeHint);
      priceInput.removeEventListener("focus", removeHint);
    };
    priceInput.addEventListener("click", removeHint, { once: true });
    priceInput.addEventListener("focus", removeHint, { once: true });
    setTimeout(removeHint, 30000);
  }

  // ═══════════════════════════════════════════════════════════════
  // 候補パネル
  // ═══════════════════════════════════════════════════════════════

  async function showCandidatesPanel(data) {
    const old = document.getElementById("furima-paypay-candidates");
    if (old) old.remove();

    const conditionHint = pickYahooFurimaCondition(data.condition);
    const categoryHints = getCategoryHints(data.categoryPath || data.category);
    const hashtagCandidates = buildHashtagCandidates(data, 5);
    const brandCandidates = await buildBrandCandidatesAsync(data, 3);

    const wrap = document.createElement("div");
    wrap.id = "furima-paypay-candidates";
    Object.assign(wrap.style, {
      position: "fixed", right: "16px", bottom: "16px",
      width: "340px", maxHeight: "75vh", overflowY: "auto",
      background: "#fff", border: "1px solid #e5e5ea",
      borderRadius: "12px", boxShadow: "0 10px 30px rgba(0,0,0,.15)",
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      fontSize: "13px", color: "#222", zIndex: "2147483646",
      padding: "14px 14px 12px"
    });

    const title = document.createElement("div");
    title.textContent = "Yahoo!フリマ候補 / 参考表示";
    Object.assign(title.style, {
      fontWeight: "700", fontSize: "14px", marginBottom: "8px", color: "#111"
    });
    wrap.appendChild(title);

    if (brandCandidates.length > 0) {
      const brandSec = document.createElement("div");
      brandSec.style.marginBottom = "12px";
      brandSec.style.padding = "10px";
      brandSec.style.background = "#fff7ed";
      brandSec.style.borderRadius = "8px";
      brandSec.style.border = "1px solid #fed7aa";

      const brandLbl = document.createElement("div");
      brandLbl.textContent = "📋 ブランド候補（クリックでコピー）";
      Object.assign(brandLbl.style, {
        fontWeight: "700", fontSize: "13px", color: "#9a3412", marginBottom: "6px"
      });
      brandSec.appendChild(brandLbl);

      const brandSteps = document.createElement("div");
      brandSteps.innerHTML = "① ボタンをクリック → ② <b>Cmd+V</b> で貼り付け（ブランド欄は自動選択されます）";
      Object.assign(brandSteps.style, {
        color: "#9a3412", fontSize: "11px", lineHeight: "1.4", marginBottom: "8px"
      });
      brandSec.appendChild(brandSteps);

      const brandBtnContainer = document.createElement("div");
      Object.assign(brandBtnContainer.style, {
        display: "flex", flexWrap: "wrap", gap: "6px"
      });

      brandCandidates.forEach((brand) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = "📋 " + brand;
        Object.assign(btn.style, {
          padding: "8px 14px",
          border: "none",
          borderRadius: "999px",
          background: "#3b82f6",
          color: "#fff",
          fontSize: "13px",
          fontWeight: "600",
          cursor: "pointer",
          transition: "all 0.15s",
          boxShadow: "0 1px 3px rgba(59,130,246,.3)"
        });
        btn.addEventListener("mouseenter", () => {
          if (!btn.dataset.copied) {
            btn.style.background = "#2563eb";
            btn.style.transform = "translateY(-1px)";
          }
        });
        btn.addEventListener("mouseleave", () => {
          if (!btn.dataset.copied) {
            btn.style.background = "#3b82f6";
            btn.style.transform = "translateY(0)";
          }
        });

        btn.addEventListener("click", function (e) {
          const ok = copyToClipboardSync(brand);

          if (ok) {
            btn.dataset.copied = "1";
            btn.textContent = "✓ コピー済み: " + brand;
            btn.style.background = "#10b981";
            btn.style.boxShadow = "0 1px 3px rgba(16,185,129,.3)";
            showBrandPasteHint(brand);
            focusBrandInput();
            toast(`「${brand}」をコピー！ そのまま Cmd+V で貼り付けてください`);
          } else {
            btn.textContent = "× コピー失敗";
            btn.style.background = "#ef4444";
            toast("コピーに失敗しました。手動で「" + brand + "」と入力してください");
            showBrandPasteHint(brand);
          }
        });

        brandBtnContainer.appendChild(btn);
      });

      brandSec.appendChild(brandBtnContainer);
      wrap.appendChild(brandSec);
    }

    if (hashtagCandidates.length > 0) {
      const tagSec = document.createElement("div");
      tagSec.style.marginBottom = "12px";
      tagSec.style.paddingBottom = "10px";
      tagSec.style.borderBottom = "1px solid #f0f0f0";

      const tagLbl = document.createElement("div");
      tagLbl.textContent = "# ハッシュタグ候補(クリックで追加)";
      Object.assign(tagLbl.style, {
        fontWeight: "700", fontSize: "13px", color: "#0a0a0a", marginBottom: "4px"
      });
      tagSec.appendChild(tagLbl);

      const hint = document.createElement("div");
      hint.textContent = "ボタンを押すと自動入力します（チップ化されない時は入力欄を1度クリック）";
      Object.assign(hint.style, {
        color: "#888", fontSize: "11px", lineHeight: "1.4", marginBottom: "8px"
      });
      tagSec.appendChild(hint);

      const btnContainer = document.createElement("div");
      Object.assign(btnContainer.style, {
        display: "flex", flexWrap: "wrap", gap: "6px"
      });

      hashtagCandidates.forEach((tag) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = "+ " + tag;
        Object.assign(btn.style, {
          padding: "6px 10px",
          border: "1px solid #ff4b6e",
          borderRadius: "999px",
          background: "#fff",
          color: "#ff4b6e",
          fontSize: "12px",
          fontWeight: "600",
          cursor: "pointer",
          transition: "all 0.15s"
        });
        btn.addEventListener("mouseenter", () => {
          if (!btn.dataset.added) {
            btn.style.background = "#ff4b6e";
            btn.style.color = "#fff";
          }
        });
        btn.addEventListener("mouseleave", () => {
          if (!btn.dataset.added) {
            btn.style.background = "#fff";
            btn.style.color = "#ff4b6e";
          }
        });
        btn.addEventListener("click", async () => {
          if (btn.dataset.added) return;
          btn.dataset.added = "1";
          btn.disabled = true;
          btn.textContent = "追加中...";
          btn.style.opacity = "0.7";

          const ok = await addOneHashtag(tag);

          if (ok) {
            btn.textContent = "✓ " + tag;
            btn.style.background = "#e8f8ec";
            btn.style.color = "#1a8a3e";
            btn.style.borderColor = "#1a8a3e";
            btn.style.opacity = "1";
          } else {
            btn.textContent = "× 失敗";
            btn.style.background = "#fff0f0";
            btn.dataset.added = "";
            btn.disabled = false;
            btn.style.opacity = "1";
          }
        });
        btnContainer.appendChild(btn);
      });

      tagSec.appendChild(btnContainer);
      wrap.appendChild(tagSec);
    }

    const note = document.createElement("div");
    note.textContent = "以下の項目は、参考表示です。フォームの選択肢から手動でお選びください。";
    Object.assign(note.style, {
      color: "#666", fontSize: "12px", lineHeight: "1.5", marginBottom: "10px"
    });
    wrap.appendChild(note);

    const addSection = (label, valueLines) => {
      const sec = document.createElement("div");
      sec.style.marginBottom = "12px";
      const lbl = document.createElement("div");
      lbl.textContent = label;
      Object.assign(lbl.style, {
        fontWeight: "700", fontSize: "13px", color: "#0a0a0a", marginBottom: "4px"
      });
      sec.appendChild(lbl);
      (Array.isArray(valueLines) ? valueLines : [valueLines]).forEach((line) => {
        if (!line) return;
        const v = document.createElement("div");
        v.textContent = "・" + line;
        Object.assign(v.style, {
          color: "#333", fontSize: "13px", lineHeight: "1.6", marginLeft: "2px"
        });
        sec.appendChild(v);
      });
      wrap.appendChild(sec);
    };

    if (categoryHints.length) {
      addSection("📁 カテゴリ（メルカリ側）", categoryHints.join(" > "));
    } else {
      addSection("📁 カテゴリ", "メルカリ側の情報なし");
    }

    const condLines = [
      `メルカリ: ${data.condition || "不明"}`,
      `→ Yahoo!フリマ推奨: ${conditionHint}（自動選択済み）`
    ];
    addSection("🏷 商品の状態", condLines);

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "閉じる";
    Object.assign(closeBtn.style, {
      width: "100%", padding: "8px", border: "1px solid #e5e5ea",
      borderRadius: "8px", background: "#f7f7f9", color: "#333",
      fontSize: "12px", cursor: "pointer", marginTop: "6px"
    });
    closeBtn.addEventListener("click", () => wrap.remove());
    wrap.appendChild(closeBtn);

    document.body.appendChild(wrap);
  }

  // ★管理アシスト用: どんな終わり方でも必ず結果を保存する（popupが待ち続けないように）
  async function saveResult(obj) {
    try {
      await chrome.storage.local.set({ paypayFillResult: JSON.stringify(obj) });
    } catch (_) {}
  }
  async function saveError(reason) {
    console.error("[PayPay] 中断:", reason);
    await saveResult({
      titleOk: false, priceOk: false, descOk: false,
      conditionOk: false, brandOk: false, imageOk: false,
      okCount: 0, ngList: [reason], error: reason
    });
  }

  try {
    // ★管理アシスト用: 起動したことを即座に知らせる（popup側の3秒判定用）
    try { await chrome.storage.local.set({ paypayFillStarted: Date.now() }); } catch (_) {}

    toast("Yahoo!フリマへ入力中...");

    // ★管理アシスト対応:
    //   1. paypayFillData … popup.js が渡す「今フォームに表示中の商品データ」（最優先）
    //   2. mercariData    … Pro互換のフォールバック
    const stored = await chrome.storage.local.get(["paypayFillData", "mercariData"]);
    let data = stored?.paypayFillData;
    if (!data || !data.title) data = stored?.mercariData;

    console.log("[PayPay] データ取得元:",
      stored?.paypayFillData?.title ? "paypayFillData" :
      stored?.mercariData?.title ? "mercariData" : "なし");

    if (!data || !data.title) {
      toast("商品データがありません。先に「メルカリで取得」を実行するか、商品を呼び出してください");
      await saveError("商品データが空です（メルカリで取得を実行してください）");
      return;
    }

    const isPayPayFurima =
      location.hostname.includes("paypayfleamarket") ||
      location.hostname.includes("paypay-fleamarket");

    if (!isPayPayFurima) {
      toast("Yahoo!フリマの出品ページで実行してください");
      await saveError("Yahoo!フリマ以外のページです（" + location.hostname + "）");
      return;
    }

    const results = [];
    results.push(await fillTitle(data));
    await sleep(120);
    results.push(await fillDescription(data));
    await sleep(120);
    results.push(await fillPrice(data));
    await sleep(150);
    results.push(await fillHashtag(data));
    await sleep(120);
    results.push(await fillShipping(data));
    await sleep(150);

    try {
      results.push(await fillCondition(data));
    } catch (e) {
      console.error("[PayPay] fillCondition error:", e);
      results.push({ key: "condition", ok: false, reason: e.message || "例外" });
    }
    await sleep(300);

    try {
      results.push(await uploadImages(data));
    } catch (e) {
      console.error("[PayPay] uploadImages error:", e);
      results.push({ key: "images", ok: false, reason: e.message || "例外" });
    }

    await showCandidatesPanel(data);

    // ★v4.0.16 手数料が反映されたか判定し、ダメだったときだけ誘導UIを出す
    //   （Reactの再描画を待つため少し間を置く）
    await sleep(500);
    const feeReflected = isFeeReflected();
    console.log("[PayPay] 手数料の自動反映:", feeReflected ? "成功" : "未反映");
    if (!feeReflected) showPriceClickHint();

    const okCount = results.filter((r) => r.ok).length;
    const ngList = results.filter((r) => !r.ok).map((r) => `${r.key}(${r.reason})`);
    console.log("[FURIMA PayPay] fill result", { results });

    // ★管理アシスト用: 実行結果パネルに表示するためステータスを保存
    try {
      const flag = (k) => results.some((r) => r.key === k && r.ok);
      await chrome.storage.local.set({
        paypayFillResult: JSON.stringify({
          titleOk:     flag("title"),
          priceOk:     flag("price"),
          descOk:      flag("description"),
          conditionOk: flag("condition"),
          brandOk:     flag("brand"),
          imageOk:     flag("images"),
          okCount,
          ngList
        })
      });
    } catch (_) {}

    const feeNote = feeReflected ? "" : " ※価格欄を1回クリックして手数料反映";
    if (ngList.length === 0) {
      toast(`Yahoo!フリマ入力完了: ${okCount}件${feeNote}`);
    } else {
      toast(`Yahoo!フリマ入力: ${okCount}件完了 / ${ngList.length}件失敗${feeNote}`);
    }
  } catch (e) {
    console.error("[FURIMA PayPay] fatal error:", e);
    toast("Yahoo!フリマ入力でエラーが発生しました: " + (e.message || e));
    await saveError("エラー: " + (e.message || String(e)));
  }
})();