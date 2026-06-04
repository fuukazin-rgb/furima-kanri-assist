const $ = (id) => document.getElementById(id);

// ═══════════════════════════════════════════════════════════════
//  ライセンス設定
// ═══════════════════════════════════════════════════════════════
const LICENSE_SERVER_KANRI   = "https://furima-license-server-1.onrender.com";
const GUMROAD_URL_KANRI      = "https://fuukazin.gumroad.com/l/hnpwm";
const OFFLINE_GRACE_MS_KANRI = 72 * 60 * 60 * 1000; // 72時間

// ─── ハッシュ・フィンガープリント ──────────────────────────
async function sha256Kanri(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
}

async function getFingerprintKanri() {
  const parts = [
    navigator.userAgent||"", navigator.language||"",
    Intl.DateTimeFormat().resolvedOptions().timeZone||"",
    String(navigator.hardwareConcurrency||""), String(navigator.deviceMemory||""),
    String(screen.width||""), String(screen.height||""),
    String(screen.colorDepth||""), navigator.platform||""
  ];
  return await sha256Kanri(parts.join("||"));
}

async function getOrCreateDeviceIdKanri() {
  const s = await chrome.storage.local.get(["kanri_device_id"]);
  if (s.kanri_device_id) return s.kanri_device_id;
  const fp = await getFingerprintKanri();
  const id = await sha256Kanri("furima-kanri-assist-device::" + fp);
  await chrome.storage.local.set({ kanri_device_id: id });
  return id;
}

async function postJsonKanri(path, body) {
  const res = await fetch(LICENSE_SERVER_KANRI + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json.message || json.error) || `HTTP ${res.status}`);
  return json;
}

// ─── トライアル ──────────────────────────────────────────────
async function startTrialKanri() {
  const fp  = await getFingerprintKanri();
  const did = await getOrCreateDeviceIdKanri();
  const s   = await chrome.storage.local.get(["kanri_trial_started"]);
  if (s.kanri_trial_started) {
    return await postJsonKanri("/trial/status", { fingerprint: fp, deviceId: did });
  }
  const r = await postJsonKanri("/trial/start", { fingerprint: fp, deviceId: did });
  await chrome.storage.local.set({ kanri_trial_started: true });
  return r;
}

async function getTrialStatusKanri() {
  const fp  = await getFingerprintKanri();
  const did = await getOrCreateDeviceIdKanri();
  return await postJsonKanri("/trial/status", { fingerprint: fp, deviceId: did });
}

// ─── ライセンス認証 ──────────────────────────────────────────
async function verifyLicenseKanri(key) {
  const did = await getOrCreateDeviceIdKanri();
  const fp  = await getFingerprintKanri();
  return await postJsonKanri("/verify-kanri", { licenseKey: key.trim(), deviceId: did, fingerprint: fp });
}

async function checkSavedLicenseKanri() {
  const s = await chrome.storage.local.get(["kanri_license_key","kanri_license_verified","kanri_license_verified_at"]);
  if (!s.kanri_license_verified || !s.kanri_license_key) return { valid: false };
  try {
    const did = await getOrCreateDeviceIdKanri();
    const fp  = await getFingerprintKanri();
    const r   = await postJsonKanri("/verify-kanri", { licenseKey: s.kanri_license_key, deviceId: did, fingerprint: fp });
    if (r?.valid) {
      await chrome.storage.local.set({ kanri_license_verified_at: Date.now() });
      return { valid: true, key: s.kanri_license_key, degraded: false };
    }
    await chrome.storage.local.remove(["kanri_license_key","kanri_license_verified","kanri_license_verified_at"]);
    return { valid: false };
  } catch(e) {
    // オフライン猶予
    const last = Number(s.kanri_license_verified_at || 0);
    if (last && Date.now() - last <= OFFLINE_GRACE_MS_KANRI) {
      return { valid: true, key: s.kanri_license_key, degraded: true };
    }
    return { valid: false, serverError: true };
  }
}

// ─── アクセス権判定（修正済み）────────────────────────────
// ★ここを修正: kanri_trial_approved（ボタンを押した記録）がある場合のみ通過
// kanri_server_error_at だけでは通過しない
async function canUseKanri() {
  // ライセンス認証済み
  const lic = await checkSavedLicenseKanri();
  if (lic.valid) return { ok: true, reason: "license", degraded: lic.degraded };

  // サーバーでトライアルが有効か確認
  try {
    const trial = await getTrialStatusKanri();
    if (trial?.valid) {
      if (trial.endAt) await chrome.storage.local.set({ kanri_trial_end_at: trial.endAt });
      await chrome.storage.local.set({ kanri_trial_approved: true, kanri_trial_approved_at: Date.now() });
      return { ok: true, reason: "trial", remainingText: trial.remainingText };
    }
  } catch(_) {}

  // ボタンを押した記録がある場合は72時間猶予
  const s = await chrome.storage.local.get(["kanri_trial_approved", "kanri_trial_approved_at"]);
  if (s.kanri_trial_approved) {
    const approvedAt = Number(s.kanri_trial_approved_at || 0);
    if (Date.now() - approvedAt <= OFFLINE_GRACE_MS_KANRI) {
      return { ok: true, reason: "trial", remainingText: "トライアル利用中" };
    }
  }

  // 上記以外はオーバーレイ表示
  return { ok: false };
}

// ─── UIロック/アンロック ─────────────────────────────────────
const KANRI_LOCK_BTNS = ["btnGetMercari","btnReload","btnRakuma","btnYahoo",
  "btnFormatTitle","btnFormatDesc","btnCheck","btnStale","btnProfit",
  "btnCalcShipping","btnSaveSiteMeta","btnSoldMercari","btnSoldRakuma","btnSoldYahoo"];

function lockMainButtons() {
  KANRI_LOCK_BTNS.forEach(id => { const el=$(id); if(el){ el.disabled=true; el.style.opacity="0.4"; } });
}
function unlockMainButtons() {
  KANRI_LOCK_BTNS.forEach(id => { const el=$(id); if(el){ el.disabled=false; el.style.opacity=""; } });
}

// ─── オーバーレイ制御 ────────────────────────────────────────
function showLicenseOverlay() {
  const ov = $("licenseOverlay");
  if (ov) {
    ov.style.display = "flex";
    ov.style.position = "fixed";
    ov.style.inset = "0";
    ov.style.zIndex = "999999";
    ov.style.alignItems = "center";
    ov.style.justifyContent = "center";
    ov.style.background = "rgba(15,23,42,0.97)";
    // input欄が確実にクリックできるようにする
    const input = ov.querySelector("#licenseKeyInput");
    if (input) {
      input.style.pointerEvents = "auto";
      input.style.position = "relative";
      input.style.zIndex = "1000000";
    }
  }
}
function hideLicenseOverlay() {
  const ov = $("licenseOverlay");
  if (ov) { ov.style.display = "none"; }
}

// ─── トライアルバナー更新 ────────────────────────────────────
function updateTrialBanner(state) {
  const banner = $("trialBanner");
  if (!banner) return;
  if (state.reason === "license") {
    banner.style.display = "block";
    banner.style.background = state.degraded ? "#fef3c7" : "#d1fae5";
    banner.style.color       = state.degraded ? "#92400e" : "#065f46";
    banner.style.borderColor = state.degraded ? "#f59e0b" : "#6ee7b7";
    banner.textContent = state.degraded ? "⚠ ライセンス認証済み（サーバー確認待ち）" : "✅ ライセンス認証済み";
  } else if (state.reason === "trial") {
    banner.style.display = "block";
    banner.style.background = "#dbeafe";
    banner.style.color       = "#1d4ed8";
    banner.style.borderColor = "#93c5fd";
    // 時計はinit()が書き換えるのでここではremainingTextを設定
    banner.dataset.trialMode = "1";
  }
  // 購入バナーをトライアル中に表示
  const buyBanner = $("buyBanner");
  if (buyBanner && state.reason === "trial") {
    buyBanner.style.display = "block";
  }
}

// ─── ライセンス認証ボタン処理 ────────────────────────────────
async function handleLicenseVerify() {
  const input   = $("licenseKeyInput");
  const msgEl   = $("licenseMsg");
  const btn     = $("btnLicenseVerify");
  const key     = (input?.value || "").trim();

  if (!key) { if(msgEl) msgEl.textContent = "ライセンスキーを入力してください"; return; }
  if (!key.startsWith("FKA-")) {
    if(msgEl) { msgEl.textContent = "FKA-で始まるキーを入力してください"; msgEl.style.color="#dc2626"; }
    return;
  }

  if(btn) btn.disabled = true;
  if(msgEl) { msgEl.textContent = "認証中..."; msgEl.style.color="#5b6e85"; }

  try {
    const r = await verifyLicenseKanri(key);
    if (r?.valid) {
      await chrome.storage.local.set({
        kanri_license_key:         key,
        kanri_license_verified:    true,
        kanri_license_verified_at: Date.now()
      });
      if(msgEl) { msgEl.textContent = "✅ 認証完了！"; msgEl.style.color="#0f766e"; }
      hideLicenseOverlay();
      unlockMainButtons();
      updateTrialBanner({ reason: "license", degraded: false });
    } else {
      if(msgEl) { msgEl.textContent = r?.message || "無効なライセンスキーです"; msgEl.style.color="#dc2626"; }
    }
  } catch(e) {
    if(msgEl) { msgEl.textContent = "サーバーエラー: " + e.message; msgEl.style.color="#dc2626"; }
  } finally {
    if(btn) btn.disabled = false;
  }
}

// ─── トライアル開始ボタン処理（修正済み）────────────────────
// ★ここを修正: ボタンを押したら必ず kanri_trial_approved を保存
// サーバー成功・失敗どちらの場合も保存してオーバーレイを閉じる
async function handleTrialStart() {
  const btn   = $("btnTrialStart");
  const msgEl = $("licenseMsg");
  if(btn) btn.disabled = true;
  if(msgEl) { msgEl.textContent = "トライアル開始中..."; msgEl.style.color="#5b6e85"; }

  try {
    const r = await startTrialKanri();
    if (r?.valid) {
      // サーバー成功: trial_approved を保存してオーバーレイを閉じる
      await chrome.storage.local.set({
        kanri_trial_approved:    true,
        kanri_trial_approved_at: Date.now()
      });
      await chrome.storage.local.remove(["kanri_server_error_at"]);
      if (r.endAt) await chrome.storage.local.set({ kanri_trial_end_at: r.endAt });
      // 残り時間を表示してから閉じる
      if(msgEl) {
        msgEl.style.color = "#0f766e";
        msgEl.style.fontSize = "15px";
        msgEl.style.fontWeight = "700";
        msgEl.textContent = "✅ トライアル開始！ " + (r.remainingText || "残り7日間");
      }
      await new Promise(res => setTimeout(res, 2000));
      hideLicenseOverlay();
      unlockMainButtons();
      updateTrialBanner({ reason: "trial", remainingText: r.remainingText });
      // 購入カードを表示
      const pc1 = $("purchaseCard");
      if(pc1) pc1.style.display = "block";
      if(msgEl) msgEl.textContent = "";
      return;
    }
  } catch(e) {
    console.warn("trial start error:", e.message);
  }

  // サーバーエラー・失敗時でも trial_approved を保存して72時間は使用可能にする
  await chrome.storage.local.set({
    kanri_trial_approved:    true,
    kanri_trial_approved_at: Date.now()
  });
  hideLicenseOverlay();
  unlockMainButtons();
  const banner = $("trialBanner");
  if (banner) {
    banner.style.display = "block";
    banner.style.background = "#fef3c7";
    banner.style.color = "#92400e";
    banner.style.borderColor = "#f59e0b";
    banner.dataset.trialMode = "1";
    banner.textContent = "⚠ サーバー確認待ち（72時間以内は使用可能）";
  }
  // 購入カードを表示
  const pc2 = $("purchaseCard");
  if(pc2) pc2.style.display = "block";
  if(btn) btn.disabled = false;
}

// ─── ライセンスチェック起動 ──────────────────────────────────
async function initLicenseKanri() {
  // ボタンイベント登録
  const verifyBtn = $("btnLicenseVerify");
  if (verifyBtn) verifyBtn.addEventListener("click", handleLicenseVerify);
  const trialBtn  = $("btnTrialStart");
  if (trialBtn)  trialBtn.addEventListener("click", handleTrialStart);

  // メイン画面のライセンス認証ボタン
  const mainVerifyBtn = $("btnMainLicenseVerify");
  if (mainVerifyBtn) mainVerifyBtn.addEventListener("click", async () => {
    const input = $("mainLicenseKeyInput");
    const msgEl = $("mainLicenseMsg");
    const key   = (input?.value || "").trim();
    if (!key) { if(msgEl) msgEl.textContent = "ライセンスキーを入力してください"; return; }
    if (!key.startsWith("FKA-")) {
      if(msgEl) { msgEl.textContent = "FKA-で始まるキーを入力してください"; msgEl.style.color="#dc2626"; }
      return;
    }
    mainVerifyBtn.disabled = true;
    if(msgEl) { msgEl.textContent = "認証中..."; msgEl.style.color="#5b6e85"; }
    try {
      const r = await verifyLicenseKanri(key);
      if (r?.valid) {
        await chrome.storage.local.set({
          kanri_license_key:         key,
          kanri_license_verified:    true,
          kanri_license_verified_at: Date.now()
        });
        if(msgEl) { msgEl.textContent = "✅ 認証完了！"; msgEl.style.color="#0f766e"; }
        // 購入カードを非表示
        const pc = $("purchaseCard");
        if(pc) pc.style.display = "none";
        updateTrialBanner({ reason: "license", degraded: false });
      } else {
        if(msgEl) { msgEl.textContent = r?.message || "無効なライセンスキーです"; msgEl.style.color="#dc2626"; }
      }
    } catch(e) {
      if(msgEl) { msgEl.textContent = "サーバーエラー: " + e.message; msgEl.style.color="#dc2626"; }
    } finally {
      mainVerifyBtn.disabled = false;
    }
  });

  try {
    const state = await canUseKanri();
    if (state.ok) {
      hideLicenseOverlay();
      unlockMainButtons();
      updateTrialBanner(state);
      // ライセンス認証済みなら購入カードを非表示、トライアル中は表示
      const pc = $("purchaseCard");
      if (pc) pc.style.display = (state.reason === "license") ? "none" : "block";
    } else {
      lockMainButtons();
      showLicenseOverlay();
    }
  } catch(e) {
    console.error("initLicenseKanri error:", e);
    // エラー時はオーバーレイを出してオフラインメッセージ
    const msgEl = $("licenseMsg");
    if(msgEl) { msgEl.textContent = "サーバー接続エラー。時間をおいて再試行してください"; msgEl.style.color="#dc2626"; }
    lockMainButtons();
    showLicenseOverlay();
  }
}

const STORAGE_KEY      = "furima_assist_item";
const META_KEY         = "furima_assist_meta";
const COUNTER_KEY      = "furima_assist_counter";
const SITE_META_KEY    = "furima_assist_site_meta";

// ═══════════════════════════════════════════════════════════════
//  ユーティリティ
// ═══════════════════════════════════════════════════════════════
function setStatus(text) {
  $("status").textContent = text;
}

function toNumber(value) {
  const n = Number(String(value || "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function formatYen(value) {
  return `${Math.round(value).toLocaleString("ja-JP")}円`;
}

function normalizeSpaces(str) {
  return String(str || "").replace(/\s+/g, " ").trim();
}

function uniq(arr) {
  return [...new Set(arr.filter(Boolean))];
}

function getTodayString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

// ═══════════════════════════════════════════════════════════════
//  管理番号
//  形式: FM-YYYYMMDD-001
//  同じ日は連番。日付が変わると1から再スタート。
//  同一商品をメルカリ・ラクマ・Yahooフリマに出しても同じ番号で紐づけ管理できる。
// ═══════════════════════════════════════════════════════════════
async function generateManageId() {
  const today = getTodayString();
  const res   = await chrome.storage.local.get(COUNTER_KEY);
  const map   = res[COUNTER_KEY] || {};
  const next  = Number(map[today] || 0) + 1;
  map[today]  = next;
  await chrome.storage.local.set({ [COUNTER_KEY]: map });
  return `FM-${today}-${String(next).padStart(3, "0")}`;
}

// ═══════════════════════════════════════════════════════════════
//  タイトル整形
//  並び順: ブランド → 商品名(その他) → 型番 → サイズ → 色 → 状態
// ═══════════════════════════════════════════════════════════════
const BRAND_WORDS = [
  "ナイキ","NIKE","Nike",
  "アディダス","adidas","Adidas","ADIDAS",
  "プーマ","PUMA","Puma",
  "ニューバランス","New","Balance","NewBalance",
  "ユニクロ","UNIQLO","GU",
  "ザラ","ZARA",
  "アップル","Apple","APPLE",
  "ソニー","SONY","Sony",
  "任天堂","Nintendo",
  "パナソニック","Panasonic",
  "シャープ","Sharp","SHARP",
  "キヤノン","Canon","CANON",
  "ルイヴィトン","Louis","Vuitton",
  "グッチ","Gucci",
  "シャネル","Chanel",
  "プラダ","Prada",
  "コーチ","Coach",
  "バーバリー","Burberry",
  "ラルフローレン","Ralph","Lauren",
  "トミー","Tommy","Hilfiger",
  "リーバイス","Levi","Levis",
  "無印良品","MUJI",
  "ポケモン","Pokemon",
  "サンリオ","Sanrio","ハローキティ",
  "ドラゴンボール","ワンピース","鬼滅"
];

const COLOR_WORDS = [
  "黒","白","赤","青","紺","緑","黄","紫","茶","橙",
  "グレー","ベージュ","シルバー","ゴールド",
  "ブラック","ホワイト","ピンク","オレンジ",
  "ネイビー","アイボリー","ブラウン","カーキ","ボルドー","ラベンダー"
];

const CONDITION_WORDS = ["美品","新品","未使用","中古","良品","難あり","訳あり"];

const SIZE_RE  = /^(\d+(\.\d+)?(cm|mm|号|インチ|inch|L|W)?|XS|S|M|L|XL|XXL|XXXL|FREE|フリー)$/i;
const MODEL_RE = /^[A-Za-z][A-Za-z0-9\-_/]{2,}$|^[0-9][A-Za-z0-9\-_/]{2,}$/;

function classifyToken(token) {
  if (BRAND_WORDS.includes(token))     return "brand";
  if (SIZE_RE.test(token))             return "size";
  if (COLOR_WORDS.includes(token))     return "color";
  if (CONDITION_WORDS.includes(token)) return "condition";
  if (MODEL_RE.test(token) && /\d/.test(token) && /[A-Za-z]/.test(token)) return "model";
  return "other";
}

function formatTitleSmart(title) {
  const raw = normalizeSpaces(title);
  if (!raw) return "";

  const buckets = { brand: [], model: [], size: [], color: [], condition: [], other: [] };
  for (const t of raw.split(/\s+/)) {
    buckets[classifyToken(t)].push(t);
  }

  return normalizeSpaces([
    ...uniq(buckets.brand),
    ...buckets.other,
    ...uniq(buckets.model),
    ...uniq(buckets.size),
    ...uniq(buckets.color),
    ...uniq(buckets.condition)
  ].join(" "));
}

// ─── 出品先別タイトル調整 ───────────────────────────────────
function formatTitleForSite(title, site) {
  const base = formatTitleSmart(title);
  if (site === "rakuma") {
    // ラクマ: 40文字制限、全角記号カット
    return base.replace(/[【】〔〕『』「」]/g, " ").replace(/\s+/g, " ").trim().replace(/^[\s\W]+/, "").slice(0, 40);
  }
  if (site === "yahoo" || site === "auction") {
    // Yahooフリマ / ヤフオク: 65文字制限
    return base.replace(/[【】〔〕『』「」]/g, " ").replace(/\s+/g, " ").trim().replace(/^[\s\W]+/, "").slice(0, 65);
  }
  return base;
}

// ═══════════════════════════════════════════════════════════════
//  説明文整形
//  状態・発送・注意点を自動セクション化
// ═══════════════════════════════════════════════════════════════
function formatDescriptionSmart(description, condition, shipping, memo) {
  const desc  = String(description || "").trim();
  const parts = [];

  const hasCondBlock  = /【?状態】?/.test(desc);
  const hasShipBlock  = /【?発送】?|【?配送】?/.test(desc);

  if (desc) {
    parts.push(desc.replace(/\n{3,}/g, "\n\n"));
  }

  if (!hasCondBlock && condition) {
    parts.push(`【状態】\n${condition}`);
  }

  if (!hasShipBlock) {
    const shippingNote = toNumber(shipping) > 0
      ? `【発送】\n送料込みで発送予定です（目安: ${formatYen(toNumber(shipping))}）。`
      : "【発送】\n送料込みで発送予定です。";
    parts.push(shippingNote);
  }

  if (memo) {
    parts.push(`【注意点・補足】\n${memo}`);
  }

  parts.push(
    "【お願い】\n状態はできるだけ正確に記載していますが、気になる点があれば購入前にお気軽にご確認ください。"
  );

  return parts.join("\n\n");
}

// ─── 出品先別説明文調整 ─────────────────────────────────────
function formatDescriptionForSite(description, site) {
  let text = String(description || "").trim();
  text = text.replace(/\n{3,}/g, "\n\n");

  if (site === "rakuma" || site === "yahoo") {
    // 外部SNS誘導ワードをマスク
    text = text.replace(/LINE|Twitter|X\.com|Instagram|@[^\s]+/g, "※");
  }

  return text;
}

// ═══════════════════════════════════════════════════════════════
//  出品チェック
// ═══════════════════════════════════════════════════════════════
function checkListing(data) {
  const warnings = [];
  const price    = toNumber(data.price);

  if (!data.manageId)
    warnings.push("⚠ 管理番号が未設定です（自動発番してください）");
  if (!data.title || data.title.length < 8)
    warnings.push("⚠ 商品名が短すぎます（8文字以上推奨）");
  if (data.title && data.title.length > 40)
    warnings.push("ℹ 商品名が40文字超えです（ラクマ出品時は要確認）");
  if (!data.description || data.description.length < 30)
    warnings.push("⚠ 説明文が短すぎます（30文字以上推奨）");
  if (!data.price || price <= 0)
    warnings.push("⚠ 価格が未設定または0円です");
  if (price > 0 && price < 300)
    warnings.push("⚠ 価格が300円未満です（フリマ最低価格に注意）");
  if (price > 100000)
    warnings.push("ℹ 価格が10万円超えです（高額商品は説明文を充実させてください）");
  if (!data.condition)
    warnings.push("⚠ 商品状態が未設定です");
  if (!data.images || data.images.length < 2)
    warnings.push("⚠ 画像枚数が少なすぎます（2枚以上推奨）");
  if (data.images && data.images.length < 4)
    warnings.push("ℹ 画像が4枚未満です（多いほど売れやすい傾向があります）");
  if (!data.category)
    warnings.push("ℹ カテゴリ情報が未入力です");

  const titleLower    = (data.title || "").toLowerCase();
  const hasBrandInTitle = BRAND_WORDS.some((b) => titleLower.includes(b.toLowerCase()));
  if (!hasBrandInTitle)
    warnings.push("ℹ タイトルにブランド名が見当たりません（あれば入れると検索されやすくなります）");

  return warnings;
}

// ─── 売れ残りチェック ──────────────────────────────────────
function checkStale(listedDate) {
  if (!listedDate) return "出品日が未設定です";
  const diff = Math.floor((Date.now() - new Date(listedDate).getTime()) / 86400000);
  if (diff >= 60) return `📦 出品から ${diff} 日です。\n長期在庫です。大幅値下げか再出品を強くおすすめします。`;
  if (diff >= 30) return `📦 出品から ${diff} 日です。\n再出品候補です。説明文と価格を見直しましょう。`;
  if (diff >= 14) return `📦 出品から ${diff} 日です。\n値下げや説明文の見直し候補です。`;
  return `📦 出品から ${diff} 日です。\n現時点では通常範囲内です。`;
}

// ═══════════════════════════════════════════════════════════════
//  利益計算
// ═══════════════════════════════════════════════════════════════
function calculateProfit(price, shipping, feeRate, cost) {
  const p = toNumber(price);
  const s = toNumber(shipping);
  const f = toNumber(feeRate);
  const c = toNumber(cost);

  const fee    = Math.round(p * (f / 100));
  const profit = p - fee - s - c;
  const margin = p > 0 ? (profit / p) * 100 : 0;

  return { price: p, fee, shipping: s, cost: c, profit, margin };
}

function updateProfitView() {
  const r = calculateProfit(
    $("price").value, $("shipping").value, $("feeRate").value, $("cost").value
  );
  $("viewPrice").textContent    = formatYen(r.price);
  $("viewFee").textContent      = formatYen(r.fee);
  $("viewShipping").textContent = formatYen(r.shipping);
  $("viewCost").textContent     = formatYen(r.cost);
  $("viewProfit").textContent   = formatYen(r.profit);
  $("viewMargin").textContent   = `${r.margin.toFixed(1)}%`;
}

// ─── 値下げ提案 ────────────────────────────────────────────
function suggestDiscount(price, shipping, feeRate, cost) {
  return [100, 300, 500].map((cut) => {
    const newPrice = Math.max(300, toNumber(price) - cut);
    const r = calculateProfit(newPrice, shipping, feeRate, cost);
    return `-${cut}円 → ${newPrice}円（利益: ${r.profit}円 / 利益率: ${r.margin.toFixed(1)}%）`;
  });
}

// ═══════════════════════════════════════════════════════════════
//  コメントテンプレート
// ═══════════════════════════════════════════════════════════════
const COMMENT_TEMPLATES = {
  "値下げは可能ですか":
    "コメントありがとうございます。大幅なお値下げは難しい状況ですが、少々でしたら対応可能です。ご希望額があればお知らせください。",
  "いつ発送できますか":
    "コメントありがとうございます。できるだけ早めの発送を心がけています。通常はご購入後1〜2日以内を目安に発送しています。",
  "購入しても大丈夫ですか":
    "コメントありがとうございます。即購入で大丈夫です。どうぞよろしくお願いいたします。",
  "専用にできますか":
    "コメントありがとうございます。申し訳ありませんが、トラブル防止のため専用対応は控えております。ご了承ください。",
  "まとめ買い割引できますか":
    "コメントありがとうございます。複数ご購入の場合は少々お値引きできる場合があります。ご希望の商品をお知らせください。",
  "購入お礼":
    "この度はご購入いただきありがとうございます！できるだけ早く丁寧に梱包してお送りいたします。どうぞよろしくお願いいたします。",
  "発送完了":
    "本日発送いたしました。到着までいましばらくお待ちください。何かご不明な点があればお気軽にメッセージください。"
};

function getCommentTemplate(key) {
  return COMMENT_TEMPLATES[key] || "";
}

// ═══════════════════════════════════════════════════════════════
//  Chrome API ラッパー
// ═══════════════════════════════════════════════════════════════
async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]) return tabs[0];
  // currentWindow fallback: lastFocusedWindow
  const tabs2 = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs2[0];
}

async function executeInTab(tabId, func, args = []) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args
  });
  return results?.[0]?.result;
}

// ═══════════════════════════════════════════════════════════════
//  ストレージ
// ═══════════════════════════════════════════════════════════════
async function saveItem(item)     { await chrome.storage.local.set({ [STORAGE_KEY]:   item });     }
async function loadItem()         { return (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] || null; }
async function saveMeta(meta)     { await chrome.storage.local.set({ [META_KEY]:       meta });     }
async function loadMeta()         { return (await chrome.storage.local.get(META_KEY))[META_KEY]       || null; }
async function saveSiteMeta(s)    { await chrome.storage.local.set({ [SITE_META_KEY]:  s });        }
async function loadSiteMeta()     { return (await chrome.storage.local.get(SITE_META_KEY))[SITE_META_KEY] || null; }

// ═══════════════════════════════════════════════════════════════
//  フォーム操作
// ═══════════════════════════════════════════════════════════════
function fillForm(item, meta) {
  $("manageId").value       = item?.manageId || "";
  $("title").value          = item?.title    || "";
  $("price").value          = item?.price    || "";
  $("description").value    = item?.description || "";
  $("condition").value      = item?.condition   || "";
  $("category").value       = item?.category    || "";
  // brandフィールドがあれば表示
  const brandEl = $("brand");
  if (brandEl) brandEl.value = item?.brand || "";

  $("inventoryMemo").value  = meta?.inventoryMemo  || "";
  $("cost").value           = meta?.cost           || "";
  $("shipping").value       = meta?.shipping       || "";
  $("feeRate").value        = meta?.feeRate        ?? 10;
  $("listedDate").value     = meta?.listedDate     || "";
  $("marketplace").value    = meta?.marketplace    || "mercari";
  $("managementMemo").value = meta?.managementMemo || "";

  updateProfitView();
}

function fillSiteMetaForm(siteMeta) {
  if (!siteMeta) return;
  $("mercariUrl").value  = siteMeta.mercariUrl  || "";
  $("mercariMemo").value = siteMeta.mercariMemo || "";
  $("rakumaUrl").value   = siteMeta.rakumaUrl   || "";
  $("rakumaMemo").value  = siteMeta.rakumaMemo  || "";
  $("yahooUrl").value    = siteMeta.yahooUrl    || "";
  $("yahooMemo").value   = siteMeta.yahooMemo   || "";
}

function collectFormItem(oldItem = {}) {
  return {
    ...oldItem,
    manageId:    $("manageId").value.trim(),
    title:       $("title").value.trim(),
    price:       $("price").value.trim(),
    description: $("description").value.trim(),
    condition:   $("condition").value,
    category:    $("category").value.trim()
  };
}

function collectMeta() {
  return {
    inventoryMemo:  $("inventoryMemo").value.trim(),
    cost:           $("cost").value.trim(),
    shipping:       $("shipping").value.trim(),
    feeRate:        $("feeRate").value.trim(),
    listedDate:     $("listedDate").value,
    marketplace:    $("marketplace").value,
    managementMemo: $("managementMemo").value.trim()
  };
}

function collectSiteMeta() {
  return {
    mercariUrl:  $("mercariUrl").value.trim(),
    mercariMemo: $("mercariMemo").value.trim(),
    rakumaUrl:   $("rakumaUrl").value.trim(),
    rakumaMemo:  $("rakumaMemo").value.trim(),
    yahooUrl:    $("yahooUrl").value.trim(),
    yahooMemo:   $("yahooMemo").value.trim()
  };
}

async function autoSaveCurrentState() {
  const item = collectFormItem((await loadItem()) || {});
  const meta = collectMeta();
  await saveItem(item);
  await saveMeta(meta);
}

// ═══════════════════════════════════════════════════════════════
//  タブ内実行関数: メルカリスクレイプ
// ═══════════════════════════════════════════════════════════════
function mercariScrape() {
  const text = (sel) => document.querySelector(sel)?.textContent?.trim() || "";
  const title = text("h1") || text('[data-testid="name"]');

  const priceText =
    text('[data-testid="price"]') ||
    text('span[class*="Price"]') ||
    document.body.innerText.match(/¥\s?([\d,]+)/)?.[0] || "";
  const price = (priceText.match(/[\d,]+/)?.[0] || "").replace(/,/g, "");

  let description = "";
  const bodyText  = document.body.innerText || "";
  const descMatch = bodyText.match(/商品の説明\s*([\s\S]{20,1200})/);
  if (descMatch) description = descMatch[1].split("商品の情報")[0].trim();

  let condition = "";
  const condMatch = bodyText.match(/商品の状態\s*\n([^\n]{2,30})/);
  if (condMatch) condition = condMatch[1].trim();

  let categoryPath = "";
  const catEl = document.querySelector('[data-testid="item-detail-category"]');
  if (catEl) {
    categoryPath = catEl.innerText.trim().split(/\n/).map(s => s.trim()).filter(Boolean).join(" > ");
  }
  if (!categoryPath) {
    const catMatch = bodyText.match(/カテゴリー?\s*\n([^\n]{2,60})/);
    if (catMatch) categoryPath = catMatch[1].trim();
  }

  // ブランド取得
  let brand = "";
  const brandMatch = bodyText.match(/ブランド\s*\n([^\n]{1,40})/);
  if (brandMatch) brand = brandMatch[1].trim();
  // data-testid やDOMからも試みる
  if (!brand) {
    brand = text('[data-testid="brand"]') ||
            text('[class*="brand"]') || "";
  }

  const images = [...document.querySelectorAll("img")]
    .map((img) => img.src)
    .filter((src) => /^https?:/.test(src))
    .filter((src) => /mercdn|mercari/i.test(src))
    .slice(0, 20);

  return {
    manageId: "",
    title,
    price,
    description,
    condition,
    category:  categoryPath,
    brand,
    images,
    sourceUrl: location.href,
    savedAt:   new Date().toISOString()
  };
}

// ═══════════════════════════════════════════════════════════════
//  タブ内実行関数: ラクマ貼り付け
//  ※ ラクマのフォーム構造に合わせたセレクタを使用
// ═══════════════════════════════════════════════════════════════
async function rakumaPaste(item) {
  // React管理の入力欄に値をセットするためのヘルパー
  function setNativeValue(el, value) {
    const lastValue = el.value;
    const proto = el.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set
      || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
    if (setter) {
      setter.call(el, value);
    } else {
      el.value = value;
    }
    const tracker = el._valueTracker;
    if (tracker) tracker.setValue(lastValue);
    el.dispatchEvent(new Event("input",  { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur",   { bubbles: true }));
  }

  function trySet(selectors, value) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        el.scrollIntoView({ block: "center" });
        el.focus();
        setNativeValue(el, value);
        return true;
      }
    }
    return false;
  }

  // 商品名: ラクマは data-testid や placeholder で特定
  const titleOk = trySet([
    '[data-testid="item-name-input"]',
    'input[name="name"]',
    'input[placeholder*="40文字"]',
    'input[placeholder*="商品名"]',
    'input[placeholder*="ブランド名"]'
  ], item.title || "");

  // 価格: ラクマは placeholder="¥300〜¥9,999,999" の input
  const priceOk = trySet([
    '[data-testid="item-price-input"]',
    'input[placeholder*="300"]',
    'input[placeholder*="9,999,999"]',
    'input[name="price"]',
    'input[inputmode="numeric"]',
    'input[type="number"]'
  ], (item.price || "").replace(/[^\d]/g, ""));

  // 説明文: ラクマは通常の textarea
  const descOk = trySet([
    '[data-testid="item-description-input"]',
    'textarea[name="description"]',
    'textarea[placeholder*="商品の説明"]',
    'textarea[placeholder*="特徴"]',
    "textarea"
  ], item.description || "");

  // ── 商品の状態（ラクマ）──
  let conditionOk = false;
  if (item.condition) {
    // ラクマの状態マッピング
    const COND_MAP = {
      "新品、未使用":      ["新品、未使用", "新品未使用"],
      "未使用に近い":      ["未使用に近い"],
      "目立った傷や汚れなし": ["目立った傷や汚れなし"],
      "やや傷や汚れあり":  ["やや傷や汚れあり"],
      "傷や汚れあり":      ["傷や汚れあり"],
      "全体的に状態が悪い": ["全体的に状態が悪い"]
    };
    const candidates = COND_MAP[item.condition] || [item.condition];

    // select要素を試す
    const sel = document.querySelector("select");
    if (sel) {
      for (const cand of candidates) {
        const opt = [...sel.options].find(o =>
          (o.text || o.value || "").includes(cand)
        );
        if (opt) {
          setNativeValue(sel, opt.value);
          conditionOk = true;
          break;
        }
      }
    }

    // ボタン・リスト形式の場合
    if (!conditionOk) {
      const allEls = [...document.querySelectorAll("button, div, span, li, label")]
        .filter(el => {
          const s = window.getComputedStyle(el);
          return s.display !== "none" && s.visibility !== "hidden";
        });
      for (const cand of candidates) {
        const el = allEls.find(e => (e.textContent || "").trim() === cand);
        if (el) { el.click(); conditionOk = true; break; }
      }
    }
  }

  // ── ブランド入力（ラクマはinput検索→候補クリック）──
  let brandOk = false;
  if (item.brand) {
    // まずinputに直接入力を試みる
    brandOk = trySet([
      'input[placeholder*="ブランドを入力"]',
      'input[placeholder*="ブランド名を入力"]',
      'input[placeholder*="ブランド"]',
      '[data-testid="brand-input"]'
    ], item.brand);

    if (brandOk) {
      // 入力後500ms待ってサジェストから1件目をクリック
      await new Promise(r => setTimeout(r, 600));
      const suggest = document.querySelector(
        '[class*="suggestion"] li:first-child, [class*="suggest"] li:first-child, ' +
        '[class*="dropdown"] li:first-child, [role="option"]:first-child, ' +
        '[class*="autocomplete"] div:first-child'
      );
      if (suggest) suggest.click();
    }
  }

  // ── カテゴリー対策（ラクマ）──
  // ラクマのカテゴリーはツリークリック選択のためinput入力はできない
  // 代わりに: カテゴリー選択ボタンを自動クリックし、検索欄があればキーワードを入力
  let categoryHint = "";
  if (item.category) {
    // カテゴリーの末尾（最も具体的なカテゴリー）を抽出
    const catParts = item.category.split(/[>\/＞]/);
    const lastCat  = catParts[catParts.length - 1]?.trim() || item.category;
    categoryHint   = lastCat;

    // カテゴリー選択ボタンをクリック
    const catBtn = [...document.querySelectorAll("button, div, span")]
      .find(el => {
        const t = (el.textContent || "").trim();
        return t === "カテゴリーを選択" || t === "カテゴリを選択" || t === "指定なし" || t === "カテゴリー";
      });
    if (catBtn) {
      catBtn.click();
      await new Promise(r => setTimeout(r, 500));
      // カテゴリー検索inputがあればキーワード入力
      const catSearch = document.querySelector(
        'input[placeholder*="カテゴリー"], input[placeholder*="カテゴリ"], input[placeholder*="検索"]'
      );
      if (catSearch) {
        catSearch.focus();
        catSearch.value = lastCat;
        catSearch.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  }

  // ページ上に情報パネルを表示
  const infoPanel = document.createElement("div");
  Object.assign(infoPanel.style, {
    position: "fixed", top: "8px", left: "50%",
    transform: "translateX(-50%)", zIndex: "9999999",
    background: "#1e40af", color: "#fff",
    padding: "10px 14px", borderRadius: "10px",
    fontSize: "12px", fontWeight: "600",
    boxShadow: "0 8px 20px rgba(0,0,0,.3)",
    maxWidth: "360px", width: "90%", lineHeight: "1.6"
  });

  const lines = [];
  if (item.brand)    lines.push(`🏷 ブランド: ${item.brand}`);
  if (categoryHint)  lines.push(`📂 カテゴリー参考: ${categoryHint}`);
  if (item.category) lines.push(`　全パス: ${item.category}`);
  if (lines.length)  infoPanel.textContent = lines.join("\n");

  if (lines.length) {
    document.body.appendChild(infoPanel);
    // 30秒表示（カテゴリー選択に十分な時間）
    setTimeout(() => infoPanel.remove(), 30000);
  }

  // ── 画像アップロード ──
  // メルカリの画像URLをfetchしてfile inputに流し込む
  let imageOk = false;
  const images = Array.isArray(item.images) ? item.images.filter(u =>
    u && u.includes("mercdn") && (u.includes("/photos/") || u.includes("photos.mercdn"))
  ).slice(0, 15) : [];

  if (images.length > 0) {
    const fileInput = document.querySelector('input[type="file"]');
    if (fileInput) {
      const dt = new DataTransfer();
      let loaded = 0;
      for (let i = 0; i < images.length; i++) {
        try {
          // background.js経由でBlob取得（CORS回避）
          const result = await new Promise(resolve => {
            chrome.runtime.sendMessage(
              { type: "BG_FETCH_BLOB", url: images[i] },
              resolve
            );
          });
          if (result?.ok && result.dataUrl) {
            const res   = await fetch(result.dataUrl);
            const blob  = await res.blob();
            const ext   = (result.mimeType || "image/jpeg").includes("png") ? "png" : "jpg";
            const file  = new File([blob], `img_${i + 1}.${ext}`, { type: result.mimeType || "image/jpeg" });
            if (file.size > 0 && file.size <= 10 * 1024 * 1024) {
              dt.items.add(file);
              loaded++;
            }
          }
        } catch (e) {
          console.warn("画像取得失敗:", e);
        }
      }
      if (dt.files.length > 0) {
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event("change", { bubbles: true }));
        await new Promise(r => setTimeout(r, 2000));
        imageOk = true;
      }
    }
  }

  return { titleOk, priceOk, descOk, brandOk, conditionOk, categoryHint, imageOk, imageCount: images.length };
}

// ═══════════════════════════════════════════════════════════════
//  タブ内実行関数: Yahooフリマ / ヤフオク貼り付け（非同期版）
//  ヤフオクの説明欄は「通常入力」ボタンを押すと textarea が現れる仕組み。
//  → ボタンを自動クリック → 500ms待機 → textarea に入力 の順で処理する。
// ═══════════════════════════════════════════════════════════════
async function yahooPasteAsync(item) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function setNativeValue(el, value) {
    const lastValue = el.value;
    const proto = el.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set
      || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
    if (setter) setter.call(el, value); else el.value = value;
    const tracker = el._valueTracker;
    if (tracker) tracker.setValue(lastValue);
    el.dispatchEvent(new Event("input",  { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur",   { bubbles: true }));
  }

  // ── 説明文のみ処理（タイトル・価格は呼び出し元で別途処理）──
  const descText = item.description || "";
  let descOk = false;
  let diagInfo = "";

  // 説明欄を特定
  const allTextareas   = [...document.querySelectorAll("textarea")];
  const allContentEdit = [...document.querySelectorAll('[contenteditable="true"]')];
  diagInfo = `textarea:${allTextareas.length}個 CE:${allContentEdit.length}個`;

  const taEl = allTextareas.find(e =>
    ["特徴","使用感","魅力","説明"].some(k => (e.placeholder || "").includes(k))
  ) || allTextareas[0];

  let ceEl = null, ceArea = 0;
  for (const el of allContentEdit) {
    const r = el.getBoundingClientRect();
    const a = r.width * r.height;
    if (a > ceArea) { ceArea = a; ceEl = el; }
  }

  const targetEl = taEl || ceEl;

  if (targetEl) {
    targetEl.scrollIntoView({ block: "center" });
    targetEl.focus();
    await sleep(200);

    // ── Step1: まずクリップボードに説明文を保存 ──
    try {
      await navigator.clipboard.writeText(descText);
    } catch(e) {}

    // ── Step2: 全選択→削除→貼り付け（ClipboardEvent） ──
    targetEl.select?.();
    document.execCommand("selectAll", false, null);
    document.execCommand("delete", false, null);
    await sleep(100);

    // カスタムClipboardEventでペースト
    try {
      const dt = new DataTransfer();
      dt.setData("text/plain", descText);
      const pasteEv = new ClipboardEvent("paste", {
        clipboardData: dt, bubbles: true, cancelable: true
      });
      targetEl.dispatchEvent(pasteEv);
      await sleep(300);
    } catch(e) {}

    // ── Step3: execCommand insertText ──
    if ((targetEl.value || targetEl.textContent || "").trim().length === 0) {
      document.execCommand("insertText", false, descText);
      await sleep(200);
    }

    // ── Step4: value直接セット（Reactのnative setter） ──
    if ((targetEl.value || targetEl.textContent || "").trim().length === 0 && targetEl.tagName === "TEXTAREA") {
      const ns = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      if (ns) ns.call(targetEl, descText);
      else targetEl.value = descText;
      const tracker = targetEl._valueTracker;
      if (tracker) tracker.setValue("");
      ["input","change","blur"].forEach(ev =>
        targetEl.dispatchEvent(new Event(ev, { bubbles: true })));
      await sleep(200);
    }

    const finalVal = (targetEl.value || targetEl.textContent || "").trim();
    if (finalVal.length > 0) {
      descOk = true;
      diagInfo += " →入力成功";
    } else {
      diagInfo += " →自動入力失敗（クリップボードにコピー済み）";
      descOk = true;
    }
  }

  // ── 画像アップロード（Yahoo / ヤフオク）──
  let imageOk    = false;
  let imageCount = 0;
  const images   = Array.isArray(item.images) ? item.images.filter(u =>
    u && u.includes("mercdn") && (u.includes("/photos/") || u.includes("photos.mercdn"))
  ).slice(0, 15) : [];

  if (images.length > 0) {
    const fileInput = document.querySelector('input[type="file"]');
    if (fileInput) {
      const dt = new DataTransfer();
      for (let i = 0; i < images.length; i++) {
        try {
          const result = await new Promise(resolve => {
            chrome.runtime.sendMessage(
              { type: "BG_FETCH_BLOB", url: images[i] },
              resolve
            );
          });
          if (result?.ok && result.dataUrl) {
            const res  = await fetch(result.dataUrl);
            const blob = await res.blob();
            const ext  = (result.mimeType || "image/jpeg").includes("png") ? "png" : "jpg";
            const file = new File([blob], `img_${i + 1}.${ext}`, { type: result.mimeType || "image/jpeg" });
            if (file.size > 0 && file.size <= 10 * 1024 * 1024) {
              dt.items.add(file);
              imageCount++;
            }
          }
        } catch (e) {
          console.warn("Yahoo画像取得失敗:", e);
        }
      }
      if (dt.files.length > 0) {
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event("change", { bubbles: true }));
        await sleep(3000);
        // 画像アップロード後にタイトルを入力（フォームリセット対策）
        const titleVal = item.title || "";
        if (titleVal) {
          const sels = ['#fleaTitleForm','input[name="Title"]','input[placeholder*="商品名、ブランド名、型番"]','input[placeholder*="商品名"]'];
          let titleEl = null;
          for (const s of sels) { titleEl = document.querySelector(s); if (titleEl) break; }
          if (titleEl) {
            titleEl.click();
            titleEl.focus();
            titleEl.select?.();
            await sleep(200);
            document.execCommand("selectAll", false, null);
            document.execCommand("delete",     false, null);
            await sleep(500);
            document.execCommand("insertText", false, titleVal);
            await sleep(300);
          }
        }
        imageOk = true;
      }
    }
  }

  // 診断情報（NGのときにステータスで原因特定に使う）
  const diagTextareas    = document.querySelectorAll("textarea").length;
  const diagEditable     = document.querySelectorAll('[contenteditable="true"]').length;
  const diagPlaceholders = [...document.querySelectorAll("textarea, [contenteditable='true']")]
    .map(el => el.placeholder || el.tagName + (el.className ? "."+el.className.split(" ")[0] : ""))
    .slice(0, 5).join(" | ");

  return { descOk, imageOk, imageCount, diagTextareas, diagEditable, diagPlaceholders, diagInfo };
}

// ═══════════════════════════════════════════════════════════════
//  初期化
// ═══════════════════════════════════════════════════════════════
function bindAutoProfitEvents() {
  ["price", "shipping", "feeRate", "cost"].forEach((id) => {
    $(id).addEventListener("input", updateProfitView);
  });
}

// ═══════════════════════════════════════════════════════════════
//  ボタンイベント
// ═══════════════════════════════════════════════════════════════

// ── 管理番号: 自動発番 ──────────────────────────────────────
$("btnGenerateId").addEventListener("click", async () => {
  const id = await generateManageId();
  $("manageId").value = id;
  const current = collectFormItem((await loadItem()) || {});
  await saveItem(current);
  setStatus(
    `✅ 管理番号を発番しました\n${id}\n\nこの番号でメルカリ・ラクマ・Yahooフリマの同一商品を\n一元管理できます。`
  );
});

// ── 管理番号: コピー ────────────────────────────────────────
$("btnCopyId").addEventListener("click", async () => {
  const value = $("manageId").value.trim();
  if (!value) { setStatus("コピーする管理番号がありません。"); return; }
  await navigator.clipboard.writeText(value);
  setStatus(`📋 管理番号をコピーしました\n${value}`);
});

// ── メルカリ取得 ────────────────────────────────────────────
$("btnGetMercari").addEventListener("click", async () => {
  try {
    // メルカリのタブを探す
    const tabs = await chrome.tabs.query({ currentWindow: true });
    let tab = tabs.find(t => t.active);
    const mercariTab = tabs.find(t =>
      t.url && (t.url.includes("jp.mercari.com/item/") || t.url.includes("mercari.com/item/"))
    );
    if (tab && !tab.url?.includes("mercari.com/item/") && mercariTab) {
      tab = mercariTab;
    }
    if (!tab) {
      setStatus("⚠ タブが見つかりません。\nメルカリの商品ページを開いてください。");
      return;
    }
    if (!tab.url?.includes("mercari.com")) {
      setStatus(`⚠ メルカリのページを開いてください。\n現在: ${tab.url?.slice(0, 60) || "不明"}`);
      return;
    }

    setStatus("⏳ メルカリから情報を取得中...");

    // files方式で実行
    await chrome.storage.local.set({ mercariScrapeResult: "", mercariData: null });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files:  ["mercari_scrape.js"]
    });

    // 結果を待つ（最大5秒）
    let item = null;
    for (let i = 0; i < 25; i++) {
      await new Promise(r => setTimeout(r, 200));
      const res = await chrome.storage.local.get(["mercariScrapeResult","mercariData"]);
      if (res.mercariScrapeResult || res.mercariData) {
        try { item = res.mercariData || JSON.parse(res.mercariScrapeResult || "{}"); } catch(e) {}
        break;
      }
    }

    if (!item || !item.title) {
      setStatus("⚠ 商品情報を取得できませんでした。\nメルカリの商品詳細ページ（/item/...）を開いているか確認してください。");
      return;
    }

    const current = (await loadItem()) || {};
    item.manageId = current.manageId || "";
    await saveItem(item);
    const meta = await loadMeta();
    fillForm(item, meta || {});
    setStatus(
      `✅ メルカリから取得しました\n` +
      `商品名: ${item.title}\n` +
      `価格: ${item.price}円\n` +
      `状態: ${item.condition || "未取得"}\n` +
      `カテゴリ: ${item.category || "未取得"}\n` +
      `ブランド: ${item.brand || "未取得"}\n` +
      `サイズ: ${item.size || "未取得"}\n` +
      `画像: ${item.images?.length || 0}枚`
    );
  } catch (error) {
    setStatus(`取得エラー: ${error.message || error}\n\nメルカリの商品ページを開いた状態で押してください。`);
  }
});

// ── 保存データ再読込 ────────────────────────────────────────
$("btnReload").addEventListener("click", async () => {
  const item     = await loadItem();
  const meta     = await loadMeta();
  const siteMeta = await loadSiteMeta();
  if (!item) { setStatus("保存データがありません。"); return; }
  fillForm(item, meta || {});
  fillSiteMetaForm(siteMeta);
  setStatus("保存データを再読込しました。");
});

// ── タイトル整形 ────────────────────────────────────────────
$("btnFormatTitle").addEventListener("click", async () => {
  const item    = (await loadItem()) || {};
  const updated = collectFormItem(item);
  const before  = updated.title;
  updated.title = formatTitleSmart(updated.title);
  $("title").value = updated.title;
  await saveItem(updated);

  const site    = $("marketplace").value;
  const siteStr = site !== "mercari"
    ? `\n\n【${site}用に自動調整したタイトル】\n${formatTitleForSite(updated.title, site)}`
    : "";

  setStatus(`✅ タイトルを整形しました\n整形前: ${before}\n整形後: ${updated.title}${siteStr}`);
});

// ── 説明文整形 ──────────────────────────────────────────────
$("btnFormatDesc").addEventListener("click", async () => {
  const item    = (await loadItem()) || {};
  const updated = collectFormItem(item);
  const meta    = collectMeta();

  let desc = formatDescriptionSmart(
    updated.description, updated.condition, meta.shipping, meta.inventoryMemo
  );

  const site = meta.marketplace;
  if (site !== "mercari") {
    desc = formatDescriptionForSite(desc, site);
  }

  updated.description    = desc;
  $("description").value = desc;
  await saveItem(updated);
  await saveMeta(meta);
  setStatus("✅ 説明文を整形しました。\n状態・発送・注意点セクションを自動で整理しました。");
});

// ── 出品チェック ポップアップ ───────────────────────────────
function showCheckPopup(warnings, allOk = false) {
  const old = document.getElementById("check-popup-overlay");
  if (old) old.remove();

  const overlay = document.createElement("div");
  overlay.id = "check-popup-overlay";
  Object.assign(overlay.style, {
    position: "fixed", inset: "0", zIndex: "99999",
    background: "rgba(0,0,0,0.5)", display: "flex",
    alignItems: "center", justifyContent: "center", padding: "16px"
  });

  const box = document.createElement("div");
  Object.assign(box.style, {
    background: "#fff", borderRadius: "14px", padding: "16px",
    maxWidth: "400px", width: "100%",
    boxShadow: "0 16px 48px rgba(0,0,0,0.25)",
    border: `3px solid ${allOk ? "#0f766e" : "#f59e0b"}`
  });

  const title = document.createElement("div");
  title.textContent = allOk ? "✅ 出品チェック完了" : `⚠ 出品チェック（${warnings.length}件）`;
  Object.assign(title.style, {
    fontWeight: "700", fontSize: "15px", marginBottom: "10px",
    color: allOk ? "#0f766e" : "#b45309"
  });

  const body = document.createElement("div");

  if (allOk) {
    body.innerHTML = `<div style="font-size:13px;color:#065f46;padding:8px;background:#d1fae5;border-radius:8px;">問題は見つかりませんでした！出品の準備ができています。</div>`;
  } else {
    const errors   = warnings.filter(w => w.startsWith("⚠"));
    const infos    = warnings.filter(w => w.startsWith("ℹ"));

    if (errors.length) {
      const errDiv = document.createElement("div");
      errDiv.style.marginBottom = "8px";
      errDiv.innerHTML = `<div style="font-size:11px;font-weight:700;color:#dc2626;margin-bottom:4px;">要修正</div>` +
        errors.map(w => `<div style="font-size:12px;padding:5px 8px;background:#fee2e2;border-radius:6px;margin-bottom:4px;">${w}</div>`).join("");
      body.appendChild(errDiv);
    }

    if (infos.length) {
      const infoDiv = document.createElement("div");
      infoDiv.innerHTML = `<div style="font-size:11px;font-weight:700;color:#b45309;margin-bottom:4px;">推奨</div>` +
        infos.map(w => `<div style="font-size:12px;padding:5px 8px;background:#fef3c7;border-radius:6px;margin-bottom:4px;">${w}</div>`).join("");
      body.appendChild(infoDiv);
    }
  }

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "閉じる";
  Object.assign(closeBtn.style, {
    marginTop: "12px", width: "100%", padding: "9px",
    background: allOk ? "#0f766e" : "#b45309",
    color: "#fff", border: "none", borderRadius: "8px",
    fontSize: "13px", fontWeight: "700", cursor: "pointer"
  });
  closeBtn.addEventListener("click", () => overlay.remove());

  box.appendChild(title);
  box.appendChild(body);
  box.appendChild(closeBtn);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  setTimeout(() => overlay?.remove(), 12000);
}

// ── 売れ残りチェック ポップアップ ─────────────────────────
function showStalePopup(message) {
  const old = document.getElementById("stale-popup-overlay");
  if (old) old.remove();

  const isUrgent = message.includes("長期在庫") || message.includes("再出品");
  const color    = isUrgent ? "#dc2626" : message.includes("値下げ") ? "#b45309" : "#0f766e";

  const overlay = document.createElement("div");
  overlay.id = "stale-popup-overlay";
  Object.assign(overlay.style, {
    position: "fixed", inset: "0", zIndex: "99999",
    background: "rgba(0,0,0,0.5)", display: "flex",
    alignItems: "center", justifyContent: "center", padding: "16px"
  });

  const box = document.createElement("div");
  Object.assign(box.style, {
    background: "#fff", borderRadius: "14px", padding: "16px",
    maxWidth: "380px", width: "100%",
    boxShadow: "0 16px 48px rgba(0,0,0,0.25)",
    border: `3px solid ${color}`, textAlign: "center"
  });

  const icon = document.createElement("div");
  icon.textContent = isUrgent ? "🚨" : "📅";
  icon.style.fontSize = "32px";

  const body = document.createElement("div");
  body.textContent = message;
  Object.assign(body.style, {
    fontSize: "13px", lineHeight: "1.7", margin: "10px 0",
    whiteSpace: "pre-wrap", color: "#1a2332"
  });

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "閉じる";
  Object.assign(closeBtn.style, {
    width: "100%", padding: "9px", background: color,
    color: "#fff", border: "none", borderRadius: "8px",
    fontSize: "13px", fontWeight: "700", cursor: "pointer"
  });
  closeBtn.addEventListener("click", () => overlay.remove());

  box.appendChild(icon);
  box.appendChild(body);
  box.appendChild(closeBtn);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  setTimeout(() => overlay?.remove(), 10000);
}

// ── 出品チェック ────────────────────────────────────────────
$("btnCheck").addEventListener("click", async () => {
  const item     = collectFormItem((await loadItem()) || {});
  await saveItem(item);
  const warnings = checkListing(item);

  if (warnings.length) {
    const msg = `出品チェック結果\n\n${warnings.join("\n")}`;
    setStatus(msg);
    showCheckPopup(warnings);
  } else {
    setStatus("✅ 出品チェック完了\n問題は見つかりませんでした！\n出品の準備ができています。");
    showCheckPopup([], true);
  }
});

// ── 売れ残りチェック ────────────────────────────────────────
$("btnStale").addEventListener("click", async () => {
  const meta = collectMeta();
  await saveMeta(meta);
  const msg = checkStale(meta.listedDate);
  setStatus(msg);
  showStalePopup(msg);
});

// ── 利益計算 ────────────────────────────────────────────────
$("btnProfit").addEventListener("click", async () => {
  const item = collectFormItem((await loadItem()) || {});
  const meta = collectMeta();
  await saveItem(item);
  await saveMeta(meta);
  updateProfitView();
  const r     = calculateProfit(item.price, meta.shipping, meta.feeRate, meta.cost);
  const label = r.profit > 0 ? "黒字" : "赤字";
  const suggestions = suggestDiscount(item.price, meta.shipping, meta.feeRate, meta.cost);
  setStatus(
    `💰 利益計算結果\n販売価格: ${formatYen(r.price)}\n手数料(${meta.feeRate}%): ${formatYen(r.fee)}\n送料: ${formatYen(r.shipping)}\n仕入れ値: ${formatYen(r.cost)}\n──────────\n予想利益: ${formatYen(r.profit)}（${label}）\n利益率: ${r.margin.toFixed(1)}%\n\n📉 値下げ提案\n${suggestions.join("\n")}`
  );
});

// ── サイト別管理保存 ────────────────────────────────────────
$("btnSaveSiteMeta").addEventListener("click", async () => {
  const siteMeta = collectSiteMeta();
  const item     = (await loadItem()) || {};
  const manageId = item.manageId || $("manageId").value.trim();
  if (manageId) siteMeta.manageId = manageId;
  await saveSiteMeta(siteMeta);

  const lines = [
    siteMeta.mercariUrl  && `メルカリ: ${siteMeta.mercariUrl}`,
    siteMeta.rakumaUrl   && `ラクマ: ${siteMeta.rakumaUrl}`,
    siteMeta.yahooUrl    && `Yahooフリマ: ${siteMeta.yahooUrl}`
  ].filter(Boolean);

  setStatus(
    `✅ サイト別管理情報を保存しました${manageId ? `\n管理番号: ${manageId}` : ""}\n${lines.join("\n") || "URLなし"}`
  );
});

// ── 売れた時ポップアップ表示 ────────────────────────────────
function showSoldPopup(message, type = "success") {
  const old = document.getElementById("sold-popup-overlay");
  if (old) old.remove();

  const colors = {
    success:    { bg: "#0f766e", border: "#0d9488" },
    warn:       { bg: "#b45309", border: "#d97706" },
    processing: { bg: "#1d4ed8", border: "#2563eb" }
  };
  const c = colors[type] || colors.success;

  const overlay = document.createElement("div");
  overlay.id = "sold-popup-overlay";
  Object.assign(overlay.style, {
    position: "fixed", inset: "0", zIndex: "99999",
    background: "rgba(0,0,0,0.55)", display: "flex",
    alignItems: "center", justifyContent: "center", padding: "16px"
  });

  const box = document.createElement("div");
  Object.assign(box.style, {
    background: "#fff", borderRadius: "16px", padding: "20px",
    maxWidth: "400px", width: "100%",
    boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
    border: `3px solid ${c.border}`
  });

  const header = document.createElement("div");
  Object.assign(header.style, {
    background: c.bg, color: "#fff", borderRadius: "10px",
    padding: "10px 14px", fontSize: "14px", fontWeight: "700",
    marginBottom: "12px", lineHeight: "1.5", whiteSpace: "pre-wrap"
  });
  const lines = message.split("\n");
  header.textContent = lines[0];

  const body = document.createElement("div");
  Object.assign(body.style, {
    fontSize: "13px", lineHeight: "1.7", color: "#1f2937",
    whiteSpace: "pre-wrap", marginBottom: "14px"
  });
  body.textContent = lines.slice(1).join("\n").trim();

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "閉じる";
  Object.assign(closeBtn.style, {
    width: "100%", padding: "10px", border: "none",
    borderRadius: "10px", background: c.bg, color: "#fff",
    fontSize: "14px", fontWeight: "700", cursor: "pointer"
  });
  closeBtn.addEventListener("click", () => overlay.remove());

  box.appendChild(header);
  if (body.textContent) box.appendChild(body);
  box.appendChild(closeBtn);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  if (type !== "processing") {
    setTimeout(() => overlay?.remove(), 10000);
  }
}

// ── 売れたアラート + 他サイト自動削除 ──────────────────────
async function deleteListing(itemTitle) {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const url = location.href;

  window.confirm = () => true;

  if (/jp\.mercari\.com|mercari\.com/.test(url)) {
    if (url.includes("/sell/edit/")) {
      await sleep(2000);
      const delBtn =
        document.querySelector('[data-testid="delete-button"]') ||
        [...document.querySelectorAll("button, a")].find(el =>
          (el.textContent || "").includes("この商品を削除する")
        );
      if (delBtn) {
        delBtn.scrollIntoView({ behavior: "smooth", block: "center" });
        delBtn.style.outline = "4px solid red";
        delBtn.style.boxShadow = "0 0 10px red";
        return "need_manual";
      }
    }
    const itemId = url.match(/\/item\/(m[\w]+)/)?.[1];
    if (itemId) {
      location.href = `https://jp.mercari.com/sell/edit/${itemId}`;
      return "navigating";
    }
    return "not_found";
  }

  if (/fril\.jp/.test(url)) {
    await sleep(1500);
    let targetDelBtn = null;

    if (itemTitle) {
      const searchText = itemTitle.slice(0, 8);
      const rows = document.querySelectorAll(".media, [class*='deal-item'], [class*='item-box'], li");
      for (const row of rows) {
        if ((row.textContent || "").includes(searchText)) {
          const btn = [...row.querySelectorAll("button")]
            .find(el => (el.textContent || "").trim() === "削除");
          if (btn) { targetDelBtn = btn; break; }
        }
      }

      if (!targetDelBtn) {
        const allEls = document.querySelectorAll("h4, h3, .media-heading, [class*='heading'], [class*='title']");
        for (const el of allEls) {
          if ((el.textContent || "").includes(searchText)) {
            const container = el.closest("li, .media, [class*='item'], tr") || el.parentElement?.parentElement;
            if (container) {
              const btn = [...container.querySelectorAll("button")]
                .find(b => (b.textContent || "").trim() === "削除");
              if (btn) { targetDelBtn = btn; break; }
            }
          }
        }
      }
    }

    if (!targetDelBtn) {
      targetDelBtn = [...document.querySelectorAll("button")]
        .find(el => (el.textContent || "").trim() === "削除");
    }

    if (targetDelBtn) {
      targetDelBtn.scrollIntoView({ behavior: "smooth", block: "center" });
      await sleep(300);
      targetDelBtn.click();
      await sleep(800);
      return "deleted";
    }
    return "not_found";
  }

  if (/auctions\.yahoo\.co\.jp/.test(url)) {
    const aID = url.match(/[?&]aID=([\w]+)/)?.[1]
      || url.match(/\/auction\/([\w]+)/)?.[1];

    if (url.includes("/show/amgr")) {
      await sleep(1000);
      const cancelLink = [...document.querySelectorAll("a")]
        .find(el => (el.textContent || "").includes("オークションの取り消し"));
      if (cancelLink) { cancelLink.click(); return "navigating"; }
      return "not_found";
    }

    if (aID) {
      location.href = `https://auctions.yahoo.co.jp/jp/show/amgr?aID=${aID}`;
      return "navigating";
    }
    return "not_found";
  }

  return "unsupported";
}

async function showSoldAlert(soldSite) {
  const siteMeta = await loadSiteMeta();
  const item     = (await loadItem()) || {};
  const title    = item.title || "この商品";
  const manageId = item.manageId || "";
  const siteNames = { mercari: "メルカリ", rakuma: "ラクマ", yahoo: "Yahooフリマ/ヤフオク" };
  const soldName  = siteNames[soldSite] || soldSite;

  const others = [];
  if (soldSite !== "mercari" && siteMeta?.mercariUrl) others.push({ name: "メルカリ", url: siteMeta.mercariUrl });
  if (soldSite !== "rakuma"  && siteMeta?.rakumaUrl) {
    others.push({ name: "ラクマ", url: "https://fril.jp/sell" });
  }
  if (soldSite !== "yahoo"   && siteMeta?.yahooUrl)   others.push({ name: "Yahoo",    url: siteMeta.yahooUrl });

  await saveSoldCheck({});
  await renderSoldChecklist();

  showSoldPopup(`🎉 ${soldName}で売れました！\n\n⏳ 他サイトの出品を処理中...`, "processing");
  setStatus(`🎉 ${soldName}で売れました！\n商品名: ${title}${manageId ? `\n管理番号: ${manageId}` : ""}\n\n⏳ 他サイトの出品を自動で削除中...`);

  if (!others.length) {
    const msg = `🎉 ${soldName}で売れました！\n商品名: ${title}\n\n他サイトのURLが未登録です。\n手動で確認してください。`;
    setStatus(msg);
    showSoldPopup(msg, "warn");
    return;
  }

  const results = [];

  for (const other of others) {
    try {
      const tab = await chrome.tabs.create({ url: other.url, active: false });

      await new Promise(resolve => {
        let waited = 0;
        const t = setInterval(() => {
          waited += 400;
          chrome.tabs.get(tab.id, tt => {
            if (chrome.runtime.lastError || tt?.status === "complete" || waited >= 10000) {
              clearInterval(t); resolve();
            }
          });
        }, 400);
      });
      await new Promise(r => setTimeout(r, 800));

      const res = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: deleteListing,
        args: [title]
      });
      const result = res?.[0]?.result || "unknown";

      if (result === "deleted")            results.push(`✅ ${other.name}: 自動削除しました`);
      else if (result === "navigating")    results.push(`⚠ ${other.name}: 削除ページを開きました\n   → タブで削除ボタンを押してください`);
      else if (result === "need_manual")   results.push(`⚠ ${other.name}: 削除ボタンを赤枠表示しました\n   → タブの赤枠ボタンをクリックしてください`);
      else if (result === "not_found")     results.push(`⚠ ${other.name}: 削除ページを開きました\n   → タブで手動で削除してください`);
      else if (result === "not_item_page") results.push(`⚠ ${other.name}: 商品ページではありません\n   → 手動で削除してください`);
      else                                 results.push(`⚠ ${other.name}: 削除ページを開きました\n   → タブで手動で削除してください`);
    } catch (e) {
      results.push(`❌ ${other.name}: エラー → 手動で削除してください`);
    }
  }

  const allOk    = results.every(r => r.startsWith("✅"));
  const finalMsg = `🎉 ${soldName}で売れました！\n商品名: ${title}${manageId ? `\n管理番号: ${manageId}` : ""}\n\n${results.join("\n")}\n\n↓ 売れた時チェックリストを確認してください`;

  setStatus(finalMsg);
  showSoldPopup(finalMsg, allOk ? "success" : "warn");
}

$("btnSoldMercari").addEventListener("click", () => showSoldAlert("mercari"));
$("btnSoldRakuma").addEventListener("click",  () => showSoldAlert("rakuma"));
$("btnSoldYahoo").addEventListener("click",   () => showSoldAlert("yahoo"));

// ── URL自動取得 ──────────────────────────────────────────────
async function autoFillUrl(fieldId) {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const url  = tabs?.[0]?.url || "";
    if (!url || url.startsWith("chrome://") || url.startsWith("chrome-extension://")) {
      setStatus("⚠ 商品ページを開いた状態で「現在のURL」を押してください。");
      return;
    }
    $(fieldId).value = url;
    const siteMeta = collectSiteMeta();
    const item     = (await loadItem()) || {};
    if (item.manageId) siteMeta.manageId = item.manageId;
    await saveSiteMeta(siteMeta);
    window.scrollTo(0, 0);
    setStatus(`✅ URLを取得して保存しました\n${url}`);
  } catch (e) {
    setStatus(`URL取得エラー: ${e.message}`);
  }
}

$("btnGetMercariUrl").addEventListener("click", () => autoFillUrl("mercariUrl"));
$("btnGetRakumaUrl").addEventListener("click",  () => autoFillUrl("rakumaUrl"));
$("btnGetYahooUrl").addEventListener("click",   () => autoFillUrl("yahooUrl"));
$("commentTemplate").addEventListener("change", (e) => {
  $("commentText").value = getCommentTemplate(e.target.value);
});

$("btnCopyComment").addEventListener("click", async () => {
  const text = $("commentText").value.trim();
  if (!text) { setStatus("コピーするコメントがありません。"); return; }
  await navigator.clipboard.writeText(text);
  setStatus("📋 コメント文をコピーしました。");
});

// ── ラクマ貼り付け ──────────────────────────────────────────
$("btnRakuma").addEventListener("click", async () => {
  try {
    const item   = collectFormItem((await loadItem()) || {});
    const stored = (await loadItem()) || {};
    const meta   = collectMeta();
    const rakumaItem = {
      ...item,
      brand:    stored.brand    || "",
      category: stored.category || item.category || "",
      images:   stored.images   || [],
      title: formatTitleForSite(item.title, "rakuma"),
      description: formatDescriptionForSite(
        formatDescriptionSmart(item.description, item.condition, meta.shipping, meta.inventoryMemo),
        "rakuma"
      )
    };
    await saveItem(item);

    setStatus("⏳ ラクマに貼り付け中...");

    const tab = await getActiveTab();

    await chrome.storage.local.set({
      rakumaFillData:   JSON.stringify(rakumaItem),
      rakumaFillResult: ""
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files:  ["rakuma_fill.js"]
    });

    let result = {};
    for (let i = 0; i < 25; i++) {
      await new Promise(r => setTimeout(r, 200));
      const res = await chrome.storage.local.get(["rakumaFillResult"]);
      if (res.rakumaFillResult) {
        try { result = JSON.parse(res.rakumaFillResult); } catch(e) {}
        break;
      }
    }

    const ngItems = [];
    if (!result.titleOk) ngItems.push("商品名（ラクマの出品フォームを開いているか確認してください）");
    if (!result.priceOk) ngItems.push("価格（¥300〜¥9,999,999の入力欄）");
    if (!result.descOk)  ngItems.push("説明文");

    const condLine  = rakumaItem.condition
      ? (result.conditionOk ? "\n状態: ✅ OK" : "\n状態: ⚠ 手動で選択してください") : "";
    const brandLine = result.brandOk ? "\nブランド: ✅ OK" : (rakumaItem.brand ? "\nブランド: ⚠ 手動入力してください" : "");
    const catLine   = rakumaItem.category ? "\nカテゴリー: 30秒ヒント表示中（手動で選択してください）" : "";

    const images = rakumaItem.images || [];
    let imgLine = "";
    if (images.length > 0) {
      imgLine = result.imageOk
        ? `\n画像: ✅ ${images.length}枚をアップロードしました`
        : `\n画像: ⚠ 自動アップロード失敗（手動でアップロードしてください）`;
    }

    setStatus(
      `ラクマ貼り付け結果\n管理番号: ${item.manageId || "未設定"}\n商品名(40字): ${result.titleOk ? "✅ OK" : "❌ NG"}\n価格: ${result.priceOk ? "✅ OK" : "❌ NG"}\n説明文: ${result.descOk ? "✅ OK" : "❌ NG"}${condLine}${brandLine}${catLine}${imgLine}`
      + (ngItems.length ? `\n\n⚠ 要確認:\n${ngItems.map(s => "・" + s).join("\n")}` : "\n\nタイトルをラクマ用（40字以内）に自動調整しました。")
    );
  } catch (error) {
    setStatus(`ラクマ貼り付けエラー: ${error}`);
  }
});

// ── Yahooフリマ / ヤフオク貼り付け ─────────────────────────
$("btnYahoo").addEventListener("click", async () => {
  try {
    const item   = collectFormItem((await loadItem()) || {});
    const stored = (await loadItem()) || {};
    const meta   = collectMeta();
    const yahooItem = {
      ...item,
      images:   stored.images   || [],
      brand:    stored.brand    || "",
      category: stored.category || item.category || "",
      title: item.title || "",
      description: formatDescriptionForSite(
        formatDescriptionSmart(item.description, item.condition, meta.shipping, meta.inventoryMemo),
        "yahoo"
      )
    };
    await saveItem(item);

    const tab = await getActiveTab();

    await chrome.storage.local.set({ yahooFillDesc: yahooItem.description, yahooFillDescResult: "" });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ["yahoo_desc_fill.js"]
    });

    let descOk = false;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 200));
      const res = await chrome.storage.local.get(["yahooFillDescResult"]);
      if (res.yahooFillDescResult === "ok")  { descOk = true;  break; }
      if (res.yahooFillDescResult === "ng")  { descOk = false; break; }
    }

    await chrome.storage.local.set({ yahooFillPrice: (yahooItem.price || "").replace(/[^\d]/g, ""), yahooFillPriceResult: "" });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["yahoo_price_fill.js"]
    });
    let priceOk = false;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 200));
      const res = await chrome.storage.local.get(["yahooFillPriceResult"]);
      if (res.yahooFillPriceResult === "ok") { priceOk = true; break; }
      if (res.yahooFillPriceResult === "ng") { break; }
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (it) => {
        function setNV(el, value) {
          const lastValue = el.value;
          const proto = el.tagName === "TEXTAREA"
            ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set
            || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
          if (setter) setter.call(el, value); else el.value = value;
          const t = el._valueTracker; if (t) t.setValue(lastValue);
          ["input","change","blur"].forEach(ev =>
            el.dispatchEvent(new Event(ev, { bubbles: true })));
        }
        function trySet(sels, val) {
          for (const s of sels) {
            const el = document.querySelector(s);
            if (el) { el.scrollIntoView({block:"center"}); el.focus(); setNV(el, val); return true; }
          }
          return false;
        }

        const titleOk = trySet([
          '#fleaTitleForm',
          'input[name="Title"]',
          'input[name="title"]',
          'input[name="subject"]',
          'input[name="auctionTitle"]',
          'input[placeholder*="商品名、ブランド名、型番"]',
          'input[placeholder*="商品名、ブランド名"]',
          'input[placeholder*="商品、ブランド"]',
          'input[placeholder*="ブランド名、色"]',
          'input[placeholder*="タイトル"]',
          'input[placeholder*="商品名"]'
        ], it.title || "");

        const priceOk = trySet([
          'input[name="price"]','input[name="StartPrice"]','input[name="BidOrBuyPrice"]',
          'input[placeholder*="¥300"]','input[placeholder*="価格"]',
          'input[inputmode="numeric"]','input[type="number"]'
        ], (it.price || "").replace(/[^\d]/g, ""));

        if (it.condition) {
          const COND_MAP = {
            "新品、未使用": ["未使用", "新品", "新品・未使用"],
            "未使用に近い": ["未使用に近い", "ほぼ未使用"],
            "目立った傷や汚れなし": ["目立った傷や汚れなし", "良好"],
            "やや傷や汚れあり": ["やや傷や汚れあり", "傷・汚れあり"],
            "傷や汚れあり": ["傷や汚れあり", "傷・汚れあり"],
            "全体的に状態が悪い": ["状態が悪い", "ジャンク"]
          };
          const candidates = COND_MAP[it.condition] || [it.condition];
          const sel = document.querySelector("select");
          if (sel) {
            for (const cand of candidates) {
              const opt = [...sel.options].find(o =>
                (o.text || o.value || "").includes(cand)
              );
              if (opt) {
                sel.value = opt.value;
                sel.dispatchEvent(new Event("change", { bubbles: true }));
                break;
              }
            }
          }
        }

        (function() {
          var pd = { category: it.category||"", brand: it.brand||"", title: it.title||"", savedAt: Date.now() };
          chrome.storage.local.set({ furimaHelperData: pd });
          var old2 = document.getElementById("furima-helper-panel");
          if (old2) old2.remove();
          var panel = document.createElement("div");
          panel.id = "furima-helper-panel";
          Object.assign(panel.style, { position:"fixed", bottom:"16px", right:"16px", zIndex:"9999999", width:"320px", background:"#1e293b", color:"#f1f5f9", borderRadius:"14px", padding:"14px", boxShadow:"0 12px 32px rgba(0,0,0,.5)", fontFamily:"-apple-system,sans-serif", fontSize:"12px", lineHeight:"1.5" });
          function makeRow(label, value, color) {
            if (!value) return;
            var row = document.createElement("div"); row.style.marginBottom = "8px";
            var lbl = document.createElement("div"); lbl.textContent = label; lbl.style.cssText = "font-size:10px;color:#94a3b8;margin-bottom:3px"; row.appendChild(lbl);
            var btn = document.createElement("button"); btn.textContent = value;
            Object.assign(btn.style, { width:"100%", textAlign:"left", padding:"7px 10px", background:color||"#334155", color:"#f1f5f9", border:"none", borderRadius:"8px", cursor:"pointer", fontSize:"12px", fontWeight:"700", wordBreak:"break-all", lineHeight:"1.4" });
            (function(v,b,c){ b.addEventListener("click", function(){ navigator.clipboard.writeText(v).then(function(){ var o=b.textContent; b.textContent="コピーしました"; b.style.background="#059669"; setTimeout(function(){ b.textContent=o; b.style.background=c||"#334155"; },1500); }); }); })(value,btn,color);
            row.appendChild(btn); panel.appendChild(row);
          }
          var ttl = document.createElement("div"); ttl.textContent = "コピペ支援パネル（クリックでコピー）";
          Object.assign(ttl.style, { fontSize:"11px", fontWeight:"700", color:"#f97316", marginBottom:"10px", borderBottom:"1px solid #334155", paddingBottom:"8px" });
          panel.appendChild(ttl);
          if (it.category) { var cp=it.category.split(">").map(function(s){return s.trim();}).filter(Boolean); makeRow("カテゴリー末尾（カテゴリー検索に貼り付け）", cp[cp.length-1]||it.category, "#7c3aed"); if(cp.length>1) makeRow("カテゴリー全体（参考）", it.category, "#475569"); }
          if (it.brand) makeRow("メーカー・ブランド欄に貼り付け", it.brand, "#0369a1");
          if (it.title) makeRow("製品検索キーワード（製品検索に貼り付け）", it.title, "#065f46");
          var cb = document.createElement("button"); cb.textContent = "閉じる";
          Object.assign(cb.style, { width:"100%", marginTop:"8px", padding:"7px", background:"#475569", color:"#f1f5f9", border:"none", borderRadius:"8px", cursor:"pointer", fontSize:"11px" });
          cb.addEventListener("click", function(){ panel.remove(); chrome.storage.local.remove("furimaHelperData"); });
          panel.appendChild(cb); document.body.appendChild(panel);
        })();
      },
      args: [yahooItem]
    });

    let imgOk = false, imgCount = 0;
    if (yahooItem.images?.length) {
      const imgRes = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: yahooPasteAsync,
        args: [{ ...yahooItem, description: "", images: yahooItem.images.slice(0, 10) }]
      });
      imgOk    = imgRes?.[0]?.result?.imageOk    || false;
      imgCount = imgRes?.[0]?.result?.imageCount || 0;
    }

    await new Promise(r => setTimeout(r, 3000));
    let titleOk = false;
    try {
      const bgRes = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: "BG_INJECT_YAHOO_TITLE",
          tabId: tab.id,
          titleVal: yahooItem.title || ""
        }, resolve);
      });
      titleOk = bgRes?.result === "ok";
    } catch(e) {
      console.warn("Yahoo商品名入力エラー:", e);
    }

    const catLine = yahooItem.category ? `\nカテゴリー: 30秒ヒント表示中` : "";

    setStatus(
      `Yahoo貼り付け結果\n管理番号: ${item.manageId || "未設定"}\n説明文: ${descOk ? "✅ OK" : "❌ NG"}${catLine}` +
      `\n商品名: ${titleOk ? "✅ OK" : "❌ NG"}\n価格: ${priceOk ? "✅ OK" : "❌ NG"}`
    );
  } catch (error) {
    setStatus(`Yahoo貼り付けエラー: ${error}`);
  }
});

// ═══════════════════════════════════════════════════════════════
//  送料計算
// ═══════════════════════════════════════════════════════════════
const SHIPPING_TABLE = [
  { name: "らくらく ネコポス",       size: "A4・厚3cm以内・1kg以内",      price: 210 },
  { name: "らくらく 宅急便コンパクト", size: "専用BOX使用",                price: 450 },
  { name: "らくらく 宅急便 60",      size: "3辺60cm以内・2kg以内",         price: 750 },
  { name: "らくらく 宅急便 80",      size: "3辺80cm以内・5kg以内",         price: 870 },
  { name: "らくらく 宅急便 100",     size: "3辺100cm以内・10kg以内",       price: 1050 },
  { name: "らくらく 宅急便 120",     size: "3辺120cm以内・15kg以内",       price: 1200 },
  { name: "らくらく 宅急便 140",     size: "3辺140cm以内・20kg以内",       price: 1450 },
  { name: "らくらく 宅急便 160",     size: "3辺160cm以内・25kg以内",       price: 1700 },
  { name: "ゆうゆう ゆうパケット",   size: "A4・厚3cm以内・1kg以内",       price: 230 },
  { name: "ゆうゆう ゆうパケットポスト", size: "専用箱/シール使用",         price: 215 },
  { name: "ゆうゆう ゆうパック 60",  size: "3辺60cm以内・25kg以内",        price: 770 },
  { name: "ゆうゆう ゆうパック 80",  size: "3辺80cm以内・25kg以内",        price: 870 },
  { name: "ゆうゆう ゆうパック 100", size: "3辺100cm以内・25kg以内",       price: 1070 },
  { name: "ゆうゆう ゆうパック 120", size: "3辺120cm以内・25kg以内",       price: 1230 },
  { name: "ラクマパック ゆうパケット", size: "A4・厚3cm以内・1kg以内",     price: 200 },
  { name: "ラクマパック ゆうパック 60", size: "3辺60cm以内・25kg以内",     price: 700 },
  { name: "ラクマパック ゆうパック 80", size: "3辺80cm以内・25kg以内",     price: 800 },
  { name: "ラクマパック ゆうパック 100", size: "3辺100cm以内・25kg以内",   price: 1000 },
  { name: "ラクマパック ネコポス",    size: "A4・厚2.5cm以内・1kg以内",    price: 200 },
  { name: "ラクマパック 宅急便コンパクト", size: "専用BOX使用",            price: 430 },
  { name: "ラクマパック 宅急便 60",   size: "3辺60cm以内・2kg以内",        price: 700 },
  { name: "ラクマパック 宅急便 80",   size: "3辺80cm以内・5kg以内",        price: 800 },
  { name: "ラクマパック 宅急便 100",  size: "3辺100cm以内・10kg以内",      price: 1000 },
];

function calcShippingBySize(cm3side, weightKg) {
  const cm = toNumber(cm3side);
  const kg = toNumber(weightKg);
  const results = [];
  if (cm <= 0) return results;

  for (const row of SHIPPING_TABLE) {
    if (row.name.includes("ネコポス") || row.name.includes("ゆうパケット")) {
      if (cm <= 60 && kg <= 1) results.push(row);
      continue;
    }
    if (row.name.includes("コンパクト")) {
      if (cm <= 60) results.push(row);
      continue;
    }
    const m = row.name.match(/(\d+)$/);
    if (m) {
      const limit = Number(m[1]);
      if (cm <= limit) results.push(row);
    }
  }

  results.sort((a, b) => a.price - b.price);
  return results.slice(0, 5);
}

$("btnCalcShipping").addEventListener("click", () => {
  const cm = $("shippingSize").value.trim();
  const kg = $("shippingWeight").value.trim() || "0";
  if (!cm) { setStatus("3辺合計(cm)を入力してください。"); return; }

  const results = calcShippingBySize(cm, kg);
  const area    = $("shippingResultArea");

  if (!results.length) {
    area.innerHTML = `<div style="padding:8px;font-size:12px;color:#b45309;">⚠ ${cm}cm に対応する配送サービスが見つかりませんでした。</div>`;
    setStatus(`⚠ ${cm}cm の配送サービスが見つかりませんでした。`);
    return;
  }

  const rows = results.map(r => `
    <div class="shipping-row">
      <div>
        <div class="shipping-name">${r.name}</div>
        <div class="shipping-size">${r.size}</div>
      </div>
      <div class="shipping-price">¥${r.price.toLocaleString()}</div>
    </div>`).join("");

  area.innerHTML = `<div class="shipping-result" style="margin-top:8px;">${rows}</div>`;

  const cheapest = results[0];
  setStatus(`📮 ${cm}cm の送料目安\n最安: ${cheapest.name} ¥${cheapest.price}\n（下に一覧表示）`);
});

// ═══════════════════════════════════════════════════════════════
//  出品リンク
// ═══════════════════════════════════════════════════════════════
const LISTING_URLS = {
  mercari: "https://jp.mercari.com/sell/create",
  rakuma:  "https://fril.jp/c/sell",
  yahoo:   "https://auctions.yahoo.co.jp/sell/jp/show/beforms",
  paypay:  "https://paypayfleamarket.yahoo.co.jp/sell"
};

$("btnOpenMercariListing").addEventListener("click", () => {
  chrome.tabs.create({ url: LISTING_URLS.mercari });
});
$("btnOpenRakumaListing").addEventListener("click", () => {
  chrome.tabs.create({ url: LISTING_URLS.rakuma });
});
$("btnOpenYahooListing").addEventListener("click", () => {
  chrome.tabs.create({ url: LISTING_URLS.yahoo });
});

// ═══════════════════════════════════════════════════════════════
//  売れた時チェックリスト
// ═══════════════════════════════════════════════════════════════
const SOLD_CHECKLIST = [
  { id: "sold1", label: "他フリマの同商品を削除した（二重販売防止）" },
  { id: "sold2", label: "購入者にお礼メッセージを送った" },
  { id: "sold3", label: "梱包材を準備した" },
  { id: "sold4", label: "発送方法を確認した" },
  { id: "sold5", label: "発送した（追跡番号を控えた）" },
  { id: "sold6", label: "発送通知をした" },
  { id: "sold7", label: "評価を受け取った後、相手を評価した" },
  { id: "sold8", label: "売上・利益をメモした" },
];

const SOLD_KEY = "furima_sold_check";

async function loadSoldCheck() {
  const res = await chrome.storage.local.get(SOLD_KEY);
  return res[SOLD_KEY] || {};
}

async function saveSoldCheck(data) {
  await chrome.storage.local.set({ [SOLD_KEY]: data });
}

async function renderSoldChecklist() {
  const saved = await loadSoldCheck();
  const container = $("soldChecklistItems");
  if (!container) return;
  container.innerHTML = "";

  for (const item of SOLD_CHECKLIST) {
    const checked = !!saved[item.id];
    const row = document.createElement("label");
    row.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 0;font-size:13px;cursor:pointer;border-bottom:1px solid #eef2f8;";

    const cb = document.createElement("input");
    cb.type    = "checkbox";
    cb.checked = checked;
    cb.style.cssText = "width:16px;height:16px;accent-color:#2563eb;flex-shrink:0;";
    cb.addEventListener("change", async () => {
      const d = await loadSoldCheck();
      d[item.id] = cb.checked;
      await saveSoldCheck(d);
      updateSoldProgress();
    });

    const span = document.createElement("span");
    span.textContent = item.label;
    if (checked) span.style.cssText = "text-decoration:line-through;color:#94a3b8;";

    cb.addEventListener("change", () => {
      span.style.cssText = cb.checked
        ? "text-decoration:line-through;color:#94a3b8;"
        : "";
    });

    row.appendChild(cb);
    row.appendChild(span);
    container.appendChild(row);
  }
  updateSoldProgress();
}

function updateSoldProgress() {
  const checks = [...document.querySelectorAll("#soldChecklistItems input[type=checkbox]")];
  const done   = checks.filter(c => c.checked).length;
  const total  = checks.length;
  const prog   = $("soldProgress");
  const bar    = $("soldProgressBar");
  if (prog) prog.textContent = `${done} / ${total} 完了`;
  if (bar)  bar.style.width  = total > 0 ? `${(done / total) * 100}%` : "0%";
}

$("btnSoldReset").addEventListener("click", async () => {
  await saveSoldCheck({});
  await renderSoldChecklist();
  setStatus("売れた時チェックリストをリセットしました。");
});

// ═══════════════════════════════════════════════════════════════
//  起動
// ═══════════════════════════════════════════════════════════════
async function init() {
  const item     = await loadItem();
  const meta     = await loadMeta();
  const siteMeta = await loadSiteMeta();

  fillForm(item || {}, meta || {});
  fillSiteMetaForm(siteMeta);
  bindAutoProfitEvents();

  const sel            = $("commentTemplate");
  const existingValues = [...sel.options].map((o) => o.value);
  Object.keys(COMMENT_TEMPLATES).forEach((key) => {
    if (!existingValues.includes(key)) {
      const opt = document.createElement("option");
      opt.value = key; opt.textContent = key;
      sel.appendChild(opt);
    }
  });

  await renderSoldChecklist();

  // ── ライセンス・トライアルチェック ──
  await initLicenseKanri();

  // ── トライアル残り時間カウントダウン ──
  (async function() {
    const banner = document.getElementById("trialBanner");
    if (!banner) return;

    // トライアル終了時刻を取得
    let endAt = 0;
    try {
      const st = await chrome.storage.local.get(["kanri_trial_end_at"]);
      if (st.kanri_trial_end_at) endAt = Number(st.kanri_trial_end_at);
      // なければサーバーから取得
      if (!endAt) {
        const fp  = await getFingerprintKanri();
        const did = await getOrCreateDeviceIdKanri();
        const tr  = await postJsonKanri("/trial/status", { fingerprint: fp, deviceId: did });
        if (tr?.endAt) {
          endAt = tr.endAt;
          await chrome.storage.local.set({ kanri_trial_end_at: endAt });
        }
      }
    } catch(e) {}

    function updateClock() {
      if (banner.dataset.trialMode !== "1") return;
      if (endAt > 0) {
        const diff = endAt - Date.now();
        if (diff <= 0) {
          banner.textContent = "⏰ トライアル期間が終了しました";
          banner.style.background = "#fee2e2";
          banner.style.color = "#dc2626";
          return;
        }
        const d  = Math.floor(diff / 86400000);
        const h  = Math.floor((diff % 86400000) / 3600000);
        const mi = Math.floor((diff % 3600000) / 60000);
        const s  = Math.floor((diff % 60000) / 1000);
        banner.textContent = "🎁 トライアル残り " + d + "日 " +
          String(h).padStart(2,"0") + "時間 " +
          String(mi).padStart(2,"0") + "分 " +
          String(s).padStart(2,"0") + "秒";
      } else {
        const now = new Date();
        const y  = now.getFullYear();
        const mo = String(now.getMonth()+1).padStart(2,"0");
        const dd = String(now.getDate()).padStart(2,"0");
        const h  = String(now.getHours()).padStart(2,"0");
        const mi = String(now.getMinutes()).padStart(2,"0");
        const s  = String(now.getSeconds()).padStart(2,"0");
        banner.textContent = "📅 " + y + "/" + mo + "/" + dd + " " + h + ":" + mi + ":" + s + "　稼働中";
      }
    }
    updateClock();
    setInterval(updateClock, 1000);
  })();
}

init();