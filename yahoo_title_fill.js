// yahoo_title_fill.js v17 - パネル復元専用（category=0のみ新規判定）
(async () => {
  // category=0 が含まれる = 新しく開いた初期状態 → データ削除してパネル非表示
  if (location.search.includes("category=0")) {
    await chrome.storage.local.remove("furimaHelperData");
    return;
  }

  // ── コピペ支援パネルをstorageから復元して表示 ──
  try {
    const res = await chrome.storage.local.get(["furimaHelperData"]);
    const data = res.furimaHelperData;
    if (!data) return;

    // 2時間以内のデータのみ復元
    if (Date.now() - (data.savedAt || 0) > 2 * 60 * 60 * 1000) {
      await chrome.storage.local.remove("furimaHelperData");
      return;
    }

    // すでにパネルがあれば何もしない
    if (document.getElementById("furima-helper-panel")) return;

    const panel = document.createElement("div");
    panel.id = "furima-helper-panel";
    Object.assign(panel.style, {
      position: "fixed", bottom: "16px", right: "16px",
      zIndex: "9999999", width: "320px",
      background: "#1e293b", color: "#f1f5f9",
      borderRadius: "14px", padding: "14px",
      boxShadow: "0 12px 32px rgba(0,0,0,.5)",
      fontFamily: "-apple-system,BlinkMacSystemFont,sans-serif",
      fontSize: "12px", lineHeight: "1.5"
    });

    function makeRow(label, value, color) {
      if (!value) return;
      const row = document.createElement("div");
      Object.assign(row.style, { marginBottom: "8px" });
      const lbl = document.createElement("div");
      lbl.textContent = label;
      Object.assign(lbl.style, { fontSize: "10px", color: "#94a3b8", marginBottom: "3px" });
      row.appendChild(lbl);
      const btn = document.createElement("button");
      btn.textContent = value;
      Object.assign(btn.style, {
        width: "100%", textAlign: "left", padding: "7px 10px",
        background: color || "#334155", color: "#f1f5f9",
        border: "none", borderRadius: "8px", cursor: "pointer",
        fontSize: "12px", fontWeight: "700", wordBreak: "break-all",
        lineHeight: "1.4"
      });
      btn.title = "クリックでコピー";
      btn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(value);
          const orig = btn.textContent;
          btn.textContent = "✅ コピーしました！";
          btn.style.background = "#059669";
          setTimeout(() => {
            btn.textContent = orig;
            btn.style.background = color || "#334155";
          }, 1500);
        } catch(e) { btn.textContent = "❌ コピー失敗"; }
      });
      row.appendChild(btn);
      panel.appendChild(row);
    }

    const titleEl = document.createElement("div");
    Object.assign(titleEl.style, {
      fontSize: "11px", fontWeight: "700", color: "#f97316",
      marginBottom: "10px", borderBottom: "1px solid #334155",
      paddingBottom: "8px"
    });
    titleEl.textContent = "📋 コピペ支援パネル（クリックでコピー）";
    panel.appendChild(titleEl);

    if (data.category) {
      const catParts = data.category.split(/[>\/＞]/).map(s => s.trim()).filter(Boolean);
      const lastCat = catParts[catParts.length - 1] || data.category;
      makeRow("📂 カテゴリー末尾（カテゴリー検索に貼り付け）", lastCat, "#7c3aed");
      if (catParts.length > 1) {
        makeRow("📂 カテゴリー全体（参考）", data.category, "#475569");
      }
    }
    if (data.brand) {
      makeRow("🏷️ メーカー・ブランド欄に貼り付け", data.brand, "#0369a1");
    }
    if (data.title) {
      makeRow("🔍 製品検索キーワード（製品検索に貼り付け）", data.title, "#065f46");
    }

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "✕ 閉じる";
    Object.assign(closeBtn.style, {
      width: "100%", marginTop: "8px", padding: "7px",
      background: "#475569", color: "#f1f5f9",
      border: "none", borderRadius: "8px", cursor: "pointer",
      fontSize: "11px"
    });
    closeBtn.addEventListener("click", () => {
      panel.remove();
      chrome.storage.local.remove("furimaHelperData");
    });
    panel.appendChild(closeBtn);
    document.body.appendChild(panel);
  } catch(e) {
    console.warn("[furima] パネル復元エラー:", e);
  }
})();