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
  let res;
  try {
    res = await fetch(LICENSE_SERVER_KANRI + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch (e) {
    // 通信自体が失敗（オフライン・タイムアウトなど）
    const err = new Error(e?.message || "network error");
    err.isNetwork = true;
    throw err;
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((json.message || json.error) || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

// ★追加: 「一時的な障害（通信失敗・5xx・408・429）」かどうか
//   Render の起動待ちなどはこれに該当 → 猶予を許可してよい
//   サーバーが明確に拒否した場合（4xx や valid:false）は猶予を与えない
function isTransientKanri(e) {
  if (!e) return false;
  if (e.isNetwork) return true;
  const s = e.status;
  return typeof s === "number" && (s >= 500 || s === 408 || s === 429);
}

// ★追加: ライセンスキーをマスク表示する
//    FKA-DEV0-TEST-0001 → FKA-••••-••••-0001
function maskLicenseKey(key) {
  const k = String(key || "").trim();
  if (!k) return "";
  const parts = k.split("-");
  if (parts.length < 2) return k.slice(0, 4) + "••••";
  const head = parts[0];
  const tail = parts[parts.length - 1];
  const middle = parts.slice(1, -1).map(() => "••••").join("-");
  return middle ? `${head}-${middle}-${tail}` : `${head}-${tail}`;
}

// ★追加: プラン名を日本語に
function planLabelKanri(plan) {
  if (plan === "year")  return "年額プラン";
  if (plan === "month") return "月額プラン";
  return "";
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
  const s = await chrome.storage.local.get([
    "kanri_license_key","kanri_license_verified","kanri_license_verified_at","kanri_license_plan"
  ]);
  if (!s.kanri_license_verified || !s.kanri_license_key) return { valid: false };
  try {
    const did = await getOrCreateDeviceIdKanri();
    const fp  = await getFingerprintKanri();
    const r   = await postJsonKanri("/verify-kanri", { licenseKey: s.kanri_license_key, deviceId: did, fingerprint: fp });
    if (r?.valid) {
      const plan = r.plan || s.kanri_license_plan || "";
      await chrome.storage.local.set({
        kanri_license_verified_at: Date.now(),
        kanri_license_plan: plan
      });
      return { valid: true, key: s.kanri_license_key, plan, degraded: false };
    }
    await chrome.storage.local.remove([
      "kanri_license_key","kanri_license_verified","kanri_license_verified_at","kanri_license_plan"
    ]);
    return { valid: false };
  } catch(e) {
    // サーバーが明確に拒否した場合（4xx）は猶予なしで無効扱い
    if (!isTransientKanri(e)) {
      await chrome.storage.local.remove([
        "kanri_license_key","kanri_license_verified","kanri_license_verified_at","kanri_license_plan"
      ]);
      return { valid: false };
    }
    // 一時的な障害のみオフライン猶予
    const last = Number(s.kanri_license_verified_at || 0);
    if (last && Date.now() - last <= OFFLINE_GRACE_MS_KANRI) {
      return { valid: true, key: s.kanri_license_key, plan: s.kanri_license_plan || "", degraded: true };
    }
    return { valid: false, serverError: true };
  }
}

// ─── アクセス権判定 ────────────────────────────────────────
// ★修正: 以前は「サーバーが期限切れと答えた場合」でも72時間の猶予で通していた。
//   猶予は「サーバーに接続できなかった場合」だけに限定する。
async function markTrialExpiredKanri() {
  await chrome.storage.local.set({ kanri_trial_expired: true });
  await chrome.storage.local.remove(["kanri_trial_approved", "kanri_trial_approved_at"]);
}

async function canUseKanri() {
  // ライセンス認証済み
  const lic = await checkSavedLicenseKanri();
  if (lic.valid) {
    return { ok: true, reason: "license", degraded: lic.degraded, key: lic.key, plan: lic.plan };
  }

  // サーバーでトライアルが有効か確認
  try {
    const trial = await getTrialStatusKanri();
    console.log("[kanri] /trial/status response:", JSON.stringify(trial));
    // ★追加: サーバーが valid:true と返しても、終了時刻が過去なら期限切れとして扱う
    //   （サーバー側の判定漏れ・古い終了時刻が残っている場合の保険）
    if (trial?.valid) {
      const stored = await chrome.storage.local.get(["kanri_trial_end_at"]);
      const endAtCheck = Number(trial.endAt || stored.kanri_trial_end_at || 0);
      if (endAtCheck > 0 && endAtCheck <= Date.now()) {
        console.warn("[kanri] server says valid but endAt is in the past:", endAtCheck);
        if (trial.endAt) await chrome.storage.local.set({ kanri_trial_end_at: trial.endAt });
        return await trialDeniedStateKanri();
      }
    }
    if (trial?.valid) {
      if (trial.endAt) await chrome.storage.local.set({ kanri_trial_end_at: trial.endAt });
      await chrome.storage.local.set({ kanri_trial_approved: true, kanri_trial_approved_at: Date.now() });
      await chrome.storage.local.remove(["kanri_trial_expired"]);
      return { ok: true, reason: "trial", remainingText: trial.remainingText, endAt: Number(trial.endAt || 0) };
    }
    // サーバーが「有効ではない」と明確に回答 → 猶予なし
    return await trialDeniedStateKanri();
  } catch(e) {
    // サーバーが4xxで拒否した場合も猶予なし
    if (!isTransientKanri(e)) return await trialDeniedStateKanri();
    // ここに来るのは通信失敗・5xxのみ → 下の猶予判定へ
  }

  // 一時的な障害時のみ72時間猶予（ただしトライアル終了が確定している場合は不可）
  const s = await chrome.storage.local.get([
    "kanri_trial_approved", "kanri_trial_approved_at", "kanri_trial_expired", "kanri_trial_end_at"
  ]);
  const endAt = Number(s.kanri_trial_end_at || 0);
  const knownExpired = !!s.kanri_trial_expired || (endAt > 0 && endAt <= Date.now());
  if (!knownExpired && s.kanri_trial_approved) {
    const approvedAt = Number(s.kanri_trial_approved_at || 0);
    if (Date.now() - approvedAt <= OFFLINE_GRACE_MS_KANRI) {
      return { ok: true, reason: "trial", remainingText: "トライアル利用中" };
    }
  }

  // 上記以外はオーバーレイ表示
  return { ok: false, serverError: true, reason: knownExpired ? "trial_expired" : "" };
}

async function trialDeniedStateKanri() {
  await markTrialExpiredKanri();
  const st = await chrome.storage.local.get(["kanri_trial_started", "kanri_trial_end_at"]);
  const everStarted = !!st.kanri_trial_started || !!st.kanri_trial_end_at;
  return { ok: false, reason: everStarted ? "trial_expired" : "no_trial" };
}

// ─── UIロック/アンロック ─────────────────────────────────────
const KANRI_LOCK_BTNS = ["btnGetMercari","btnReload","btnRakuma","btnYahoo",
  "btnFormatTitle","btnFormatDesc","btnCheck","btnStale","btnProfit",
  "btnCalcShipping","btnSaveSiteMeta","btnSoldMercari","btnSoldRakuma",
  "btnSoldPaypay","btnSoldYahoo"];

// ★追加: 利用可否フラグ（null=確認中 / true=利用可 / false=利用不可）
let KANRI_ACCESS_OK = null;

// ★追加: ライセンス確認が終わったら true/false で完了する（確認中に押されたボタンを、あとで実行するため）
let _kanriReadyResolve = () => {};
const KANRI_READY = new Promise((resolve) => { _kanriReadyResolve = resolve; });

// ★追加: 直近で「利用OK」と確認できた記録（サーバーの確認を待たずに、続けて使えるようにする）
const KANRI_ACCESS_CACHE_KEY = "kanri_access_cache";
let KANRI_ACCESS_CACHE = null;
try {
  chrome.storage.local.get([KANRI_ACCESS_CACHE_KEY], (r) => {
    KANRI_ACCESS_CACHE = (r && r[KANRI_ACCESS_CACHE_KEY]) || null;
  });
} catch (e) {}

// 記録が新しい（72時間以内）で、トライアルなら終了時刻を過ぎていないときだけ、確認中でも通す
function isCachedAccessOkKanri() {
  const c = KANRI_ACCESS_CACHE;
  if (!c || !c.ok) return false;
  if (Date.now() - Number(c.at || 0) > OFFLINE_GRACE_MS_KANRI) return false;
  const endAt = Number(c.endAt || 0);
  if (c.reason === "trial" && endAt > 0 && endAt <= Date.now()) return false;
  return true;
}

function saveAccessCacheKanri(state) {
  try {
    if (state && state.ok) {
      KANRI_ACCESS_CACHE = { ok: true, at: Date.now(), reason: state.reason || "", endAt: Number(state.endAt || 0) };
      chrome.storage.local.set({ [KANRI_ACCESS_CACHE_KEY]: KANRI_ACCESS_CACHE });
    } else {
      KANRI_ACCESS_CACHE = null;
      chrome.storage.local.remove([KANRI_ACCESS_CACHE_KEY]);
    }
  } catch (e) {}
}

function lockMainButtons() {
  KANRI_ACCESS_OK = false;
  _kanriReadyResolve(false);
  KANRI_LOCK_BTNS.forEach(id => { const el=$(id); if(el){ el.disabled=true; el.style.opacity="0.4"; } });
}
function unlockMainButtons() {
  KANRI_ACCESS_OK = true;
  _kanriReadyResolve(true);
  KANRI_LOCK_BTNS.forEach(id => { const el=$(id); if(el){ el.disabled=false; el.style.opacity=""; } });
}

// ★追加: 各ボタンのクリック処理より先に走る保険のガード
//   （disabled を外された場合や、確認完了前のクリックでも実行させない）
document.addEventListener("click", (ev) => {
  const btn = ev.target && ev.target.closest ? ev.target.closest("button") : null;
  if (!btn || !KANRI_LOCK_BTNS.includes(btn.id)) return;
  if (KANRI_ACCESS_OK === true) return;
  // 確認中でも、直近でOKと確認できていれば、そのまま実行する
  if (KANRI_ACCESS_OK === null && isCachedAccessOkKanri()) return;
  ev.stopImmediatePropagation();
  ev.preventDefault();
  if (KANRI_ACCESS_OK === false) {
    showLicenseOverlay();
    return;
  }
  // 確認中：ダイアログは出さず、確認が終わったら自動で実行する
  try { setStatus("⏳ ライセンスを確認中です…\n確認できたら、自動で実行します。"); } catch (e) {}
  if (btn.__fxWaiting) return;
  btn.__fxWaiting = true;
  KANRI_READY.then((ok) => {
    btn.__fxWaiting = false;
    if (ok) btn.click();
  });
}, true);

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

// ★修正: 認証済み表示を確実にする
//   - trialMode を "0" にしてカウントダウンによる上書きを止める
//   - buyBanner / purchaseCard を隠す
//   - マスクしたキーとプランを表示する
function applyLicensedUI(state) {
  const banner = $("trialBanner");
  const buyBanner = $("buyBanner");
  const pc = $("purchaseCard");

  // ★最重要: カウントダウンによる上書きを停止
  if (banner) {
    banner.dataset.trialMode = "0";
    banner.style.display = "block";

    const masked = maskLicenseKey(state.key || "");
    const planTxt = planLabelKanri(state.plan || "");
    const detail = [planTxt, masked].filter(Boolean).join(" ・ ");

    if (state.degraded) {
      banner.style.background   = "rgba(254,243,199,0.75)";
      banner.style.borderColor  = "rgba(245,158,11,0.6)";
      banner.style.color        = "#92400e";
      banner.textContent = detail
        ? `⚠ ライセンス認証済み（サーバー確認待ち）\n${detail}`
        : "⚠ ライセンス認証済み（サーバー確認待ち）";
    } else {
      banner.style.background   = "rgba(209,250,229,0.80)";
      banner.style.borderColor  = "rgba(110,231,183,0.8)";
      banner.style.color        = "#065f46";
      banner.textContent = detail
        ? `✅ ライセンス認証済み\n${detail}`
        : "✅ ライセンス認証済み";
    }
    banner.style.whiteSpace = "pre-line";
    banner.style.lineHeight = "1.7";
  }

  // 認証済みなら購入導線は不要
  if (buyBanner) buyBanner.style.display = "none";
  if (pc) pc.style.display = "none";
}

// ─── トライアルバナー更新 ────────────────────────────────────
function updateTrialBanner(state) {
  const banner = $("trialBanner");
  if (!banner) return;

  if (state.reason === "license") {
    applyLicensedUI(state);
    return;
  }

  if (state.reason === "trial") {
    banner.style.display = "block";
    banner.style.background  = "rgba(219,234,254,0.75)";
    banner.style.color       = "#1d4ed8";
    banner.style.borderColor = "rgba(147,197,253,0.8)";
    // 時計はinit()が書き換えるのでここではフラグを立てる
    banner.dataset.trialMode = "1";

    const buyBanner = $("buyBanner");
    if (buyBanner) buyBanner.style.display = "block";
  }
}

// ─── ライセンス認証ボタン処理（オーバーレイ側）──────────────
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
      const plan = r.plan || "";
      await chrome.storage.local.set({
        kanri_license_key:         key,
        kanri_license_verified:    true,
        kanri_license_verified_at: Date.now(),
        kanri_license_plan:        plan
      });
      if(msgEl) { msgEl.textContent = "✅ 認証完了！"; msgEl.style.color="#0f766e"; }
      hideLicenseOverlay();
      unlockMainButtons();
      saveAccessCacheKanri({ ok: true, reason: "license" });
      updateTrialBanner({ reason: "license", degraded: false, key, plan });
    } else {
      if(msgEl) { msgEl.textContent = r?.message || "無効なライセンスキーです"; msgEl.style.color="#dc2626"; }
    }
  } catch(e) {
    if(msgEl) { msgEl.textContent = "サーバーエラー: " + e.message; msgEl.style.color="#dc2626"; }
  } finally {
    if(btn) btn.disabled = false;
  }
}

// ─── トライアル開始ボタン処理 ────────────────────────────────
async function handleTrialStart() {
  const btn   = $("btnTrialStart");
  const msgEl = $("licenseMsg");
  if(btn) btn.disabled = true;
  if(msgEl) { msgEl.textContent = "トライアル開始中..."; msgEl.style.color="#5b6e85"; }

  const showDenied = (text) => {
    if(msgEl) {
      msgEl.style.color = "#dc2626";
      msgEl.style.fontSize = "";
      msgEl.style.fontWeight = "";
      msgEl.textContent = text;
    }
    if(btn) btn.disabled = false;
  };

  let startErr = null;
  try {
    const r = await startTrialKanri();
    if (r?.valid) {
      await chrome.storage.local.set({
        kanri_trial_approved:    true,
        kanri_trial_approved_at: Date.now()
      });
      await chrome.storage.local.remove(["kanri_server_error_at", "kanri_trial_expired"]);
      if (r.endAt) await chrome.storage.local.set({ kanri_trial_end_at: r.endAt });
      if(msgEl) {
        msgEl.style.color = "#0f766e";
        msgEl.style.fontSize = "15px";
        msgEl.style.fontWeight = "700";
        msgEl.textContent = "✅ トライアル開始！ " + (r.remainingText || "残り7日間");
      }
      await new Promise(res => setTimeout(res, 2000));
      hideLicenseOverlay();
      unlockMainButtons();
      saveAccessCacheKanri({ ok: true, reason: "trial", endAt: Number(r.endAt || 0) });
      updateTrialBanner({ reason: "trial", remainingText: r.remainingText });
      const pc1 = $("purchaseCard");
      if(pc1) pc1.style.display = "block";
      if(msgEl) msgEl.textContent = "";
      return;
    }
    // ★修正: サーバーが「トライアル無効（終了済み・利用済み）」と回答 → 猶予を与えない
    await markTrialExpiredKanri();
    showDenied(r?.message || "トライアル期間は終了しています。ライセンスをご購入ください。");
    return;
  } catch(e) {
    console.warn("trial start error:", e.message);
    startErr = e;
  }

  // ★修正: サーバーが明確に拒否した（4xx）場合も猶予なし
  if (!isTransientKanri(startErr)) {
    await markTrialExpiredKanri();
    showDenied(startErr?.message || "トライアルはご利用いただけません。ライセンスをご購入ください。");
    return;
  }

  // ★修正: サーバーに接続できないときは、トライアルを新規に開始・延長しない。
  //   （以前はここで72時間を自己付与しており、通信を切るだけで何度でも延長できる抜け穴だった。
  //     猶予は「サーバーが一度でも有効と確認したトライアル」に対してだけ、
  //     canUseKanri() が最終確認から72時間・終了時刻まで を上限に与える）
  showDenied("サーバーに接続できませんでした。時間をおいてもう一度お試しください。");
}

// ─── ライセンスチェック起動 ──────────────────────────────────
async function initLicenseKanri() {
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
        const plan = r.plan || "";
        await chrome.storage.local.set({
          kanri_license_key:         key,
          kanri_license_verified:    true,
          kanri_license_verified_at: Date.now(),
          kanri_license_plan:        plan
        });
        if(msgEl) { msgEl.textContent = "✅ 認証完了！"; msgEl.style.color="#0f766e"; }
        updateTrialBanner({ reason: "license", degraded: false, key, plan });
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
    saveAccessCacheKanri(state);
    if (state.ok) {
      hideLicenseOverlay();
      unlockMainButtons();
      updateTrialBanner(state);
      // トライアル中のみ購入カードを表示（ライセンス済みは applyLicensedUI が非表示にする）
      if (state.reason === "trial") {
        const pc = $("purchaseCard");
        if (pc) pc.style.display = "block";
      }
      return state;
    } else {
      lockMainButtons();
      showLicenseOverlay();
      const expMsg = $("licenseMsg");
      if (expMsg && state.reason === "trial_expired") {
        expMsg.textContent = "⏰ トライアル期間が終了しました。ライセンスをご購入ください。";
        expMsg.style.color = "#dc2626";
      }
      return state;
    }
  } catch(e) {
    console.error("initLicenseKanri error:", e);
    const msgEl = $("licenseMsg");
    if(msgEl) { msgEl.textContent = "サーバー接続エラー。時間をおいて再試行してください"; msgEl.style.color="#dc2626"; }
    lockMainButtons();
    showLicenseOverlay();
    return { ok: false };
  }
}

const STORAGE_KEY      = "furima_assist_item";
const META_KEY         = "furima_assist_meta";
const COUNTER_KEY      = "furima_assist_counter";
const SITE_META_KEY    = "furima_assist_site_meta";
// ★追加: 送料計算（3辺合計cm・重さ）を保存するためのキー。
//   ポップアップを閉じて別サイトのタブで開き直しても、直前に入力した値を復元できるようにする
const SHIPCALC_KEY     = "furima_assist_shipcalc";

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

  // ★修正: 旧コードは /^[\s\W]+/ で先頭の記号を除去していたが、
  //   JavaScriptの \W は日本語もすべて該当するため、日本語だけの商品名が
  //   丸ごと消えてしまっていた。除去する記号を明示的に列挙する方式に変更。
  const stripLeadSymbols = (s) =>
    s.replace(/^[\s\-–—_=+*＊#＃|｜/\\,.、。・:：;；!！?？"'“”()（）[\]{}]+/, "");

  const clean = (s, limit) => {
    const t = stripLeadSymbols(
      s.replace(/[【】〔〕『』「」]/g, " ").replace(/\s+/g, " ").trim()
    ).slice(0, limit);
    // ★安全装置: 整形の結果が空になったら、整形前の値をそのまま使う
    return t || String(s || "").trim().slice(0, limit);
  };

  if (site === "rakuma") {
    return clean(base, 40);
  }
  if (site === "yahoo" || site === "auction") {
    return clean(base, 65);
  }
  return base;
}

// ═══════════════════════════════════════════════════════════════
//  説明文整形
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
// Yahoo!フリマでは「ノークレーム・ノーリターン」等の表現を使うと、出品時にエラーになる。
// 説明文の中から、その表現を含む「一文」だけを取り除く（他の文はそのまま）。
function stripNoClaimPhrases(text) {
  const src = String(text || "");
  const re = /ノー?クレーム|ノークレ|ノー?リターン|ノーリタ|NCNR|ＮＣＮＲ|NC\s*[\/・&＆]\s*NR/i;
  let removed = false;
  const lines = src.split("\n").map((line) => {
    if (!re.test(line)) return line;
    removed = true;
    const parts = line.match(/[^。！!？?]+[。！!？?]?/g) || [line];
    return parts.filter((s) => !re.test(s)).join("").trim();
  });
  const out = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text: out, removed };
}

function formatDescriptionForSite(description, site) {
  let text = String(description || "").trim();
  text = text.replace(/\n{3,}/g, "\n\n");

  if (site === "rakuma" || site === "yahoo") {
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
// ★追加: 送料計算（3辺合計cm・重さ）の保存・復元
async function saveShipCalc(v)    { await chrome.storage.local.set({ [SHIPCALC_KEY]:    v });        }
async function loadShipCalc()     { return (await chrome.storage.local.get(SHIPCALC_KEY))[SHIPCALC_KEY] || null; }

// ═══════════════════════════════════════════════════════════════
//  メルカリの「商品写真」だけを選ぶ
//    ページには、星やリボンのアイコン・他の商品のサムネイル・同じ写真の小さい版も
//    含まれているため、その商品の写真（m〇〇_1.jpg など）だけを、番号順に1枚ずつ残す
// ═══════════════════════════════════════════════════════════════
function pickProductPhotos(urls, sourceUrl, max = 20) {
  const list = Array.isArray(urls) ? urls.filter((u) => typeof u === "string" && /^https?:\/\//.test(u)) : [];
  if (!list.length) return [];

  const re = /\/(m\d{6,})_(\d{1,2})\.(?:jpe?g|png|webp)/i;
  const cand = [];
  for (const u of list) {
    const m = u.split("?")[0].match(re);
    if (m) cand.push({ u, id: m[1], n: Number(m[2]) });
  }

  if (cand.length) {
    // この商品のID（ページのURLから。無ければ、いちばん多く出てくるID）
    let own = ((String(sourceUrl || "").match(/\/item\/(m\d+)/) || [])[1]) || "";
    if (!own || !cand.some((c) => c.id === own)) {
      const count = {};
      cand.forEach((c) => { count[c.id] = (count[c.id] || 0) + 1; });
      own = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
    }
    // 同じ番号の写真は、大きいほう（orig）を優先して1枚だけ残す
    const rank = (u) => (/\/orig\//.test(u) ? 0 : /\/detail\//.test(u) ? 1 : /thumb/i.test(u) ? 3 : 2);
    const best = new Map();
    cand.filter((c) => c.id === own).forEach((c) => {
      const prev = best.get(c.n);
      if (!prev || rank(c.u) < rank(prev.u)) best.set(c.n, c);
    });
    const picked = [...best.values()].sort((a, b) => a.n - b.n).map((c) => c.u).slice(0, max);
    if (picked.length) return picked;
  }

  // URLの形が想定と違うとき（形式が変わった場合など）は、/photos/ を含むものだけを重複なしで残す。それも無ければ元のまま
  const seen = new Set();
  const fallback = list.filter((u) => {
    if (!/\/photos\//.test(u) || /\/thumb/i.test(u)) return false;
    const base = u.split("?")[0];
    if (seen.has(base)) return false;
    seen.add(base);
    return true;
  }).slice(0, max);
  return fallback.length ? fallback : list.slice(0, max);
}

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

// サイト別管理のURLが、どのメルカリ商品のものか（例: m89333118579）。別の商品を取得したときに、前の商品のURLを消すために使う
let SITE_OWNER_ITEM_ID = "";

function mercariItemIdOf(url) {
  const m = String(url || "").match(/\/item\/(m\d+)/i);
  return m ? m[1].toLowerCase() : "";
}

// 別の商品を取得したときに、サイト別管理の前の商品のURL・メモを消すかどうかを決める
function planSiteMetaReset(stored, newId) {
  const s = stored || {};
  const urlKeys  = [["rakumaUrl", "ラクマ"], ["paypayUrl", "Yahoo!フリマ"], ["yahooUrl", "ヤフオク"]];
  const memoKeys = ["mercariMemo", "rakumaMemo", "paypayMemo", "yahooMemo"];
  const oldId    = String(s.ownerItemId || "").toLowerCase() || mercariItemIdOf(s.mercariUrl);
  const left     = urlKeys.filter(([k]) => String(s[k] || "").trim()).map(([, label]) => label);
  const hasLeft  = left.length > 0 || memoKeys.some((k) => String(s[k] || "").trim());
  // 前の商品が分かるときは「IDが違えば別の商品」。分からなくてもURL等が残っているなら、前の商品のものとみなす
  const isNewItem = !!newId && (oldId ? oldId !== String(newId).toLowerCase() : hasLeft);
  return { isNewItem, oldId, clearedLabels: isNewItem ? left : [] };
}

function fillSiteMetaForm(siteMeta) {
  SITE_OWNER_ITEM_ID = (siteMeta && siteMeta.ownerItemId) || "";
  if (!siteMeta) return;
  $("mercariUrl").value  = siteMeta.mercariUrl  || "";
  $("mercariMemo").value = siteMeta.mercariMemo || "";
  $("rakumaUrl").value   = siteMeta.rakumaUrl   || "";
  $("rakumaMemo").value  = siteMeta.rakumaMemo  || "";
  $("paypayUrl").value   = siteMeta.paypayUrl   || "";
  $("paypayMemo").value  = siteMeta.paypayMemo  || "";
  $("yahooUrl").value    = siteMeta.yahooUrl    || "";
  $("yahooMemo").value   = siteMeta.yahooMemo   || "";

  // 復元した値をその場で検証表示
  validateAllUrls();
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
    paypayUrl:   $("paypayUrl").value.trim(),
    paypayMemo:  $("paypayMemo").value.trim(),
    yahooUrl:    $("yahooUrl").value.trim(),
    yahooMemo:   $("yahooMemo").value.trim(),
    ownerItemId: SITE_OWNER_ITEM_ID
  };
}

// ★追加: 「全クリア」— 新しい商品を出品する前に、前の商品のデータを一括で消す。
//   ライセンス・トライアルの情報は消さない（それらは別のキーで管理されている）。
async function clearAllItemData() {
  await chrome.storage.local.remove([
    STORAGE_KEY,    // 商品データ（管理番号・商品名・価格・説明文など）
    META_KEY,       // 価格・利益管理（仕入れ値・送料・手数料率・出品日・メモ）
    SITE_META_KEY,  // サイト別管理（メルカリ／ラクマ／Yahoo!フリマ／ヤフオクのURL・メモ）
    SOLD_KEY,       // 売れた時チェックリスト
    SHIPCALC_KEY    // 送料計算（3辺合計cm・重さ）
  ]);

  SITE_OWNER_ITEM_ID = "";

  fillForm({}, {});
  fillSiteMetaForm({
    mercariUrl: "", mercariMemo: "",
    rakumaUrl: "",  rakumaMemo: "",
    paypayUrl: "",  paypayMemo: "",
    yahooUrl: "",   yahooMemo: "",
    ownerItemId: ""
  });

  const cmEl = $("shippingSize");
  const kgEl = $("shippingWeight");
  if (cmEl) cmEl.value = "";
  if (kgEl) kgEl.value = "";
  if ($("shippingThick")) $("shippingThick").value = "";
  ["shipL", "shipW", "shipH"].forEach((id) => { if ($(id)) $(id).value = ""; });
  const shipArea = $("shippingResultArea");
  if (shipArea) shipArea.innerHTML = "";

  await renderSoldChecklist();

  setStatus("🗑 商品データをすべてクリアしました。新しい商品の出品を始められます。");
}

async function autoSaveCurrentState() {
  const item = collectFormItem((await loadItem()) || {});
  const meta = collectMeta();
  await saveItem(item);
  await saveMeta(meta);
}

// ★v1.5.4 追加: 出品管理（出品日・出品先）を自動でそろえる
//   ・出品日が空なら「今日」を入れる（端末のローカル日付）
//   ・サイト別管理に登録済みのURLから出品先を決める
//       1サイトだけ → そのサイト／2サイト以上 → 複数フリマ
function todayLocalDate() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function marketplaceFromSiteMeta(sm) {
  if (!sm) return "";
  const sites = [];
  if (String(sm.mercariUrl || "").trim()) sites.push("mercari");
  if (String(sm.rakumaUrl  || "").trim()) sites.push("rakuma");
  if (String(sm.paypayUrl  || "").trim()) sites.push("yahoo");    // Yahoo!フリマ
  if (String(sm.yahooUrl   || "").trim()) sites.push("auction");  // ヤフオク
  if (sites.length >= 2) return "multi";
  return sites[0] || "";
}

// 管理メモに「2026/10/11 ラクマ出品」のような履歴を1行ずつ追記する（同じ行は二重に書かない）
function appendManagementLog(label) {
  const el = $("managementMemo");
  if (!el || !label) return;
  const line = `${todayLocalDate().replace(/-/g, "/")} ${label}出品`;
  const lines = el.value.split("\n").map((t) => t.trim());
  if (lines.includes(line)) return;
  el.value = el.value.trim() ? `${el.value.replace(/\s+$/, "")}\n${line}` : line;
}

// ★v1.5.4: 見積もりメモ（mercari_scrape.js が読んだ hint）を反映し、送料計算 → 送料反映 → 利益計算まで自動で行う
async function applyListingHint(hint) {
  if (!hint) return "";
  const notes = [];
  try {
    if (hint.cost != null && $("cost")) {
      $("cost").value = String(hint.cost);
      $("cost").dispatchEvent(new Event("input", { bubbles: true }));
      notes.push(`仕入れ値 ¥${hint.cost}`);
    }
    if (hint.invMemo && $("inventoryMemo")) {
      const cur = $("inventoryMemo").value.trim();
      if (!cur || cur === INVENTORY_MEMO_TEMPLATE.trim()) $("inventoryMemo").value = hint.invMemo;
      else if (!cur.includes(hint.invMemo)) $("inventoryMemo").value = `${cur}\n${hint.invMemo}`;
    }
    if (hint.cm != null && $("shippingSize")) {
      $("shippingSize").value   = String(hint.cm);
      if ($("shippingWeight")) $("shippingWeight").value = hint.kg != null ? String(hint.kg) : "";
      if ($("shippingThick"))  $("shippingThick").value  = hint.thick != null ? String(hint.thick) : "";
      await saveShipCalc({ cm: $("shippingSize").value, kg: $("shippingWeight") ? $("shippingWeight").value : "", thick: $("shippingThick") ? $("shippingThick").value : "" });

      // 送料計算を実行し、表示中のフリマで一番安い配送方法を「送料」に入れる
      $("btnCalcShipping").click();
      const rows = [...document.querySelectorAll("#shippingResultArea [data-ship]")]
        .map((el) => ({ el, row: SHIPPING_TABLE[Number(el.dataset.ship)] }))
        .filter((x) => x.row);
      const sizeNote = `${hint.cm}cm${hint.kg != null ? "・" + hint.kg + "kg" : ""}の見積もり`;

      // 配送方法の指定（hint.ship）があれば、それを最優先にする
      const norm = (t) => String(t || "").replace(/\s+/g, "").toLowerCase();
      const want = norm(hint.ship);
      let picked = null;
      if (want) {
        picked = rows.find((x) => norm(x.row.name) === want)
              || rows.find((x) => norm(x.row.name).startsWith(want));
        if (picked) {
          picked.el.click();
          notes.push(`送料 ¥${picked.row.price}（${picked.row.name}・指定どおり／${sizeNote}）`);
        } else {
          // 一覧に出ていない（大きさの条件から外れた）場合も、表示中のフリマの送料表から探して入れる
          const mp = ($("marketplace") && $("marketplace").value) || "mercari";
          const plat = /rakuma/.test(mp) ? "rakuma" : /yahoo/.test(mp) ? "yahoo" : "mercari";
          const row = SHIPPING_TABLE.find((r) => r.p === plat && norm(r.name) === want)
                   || SHIPPING_TABLE.find((r) => r.p === plat && norm(r.name).startsWith(want));
          if (row && $("shipping")) {
            $("shipping").value = String(row.price);
            $("shipping").dispatchEvent(new Event("input",  { bubbles: true }));
            $("shipping").dispatchEvent(new Event("change", { bubbles: true }));
            picked = { row };
            notes.push(`送料 ¥${row.price}（${row.name}・指定どおり／※大きさの条件を確認してください）`);
          } else {
            notes.push(`⚠ 指定の配送方法「${hint.ship}」が送料表に見つからないため、最安を入れました`);
          }
        }
      }

      if (!picked && rows.length) {
        // 厚さ未確認の薄型便は後回し、「〜（一番小さいサイズの料金）」でない金額を優先する
        const sure = rows.filter((x) => !x.el.dataset.warn && !x.el.dataset.next);
        const base = sure.length ? sure : rows;
        const pool = base.filter((x) => !x.row.from).length ? base.filter((x) => !x.row.from) : base;
        const best = pool.reduce((m, x) => (x.row.price < m.row.price ? x : m), pool[0]);
        best.el.click();
        notes.push(`送料 ¥${best.row.price}（${best.row.name}・最安／${sizeNote}）`);
      }
    }
    updateProfitView();
    await saveMeta(collectMeta());
  } catch (e) {}
  return notes.length ? `\n見積もりメモを反映: ${notes.join("／")}` : "";
}

// 在庫メモが空のときだけ、書き込み用のひな形を入れる
const INVENTORY_MEMO_TEMPLATE = "保管場所：\n仕入れ日：\n仕入れ先：\n付属品：";

async function syncListingMeta({ resetDate = false, newItem = false, logLabel = "" } = {}) {
  try {
    const dateEl = $("listedDate");
    const siteEl = $("marketplace");
    if (!dateEl || !siteEl) return;
    if (resetDate || !dateEl.value) dateEl.value = todayLocalDate();
    const mp = marketplaceFromSiteMeta(await loadSiteMeta());
    if (mp) siteEl.value = mp;

    // 新しい商品: 管理メモ・在庫メモを前の商品から引き継がない
    if (newItem) {
      if ($("managementMemo")) $("managementMemo").value = "";
      if ($("inventoryMemo"))  $("inventoryMemo").value  = "";
    }
    if ($("inventoryMemo") && !$("inventoryMemo").value.trim()) {
      $("inventoryMemo").value = INVENTORY_MEMO_TEMPLATE;
    }
    if (logLabel) appendManagementLog(logLabel);

    await saveMeta(collectMeta());
  } catch (e) {}
}

// ═══════════════════════════════════════════════════════════════
//  タブ内実行関数: Yahooフリマ / ヤフオク貼り付け（非同期版）
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

  const descText = item.description || "";
  let descOk = false;
  let diagInfo = "";

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

    try {
      await navigator.clipboard.writeText(descText);
    } catch(e) {}

    // ★フォーカスが説明文欄に無いまま execCommand を撃つと、
    //   直前にフォーカスされていた価格欄の中身を消してしまう。必ず確認する。
    if (document.activeElement === targetEl) {
      targetEl.select?.();
      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
    } else {
      console.warn("[furima] 説明文欄にフォーカスが無いため一括削除を見送りました");
    }
    await sleep(100);

    try {
      const dt = new DataTransfer();
      dt.setData("text/plain", descText);
      const pasteEv = new ClipboardEvent("paste", {
        clipboardData: dt, bubbles: true, cancelable: true
      });
      targetEl.dispatchEvent(pasteEv);
      await sleep(300);
    } catch(e) {}

    if ((targetEl.value || targetEl.textContent || "").trim().length === 0) {
      document.execCommand("insertText", false, descText);
      await sleep(200);
    }

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
  ).slice(0, 20) : [];

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
            // ★ここも同じ。フォーカスが商品名欄に来ていなければ触らない。
            if (document.activeElement === titleEl) {
              document.execCommand("selectAll", false, null);
              document.execCommand("delete",     false, null);
              await sleep(500);
              document.execCommand("insertText", false, titleVal);
              await sleep(300);
            } else {
              console.warn("[furima] 商品名欄にフォーカスが無いため入力を見送りました");
            }
          }
        }
        imageOk = true;
      }
    }
  }

  const diagTextareas    = document.querySelectorAll("textarea").length;
  const diagEditable     = document.querySelectorAll('[contenteditable="true"]').length;
  const diagPlaceholders = [...document.querySelectorAll("textarea, [contenteditable='true']")]
    .map(el => el.placeholder || el.tagName + (el.className ? "."+el.className.split(" ")[0] : ""))
    .slice(0, 5).join(" | ");

  return { descOk, imageOk, imageCount, diagTextareas, diagEditable, diagPlaceholders, diagInfo };
}

// ═══════════════════════════════════════════════════════════════
//  初期化ヘルパー
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

    await chrome.storage.local.set({ mercariScrapeResult: "", mercariData: null });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files:  ["mercari_scrape.js"]
    });

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
    item.images = pickProductPhotos(item.images, item.sourceUrl);   // ★商品写真だけにする
    await saveItem(item);
    const meta = await loadMeta();
    fillForm(item, meta || {});

    // ★サイト別管理の整理
    //   ・別の商品を取得したときは、前の商品のURL・メモ（ラクマ／Yahoo!フリマ／ヤフオク）を消す
    //     （前の商品のURLが残っていると、「売れた！」で別の商品の出品を消してしまうおそれがあるため）
    //   ・メルカリのURLが空・誤りのときは、いま取得したページのURLを自動で入れる
    let autoUrlNote = "";
    try {
      const src   = String(item.sourceUrl || "").split("?")[0].split("#")[0];
      const newId = mercariItemIdOf(src);
      if (newId) {
        const plan = planSiteMetaReset((await loadSiteMeta()) || {}, newId);
        let changed = false;
        if (plan.isNewItem) {
          ["rakumaUrl", "paypayUrl", "yahooUrl", "mercariMemo", "rakumaMemo", "paypayMemo", "yahooMemo"].forEach((id) => { $(id).value = ""; });
          $("mercariUrl").value = src;
          changed = true;
          autoUrlNote = plan.clearedLabels.length
            ? `\nサイト別管理: 前の商品のURLを消しました（${plan.clearedLabels.join("・")}）`
            : "\nサイト別管理: メルカリのURLを自動で入れました";
        } else if (mercariItemIdOf($("mercariUrl").value) !== newId) {
          $("mercariUrl").value = src;
          changed = true;
          autoUrlNote = "\nサイト別管理: メルカリのURLを自動で入れました";
        }
        SITE_OWNER_ITEM_ID = newId;
        const sm = collectSiteMeta();
        if (item.manageId) sm.manageId = item.manageId;
        await saveSiteMeta(sm);
        if (changed) validateAllUrls();
      }
    } catch (e) {}

    // ★v1.5.4: 出品日（新しい商品なら今日に更新）・出品先を自動でそろえる
    {
      const srcId = mercariItemIdOf(String(item.sourceUrl || "").split("?")[0].split("#")[0]);
      const LAST_KEY = "fx_lastMercariItemId";
      const prevId = (await chrome.storage.local.get(LAST_KEY))[LAST_KEY] || "";
      // ※ 更新直後の初回（prevId が空）は「新しい商品」とみなさない（入力済みのメモを消さないため）
      const isNew = !!srcId && !!prevId && prevId !== srcId;

      // 管理番号: 新しい商品なら新しく発番（前の商品の番号を引き継がない）。空のときも発番
      if (isNew || !String(item.manageId || "").trim()) {
        item.manageId = await generateManageId();
        $("manageId").value = item.manageId;
        await saveItem(item);
        try {
          const sm = collectSiteMeta();
          sm.manageId = item.manageId;
          await saveSiteMeta(sm);
        } catch (e) {}
      }

      // ★新しい商品のときは、前の商品の「3辺合計・重さ・送料・仕入れ値」を消す
      //   （見積もりメモがあれば、このあと applyListingHint で入れ直す）
      if (isNew) {
        try {
          ["shipL", "shipW", "shipH", "shippingSize", "shippingWeight", "shippingThick", "shipping", "cost"].forEach((id) => {
            const el = $(id);
            if (!el) return;
            el.value = "";
            el.dispatchEvent(new Event("input", { bubbles: true }));
          });
          await saveShipCalc({ cm: "", kg: "", thick: "", l: "", w: "", h: "" });
          const area = $("shippingResultArea");
          if (area) area.innerHTML = "";
          updateProfitView();
        } catch (e) {}
      }

      await syncListingMeta({ resetDate: isNew, newItem: isNew, logLabel: isNew ? "メルカリ" : "" });
      if (srcId) await chrome.storage.local.set({ [LAST_KEY]: srcId });
      autoUrlNote += await applyListingHint(item.hint);
    }

    setStatus(
      `✅ メルカリから取得しました\n` +
      `商品名: ${item.title}\n` +
      `価格: ${item.price}円\n` +
      `状態: ${item.condition || "未取得"}\n` +
      `カテゴリ: ${item.category || "未取得"}\n` +
      `ブランド: ${item.brand || "未取得"}\n` +
      `サイズ: ${item.size || "未取得"}\n` +
      `画像: ${item.images?.length || 0}枚` +
      autoUrlNote
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
    siteMeta.paypayUrl   && `Yahoo!フリマ: ${siteMeta.paypayUrl}`,
    siteMeta.yahooUrl    && `ヤフオク: ${siteMeta.yahooUrl}`
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

  // ── Yahoo!フリマ（PayPayフリマ） ──────────────────────────
  // PayPayフリマは出品削除UIの変更が多いため、自動クリックはせず
  // 「削除ボタンを赤枠で示して人間に押させる」方式を採用する。
  // （誤爆で別の商品を消すリスクを避けるため）
  if (/paypayfleamarket\.yahoo\.co\.jp/.test(url)) {
    await sleep(2000);

    const findByText = (texts) =>
      [...document.querySelectorAll("button, a, [role='button']")].find(el => {
        const t = (el.textContent || "").trim();
        return texts.some(x => t.includes(x));
      });

    // 1) 削除ボタンが既にページ上にあるか
    const delBtn = findByText(["この商品を削除", "出品を削除", "商品を削除", "削除する"]);
    if (delBtn) {
      delBtn.scrollIntoView({ behavior: "smooth", block: "center" });
      delBtn.style.outline   = "4px solid red";
      delBtn.style.boxShadow = "0 0 10px red";
      return "need_manual";
    }

    // 2) 編集ページへ遷移できるか（削除は編集ページ内にある）
    const editBtn = findByText(["商品を編集", "編集する", "出品を編集"]);
    if (editBtn) {
      editBtn.scrollIntoView({ behavior: "smooth", block: "center" });
      editBtn.style.outline   = "4px solid red";
      editBtn.style.boxShadow = "0 0 10px red";
      return "need_manual";
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
  // 保存済みの値に加えて、画面の入力欄に入っているURLも使う（「サイト別管理を保存」を押し忘れていても動くように）
  const storedMeta = (await loadSiteMeta()) || {};
  const formMeta   = collectSiteMeta();
  const siteMeta   = { ...storedMeta };
  ["mercariUrl", "rakumaUrl", "paypayUrl", "yahooUrl"].forEach((k) => {
    if (formMeta[k]) siteMeta[k] = formMeta[k];
  });
  const item     = (await loadItem()) || {};
  const title    = item.title || "この商品";
  const manageId = item.manageId || "";
  const siteNames = {
    mercari: "メルカリ",
    rakuma:  "ラクマ",
    paypay:  "Yahoo!フリマ",
    yahoo:   "ヤフオク"
  };
  const soldName  = siteNames[soldSite] || soldSite;

  const others = [];
  if (soldSite !== "mercari" && siteMeta?.mercariUrl) {
    others.push({ name: "メルカリ", url: siteMeta.mercariUrl });
  }
  if (soldSite !== "rakuma"  && siteMeta?.rakumaUrl) {
    // ラクマは商品ページからでなく「出品中一覧」から削除する仕様
    others.push({ name: "ラクマ", url: "https://fril.jp/sell" });
  }
  if (soldSite !== "paypay"  && siteMeta?.paypayUrl) {
    others.push({ name: "Yahoo!フリマ", url: siteMeta.paypayUrl });
  }
  if (soldSite !== "yahoo"   && siteMeta?.yahooUrl) {
    others.push({ name: "ヤフオク", url: siteMeta.yahooUrl });
  }

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

  // ① 先に、他サイトのタブを全部開く
  //    （途中でポップアップが閉じても、Yahoo!フリマなど後ろのサイトのタブが開かないことがないように）
  const opened = [];
  for (const other of others) {
    try {
      const tab = await chrome.tabs.create({ url: other.url, active: false });
      opened.push({ other, tab });
    } catch (e) {
      opened.push({ other, tab: null });
    }
  }

  // ② 開いたタブを順番に処理する
  for (const { other, tab } of opened) {
    try {
      if (!tab) throw new Error("tab create failed");

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
$("btnSoldPaypay").addEventListener("click",  () => showSoldAlert("paypay"));
$("btnSoldYahoo").addEventListener("click",   () => showSoldAlert("yahoo"));

// ── URL自動取得 ──────────────────────────────────────────────
async function autoFillUrl(fieldId) {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    let url    = tabs?.[0]?.url || "";
    if (!url || url.startsWith("chrome://") || url.startsWith("chrome-extension://")) {
      setStatus("⚠ 商品ページを開いた状態で「現在のURL」を押してください。");
      return;
    }

    // 出品完了ページ（ヤフオク・Yahoo!フリマ）や出品一覧（ラクマ）では、ページのURLが商品ページのURLではない。
    // その場合は、ページの中から商品ページのURLを読み取る
    const fieldSite = { rakumaUrl: "rakuma", paypayUrl: "paypay", yahooUrl: "yahoo" }[fieldId];
    if (fieldSite && tabs[0].id != null) {
      try {
        const r = await chrome.runtime.sendMessage({ type: "FX_PROBE_TAB", tabId: tabs[0].id });
        if (r && r.ok && r.site === fieldSite && r.url) url = r.url;
      } catch (e) {}
    }
    $(fieldId).value = url;

    // 取得したURLをその場で検証（出品フォームURLの誤登録を防ぐ）
    const v = validateUrlField(fieldId);

    const siteMeta = collectSiteMeta();
    const item     = (await loadItem()) || {};
    if (item.manageId) siteMeta.manageId = item.manageId;
    await saveSiteMeta(siteMeta);
    window.scrollTo(0, 0);

    if (v && !v.ok) {
      setStatus(`⚠ URLを取得しましたが、内容を確認してください\n${v.msg}\n${url}`);
    } else {
      setStatus(`✅ URLを取得して保存しました\n${url}`);
    }
  } catch (e) {
    setStatus(`URL取得エラー: ${e.message}`);
  }
}

$("btnGetMercariUrl").addEventListener("click", () => autoFillUrl("mercariUrl"));
$("btnGetRakumaUrl").addEventListener("click",  () => autoFillUrl("rakumaUrl"));
$("btnGetPaypayUrl").addEventListener("click",  () => autoFillUrl("paypayUrl"));
$("btnGetYahooUrl").addEventListener("click",   () => autoFillUrl("yahooUrl"));

// ═══════════════════════════════════════════════════════════════
//  URL検証
//  「出品フォームのURL」を登録してしまうと、売れた時の自動削除が
//  動かない。人為ミスをその場で気づかせるための検証。
//  誤検知を避けるため、明確に間違っている場合だけ警告する。
// ═══════════════════════════════════════════════════════════════
const URL_RULES = {
  mercariUrl: {
    label: "メルカリ",
    hint:  "jp.mercari.com/item/...",
    hosts: [/(^|\.)mercari\.com$/i],
    sellNg: [/\/sell(\/|\?|$)/i, /\/mypage(\/|\?|$)/i]
  },
  rakumaUrl: {
    label: "ラクマ",
    hint:  "fril.jp/...",
    hosts: [/(^|\.)fril\.jp$/i, /(^|\.)rakuma\.rakuten\.co\.jp$/i],
    sellNg: [/\/c\/sell(\/|\?|$)/i, /\/sell(\/|\?|$)/i, /\/item\/new/i, /\/mypage(\/|\?|$)/i]
  },
  paypayUrl: {
    label: "Yahoo!フリマ",
    hint:  "paypayfleamarket.yahoo.co.jp/item/...",
    hosts: [/(^|\.)paypayfleamarket\.yahoo\.co\.jp$/i],
    sellNg: [/\/sell(\/|\?|$)/i, /\/mypage(\/|\?|$)/i]
  },
  yahooUrl: {
    label: "ヤフオク",
    hint:  "auctions.yahoo.co.jp/...",
    hosts: [/(^|\.)auctions\.yahoo\.co\.jp$/i],
    sellNg: [/\/sell(\/|\?|$)/i, /show\/beforms/i, /show\/submit/i, /show\/amgr/i]
  }
};

function setUrlMsg(fieldId, state, text) {
  const input = $(fieldId);
  const msg   = $(fieldId + "Msg");
  if (input) input.classList.remove("url-ok", "url-warn");
  if (msg)   msg.classList.remove("ok", "warn");

  if (state === "none") {
    if (msg) msg.textContent = "";
    return;
  }
  if (input) input.classList.add(state === "ok" ? "url-ok" : "url-warn");
  if (msg) {
    msg.classList.add(state === "ok" ? "ok" : "warn");
    msg.textContent = text;
  }
}

function validateUrlField(fieldId) {
  const rule = URL_RULES[fieldId];
  const el   = $(fieldId);
  if (!rule || !el) return null;

  const raw = el.value.trim();

  if (!raw) {
    setUrlMsg(fieldId, "none", "");
    return { ok: true, msg: "" };
  }

  let u;
  try {
    u = new URL(raw);
  } catch (e) {
    const m = `⚠ URLの形式が正しくありません（${rule.hint} の形式）`;
    setUrlMsg(fieldId, "warn", m);
    return { ok: false, msg: m };
  }

  if (!/^https?:$/.test(u.protocol)) {
    const m = "⚠ http/https のURLを入れてください";
    setUrlMsg(fieldId, "warn", m);
    return { ok: false, msg: m };
  }

  // ドメイン違い（例: メルカリ欄に fril.jp を入れた）
  if (!rule.hosts.some(re => re.test(u.hostname))) {
    const m = `⚠ ${rule.label}の商品URLを入れてください（${rule.hint}）`;
    setUrlMsg(fieldId, "warn", m);
    return { ok: false, msg: m };
  }

  // 出品フォームのURL（これが本命の事故パターン）
  const path = u.pathname + u.search;
  if (rule.sellNg.some(re => re.test(path))) {
    const m = "⚠ これは出品ページのURLです。出品後の商品ページURLを登録してください";
    setUrlMsg(fieldId, "warn", m);
    return { ok: false, msg: m };
  }

  // トップページ（商品ページではない）
  if (u.pathname === "/" || u.pathname === "") {
    const m = "⚠ トップページのURLです。商品ページのURLを登録してください";
    setUrlMsg(fieldId, "warn", m);
    return { ok: false, msg: m };
  }

  setUrlMsg(fieldId, "ok", "✅ OK");
  return { ok: true, msg: "OK" };
}

function validateAllUrls() {
  Object.keys(URL_RULES).forEach(id => validateUrlField(id));
}

Object.keys(URL_RULES).forEach(id => {
  const el = $(id);
  if (el) el.addEventListener("input", () => validateUrlField(id));
});

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
      images:   pickProductPhotos(stored.images || [], stored.sourceUrl),
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
    // ★v1.5.4: カテゴリ・発送日数の自動選択の結果
    const catLine = result.categoryOk
      ? `\nカテゴリー: ✅ ${result.categoryText || "OK"}`
      : (rakumaItem.category ? `\nカテゴリー: ⚠ 手動で選択してください${result.categoryReason ? "（" + result.categoryReason + "）" : ""}` : "");
    const daysLine = result.shipDaysOk
      ? `\n発送日の目安: ✅ ${result.shipDaysText || "OK"}`
      : `\n発送日の目安: ⚠ 確認してください${result.shipDaysReason ? "（" + result.shipDaysReason + "）" : ""}`;

    const images = rakumaItem.images || [];
    let imgLine = "";
    if (images.length > 0) {
      imgLine = result.imageOk
        ? `\n画像: ✅ ${images.length}枚をアップロードしました`
        : `\n画像: ⚠ 自動アップロード失敗（手動でアップロードしてください）`;
    }

    setStatus(
      `ラクマ貼り付け結果\n管理番号: ${item.manageId || "未設定"}\n商品名(40字): ${result.titleOk ? "✅ OK" : "❌ NG"}\n価格: ${result.priceOk ? "✅ OK" : "❌ NG"}\n説明文: ${result.descOk ? "✅ OK" : "❌ NG"}${condLine}${brandLine}${catLine}${daysLine}${imgLine}`
      + (ngItems.length ? `\n\n⚠ 要確認:\n${ngItems.map(s => "・" + s).join("\n")}` : "\n\nタイトルをラクマ用（40字以内）に自動調整しました。")
    );
  } catch (error) {
    setStatus(`ラクマ貼り付けエラー: ${error}`);
  }
});

// ── Yahooフリマ / ヤフオク貼り付け ─────────────────────────
// ═══════════════════════════════════════════════════════════════
//  Yahoo!フリマ（PayPayフリマ）貼り付け
//  paypay_fill.js は chrome.storage.local の "mercariData" を
//  自分で読む設計。ただし mercariData は「メルカリで取得」した
//  時点の生データなので、フォームでの編集や整形が反映されない。
//  → 注入直前に、現在のフォーム内容で mercariData を上書きする。
// ═══════════════════════════════════════════════════════════════
async function runPaypayFill(tab, item, stored, meta) {
  setStatus("⏳ Yahoo!フリマに貼り付け中...");

  // ★重要: ポップアップの入力欄が空でも、保存済みデータで補う
  //   （別タブでポップアップを開き直すと入力欄が空になる場合があるため）
  const saved = (await loadItem()) || {};
  const pick = (a, b, c) => {
    const v1 = String(a || "").trim(); if (v1) return v1;
    const v2 = String(b || "").trim(); if (v2) return v2;
    return String(c || "").trim();
  };

  const rawTitle = pick(item.title,       stored.title,       saved.title);
  const rawPrice = pick(item.price,       stored.price,       saved.price);
  const rawDesc  = pick(item.description, stored.description, saved.description);
  const rawCond  = pick(item.condition,   stored.condition,   saved.condition);

  // ★Yahoo!フリマで使えない表現（ノークレーム・ノーリターン等）は、一文ごと外して貼り付ける
  const paypayDesc = stripNoClaimPhrases(formatDescriptionForSite(
    formatDescriptionSmart(rawDesc, rawCond, meta.shipping, meta.inventoryMemo),
    "yahoo"
  ));

  const paypayItem = {
    ...saved,
    ...stored,
    title: formatTitleForSite(rawTitle, "yahoo"),
    price: String(rawPrice).replace(/[^\d]/g, ""),
    description: paypayDesc.text,
    condition:    rawCond,
    category:     stored.category     || saved.category     || item.category || "",
    categoryPath: stored.categoryPath || saved.categoryPath || stored.category || saved.category || "",
    brand:        stored.brand  || saved.brand  || "",
    images:       pickProductPhotos(
      (stored.images && stored.images.length ? stored.images : saved.images) || [],
      stored.sourceUrl || saved.sourceUrl
    )
  };

  // ★事前チェック: 商品名がどこにも無ければ注入せず即エラー
  if (!paypayItem.title) {
    setStatus(
      "⚠ 商品名が空のため貼り付けできません。\n\n" +
      "・メルカリの商品ページで「メルカリで取得」を実行する\n" +
      "・または管理番号で商品を呼び出してから実行してください\n\n" +
      "【診断情報】\n" +
      `入力欄: 「${item.title || "空"}」\n` +
      `保存データ: 「${saved.title || "空"}」\n` +
      "※両方とも空の場合、取得データが保存されていません。"
    );
    return;
  }

  await chrome.storage.local.set({
    paypayFillData:    paypayItem,   // ★管理アシスト用（優先して読まれる）
    mercariData:       paypayItem,   // Pro互換のフォールバック
    paypayFillResult:  "",
    paypayFillStarted: ""
  });

  // ★注入。失敗したら理由をそのまま表示する
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files:  ["paypay_fill.js"]
    });
  } catch (e) {
    setStatus(
      "⚠ Yahoo!フリマのページにスクリプトを注入できませんでした。\n\n" +
      "エラー: " + (e?.message || String(e)) + "\n\n" +
      "・ページを Cmd+R でリロードしてから、もう一度お試しください\n" +
      "・chrome://extensions で拡張機能を🔄再読み込みしてください"
    );
    return;
  }

  // ── 第1段階: 起動したかを3秒だけ待つ ──────────────────
  let started = false;
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 200));
    const res = await chrome.storage.local.get(["paypayFillStarted", "paypayFillResult"]);
    if (res.paypayFillStarted) { started = true; break; }
    if (res.paypayFillResult) { started = true; break; }
  }

  if (!started) {
    setStatus(
      "⚠ Yahoo!フリマのページでスクリプトが起動しませんでした。\n\n" +
      "次の順で試してください。\n" +
      "① Yahoo!フリマのページを Cmd+R でリロード\n" +
      "② chrome://extensions で拡張機能を🔄再読み込み\n" +
      "③ もう一度「Yahooに貼り付け」を押す\n\n" +
      `現在のタブ: ${(tab?.url || "不明").slice(0, 70)}`
    );
    return;
  }

  // ── 第2段階: 入力完了を待つ（画像アップロードがあるので最大40秒）──
  setStatus("⏳ Yahoo!フリマに入力中...（画像のアップロードに時間がかかります）");

  let result = null;
  for (let i = 0; i < 200; i++) {
    await new Promise(r => setTimeout(r, 200));
    const res = await chrome.storage.local.get(["paypayFillResult"]);
    const raw = res.paypayFillResult;
    if (raw !== "" && raw !== undefined && raw !== null) {
      if (typeof raw === "string") {
        try { result = JSON.parse(raw); } catch (e) { result = { raw }; }
      } else {
        result = raw;
      }
      break;
    }
  }

  if (!result) {
    setStatus(
      "⚠ 入力は始まりましたが、40秒以内に完了しませんでした。\n\n" +
      "画像の枚数が多いと時間がかかることがあります。\n" +
      "ページの入力状況を直接ご確認ください。"
    );
    return;
  }

  // ★スクリプト側が中断した場合は、その理由をそのまま表示する
  if (result.error) {
    setStatus(
      "⚠ Yahoo!フリマの貼り付けが中断されました。\n\n" +
      "理由: " + result.error
    );
    return;
  }

  const mark = (v) => (v ? "✅ OK" : "❌ NG");
  const lines = [
    "Yahoo!フリマ 貼り付け結果",
    `管理番号: ${item.manageId || "未設定"}`,
    `商品名: ${mark(result.titleOk)}`,
    `価格: ${mark(result.priceOk)}`,
    `説明文: ${mark(result.descOk)}`,
    `商品の状態: ${mark(result.conditionOk)}`,
    `ブランド: ${result.brandSkipped ? "－（メルカリにブランドなし）" : result.brandPending ? "⏳ ページを1回クリックすると自動で入ります" : mark(result.brandOk) + (result.brandText ? "（" + result.brandText + "）" : "")}`,
    `画像: ${mark(result.imageOk)}`,
    `カテゴリ: ${mark(result.categoryOk)}`,
    `ハッシュタグ: ${mark(result.hashtagOk)}${result.hashtagText ? "（" + result.hashtagText + "）" : ""}`,
    `発送までの日数: ${mark(result.shipDaysOk)}`
  ];
  if (paypayDesc.removed) {
    lines.push("※ Yahoo!フリマで使えない表現（ノークレーム・ノーリターン）は、自動で外しました");
  }

  if (Array.isArray(result.ngList) && result.ngList.length) {
    lines.push("", "未入力の項目:", ...result.ngList.map(x => `・${x}`));
  }
  if (!result.categoryOk || !result.shipDaysOk) {
    lines.push("", "※ ❌ の項目は手動で選んでください。");
  }

  setStatus(lines.join("\n"));
}

$("btnYahoo").addEventListener("click", async () => {
  try {
    const item   = collectFormItem((await loadItem()) || {});
    const stored = (await loadItem()) || {};
    const meta   = collectMeta();
    await saveItem(item);

    const tab    = await getActiveTab();
    const tabUrl = tab?.url || "";

    // ★ 開いているタブのURLで貼り付け先を自動判定する
    //    Yahoo!フリマ  → paypay_fill.js
    //    ヤフオク      → 従来処理（yahoo_desc_fill.js ほか）
    if (/paypayfleamarket/.test(tabUrl)) {
      await runPaypayFill(tab, item, stored, meta);
      return;
    }

    if (!/auctions\.yahoo\.co\.jp/.test(tabUrl)) {
      setStatus(
        "⚠ 貼り付け先のページを開いてから押してください。\n\n" +
        "・Yahoo!フリマ → paypayfleamarket.yahoo.co.jp/sell\n" +
        "・ヤフオク → auctions.yahoo.co.jp（出品フォーム）\n\n" +
        `現在のタブ: ${tabUrl.slice(0, 60) || "不明"}`
      );
      return;
    }

    const yahooItem = {
      ...item,
      images:   pickProductPhotos(stored.images || [], stored.sourceUrl),
      brand:    stored.brand    || "",
      category: stored.category || item.category || "",
      title: item.title || "",
      description: formatDescriptionForSite(
        formatDescriptionSmart(item.description, item.condition, meta.shipping, meta.inventoryMemo),
        "yahoo"
      )
    };

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

        // ★価格は yahoo_price_fill.js が最後にまとめて担当する。
        //   ここで入力するとフォーカスが価格欄に残り、後続の
        //   execCommand("delete") に巻き込まれて中身が消えるため削除した。
        try { document.activeElement?.blur?.(); } catch (_) {}

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

    // ═══════════════════════════════════════════════
    //  ★価格入力は必ず最後に行う
    //    画像・商品名の処理は document.execCommand("delete") を使う。
    //    execCommand はフォーカス中の要素に効くため、価格を先に入れると
    //    その削除命令に巻き込まれて価格欄が空になっていた（2026-07-18 判明）。
    // ═══════════════════════════════════════════════
    try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => { try { document.activeElement?.blur?.(); } catch (_) {} } }); } catch (_) {}
    await new Promise(r => setTimeout(r, 500));

    await chrome.storage.local.set({ yahooFillPrice: (yahooItem.price || "").replace(/[^\d]/g, ""), yahooFillPriceResult: "" });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["yahoo_price_fill.js"]
    });
    let priceOk = false;
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 200));
      const res = await chrome.storage.local.get(["yahooFillPriceResult"]);
      if (res.yahooFillPriceResult === "ok") { priceOk = true; break; }
      if (res.yahooFillPriceResult === "ng") { break; }
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
// 料金表の見かた
//   p: フリマ / g: 配送サービスのグループ / price: 料金（円）
//   from: true → 「〜」付き（いちばん小さいサイズの料金。大きいサイズは料金が上がる）
//   ref:  true → 最新の料金をまだ確認できていない「参考」の金額
//   maxCm: 3辺合計の上限（未指定は60cm） / minCm: 3辺合計の下限 / maxKg: 重さの上限
const SHIPPING_PLATFORMS = [
  { id: "mercari", label: "メルカリ",     color: "#ff3b47", letter: "M" },
  { id: "rakuma",  label: "ラクマ",       color: "#e0357a", letter: "R" },
  { id: "yahoo",   label: "Yahoo!フリマ", color: "#ff8a00", letter: "Y" },
];

const SHIPPING_TABLE = [
  // ── メルカリ：らくらくメルカリ便（ヤマト運輸）──
  { p: "mercari", g: "らくらくメルカリ便（ヤマト運輸）", name: "ネコポス", size: "3辺60cm・長辺34cm・厚さ3cm・1kgまで", price: 210, maxKg: 1 },
  { p: "mercari", g: "らくらくメルカリ便（ヤマト運輸）", name: "宅急便コンパクト", size: "専用BOX（厚さ5cmまで）", price: 450 },
  { p: "mercari", g: "らくらくメルカリ便（ヤマト運輸）", name: "宅急便 60", size: "3辺60cm以内・2kgまで", price: 750, maxCm: 60, maxKg: 2 },
  { p: "mercari", g: "らくらくメルカリ便（ヤマト運輸）", name: "宅急便 80", size: "3辺80cm以内・5kgまで", price: 850, maxCm: 80, maxKg: 5 },
  { p: "mercari", g: "らくらくメルカリ便（ヤマト運輸）", name: "宅急便 100", size: "3辺100cm以内・10kgまで", price: 1050, maxCm: 100, maxKg: 10 },
  { p: "mercari", g: "らくらくメルカリ便（ヤマト運輸）", name: "宅急便 120", size: "3辺120cm以内・15kgまで", price: 1200, maxCm: 120, maxKg: 15 },
  { p: "mercari", g: "らくらくメルカリ便（ヤマト運輸）", name: "宅急便 140", size: "3辺140cm以内・20kgまで", price: 1450, maxCm: 140, maxKg: 20 },
  { p: "mercari", g: "らくらくメルカリ便（ヤマト運輸）", name: "宅急便 160", size: "3辺160cm以内・25kgまで", price: 1700, maxCm: 160, maxKg: 25 },
  { p: "mercari", g: "らくらくメルカリ便（ヤマト運輸）", name: "宅急便 180", size: "3辺180cm以内・30kgまで・ヤマト営業所／集荷のみ", price: 2100, maxCm: 180, maxKg: 30 },
  { p: "mercari", g: "らくらくメルカリ便（ヤマト運輸）", name: "宅急便 200", size: "3辺200cm以内・30kgまで・ヤマト営業所／集荷のみ", price: 2500, maxCm: 200, maxKg: 30 },
  // ── メルカリ：ゆうゆうメルカリ便（日本郵便）──
  { p: "mercari", g: "ゆうゆうメルカリ便（日本郵便）", name: "ゆうパケットポストmini", size: "専用封筒・21×17cm以内・2kgまで", price: 160, maxKg: 2 },
  { p: "mercari", g: "ゆうゆうメルカリ便（日本郵便）", name: "ゆうパケットポスト", size: "専用箱／発送用シール・2kgまで", price: 215, maxKg: 2 },
  { p: "mercari", g: "ゆうゆうメルカリ便（日本郵便）", name: "ゆうパケット", size: "厚さ3cm・長辺34cm・1kgまで", price: 230, maxKg: 1 },
  { p: "mercari", g: "ゆうゆうメルカリ便（日本郵便）", name: "ゆうパケットプラス", size: "専用箱（17×24×7cm以内）・2kgまで", price: 455, maxCm: 48, maxKg: 2 },
  { p: "mercari", g: "ゆうゆうメルカリ便（日本郵便）", name: "ゆうパック 60", size: "3辺60cm以内・25kgまで", price: 750, maxCm: 60, maxKg: 25 },
  { p: "mercari", g: "ゆうゆうメルカリ便（日本郵便）", name: "ゆうパック 80", size: "3辺80cm以内・25kgまで", price: 870, maxCm: 80, maxKg: 25 },
  { p: "mercari", g: "ゆうゆうメルカリ便（日本郵便）", name: "ゆうパック 100", size: "3辺100cm以内・25kgまで", price: 1070, maxCm: 100, maxKg: 25 },
  { p: "mercari", g: "ゆうゆうメルカリ便（日本郵便）", name: "ゆうパック 120", size: "3辺120cm以内・25kgまで", price: 1200, maxCm: 120, maxKg: 25 },
  { p: "mercari", g: "ゆうゆうメルカリ便（日本郵便）", name: "ゆうパック 140", size: "3辺140cm以内・25kgまで", price: 1450, maxCm: 140, maxKg: 25 },
  { p: "mercari", g: "ゆうゆうメルカリ便（日本郵便）", name: "ゆうパック 160", size: "3辺160cm以内・25kgまで", price: 1700, maxCm: 160, maxKg: 25 },
  { p: "mercari", g: "ゆうゆうメルカリ便（日本郵便）", name: "ゆうパック 170", size: "3辺170cm以内・25kgまで", price: 1900, maxCm: 170, maxKg: 25 },
  // ── メルカリ：エコメルカリ便（置き配専用）──
  { p: "mercari", g: "エコメルカリ便（置き配専用）", name: "スマリボックス（〜100サイズ）", size: "対象エリアのスマリボックスのみ・10kgまで", price: 730, maxCm: 100, maxKg: 10 },
  { p: "mercari", g: "エコメルカリ便（置き配専用）", name: "自宅集荷（60〜160サイズ）", size: "置き配専用・20kgまで", price: 730, maxCm: 160, maxKg: 20 },
  // ── メルカリ：梱包・発送たのメル便（家具・家電など）──
  { p: "mercari", g: "梱包・発送たのメル便（自宅集荷）", name: "たのメル便 80", size: "3辺80cm以内・100kgまで", price: 1700, minCm: 80, maxCm: 80, maxKg: 100 },
  { p: "mercari", g: "梱包・発送たのメル便（自宅集荷）", name: "たのメル便 120", size: "3辺120cm以内・100kgまで", price: 2400, minCm: 80, maxCm: 120, maxKg: 100 },
  { p: "mercari", g: "梱包・発送たのメル便（自宅集荷）", name: "たのメル便 160", size: "3辺160cm以内・100kgまで", price: 3400, minCm: 80, maxCm: 160, maxKg: 100 },
  { p: "mercari", g: "梱包・発送たのメル便（自宅集荷）", name: "たのメル便 200", size: "3辺200cm以内・100kgまで", price: 5000, minCm: 80, maxCm: 200, maxKg: 100 },
  { p: "mercari", g: "梱包・発送たのメル便（自宅集荷）", name: "たのメル便 250", size: "3辺250cm以内・100kgまで", price: 8600, minCm: 80, maxCm: 250, maxKg: 100 },
  { p: "mercari", g: "梱包・発送たのメル便（自宅集荷）", name: "たのメル便 300", size: "3辺300cm以内・100kgまで", price: 12000, minCm: 80, maxCm: 300, maxKg: 100 },
  { p: "mercari", g: "梱包・発送たのメル便（自宅集荷）", name: "たのメル便 350", size: "3辺350cm以内・100kgまで", price: 18500, minCm: 80, maxCm: 350, maxKg: 100 },
  { p: "mercari", g: "梱包・発送たのメル便（自宅集荷）", name: "たのメル便 400", size: "3辺400cm以内・100kgまで", price: 25400, minCm: 80, maxCm: 400, maxKg: 100 },
  { p: "mercari", g: "梱包・発送たのメル便（自宅集荷）", name: "たのメル便 450", size: "3辺450cm以内・100kgまで", price: 33000, minCm: 80, maxCm: 450, maxKg: 100 },

  // ── ラクマ（※サイズ別の料金は、最新の料金表を確認でき次第「参考」を外します）──
  { p: "rakuma", g: "かんたんラクマパック（日本郵便）", name: "ゆうパケットポストmini", size: "専用封筒（20円）・アプリのみ・2kgまで",        price: 150, maxKg: 2 },
  { p: "rakuma", g: "かんたんラクマパック（日本郵便）", name: "ゆうパケットポスト",     size: "専用シール（5円〜）・専用箱（65円）・アプリのみ", price: 175, maxKg: 2 },
  { p: "rakuma", g: "かんたんラクマパック（日本郵便）", name: "ゆうパケット",           size: "厚さ3cm・1kgまで",                             price: 200, maxKg: 1 },
  { p: "rakuma", g: "かんたんラクマパック（日本郵便）", name: "ゆうパケットプラス",     size: "専用箱（65円）・商品価格410円以上",            price: 380, maxCm: 48, maxKg: 2 },
  { p: "rakuma", g: "かんたんラクマパック（日本郵便）", name: "ゆうパック 60",          size: "3辺60cm以内・商品価格750円以上",               price: 700,  maxCm: 60,  maxKg: 25 },
  { p: "rakuma", g: "かんたんラクマパック（日本郵便）", name: "ゆうパック 80",          size: "3辺80cm以内・商品価格750円以上",               price: 800,  maxCm: 80,  maxKg: 25, ref: true },
  { p: "rakuma", g: "かんたんラクマパック（日本郵便）", name: "ゆうパック 100",         size: "3辺100cm以内・商品価格750円以上",              price: 1000, maxCm: 100, maxKg: 25, ref: true },
  { p: "rakuma", g: "かんたんラクマパック（ヤマト運輸）", name: "ネコポス",         size: "厚さ3cm・1kgまで",                  price: 200, maxKg: 1 },
  { p: "rakuma", g: "かんたんラクマパック（ヤマト運輸）", name: "宅急便コンパクト", size: "専用資材（70円）・商品価格470円以上", price: 430 },
  { p: "rakuma", g: "かんたんラクマパック（ヤマト運輸）", name: "宅急便 60",        size: "3辺60cm以内・2kgまで・商品価格750円以上",   price: 650,  maxCm: 60,  maxKg: 2 },
  { p: "rakuma", g: "かんたんラクマパック（ヤマト運輸）", name: "宅急便 80",        size: "3辺80cm以内・5kgまで・商品価格750円以上",   price: 800,  maxCm: 80,  maxKg: 5,  ref: true },
  { p: "rakuma", g: "かんたんラクマパック（ヤマト運輸）", name: "宅急便 100",       size: "3辺100cm以内・10kgまで・商品価格750円以上", price: 1000, maxCm: 100, maxKg: 10, ref: true },

  // ── Yahoo!フリマ：おてがる配送（ヤマト運輸）──
  { p: "yahoo", g: "おてがる配送（ヤマト運輸）", name: "ネコポス", size: "3辺60cm・長辺34cm・厚さ3cm・1kgまで", price: 210, maxKg: 1 },
  { p: "yahoo", g: "おてがる配送（ヤマト運輸）", name: "宅急便コンパクト（EAZY）", size: "専用BOX（箱代70円〜）・厚さ5cmまで", price: 490 },
  { p: "yahoo", g: "おてがる配送（ヤマト運輸）", name: "宅急便（EAZY） 60", size: "3辺60cm以内・2kgまで", price: 750, maxCm: 60, maxKg: 2 },
  { p: "yahoo", g: "おてがる配送（ヤマト運輸）", name: "宅急便（EAZY） 80", size: "3辺80cm以内・5kgまで", price: 850, maxCm: 80, maxKg: 5 },
  { p: "yahoo", g: "おてがる配送（ヤマト運輸）", name: "宅急便（EAZY） 100", size: "3辺100cm以内・10kgまで", price: 1050, maxCm: 100, maxKg: 10 },
  { p: "yahoo", g: "おてがる配送（ヤマト運輸）", name: "宅急便（EAZY） 120", size: "3辺120cm以内・15kgまで", price: 1200, maxCm: 120, maxKg: 15 },
  { p: "yahoo", g: "おてがる配送（ヤマト運輸）", name: "宅急便（EAZY） 140", size: "3辺140cm以内・20kgまで", price: 1400, maxCm: 140, maxKg: 20 },
  { p: "yahoo", g: "おてがる配送（ヤマト運輸）", name: "宅急便（EAZY） 160", size: "3辺160cm以内・25kgまで", price: 1700, maxCm: 160, maxKg: 25 },
  { p: "yahoo", g: "おてがる配送（ヤマト運輸）", name: "宅急便（EAZY） 180", size: "3辺180cm以内・30kgまで", price: 2100, maxCm: 180, maxKg: 30 },
  { p: "yahoo", g: "おてがる配送（ヤマト運輸）", name: "宅急便（EAZY） 200", size: "3辺200cm以内・30kgまで", price: 2500, maxCm: 200, maxKg: 30 },
  // ── Yahoo!フリマ：おてがる配送（日本郵便）──
  { p: "yahoo", g: "おてがる配送（日本郵便）", name: "ゆうパケットポストmini", size: "専用封筒（20円〜）・アプリから発送・2kgまで", price: 160, maxKg: 2 },
  { p: "yahoo", g: "おてがる配送（日本郵便）", name: "ゆうパケットポスト", size: "専用箱（65円）／シール（5円）・アプリから発送・2kgまで", price: 210, maxKg: 2 },
  { p: "yahoo", g: "おてがる配送（日本郵便）", name: "ゆうパケット", size: "厚さ3cm・1kgまで", price: 215, maxKg: 1 },
  { p: "yahoo", g: "おてがる配送（日本郵便）", name: "ゆうパケットプラス", size: "専用箱（65円）・24×17cm以内・厚さ7cm・2kgまで", price: 410, maxCm: 48, maxKg: 2 },
  { p: "yahoo", g: "おてがる配送（日本郵便）", name: "ゆうパック 60", size: "3辺60cm以内・25kgまで", price: 750, maxCm: 60, maxKg: 25 },
  { p: "yahoo", g: "おてがる配送（日本郵便）", name: "ゆうパック 80", size: "3辺80cm以内・25kgまで", price: 850, maxCm: 80, maxKg: 25 },
  { p: "yahoo", g: "おてがる配送（日本郵便）", name: "ゆうパック 100", size: "3辺100cm以内・25kgまで", price: 1050, maxCm: 100, maxKg: 25 },
  { p: "yahoo", g: "おてがる配送（日本郵便）", name: "ゆうパック 120", size: "3辺120cm以内・25kgまで", price: 1200, maxCm: 120, maxKg: 25 },
  { p: "yahoo", g: "おてがる配送（日本郵便）", name: "ゆうパック 140", size: "3辺140cm以内・25kgまで", price: 1400, maxCm: 140, maxKg: 25 },
  { p: "yahoo", g: "おてがる配送（日本郵便）", name: "ゆうパック 160", size: "3辺160cm以内・25kgまで", price: 1700, maxCm: 160, maxKg: 25 },
  { p: "yahoo", g: "おてがる配送（日本郵便）", name: "ゆうパック 170", size: "3辺170cm以内・25kgまで", price: 1900, maxCm: 170, maxKg: 25 },
  // ── Yahoo!フリマ：おまかせ配送（家具・家電など）──
  { p: "yahoo", g: "おまかせ配送（アプリ限定・自宅集荷）", name: "家具・家電 80", size: "3辺80cm以内・150kgまで（100kg超は別途作業料金）", price: 1700, minCm: 80, maxCm: 80, maxKg: 150 },
  { p: "yahoo", g: "おまかせ配送（アプリ限定・自宅集荷）", name: "家具・家電 120", size: "3辺120cm以内・150kgまで（100kg超は別途作業料金）", price: 2400, minCm: 80, maxCm: 120, maxKg: 150 },
  { p: "yahoo", g: "おまかせ配送（アプリ限定・自宅集荷）", name: "家具・家電 160", size: "3辺160cm以内・150kgまで（100kg超は別途作業料金）", price: 3400, minCm: 80, maxCm: 160, maxKg: 150 },
  { p: "yahoo", g: "おまかせ配送（アプリ限定・自宅集荷）", name: "家具・家電 200", size: "3辺200cm以内・150kgまで（100kg超は別途作業料金）", price: 5000, minCm: 80, maxCm: 200, maxKg: 150 },
  { p: "yahoo", g: "おまかせ配送（アプリ限定・自宅集荷）", name: "家具・家電 250", size: "3辺250cm以内・150kgまで（100kg超は別途作業料金）", price: 8600, minCm: 80, maxCm: 250, maxKg: 150 },
  { p: "yahoo", g: "おまかせ配送（アプリ限定・自宅集荷）", name: "家具・家電 300", size: "3辺300cm以内・150kgまで（100kg超は別途作業料金）", price: 12000, minCm: 80, maxCm: 300, maxKg: 150 },
  { p: "yahoo", g: "おまかせ配送（アプリ限定・自宅集荷）", name: "家具・家電 350", size: "3辺350cm以内・150kgまで（100kg超は別途作業料金）", price: 18500, minCm: 80, maxCm: 350, maxKg: 150 },
  { p: "yahoo", g: "おまかせ配送（アプリ限定・自宅集荷）", name: "家具・家電 400", size: "3辺400cm以内・150kgまで（100kg超は別途作業料金）", price: 25400, minCm: 80, maxCm: 400, maxKg: 150 },
  { p: "yahoo", g: "おまかせ配送（アプリ限定・自宅集荷）", name: "家具・家電 450", size: "3辺450cm以内・150kgまで（100kg超は別途作業料金）", price: 33000, minCm: 80, maxCm: 450, maxKg: 150 },
];

// ★v1.5.4: 専用資材・薄型の配送方法は、入れ物の大きさで入るかどうかを判定する
//   sum   … 入れ物の3辺合計の目安（cm）。これより大きい荷物は入らない
//   thick … 厚さの上限（cm）。厚さを入力したときだけ判定する
const SHIPPING_BOX = {
  "ネコポス":               { sum: 57, thick: 3, label: "31.2×22.8cm・厚さ3cm" },
  "宅急便コンパクト":       { sum: 50, thick: 5, label: "専用BOX 25×20×5cm" },
  "宅急便コンパクト（EAZY）": { sum: 50, thick: 5, label: "専用BOX 25×20×5cm" },
  "ゆうパケットポストmini": { sum: 41, thick: 3, label: "専用封筒 21×17cm" },
  "ゆうパケットポスト":     { sum: 59, thick: 3, label: "専用箱 32.7×22.8×3cm" },
  "ゆうパケット":           { sum: 60, thick: 3, label: "長辺34cm・厚さ3cm" },
  "ゆうパケットプラス":     { sum: 48, thick: 7, label: "専用箱 24×17×7cm" },
};
SHIPPING_TABLE.forEach((r) => { if (SHIPPING_BOX[r.name]) r.box = SHIPPING_BOX[r.name]; });

// 重さの入力を kg にそろえる。100以上は「g で入れた」とみなして kg に直す（例: 620 → 0.62kg）
function normalizeShipKg(value) {
  const n = toNumber(value);
  if (n >= 100) return { kg: n / 1000, fromGram: true };
  return { kg: n, fromGram: false };
}

// 1つの配送方法について、入らない理由（入るなら ""）と注意（厚さ未入力など）を返す
function judgeShippingRow(row, cm, kg, thick) {
  const reasons = [];
  if (row.minCm && cm < row.minCm) reasons.push(`3辺合計${row.minCm}cm以上が対象`);
  if (row.box && cm > row.box.sum) reasons.push(`${row.box.label}に入りません（3辺合計 約${row.box.sum}cmまで）`);
  else if (cm > (row.maxCm || 60)) reasons.push(`3辺合計${row.maxCm || 60}cmまで`);
  if (row.box && row.box.thick && thick > 0 && thick > row.box.thick) reasons.push(`厚さ${row.box.thick}cmまで`);
  if (kg > 0 && row.maxKg && kg > row.maxKg) reasons.push(`${row.maxKg}kgまで`);
  let warn = "";
  if (!reasons.length && row.box && row.box.thick && !(thick > 0)) warn = `厚さ${row.box.thick}cm以内か確認してください`;
  return { ng: reasons.join("・"), warn };
}

// 3辺合計(cm)・重さ(kg)・厚さ(cm) から、全部の配送方法を「入る／入らない」付きで返す
//   「宅急便 60 / 80 / 100…」のようなサイズ別の行は、入る一番小さいサイズだけ残す
//   （どのサイズにも入らないときは、一番大きいサイズを「入らない」として残す）
function judgeAllShipping(cm3side, weightKg, thickCm) {
  const cm = toNumber(cm3side);
  const kg = toNumber(weightKg);
  const thick = toNumber(thickCm);
  if (cm <= 0) return [];
  const tiers = new Map();
  const out = [];
  SHIPPING_TABLE.forEach((row) => {
    const j = { row, ...judgeShippingRow(row, cm, kg, thick) };
    const m = row.name.match(/^(.*?)\s+\d+$/);
    if (!m) { out.push(j); return; }
    const key = row.p + "|" + row.g + "|" + m[1];
    if (!tiers.has(key)) tiers.set(key, []);
    tiers.get(key).push(j);
  });
  // ★v1.5.4: 入る一番小さいサイズに加えて「1つ上のサイズ」も出す（緩衝材を多めに使う・箱が大きくなる場合用）
  tiers.forEach((list) => {
    const sorted = list.slice().sort((a, b) => (a.row.maxCm || 60) - (b.row.maxCm || 60));
    const i = sorted.findIndex((j) => !j.ng);
    if (i < 0) { out.push(sorted[sorted.length - 1]); return; }
    out.push(sorted[i]);
    const up = sorted[i + 1];
    if (up && !up.ng) out.push({ ...up, nextUp: true });
  });
  return out.sort((a, b) => SHIPPING_TABLE.indexOf(a.row) - SHIPPING_TABLE.indexOf(b.row));
}

// 入る配送方法だけを返す（従来どおりの呼び出し用）
function calcShippingBySize(cm3side, weightKg, thickCm) {
  return judgeAllShipping(cm3side, weightKg, thickCm).filter((j) => !j.ng && !j.nextUp).map((j) => j.row);
}

// ★追加: 3辺合計(cm)・重さ・厚さ を入力するたびに保存する。
//   これで、ポップアップを閉じて別のサイト（ラクマ／Yahoo!フリマ／ヤフオク）のタブで
//   もう一度開いても、直前に入力した値がそのまま残る（毎回入力し直す必要がなくなる）
(function bindShipCalcAutoSave() {
  const cmEl = $("shippingSize");
  const kgEl = $("shippingWeight");
  const thEl = $("shippingThick");
  const lEl = $("shipL"), wEl = $("shipW"), hEl = $("shipH");
  if (!cmEl || !kgEl) return;
  const save = () => {
    saveShipCalc({
      cm: cmEl.value, kg: kgEl.value, thick: thEl ? thEl.value : "",
      l: lEl ? lEl.value : "", w: wEl ? wEl.value : "", h: hEl ? hEl.value : ""
    });
  };
  // ★v1.5.4: 縦・横・高さを3つとも入れたら、3辺合計と厚さ（一番短い辺）を自動で入れる
  const fromDims = () => {
    const d = [lEl, wEl, hEl].map((el) => (el ? toNumber(el.value) : 0));
    if (d.every((v) => v > 0)) {
      const sum = Math.round(d.reduce((a, b) => a + b, 0) * 10) / 10;
      cmEl.value = String(sum);
      if (thEl) thEl.value = String(Math.min(...d));
    }
    save();
  };
  cmEl.addEventListener("input", save);
  kgEl.addEventListener("input", save);
  if (thEl) thEl.addEventListener("input", save);
  [lEl, wEl, hEl].forEach((el) => { if (el) el.addEventListener("input", fromDims); });
})();

$("btnCalcShipping").addEventListener("click", () => {
  const cm = $("shippingSize").value.trim();
  const kgIn = normalizeShipKg($("shippingWeight").value.trim() || "0");
  const kg = kgIn.kg;
  const thick = $("shippingThick") ? $("shippingThick").value.trim() : "";
  if (!cm) { setStatus("3辺合計(cm)を入力してください。"); return; }

  const judged  = judgeAllShipping(cm, kg, thick);
  // 自動選択・最安の対象は「入る一番小さいサイズ」まで（1つ上のサイズは自分で選ぶときだけ）
  const results = judged.filter((j) => !j.ng && !j.nextUp).map((j) => j.row);
  // 自動で選ぶときは「厚さ未確認」の薄型便を後回しにする（入るか分からないため）
  const warnSet = new Set(judged.filter((j) => !j.ng && j.warn).map((j) => j.row));
  const autoPool = (list) => {
    const sure = list.filter((r) => !warnSet.has(r));
    const base = sure.length ? sure : list;
    const fixed = base.filter((r) => !r.from);
    return fixed.length ? fixed : base;
  };
  const area    = $("shippingResultArea");

  if (!judged.length) {
    area.innerHTML = `<div style="padding:8px;font-size:12px;color:#b45309;">⚠ ${cm}cm に対応する配送サービスが見つかりませんでした。</div>`;
    setStatus(`⚠ ${cm}cm の配送サービスが見つかりませんでした。`);
    return;
  }

  // 「出品管理」の出品先に合わせて、最初に開くフリマを決める
  const selected = ($("marketplace") && $("marketplace").value) || "";
  let active = "mercari";
  let appliedIdx = -1;   // 「送料」に反映した行（SHIPPING_TABLE の番号）
  if (!/ヤフオク|オークション|auction/i.test(selected)) {
    if (/ラクマ|rakuma/i.test(selected)) active = "rakuma";
    else if (/yahoo|paypay|ヤフー/i.test(selected)) active = "yahoo";
  }

  // ラクマは 200cm（ゆうパックは170cm）まで対応しているが、101cm以上の料金表はまだ入っていない
  const cmNum = toNumber(cm);
  const rakumaGap = cmNum > 100 && cmNum <= 200;

  const cheapestOf = (platId) => {
    const list = autoPool(results.filter((r) => r.p === platId));
    if (!list.length) return null;
    return list.reduce((m, r) => (r.price < m.price ? r : m), list[0]);
  };

  const refTag = `<span style="margin-left:6px;font-size:10px;padding:1px 6px;border-radius:999px;background:rgba(251,191,36,0.2);color:#fbbf24;">参考</span>`;
  const groupStyle = "padding:10px 4px 4px;font-size:12px;font-weight:700;color:#93c5fd;";

  const drawDetail = (platId) => {
    const items = judged.filter((j) => j.row.p === platId);
    const okCount = items.filter((j) => !j.ng).length;
    let head = "";
    if (!okCount) {
      head = (platId === "rakuma" && rakumaGap)
        ? `<div style="padding:10px 4px;font-size:12px;color:#fbbf24;line-height:1.7;">ラクマは、この大きさ（宅急便は200cm、ゆうパックは170cmまで）にも対応していますが、料金表がまだ入っていません。ラクマの画面で確認してください。</div>`
        : `<div style="padding:10px 4px;font-size:12px;color:#fbbf24;">この大きさ・重さに合う配送方法が見つかりませんでした。</div>`;
    }
    const groups = [];
    items.forEach((j) => { if (!groups.includes(j.row.g)) groups.push(j.row.g); });
    return head + groups.map((g) => {
      const list = items.filter((j) => j.row.g === g)
        .sort((a, b) => (a.ng ? 1 : 0) - (b.ng ? 1 : 0) || a.row.price - b.row.price);
      const upTag = `<span style="margin-left:6px;font-size:10px;padding:1px 6px;border-radius:999px;background:rgba(147,197,253,0.2);color:#93c5fd;">1つ上のサイズ</span>`;
      const html = list.map((j) => {
        const r = j.row;
        const idx = SHIPPING_TABLE.indexOf(r);
        if (j.ng) {
          return `
    <div class="shipping-row shipping-ng" title="この大きさ・重さでは選べません">
      <div>
        <div class="shipping-name">🚫 ${r.name}${r.ref ? refTag : ""}</div>
        <div class="shipping-size">${r.size}</div>
        <div class="shipping-ng-reason">入らない：${j.ng}</div>
      </div>
      <div class="shipping-price">¥${r.price.toLocaleString()}${r.from ? "〜" : ""}</div>
    </div>`;
        }
        const done = idx === appliedIdx;
        const rowStyle = "cursor:pointer;" + (done ? "outline:2px solid #34d399;outline-offset:-2px;border-radius:10px;" : "");
        return `
    <div class="shipping-row" data-ship="${idx}"${j.warn ? ' data-warn="1"' : ""}${j.nextUp ? ' data-next="1"' : ""} style="${rowStyle}" title="クリックすると「送料」に反映します">
      <div>
        <div class="shipping-name">${done ? "✅ " : "○ "}${r.name}${r.ref ? refTag : ""}${j.nextUp ? upTag : ""}</div>
        <div class="shipping-size">${r.size}</div>
        ${j.nextUp ? `<div class="shipping-up">緩衝材を多めに使う・箱が大きくなる場合に</div>` : ""}
        ${j.warn ? `<div class="shipping-warn">⚠ ${j.warn}</div>` : ""}
      </div>
      <div class="shipping-price">¥${r.price.toLocaleString()}${r.from ? "〜" : ""}</div>
    </div>`;
      }).join("");
      return `<div style="${groupStyle}">${g}</div>${html}`;
    }).join("");
  };

  const draw = () => {
    // フリマごとの切り替えボタン（アイコン＋名前＋最安）。ボタン用のCSSの影響を避けるため div を使う
    const tabs = SHIPPING_PLATFORMS.map((pl) => {
      const c  = cheapestOf(pl.id);
      const on = pl.id === active;
      return `<div data-plat="${pl.id}" role="button" tabindex="0" style="flex:1;min-width:0;cursor:pointer;text-align:center;padding:8px 4px;border-radius:12px;border:2px solid ${on ? pl.color : "rgba(148,163,184,0.35)"};background:${on ? pl.color + "33" : "rgba(15,23,42,0.35)"};color:#e5e7eb;user-select:none;">
        <div style="width:28px;height:28px;margin:0 auto 4px;border-radius:8px;background:${pl.color};color:#fff;font-weight:800;font-size:15px;line-height:28px;">${pl.letter}</div>
        <div style="font-size:12px;font-weight:700;">${pl.label}</div>
        <div style="font-size:11px;color:#cbd5e1;">${c ? "最安 ¥" + c.price.toLocaleString() + (c.from ? "〜" : "") : (pl.id === "rakuma" && rakumaGap ? "料金表なし" : "対応なし")}</div>
      </div>`;
    }).join("");

    const cond = `<div style="padding:2px 4px 0;font-size:11px;color:#94a3b8;">条件：3辺合計 ${cm}cm・重さ ${kg > 0 ? kg + "kg" : "未入力"}${kgIn.fromGram ? "（g とみなして換算）" : ""}・厚さ ${toNumber(thick) > 0 ? thick + "cm" : "未入力"}</div>`;
    const foot = `<div style="padding:6px 4px 0;font-size:11px;color:#94a3b8;">※「〜」は一番小さいサイズの料金です（大きいサイズは高くなります）。「参考」は最新の料金を確認できていない金額です。料金は改定されることがあるため、最新は各アプリの画面で確認してください。</div>`;

    const hint = `<div style="padding:2px 4px 0;font-size:11px;color:#94a3b8;">👆 「○」の配送方法をクリックすると、上の「送料（円）」に入ります（🚫 は大きさ・重さが合わないため選べません）</div>`;
    let appliedBar = "";
    if (appliedIdx >= 0) {
      const ar = SHIPPING_TABLE[appliedIdx];
      const plat = SHIPPING_PLATFORMS.find((p) => p.id === ar.p);
      const notes = [];
      if (ar.from) notes.push("一番小さいサイズの料金です");
      if (ar.ref)  notes.push("参考の金額です");
      appliedBar = `<div style="margin:8px 0 0;padding:8px 10px;border-radius:10px;background:rgba(52,211,153,0.15);border:1px solid rgba(52,211,153,0.5);color:#a7f3d0;font-size:12px;line-height:1.6;">✅ 「送料」に ¥${ar.price.toLocaleString()} を入れました<br>（${plat ? plat.label : ""}／${ar.name}）${notes.length ? "<br>※ " + notes.join("・") : ""}</div>`;
    }

    area.innerHTML = `<div style="display:flex;gap:8px;margin:8px 0;">${tabs}</div>${appliedBar}${cond}${hint}<div class="shipping-result">${drawDetail(active)}</div>${foot}`;
  };

  // 送料の行をクリックしたら、「送料（円）」に入れて利益も再計算する
  const applyShipping = (row) => {
    const el = $("shipping");
    if (!el) return;
    el.value = String(row.price);
    el.dispatchEvent(new Event("input",  { bubbles: true }));   // 利益の再計算
    el.dispatchEvent(new Event("change", { bubbles: true }));
    appliedIdx = SHIPPING_TABLE.indexOf(row);
    setStatus(`📮 送料に ¥${row.price.toLocaleString()} を入れました\n（${row.g}／${row.name}）`);
  };

  // ボタンを押したら、そのフリマの一覧に切り替える
  area.onclick = (ev) => {
    const tgt = ev.target;
    if (!tgt || !tgt.closest) return;
    const rowEl = tgt.closest("[data-ship]");
    if (rowEl) {
      const row = SHIPPING_TABLE[Number(rowEl.dataset.ship)];
      if (row) { applyShipping(row); draw(); }
      return;
    }
    const t = tgt.closest("[data-plat]");
    if (!t) return;
    active = t.dataset.plat;
    // ★v1.5.4: フリマのボタンを押したら、そのフリマで「入る」配送方法のうち最安を「送料（円）」に入れる
    //   （「〜」付きの一番小さいサイズの料金より、確定している料金を優先）
    {
      const pool = autoPool(results.filter((r) => r.p === active));
      const best = pool.length ? pool.reduce((m, r) => (r.price < m.price ? r : m), pool[0]) : null;
      if (best) applyShipping(best);
    }
    draw();
  };

  draw();

  const lines = SHIPPING_PLATFORMS.map((pl) => {
    const c = cheapestOf(pl.id);
    return c ? `${pl.label}: ${c.name} ¥${c.price}${c.from ? "〜" : ""}` : `${pl.label}: ${pl.id === "rakuma" && rakumaGap ? "料金表なし" : "対応なし"}`;
  });
  setStatus(`📮 ${cm}cm${kg > 0 ? "・" + kg + "kg" : ""} の送料目安（各フリマの最安）${kgIn.fromGram ? "\n※ 重さは g とみなして kg に換算しました" : ""}\n${lines.join("\n")}\n（一覧から配送方法を選べます）`);
});

// ═══════════════════════════════════════════════════════════════
//  出品日：カレンダーを開きやすくする
//    ・入力欄のどこを押してもカレンダーを開く
//    ・入力欄の右側に大きな 📅 ボタンを表示する
// ═══════════════════════════════════════════════════════════════
(function setupListedDatePicker() {
  const input = $("listedDate");
  if (!input || input.dataset.pickerReady === "1") return;
  input.dataset.pickerReady = "1";

  const openPicker = () => {
    try {
      if (typeof input.showPicker === "function") input.showPicker();
      else input.focus();
    } catch (e) {
      input.focus();
    }
  };

  // 入力欄のどこを押しても開く
  input.style.cursor = "pointer";
  input.addEventListener("click", openPicker);

  // 📅 ボタン（レイアウトを崩さないよう、入力欄の上に重ねて表示する）
  const parent = input.parentElement;
  if (!parent) return;
  if (getComputedStyle(parent).position === "static") parent.style.position = "relative";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "📅";
  btn.title = "カレンダーを開く";
  btn.setAttribute("aria-label", "カレンダーを開く");
  btn.style.cssText =
    "position:absolute;z-index:5;width:34px;height:34px;padding:0;margin:0;" +
    "border:1px solid rgba(147,197,253,0.6);border-radius:9px;" +
    "background:rgba(59,130,246,0.30);color:#fff;font-size:17px;line-height:32px;" +
    "text-align:center;cursor:pointer;box-shadow:none;min-width:0;min-height:0;";
  btn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    openPicker();
  });
  parent.appendChild(btn);
  input.style.paddingRight = "46px";

  // 入力欄の右端に合わせて位置を決める
  const place = () => {
    btn.style.left = (input.offsetLeft + input.offsetWidth - 34 - 8) + "px";
    btn.style.top  = (input.offsetTop + Math.max(0, (input.offsetHeight - 34) / 2)) + "px";
  };
  place();
  setTimeout(place, 300);
  window.addEventListener("resize", place);
})();

// ═══════════════════════════════════════════════════════════════
//  画面をコンパクトにする
//    1. 各カードを「たたむ／ひらく」（状態は保存される）
//    2. 「基本操作」（取得・貼り付け）を画面の上に固定する（M・R・Y のアイコン付き）
//    3. 一番上（トライアル帯・購入・ライセンス認証）を小さくまとめる
//  ※ ボタンや入力欄は作り直さず、今ある要素を移動・装飾するだけ（ID・処理はそのまま）
// ═══════════════════════════════════════════════════════════════
(function setupCompactUI() {
  const UI_KEY = "fx_ui_open_v1";
  // 最初は閉じておくカード（見出しの文字に含まれる語で判定）
  const CLOSED_BY_DEFAULT = ["価格・利益管理", "送料計算", "出品管理", "サイト別管理", "売れた時チェック"];

  const css = document.createElement("style");
  css.id = "fx-ui-style";
  css.textContent = `
    /* 1. たたむ／ひらく */
    .fx-card-head{display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;margin-bottom:9px;}
    .fx-card-head .badge{margin-bottom:0;}
    .fx-card-head .fx-summary{display:none;margin-left:auto;font-size:11px;color:var(--subtext);white-space:nowrap;}
    .fx-card-head .fx-chevron{margin-left:auto;font-size:12px;opacity:.75;transition:transform .15s;}
    .fx-collapsed .fx-summary{display:inline;}
    .fx-collapsed .fx-summary + .fx-chevron{margin-left:8px;}
    .fx-collapsed .fx-chevron{transform:rotate(-90deg);}
    .fx-collapsed .fx-card-body{display:none;}
    .fx-collapsed .fx-card-head{margin-bottom:0;}
    .fx-lic-title{font-size:12px;font-weight:700;color:var(--text);}
    /* 2. 基本操作を上に固定 */
    .fx-sticky{position:sticky;top:0;z-index:60;background:rgba(13,20,37,0.94) !important;
      -webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);}
    .fx-main-head{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:8px;}
    .fx-main-head .badge{margin-bottom:0;}
    .fx-main-tools{display:flex;gap:6px;}
    button.fx-mini{width:auto;min-width:0;padding:5px 9px;font-size:11px;border-radius:10px;white-space:nowrap;}
    .fx-sticky .grid{grid-template-columns:repeat(3,1fr);gap:6px;}
    .fx-sticky .grid button{padding:9px 4px;font-size:11.5px;white-space:nowrap;display:flex;align-items:center;justify-content:center;}
    .fx-ico{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:5px;
      font-size:11px;font-weight:800;color:#fff;margin-right:5px;flex:0 0 auto;}
    .fx-status-line{margin-top:7px;font-size:11px;color:var(--subtext);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    /* 3. 一番上を小さく */
    .fx-h1{font-size:15px !important;margin:0 0 8px !important;}
    .fx-top-row{display:flex;gap:8px;align-items:stretch;}
    .fx-top-row #trialBanner{flex:1 1 auto;min-width:0;}
    .fx-top-row #buyBanner{flex:0 0 auto;padding:6px 8px !important;}
    .fx-top-row #buyBanner > div{display:none;}
    .fx-top-row #buyBanner a{padding:7px 12px !important;font-size:11px;white-space:nowrap;}
  `;
  document.head.appendChild(css);

  const saved = {};
  const sections = [];   // { key, setOpen }

  // container の直下にある headEl を見出しにして、残りを「たたむ」中身にする
  const wrapCollapsible = (container, headEl, key, defaultOpen) => {
    const head = document.createElement("div");
    head.className = "fx-card-head";
    container.insertBefore(head, headEl);
    head.appendChild(headEl);
    const summary = document.createElement("span");
    summary.className = "fx-summary";
    head.appendChild(summary);
    const chev = document.createElement("span");
    chev.className = "fx-chevron";
    chev.textContent = "▾";
    head.appendChild(chev);
    const body = document.createElement("div");
    body.className = "fx-card-body";
    while (head.nextSibling) body.appendChild(head.nextSibling);
    container.appendChild(body);

    const setOpen = (open, persist) => {
      container.classList.toggle("fx-collapsed", !open);
      head.setAttribute("aria-expanded", String(open));
      // 開いたときに、位置を計算して置いている部品（📅ボタンなど）の位置を合わせ直す
      if (open) setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
      if (persist) {
        saved[key] = open;
        try { chrome.storage.local.set({ [UI_KEY]: saved }); } catch (e) {}
      }
    };
    head.addEventListener("click", () => setOpen(container.classList.contains("fx-collapsed"), true));
    setOpen(defaultOpen, false);
    const sec = { key, summary, setOpen };
    sections.push(sec);
    return sec;
  };

  // 別の要素の文字を、たたんだときの見出し横に表示する（例: 予想利益）
  const mirror = (sec, sourceId, prefix) => {
    const src = document.getElementById(sourceId);
    if (!sec || !src) return;
    const update = () => { sec.summary.textContent = prefix + src.textContent.trim(); };
    update();
    new MutationObserver(update).observe(src, { childList: true, characterData: true, subtree: true });
  };

  // ── 2. 基本操作（上に固定）──
  const setupMainActions = (card, badge) => {
    card.classList.add("fx-sticky");
    const head = document.createElement("div");
    head.className = "fx-main-head";
    card.insertBefore(head, badge);
    head.appendChild(badge);
    const tools = document.createElement("div");
    tools.className = "fx-main-tools";
    head.appendChild(tools);

    // 「データ再読込」ボタンは画面から隠す（保存データは、開くたびに自動で読み込まれるため不要。処理は残してある）
    const reload = document.getElementById("btnReload");
    if (reload) reload.style.display = "none";

    const howto = card.querySelector(".howto");
    if (howto) {
      howto.style.display = "none";
      const help = document.createElement("button");
      help.type = "button";
      help.className = "fx-mini btn-gray";
      help.textContent = "？使い方";
      help.addEventListener("click", () => {
        howto.style.display = howto.style.display === "none" ? "block" : "none";
      });
      tools.appendChild(help);
    }

    // ★追加: 「🗑 全クリア」ボタン — 前の商品のデータが残ったまま次の商品を出品してしまうのを防ぐ
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "fx-mini btn-gray";
    clearBtn.textContent = "🗑 全クリア";
    clearBtn.title = "商品データ・サイト別URL・送料計算などをすべて消して、次の商品の出品に備えます";
    clearBtn.addEventListener("click", async () => {
      const ok = window.confirm(
        "現在の商品データ（商品情報・価格/利益・サイト別URL・送料計算・売れた時チェック）を\n" +
        "すべて消します。よろしいですか？\n\n" +
        "※ ライセンス・トライアルの情報は消えません。"
      );
      if (!ok) return;
      await clearAllItemData();
    });
    tools.appendChild(clearBtn);

    // 取得・貼り付けボタンに、フリマのアイコン（M・R・Y）を付ける
    const iconize = (id, plat) => {
      const b = document.getElementById(id);
      if (!b || !plat) return;
      const label = b.textContent.replace(/^[^\p{L}\p{N}]+/u, "").trim();
      b.innerHTML = `<span class="fx-ico" style="background:${plat.color}">${plat.letter}</span>${label}`;
    };
    iconize("btnGetMercari", SHIPPING_PLATFORMS[0]);
    iconize("btnRakuma",     SHIPPING_PLATFORMS[1]);
    iconize("btnYahoo",      SHIPPING_PLATFORMS[2]);

    // 実行結果の1行目を、固定した枠の中にも表示する（下にスクロールしていても結果が見える）
    const st = document.getElementById("status");
    if (st) {
      const line = document.createElement("div");
      line.className = "fx-status-line";
      card.appendChild(line);
      const update = () => { line.textContent = (st.textContent || "").trim().split("\n")[0]; };
      update();
      new MutationObserver(update).observe(st, { childList: true, characterData: true, subtree: true });
    }
  };

  // ── 1. 各カードをたたむ／ひらく ──
  document.querySelectorAll(".card").forEach((card) => {
    const badge = card.querySelector(":scope > .badge");
    if (!badge) return;
    const title = badge.textContent.trim();
    if (title.includes("基本操作")) { setupMainActions(card, badge); return; }
    const defaultOpen = !CLOSED_BY_DEFAULT.some((w) => title.includes(w));
    const sec = wrapCollapsible(card, badge, title, defaultOpen);
    if (title.includes("価格・利益管理")) mirror(sec, "viewProfit", "予想利益 ");
    if (title.includes("売れた時チェック")) mirror(sec, "soldProgress", "");
  });

  // ── 3. 一番上を小さくまとめる ──
  const h1 = document.querySelector("h1");
  if (h1) h1.classList.add("fx-h1");

  const trial = document.getElementById("trialBanner");
  const buy   = document.getElementById("buyBanner");
  if (trial && buy && trial.parentNode) {
    const row = document.createElement("div");
    row.className = "fx-top-row";
    trial.parentNode.insertBefore(row, trial);
    row.appendChild(trial);
    row.appendChild(buy);
  }

  const pc = document.getElementById("purchaseCard");
  if (pc) {
    const title = document.createElement("div");
    title.className = "fx-lic-title";
    title.textContent = "🔑 ライセンス認証・購入";
    pc.insertBefore(title, pc.firstChild);
    wrapCollapsible(pc, title, "purchaseCard", false);
  }

  // 前回の開き具合を復元する
  try {
    chrome.storage.local.get([UI_KEY], (res) => {
      const st = (res && res[UI_KEY]) || {};
      Object.assign(saved, st);
      sections.forEach((s) => { if (typeof st[s.key] === "boolean") s.setOpen(st[s.key], false); });
    });
  } catch (e) {}
})();

// ═══════════════════════════════════════════════════════════════
//  出品リンク
// ═══════════════════════════════════════════════════════════════
// ★修正: ラクマ・ヤフオクの正しい出品フォームURLが判明したので、直リンクに戻す
const LISTING_URLS = {
  mercari: "https://jp.mercari.com/sell/create",
  rakuma:  "https://fril.jp/item/new",
  yahoo:   "https://auctions.yahoo.co.jp/jp/show/submit?category=0",
  paypay:  "https://paypayfleamarket.yahoo.co.jp/sell"
};

$("btnOpenMercariListing").addEventListener("click", () => {
  chrome.tabs.create({ url: LISTING_URLS.mercari });
});
$("btnOpenRakumaListing").addEventListener("click", () => {
  chrome.tabs.create({ url: LISTING_URLS.rakuma });
});
$("btnOpenPaypayListing").addEventListener("click", () => {
  chrome.tabs.create({ url: LISTING_URLS.paypay });
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
    row.className = "checklist-item";

    const cb = document.createElement("input");
    cb.type    = "checkbox";
    cb.checked = checked;

    const span = document.createElement("span");
    span.textContent = item.label;
    if (checked) {
      span.style.textDecoration = "line-through";
      span.style.opacity = "0.55";
    }

    cb.addEventListener("change", async () => {
      const d = await loadSoldCheck();
      d[item.id] = cb.checked;
      await saveSoldCheck(d);
      span.style.textDecoration = cb.checked ? "line-through" : "";
      span.style.opacity        = cb.checked ? "0.55" : "";
      updateSoldProgress();
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

  // ★追加: 送料計算（3辺合計cm・重さ）を復元する
  {
    const sc = await loadShipCalc();
    const cmEl = $("shippingSize");
    const kgEl = $("shippingWeight");
    if (sc && cmEl) cmEl.value = sc.cm || "";
    if (sc && kgEl) kgEl.value = sc.kg || "";
    if (sc && $("shippingThick")) $("shippingThick").value = sc.thick || "";
    if (sc && $("shipL")) $("shipL").value = sc.l || "";
    if (sc && $("shipW")) $("shipW").value = sc.w || "";
    if (sc && $("shipH")) $("shipH").value = sc.h || "";
  }

  // ★出品したあとのURLを自動で保存したとき（background.js）は、お知らせを出して、アイコンの「URL」の印を消す
  try {
    const cap = (await chrome.storage.local.get(["fx_last_capture"])).fx_last_capture;
    if (cap && Date.now() - Number(cap.at || 0) < 6 * 3600 * 1000) {
      if (cap.failed) {
        setStatus(
          `⚠ ${cap.label}の出品URLを、自動で取得できませんでした\n` +
          `商品ページを開いて、サイト別管理の「現在のURL」を押してください。`
        );
      } else if (cap.matched === false) {
        setStatus(
          `✅ ${cap.label}の出品URLを、サイト別管理に自動で保存しました\n${cap.url}\n` +
          `※ 出品した商品の一覧の先頭を保存しました。商品名が合っているか、確認してください。`
        );
      } else {
        setStatus(`✅ ${cap.label}の出品URLを、サイト別管理に自動で保存しました\n${cap.url}`);
      }
      if (!cap.failed) {
        fillSiteMetaForm(await loadSiteMeta());
        await syncListingMeta({ logLabel: cap.label });   // ★v1.5.4: 出品先・管理メモを自動で更新
      }
      await chrome.storage.local.remove(["fx_last_capture"]);
    }
    chrome.action.setBadgeText({ text: "" });
  } catch (e) {}

  // ★出品完了ページ（Yahoo!フリマ）や、出品した商品の一覧（ラクマ）を開いた状態でアイコンを押したときは、
  //   その場でページから商品URLを読み取って、サイト別管理に保存する（待たずに次の処理へ進む）
  try {
    chrome.tabs.query({ active: true, currentWindow: true }).then(async (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || tab.id == null) return;
      const r = await chrome.runtime.sendMessage({ type: "FX_PROBE_TAB", tabId: tab.id });
      if (r && r.ok) {
        fillSiteMetaForm(await loadSiteMeta());
        validateAllUrls();
        await syncListingMeta({ logLabel: r.label });   // ★v1.5.4: 出品先・管理メモを自動で更新
        setStatus(
          `✅ ${r.label}の出品URLを、このページから読み取って、サイト別管理に保存しました\n${r.url}` +
          (r.matched === false ? "\n※ 一覧の先頭を保存しました。商品名が合っているか、確認してください。" : "")
        );
        try { chrome.action.setBadgeText({ text: "" }); } catch (e) {}
      }
    }).catch(() => {});
  } catch (e) {}

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
  const licState = await initLicenseKanri();

  // ★修正: ライセンス認証済みならカウントダウンは一切動かさない
  //   （以前はここが1秒ごとにバナーを上書きし、認証済みでも
  //     「トライアル期間が終了しました」と表示されるバグの原因だった）
  if (licState?.reason === "license") {
    return;
  }

  // ── トライアル残り時間カウントダウン ──
  (async function() {
    const banner = document.getElementById("trialBanner");
    if (!banner) return;
    if (banner.dataset.trialMode !== "1") return;

    let endAt = 0;
    try {
      const st = await chrome.storage.local.get(["kanri_trial_end_at"]);
      if (st.kanri_trial_end_at) endAt = Number(st.kanri_trial_end_at);
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
      // ★ 認証が通った瞬間に trialMode が "0" になり、上書きが止まる
      if (banner.dataset.trialMode !== "1") return;

      if (endAt > 0) {
        const diff = endAt - Date.now();
        if (diff <= 0) {
          banner.textContent = "⏰ トライアル期間が終了しました";
          banner.style.background = "rgba(254,226,226,0.8)";
          banner.style.color = "#dc2626";
          // ★追加: 表示だけでなく機能もロックする
          if (KANRI_ACCESS_OK !== false) {
            chrome.storage.local.set({ kanri_trial_expired: true });
            chrome.storage.local.remove(["kanri_trial_approved", "kanri_trial_approved_at"]);
            saveAccessCacheKanri({ ok: false });
            lockMainButtons();
            showLicenseOverlay();
            const m = document.getElementById("licenseMsg");
            if (m) { m.textContent = "⏰ トライアル期間が終了しました。ライセンスをご購入ください。"; m.style.color = "#dc2626"; }
          }
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