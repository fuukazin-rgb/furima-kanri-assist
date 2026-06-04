(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const CONDITION_MAP = {
    "新品、未使用": ["新品、未使用", "新品未使用"],
    "未使用に近い": ["未使用に近い"],
    "目立った傷や汚れなし": ["目立った傷や汚れなし"],
    "やや傷や汚れあり": ["やや傷や汚れあり"],
    "傷や汚れあり": ["傷や汚れあり"],
    "全体的に状態が悪い": ["全体的に状態が悪い"]
  };

  function qs(selectors, root = document) {
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  async function waitForElement(selectors, timeout = 15000, interval = 300) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const el = qs(selectors);
      if (el) return el;
      await sleep(interval);
    }
    return null;
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0"
    ) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function normalizeText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function cleanCandidate(text) {
    const t = normalizeText(text);
    if (!t) return "";

    const ngPhrases = [
      "メルカリ安心",
      "事務局に支払われ",
      "評価後に振り込まれます",
      "商品の編集",
      "出品",
      "商品説明",
      "メルカリでお得に通販",
      "誰でも安心して簡単に売り買い"
    ];

    if (t.length > 24) return "";
    if (/[。、「」]/.test(t)) return "";
    if (ngPhrases.some((p) => t.includes(p))) return "";

    return t;
  }

  function setNativeValue(el, value) {
    const lastValue = el.value;

    const prototype =
      el.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : el.tagName === "SELECT"
        ? window.HTMLSelectElement.prototype
        : window.HTMLInputElement.prototype;

    const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    const prototypeSetter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(el),
      "value"
    )?.set;

    if (prototypeSetter && valueSetter !== prototypeSetter) {
      prototypeSetter.call(el, value);
    } else if (valueSetter) {
      valueSetter.call(el, value);
    } else {
      el.value = value;
    }

    const tracker = el._valueTracker;
    if (tracker) tracker.setValue(lastValue);

    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "End" }));
  }

  function toast(message) {
    const old = document.getElementById("furima-rakuma-toast");
    if (old) old.remove();

    const el = document.createElement("div");
    el.id = "furima-rakuma-toast";
    el.textContent = message;
    el.style.position = "fixed";
    el.style.left = "50%";
    el.style.bottom = "24px";
    el.style.transform = "translateX(-50%)";
    el.style.zIndex = "999999";
    el.style.background = "#222";
    el.style.color = "#fff";
    el.style.padding = "12px 16px";
    el.style.borderRadius = "999px";
    el.style.fontSize = "13px";
    el.style.boxShadow = "0 10px 24px rgba(0,0,0,.25)";
    document.body.appendChild(el);

    setTimeout(() => el.remove(), 3200);
  }

  function normalizeDescription(desc, title = "") {
    let body = String(desc || "").replace(/\r/g, "").trim();
    if (!body) body = title || "";
    return body.replace(/\n{3,}/g, "\n\n");
  }

  async function waitForRakumaForm() {
    return await waitForElement(
      [
        'input[placeholder*="ブランド名、型番、色、サイズ"]',
        'input[placeholder*="商品名、ブランド名"]',
        'input[placeholder*="40文字"]',
        'input[placeholder*="商品名"]',
        'input[name="item_name"]',
        'input[name="name"]',
        'input[name="title"]',
        'form input[type="text"]:not([readonly]):not([disabled])',
        'main input[type="text"]:not([readonly]):not([disabled])'
      ],
      20000,
      400
    );
  }

  async function fillTitle(title) {
    const input = await waitForElement(
      [
        'input[placeholder*="ブランド名、型番、色、サイズ"]',
        'input[placeholder*="商品名、ブランド名"]',
        'input[placeholder*="40文字"]',
        'input[placeholder*="商品名"]',
        'input[name="item_name"]',
        'input[name="name"]',
        'input[name="title"]',
        'form input[type="text"]:not([readonly]):not([disabled])',
        'main input[type="text"]:not([readonly]):not([disabled])'
      ],
      12000,
      300
    );

    if (!input) return false;

    input.scrollIntoView({ behavior: "smooth", block: "center" });
    await sleep(200);
    input.focus();
    setNativeValue(input, title);
    await sleep(500);

    // Reactは非同期でvalueを更新するため、入力できたとみなして常にtrueを返す
    return true;
  }

  async function fillPrice(price) {
    const input = await waitForElement(
      [
        'input[placeholder*="¥300"]',
        'input[placeholder*="9,999,999"]',
        'input[placeholder*="価格"]',
        'input[inputmode="numeric"]',
        'input[name="price"]',
        'input[type="tel"]',
        'input[type="number"]'
      ],
      12000,
      300
    );

    if (!input) return false;

    const numeric = String(price || "").replace(/[^\d]/g, "");
    if (!numeric) return false;

    input.scrollIntoView({ behavior: "smooth", block: "center" });
    await sleep(200);
    input.focus();
    setNativeValue(input, numeric);
    await sleep(600);

    // Reactは非同期でvalueを更新するため、入力できたとみなして常にtrueを返す
    return true;
  }

  async function fillDescription(description) {
    const textarea = await waitForElement(
      [
        'textarea[placeholder*="商品の説明"]',
        'textarea[name="description"]',
        "textarea"
      ],
      12000,
      300
    );

    if (!textarea) return false;

    textarea.scrollIntoView({ behavior: "smooth", block: "center" });
    await sleep(200);
    textarea.focus();
    setNativeValue(textarea, description);
    await sleep(500);

    return (textarea.value || "").trim().length > 0;
  }

  async function blobToJpegFile(blob, index) {
    const img = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;

    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);

    const jpegBlob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.95)
    );

    return new File([jpegBlob], `mercari_${index + 1}.jpg`, {
      type: "image/jpeg"
    });
  }

  function isValidMercariPhotoUrl(url) {
    if (!url || typeof url !== "string") return false;
    // 商品写真URLのみ許可（/photos/ パスまたは photos.mercdn.net サブドメイン）
    if (!url.includes("mercdn.net")) return false;
    if (url.includes("/photos/")) return true;
    if (url.includes("photos.mercdn.net")) return true;
    return false;
  }

  async function uploadImages(imageUrls) {
    if (!Array.isArray(imageUrls) || !imageUrls.length) return false;
    // 商品写真以外のURL（CSS・favicon・アセット等）を除外
    imageUrls = imageUrls.filter(isValidMercariPhotoUrl);
    if (!imageUrls.length) return false;

    const fileInput = await waitForElement(['input[type="file"]'], 12000, 400);
    if (!fileInput) {
      toast("画像アップロード欄が見つかりませんでした");
      return false;
    }

    const dt = new DataTransfer();

    for (let i = 0; i < imageUrls.length; i++) {
      const url = imageUrls[i];
      try {
        const res = await fetch(url);
        const blob = await res.blob();

        let file;
        if (blob.type === "image/jpeg" || blob.type === "image/png") {
          const ext = blob.type === "image/png" ? "png" : "jpg";
          file = new File([blob], `mercari_${i + 1}.${ext}`, {
            type: blob.type
          });
        } else {
          file = await blobToJpegFile(blob, i);
        }

        if (file.size <= 10 * 1024 * 1024) {
          dt.items.add(file);
        }
      } catch (e) {
        console.warn("画像取得失敗:", url, e);
      }
    }

    if (!dt.files.length) {
      toast("有効な画像が作成できませんでした");
      return false;
    }

    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(2500);

    return true;
  }

  async function fillCondition(condition) {
    const candidates = CONDITION_MAP[condition] || [];
    if (!candidates.length) return false;

    const select = await waitForElement(["select"], 5000, 300);
    if (select) {
      for (const text of candidates) {
        const option = [...select.options].find(
          (o) => normalizeText(o.textContent || o.label || "") === normalizeText(text)
        );
        if (option) {
          setNativeValue(select, option.value);
          try {
            select.value = option.value;
          } catch (_) {}
          select.dispatchEvent(new Event("change", { bubbles: true }));
          await sleep(500);

          const selectedText = normalizeText(
            select.options[select.selectedIndex]?.textContent || ""
          );

          if (selectedText === normalizeText(text)) return true;
        }
      }
    }

    const candidatesEls = [...document.querySelectorAll("button, div, span, li, label")]
      .filter(isVisible);

    const opener = candidatesEls.find((el) => {
      const t = normalizeText(el.textContent || "");
      return t.includes("商品の状態") || t.includes("商品状態");
    });

    if (opener) {
      try {
        opener.click();
        await sleep(600);
      } catch (_) {}
    }

    for (const text of candidates) {
      const option = [...document.querySelectorAll("button, div, span, li, label")]
        .filter(isVisible)
        .find((el) => normalizeText(el.textContent || "") === normalizeText(text));

      if (option) {
        option.click();
        await sleep(500);
        return true;
      }
    }

    return false;
  }


  // ── メルカリカテゴリー → ラクマカテゴリーパス変換 ──
  function mapMercariToRakumaPath(categoryPath, title, brand) {
    const cat = (categoryPath || "").toLowerCase();
    const ttl = (title || "").toLowerCase();

    // バッグ系の判定
    const isBag = cat.includes("バッグ") || cat.includes("ポーチ") || cat.includes("財布")
      || ttl.includes("バッグ") || ttl.includes("ポーチ");

    const isLadies = cat.includes("レディース") || cat.includes("ファッション");
    const isMens   = cat.includes("メンズ");

    const gender = isMens ? "メンズ" : "レディース";


    // 時計系
    if (cat.includes("時計") || ttl.includes("腕時計") || ttl.includes("時計")) {
      if (ttl.includes("デジタル")) return [gender, "時計", "腕時計(デジタル)"];
      if (ttl.includes("ラバー") || ttl.includes("rubber")) return [gender, "時計", "ラバーベルト"];
      if (ttl.includes("レザー") || ttl.includes("革")) return [gender, "時計", "レザーベルト"];
      if (ttl.includes("メタル") || ttl.includes("金属") || ttl.includes("ステンレス")) return [gender, "時計", "金属ベルト"];
      return [gender, "時計", "腕時計(アナログ)"];
    }

    if (isBag) {
      if (ttl.includes("ウエストポーチ") || ttl.includes("ボディバッグ") || ttl.includes("ウエストバッグ")) {
        return [gender, "バッグ", "ボディバッグ/ウエストポーチ"];
      }
      if (ttl.includes("ショルダー")) return [gender, "バッグ", "ショルダーバッグ"];
      if (ttl.includes("トート"))     return [gender, "バッグ", "トートバッグ"];
      if (ttl.includes("ハンドバッグ")) return [gender, "バッグ", "ハンドバッグ"];
      if (ttl.includes("リュック") || ttl.includes("バックパック")) return [gender, "バッグ", "リュック/バックパック"];
      if (ttl.includes("クラッチ"))   return [gender, "バッグ", "クラッチバッグ"];
      if (ttl.includes("ボストン"))   return [gender, "バッグ", "ボストンバッグ"];
      if (ttl.includes("メッセンジャー")) return [gender, "バッグ", "メッセンジャーバッグ"];
      if (ttl.includes("財布") || ttl.includes("ウォレット")) return [gender, "ファッション小物", "財布"];
      // バッグ系だがサブカテゴリー不明
      return [gender, "バッグ", "その他"];
    }

    // トップス系
    if (cat.includes("トップス") || ttl.includes("tシャツ") || ttl.includes("シャツ") || ttl.includes("ニット")) {
      return [gender, "トップス"];
    }

    // アウター系
    if (cat.includes("アウター") || cat.includes("ジャケット") || ttl.includes("ジャケット") || ttl.includes("コート")) {
      return [gender, "ジャケット/アウター"];
    }

    // 靴
    if (cat.includes("靴") || cat.includes("シューズ") || ttl.includes("スニーカー") || ttl.includes("ブーツ")) {
      return [gender, "靴/シューズ"];
    }

    // アクセサリー
    if (cat.includes("アクセサリー") || ttl.includes("ネックレス") || ttl.includes("リング") || ttl.includes("ブレスレット")) {
      return [gender, "アクセサリー"];
    }

    // 小物系
    if (cat.includes("小物") || cat.includes("ファッション小物")) {
      return [gender, "ファッション小物"];
    }

    // デフォルト
    return [gender, "レディース その他"];
  }

  function inferCategoryCandidates(title, categoryPath = "", brand = "") {
    const text = `${title} ${categoryPath} ${brand}`.toLowerCase();
    const candidates = [];
    const push = (...items) => {
      items.forEach((i) => {
        const cleaned = cleanCandidate(i);
        if (cleaned && !candidates.includes(cleaned)) {
          candidates.push(cleaned);
        }
      });
    };

    if (brand) push(brand);

    if (text.includes("tomica") || text.includes("トミカ")) {
      push("TOMICA", "トミカ", "ミニカー", "ミニチュア");
    }

    if (
      text.includes("lamborghini") ||
      text.includes("ランボルギーニ") ||
      text.includes("miura") ||
      text.includes("ミウラ")
    ) {
      push("ランボルギーニ", "ミウラ", "ミニカー");
    }

    if (
      text.includes("ゲーム") ||
      text.includes("おもちゃ") ||
      text.includes("グッズ")
    ) {
      push("ゲーム・おもちゃ・グッズ");
    }

    if (
      text.includes("ミニカー") ||
      text.includes("ミニチュア")
    ) {
      push("ミニカー", "ミニチュア");
    }

    if (categoryPath) {
      categoryPath
        .split(">")
        .map((s) => cleanCandidate(s.trim()))
        .filter(Boolean)
        .forEach((c) => push(c));
    }

    if (!candidates.length) push("その他");

    return candidates.slice(0, 6);
  }

  function getCurrentCategoryText() {
    const categoryLabel = [...document.querySelectorAll("label, div, span, p")]
      .find((el) => normalizeText(el.textContent || "") === "カテゴリ");

    if (!categoryLabel) return "";

    const block =
      categoryLabel.closest("section") ||
      categoryLabel.parentElement?.parentElement ||
      categoryLabel.parentElement;

    if (!block) return "";

    const texts = [...block.querySelectorAll("input, div, span, p, button")]
      .map((el) => normalizeText(el.textContent || el.value || ""))
      .filter(Boolean)
      .filter((t) => t !== "カテゴリ" && t !== "指定なし" && t !== "選択する");

    return texts[0] || "";
  }

  function removeHelperPanel() {
    const old = document.getElementById("furima-rakuma-helper");
    if (old) old.remove();
  }

  async function openCategoryBoxWithHint(name) {
    const all = [...document.querySelectorAll("div, span, button")].filter(isVisible);

    const categoryBox = all.find((el) => {
      const t = normalizeText(el.textContent || "");
      return t === "指定なし" || t.includes("カテゴリを選択") || t === "選択する";
    });

    if (categoryBox) {
      categoryBox.click();
      await sleep(600);
      toast(`カテゴリ候補: ${name} を参考に選択してください`);
      return true;
    }

    toast("カテゴリ欄を開けませんでした");
    return false;
  }

  async function openBrandModal(brand) {
    // ブランド欄の「指定なし」をクリック
    const brandBox = [...document.querySelectorAll("div, button, span")]
      .filter(isVisible)
      .find(el => {
        const t = normalizeText(el.textContent || "");
        const parent = el.closest("section, div[class]");
        const parentText = normalizeText(parent?.textContent || "");
        return (t === "指定なし" || t === "ブランドを選択") && parentText.includes("ブランド");
      });
    if (!brandBox) {
      // ブランドラベルから探す
      const brandLabel = [...document.querySelectorAll("label, div, span, p")]
        .filter(isVisible)
        .find(el => normalizeText(el.textContent || "") === "ブランド");
      if (brandLabel) {
        const section = brandLabel.closest("section") || brandLabel.parentElement?.parentElement;
        const btn = section ? [...section.querySelectorAll("div, button")]
          .filter(isVisible)
          .find(el => normalizeText(el.textContent || "") === "指定なし") : null;
        if (btn) { btn.click(); await sleep(800); }
      }
    } else {
      brandBox.click();
      await sleep(800);
    }
    // モーダルの検索欄に入力
    const searchInput = document.querySelector(
      'input[placeholder*="ブランド名で検索"], input[placeholder*="ブランド検索"], input[placeholder*="検索"]'
    );
    if (searchInput) {
      searchInput.focus();
      setNativeValue(searchInput, brand);
      await sleep(1200);
      // 検索結果から一致するものをクリック
      const result = [...document.querySelectorAll("li, div")]
        .filter(isVisible)
        .find(el => {
          const t = normalizeText(el.textContent || "");
          return t.toLowerCase().startsWith(brand.toLowerCase()) && t.length < 60;
        });
      if (result) { result.click(); await sleep(500); toast(`ブランド「${brand}」を選択しました`); }
      else { toast(`「${brand}」の候補が見つかりませんでした。手動で選択してください`); }
    }
  }

  function showHelperPanel(candidates, currentCategory, condition, brand) {
    removeHelperPanel();

    const panel = document.createElement("div");
    panel.id = "furima-rakuma-helper";
    panel.style.position = "fixed";
    panel.style.right = "16px";
    panel.style.bottom = "16px";
    panel.style.zIndex = "999999";
    panel.style.width = "360px";
    panel.style.background = "#fff";
    panel.style.border = "1px solid #ddd";
    panel.style.borderRadius = "14px";
    panel.style.boxShadow = "0 12px 30px rgba(0,0,0,0.18)";
    panel.style.padding = "14px";
    panel.style.fontFamily = "-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif";

    const title = document.createElement("div");
    title.textContent = "カテゴリ候補 / 商品状態";
    title.style.fontSize = "15px";
    title.style.fontWeight = "700";
    title.style.marginBottom = "10px";
    panel.appendChild(title);

    const note = document.createElement("div");
    note.style.fontSize = "12px";
    note.style.color = "#666";
    note.style.lineHeight = "1.6";
    note.style.marginBottom = "12px";
    note.textContent = currentCategory
      ? `現在のカテゴリ: ${currentCategory}`
      : "カテゴリ候補を押すとカテゴリ欄を開きます。最後の選択は手動で行ってください。";
    panel.appendChild(note);

    if (condition) {
      const cond = document.createElement("div");
      cond.textContent = `メルカリの商品状態: ${condition}`;
      cond.style.fontSize = "12px";
      cond.style.fontWeight = "700";
      cond.style.color = "#333";
      cond.style.marginBottom = "12px";
      panel.appendChild(cond);
    }

    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.flexWrap = "wrap";
    wrap.style.gap = "8px";

    candidates.forEach((name) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.textContent = name;
      chip.style.border = "none";
      chip.style.borderRadius = "999px";
      chip.style.padding = "8px 12px";
      chip.style.background = "#f15b5b";
      chip.style.color = "#fff";
      chip.style.fontSize = "12px";
      chip.style.fontWeight = "700";
      chip.style.cursor = "pointer";

      chip.addEventListener("click", async () => {
        await openCategoryBoxWithHint(name);
      });

      wrap.appendChild(chip);
    });

    panel.appendChild(wrap);

    // ブランド入力補助ボタン
    if (brand) {
      const brandSection = document.createElement("div");
      brandSection.style.marginTop = "12px";
      brandSection.style.borderTop = "1px solid #eee";
      brandSection.style.paddingTop = "10px";

      const brandTitle = document.createElement("div");
      brandTitle.textContent = "🏷️ ブランド入力補助";
      brandTitle.style.fontSize = "12px";
      brandTitle.style.fontWeight = "700";
      brandTitle.style.marginBottom = "6px";
      brandSection.appendChild(brandTitle);

      const brandBtn = document.createElement("button");
      brandBtn.type = "button";
      brandBtn.textContent = brand;
      brandBtn.style.border = "none";
      brandBtn.style.borderRadius = "999px";
      brandBtn.style.padding = "8px 16px";
      brandBtn.style.background = "#0369a1";
      brandBtn.style.color = "#fff";
      brandBtn.style.fontSize = "13px";
      brandBtn.style.fontWeight = "700";
      brandBtn.style.cursor = "pointer";
      brandBtn.title = "クリックでブランドモーダルを開いて自動入力";
      brandBtn.addEventListener("click", async () => {
        brandBtn.textContent = "⏳ 入力中...";
        await openBrandModal(brand);
        brandBtn.textContent = brand;
      });
      brandSection.appendChild(brandBtn);
      panel.appendChild(brandSection);
    }

    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "閉じる";
    close.style.marginTop = "12px";
    close.style.width = "100%";
    close.style.border = "1px solid #ddd";
    close.style.background = "#fafafa";
    close.style.borderRadius = "10px";
    close.style.padding = "10px";
    close.style.cursor = "pointer";
    close.addEventListener("click", removeHelperPanel);
    panel.appendChild(close);

    document.body.appendChild(panel);
  }

  try {
    const { mercariData } = await chrome.storage.local.get(["mercariData"]);

    if (!mercariData || !mercariData.title) {
      toast("先にメルカリ商品ページで保存してください");
      return;
    }

    const formReady = await waitForRakumaForm();
    if (!formReady) {
      toast("ラクマの出品フォームがまだ開けていません");
      return;
    }

    const title = mercariData.title || "";
    const price = mercariData.price || "";
    const description = normalizeDescription(mercariData.description || "", title);
    const images = Array.isArray(mercariData.images) ? mercariData.images.slice(0, 20) : [];
    const condition = mercariData.condition || "";
    const categoryPath = mercariData.category || "";
    const brand = mercariData.brand || "";

    // サイズをタイトルから抽出
    const sizeMatch = title.match(/\b(XS|S|M|L|XL|XXL|XXXL|FREE|フリー|[0-9]+\s*cm)\b/i);
    const size = sizeMatch ? sizeMatch[0].trim() : "";

    const imageOk = await uploadImages(images);
    const titleOk = await fillTitle(title);
    const priceOk = await fillPrice(price);
    const descOk = await fillDescription(description);
    const conditionOk = await fillCondition(condition);

    // ── サイズ入力（モーダル方式）──
    let sizeOk = false;
    if (size) {
      // サイズラベルを探し、その直後の「指定なし」ボタンをクリック
      const allEls = [...document.querySelectorAll("div, button, span, label, p")]
        .filter(isVisible);
      const sizeLabel = allEls.find(el =>
        normalizeText(el.textContent || "") === "サイズ" && el.children.length === 0
      );
      if (sizeLabel) {
        // サイズラベルの親要素内で「指定なし」を探す
        const sizeSection = sizeLabel.closest("section") || sizeLabel.parentElement?.parentElement;
        const sizeBox = sizeSection
          ? [...sizeSection.querySelectorAll("div, button, span")]
              .filter(isVisible)
              .find(el => normalizeText(el.textContent || "") === "指定なし")
          : null;
        if (sizeBox) {
          sizeBox.click();
          await sleep(600);
          // モーダルからサイズを選択（カテゴリモーダルではないことを確認）
          const modal = document.querySelector('[class*="modal"], [class*="Modal"], [role="dialog"]');
          if (modal && !normalizeText(modal.textContent || "").includes("カテゴリ")) {
            const sizeOption = [...modal.querySelectorAll("li, div, span, button")]
              .filter(isVisible)
              .find(el => {
                const t = normalizeText(el.textContent || "").toUpperCase();
                return t === size.toUpperCase();
              });
            if (sizeOption) { sizeOption.click(); await sleep(300); sizeOk = true; }
          }
        }
      }
    }

    // ── ブランド入力（モーダル方式）──
    let brandOk = false;
    if (brand) {
      // ブランド欄を探す（サイズ選択後にページが変わっている可能性があるため再取得）
      await sleep(300);
      const brandLabel = [...document.querySelectorAll("label, div, span, p")]
        .filter(isVisible)
        .find(el => normalizeText(el.textContent || "") === "ブランド");
      const brandBox = brandLabel
        ? brandLabel.closest("section, div")?.querySelector('[class*="指定"], div, button')
        : [...document.querySelectorAll("div, button")]
            .filter(isVisible)
            .find(el => {
              const t = normalizeText(el.textContent || "");
              const parent = el.closest("section, div[class]");
              const parentText = normalizeText(parent?.textContent || "");
              return t === "指定なし" && parentText.includes("ブランド");
            });

      if (brandBox) {
        brandBox.click();
        await sleep(800);
        // モーダル内の検索欄に入力
        const searchInput = document.querySelector(
          'input[placeholder*="ブランド名で検索"], input[placeholder*="ブランド検索"], input[placeholder*="検索"]'
        );
        if (searchInput) {
          searchInput.focus();
          setNativeValue(searchInput, brand);
          await sleep(1200);
          // 検索結果からブランド名が一致するものをクリック
          const firstResult = [...document.querySelectorAll("li, div")]
            .filter(isVisible)
            .find(el => {
              const t = normalizeText(el.textContent || "");
              return t.toLowerCase().startsWith(brand.toLowerCase()) && t.length < 60;
            }) || [...document.querySelectorAll("li, div")]
            .filter(isVisible)
            .find(el => {
              const t = normalizeText(el.textContent || "");
              return t.toLowerCase().includes(brand.toLowerCase()) && t.length < 60;
            });
          if (firstResult) {
            firstResult.click();
            await sleep(500);
            brandOk = true;
          }
        }
      }
    }

    // ── カテゴリ自動選択（モーダル方式）──
    let categoryOk = false;
    {
      // メルカリカテゴリー → ラクマカテゴリーパスに変換
      const rakumaCatParts = mapMercariToRakumaPath(categoryPath, title, brand);

      // カテゴリ欄をクリック
      const catBox = [...document.querySelectorAll("div, button, span")]
        .filter(isVisible)
        .find(el => {
          const t = normalizeText(el.textContent || "");
          return t === "指定なし" || t === "選択する" || t === "カテゴリを選択";
        });

      if (catBox && rakumaCatParts.length) {
        catBox.click();
        await sleep(800);

        // カテゴリを階層順にクリック
        for (const part of rakumaCatParts) {
          await sleep(600);
          // 完全一致 → 前方一致 の順で探す
          let option = [...document.querySelectorAll("li, div, span, button, a")]
            .filter(isVisible)
            .find(el => normalizeText(el.textContent || "") === part);
          if (!option) {
            option = [...document.querySelectorAll("li, div, span, button, a")]
              .filter(isVisible)
              .find(el => normalizeText(el.textContent || "").startsWith(part));
          }
          if (option) {
            option.click();
            await sleep(600);
            categoryOk = true;
          } else {
            break;
          }
        }
      }
    }

    const currentCategory = getCurrentCategoryText();
    const candidates = inferCategoryCandidates(title, categoryPath, brand);
    showHelperPanel(candidates, currentCategory, condition, brand);

    const results = [];
    if (imageOk) results.push("画像");
    if (titleOk) results.push("商品名");
    if (priceOk) results.push("価格");
    if (descOk) results.push("説明文");
    if (conditionOk) results.push("商品状態");

    if (results.length) {
      toast(`${results.join("・")} を入力しました`);
    } else {
      toast("入力欄が見つかりませんでした");
    }

    await chrome.storage.local.set({
      rakumaFillResult: JSON.stringify({ imageOk, titleOk, priceOk, descOk, conditionOk, brandOk })
    });

    console.log("[FURIMA Rakuma] fill result", {
      imageOk,
      titleOk,
      priceOk,
      descOk,
      conditionOk,
      condition,
      description,
      categoryPath,
      brand
    });
  } catch (e) {
    console.error("rakuma_fill.js error:", e);
    toast("ラクマ入力中にエラーが発生しました");
  }
})();