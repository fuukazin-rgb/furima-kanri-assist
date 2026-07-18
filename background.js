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