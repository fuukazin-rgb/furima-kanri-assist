// mercari_scrape.js v1.0
// メルカリ商品ページから情報を取得する（files方式で実行）
// storage: mercariScrapeResult (JSON)

(async () => {
  const bodyText = document.body?.innerText || "";
  const text = sel => document.querySelector(sel)?.textContent?.trim() || "";

  // ── タイトル ──────────────────────────────────────────────
  const rawTitle =
    text("h1") ||
    text('[data-testid="name"]') ||
    text('[class*="ItemName"]') ||
    text('[class*="item-name"]') ||
    "";
  const title = rawTitle.replace(/^[\s\u3000【】〔〕『』「」♪★☆◆●○■□▲▼→←↑↓※]+/, "").trim();

  // ── 価格 ──────────────────────────────────────────────────
  const priceRaw =
    text('[data-testid="price"]') ||
    text('span[class*="Price"]') ||
    text('[class*="ItemPrice"]') ||
    bodyText.match(/¥\s?([\d,]+)/)?.[0] || "";
  const price = (priceRaw.match(/[\d,]+/)?.[0] || "").replace(/,/g, "");

  // ── 説明文 ────────────────────────────────────────────────
  let description = "";
  // DOM優先
  const descEl =
    document.querySelector('[data-testid="description"]') ||
    document.querySelector('[class*="ItemDescription"]') ||
    document.querySelector('[class*="item-description"]');
  if (descEl) {
    description = descEl.innerText?.trim() || descEl.textContent?.trim() || "";
  }
  // フォールバック: innerTextから正規表現
  if (!description) {
    const m = bodyText.match(/商品の説明\s*\n?([\s\S]{10,2000})/);
    if (m) description = m[1].split(/商品の情報|いいね！|コメント/)[0].trim();
  }

  // ── 商品の状態 ────────────────────────────────────────────
  let condition = "";
  const condEl =
    document.querySelector('[data-testid="condition"]') ||
    document.querySelector('[class*="ItemCondition"]');
  if (condEl) condition = condEl.textContent?.trim() || "";
  if (!condition) {
    const m = bodyText.match(/商品の状態\s*\n?([^\n]{2,30})/);
    if (m) condition = m[1].trim();
  }

  // ── カテゴリー ────────────────────────────────────────────
  let category = "";

  // 方法1: data-testid="item-detail-category" から取得（最も確実）
  const catEl = document.querySelector('[data-testid="item-detail-category"]');
  if (catEl) {
    const catText = catEl.innerText || catEl.textContent || "";
    category = catText.trim().split(/\n/).map(s => s.trim()).filter(Boolean).join(" > ");
  }

  // 方法2: パンくずリストから取得
  if (!category) {
    const breadcrumbs = [...document.querySelectorAll('[class*="breadcrumb"], nav a, [aria-label*="パンくず"] a')]
      .map(el => el.textContent?.trim())
      .filter(t => t && t !== "ホーム" && t !== "HOME" && t.length < 40);
    if (breadcrumbs.length > 1) {
      category = breadcrumbs.join(" > ");
    }
  }

  // 方法3: bodyTextからカテゴリー行を取得
  if (!category) {
    const m = bodyText.match(/カテゴリー?\s*\n?([^\n]{2,60})/);
    if (m) category = m[1].trim();
  }

  // ── サイズ ──────────────────────────────────────────────
  let size = "";
  const sizeEl = document.querySelector('[data-testid="サイズ"] p');
  if (sizeEl) {
    size = sizeEl.textContent.trim();
  }
  if (!size) {
    const m = (document.body.innerText || "").match(/サイズ\s*\n?([^\n]{1,20})/);
    if (m) size = m[1].trim();
  }

  // ── ブランド ──────────────────────────────────────────────
  let brand = "";
  const brandEl =
    document.querySelector('[data-testid="brand"]') ||
    document.querySelector('[class*="ItemBrand"]') ||
    document.querySelector('[class*="brand-name"]');
  if (brandEl) {
    const t = brandEl.textContent?.trim() || "";
    // 短くて意味のある文字列のみ採用（説明文の混入を防ぐ）
    if (t.length > 0 && t.length <= 40 && !t.includes("。") && !t.includes("、")) {
      brand = t;
    }
  }
  if (!brand) {
    // ブランド行の次の行を取得（改行区切りで厳密に）
    const brandMatch = bodyText.match(/ブランド[\s\n]+([^\n]{1,40})/);
    if (brandMatch) {
      const candidate = brandMatch[1].trim();
      // 説明文っぽい文字列を除外（句読点・長すぎる・ひらがな多い）
      if (
        candidate.length <= 30 &&
        !candidate.includes("。") &&
        !candidate.includes("、") &&
        !candidate.includes("です") &&
        !candidate.includes("ます") &&
        !candidate.includes("ため") &&
        !candidate.includes("ので")
      ) {
        brand = candidate;
      }
    }
  }
  // 無効なブランド名を除外
  const invalidBrands = [
    "指定なし", "ブランドなし", "品撲滅への取り組み", "品質への取り組み",
    "偽物撲滅", "安心・安全", "その他", "ノーブランド", "---",
    "コメント", "いいね", "送料"
  ];
  if (invalidBrands.some(ng => brand.includes(ng))) brand = "";

  // ── 画像 ──────────────────────────────────────────────────
  // メルカリの商品画像: mercdn.netのphotoURLを収集
  const seenUrls = new Set();
  const images = [];
  for (const img of document.querySelectorAll("img")) {
    const src = img.src || img.getAttribute("src") || "";
    // mercdnのphoto URLのみ（サムネイル除外のためサイズ指定なしを優先）
    if (!src || !src.startsWith("http")) continue;
    if (!(/mercdn|mercari/i.test(src))) continue;
    if (src.includes("/thumbnail/") || src.includes("thumbnail")) continue;
    // 重複除去（クエリ除去したURLで比較）
    const base = src.split("?")[0];
    if (seenUrls.has(base)) continue;
    seenUrls.add(base);
    images.push(src);
    if (images.length >= 20) break;
  }

  // ── 結果を storage に保存 ──────────────────────────────────
  const result = {
    title,
    price,
    description,
    condition,
    category: category,
    size,
    brand,
    images,
    sourceUrl: location.href,
    savedAt:   new Date().toISOString()
  };

  await chrome.storage.local.set({ mercariData: result });
})();