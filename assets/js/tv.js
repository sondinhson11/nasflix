/* ============================================================
   SFLIX — TV / Leanback Controller
   - Phát hiện TV mode (URL ?tv=1 hoặc UA Android TV / Leanback)
   - Điều khiển focus bằng D-pad (mũi tên / Enter / Back)
   - Auto-focus phần tử "tự nhiên" đầu tiên trên mỗi trang
   - <select> bộ lọc: ↑↓ KHÔNG đổi value, phải bấm OK mở popup chọn
   ============================================================ */

(function () {
  "use strict";

  const TV_FLAG_KEY = "SFLIX_tv_mode";

  // ---------- 1. Phát hiện TV mode ----------
  function detectTV() {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("tv") === "1") return true;
      if (localStorage.getItem(TV_FLAG_KEY) === "1") return true;
    } catch (e) {}
    const ua = navigator.userAgent || "";
    if (/Android TV|GoogleTV|SmartTV|AFT[A-Z]+|Chromecast|Leanback|Web0S|Tizen|Roku/i.test(ua)) {
      return true;
    }
    if (/Android/.test(ua) && window.innerWidth >= 1280 && !window.matchMedia("(pointer: fine)").matches) {
      return true;
    }
    return false;
  }

  const isTV = detectTV();
  window.SFLIX_IS_TV = isTV;

  if (!isTV) return;

  document.documentElement.classList.add("tv-mode-on");
  const applyBodyClass = () => document.body.classList.add("tv-mode");
  if (document.body) applyBodyClass();
  else document.addEventListener("DOMContentLoaded", applyBodyClass);

  try { localStorage.setItem(TV_FLAG_KEY, "1"); } catch (e) {}

  // ---------- 2. Focusable selector ----------
  const FOCUSABLE_SELECTORS = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "[tabindex]:not([tabindex='-1'])",
    ".movie-card",
    ".ep-btn",
    ".nav-link",
    ".page-btn",
    ".filter-toggle-btn",
    ".filter-sheet-apply",
    ".filter-sheet-reset",
    ".server-select-btn",
    ".search-result-card",
  ].join(",");

  function isFocusable(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    if (el.disabled) return false;
    if (el.getAttribute("tabindex") === "-1") return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") return false;
    return el.matches(FOCUSABLE_SELECTORS);
  }

  function getFocusableList() {
    return Array.from(document.querySelectorAll(FOCUSABLE_SELECTORS)).filter(isFocusable);
  }

  function rectCenter(rect) {
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  // ---------- 3. Spatial nav — chặt hơn ----------
  // Thuật toán:
  //  - Lấy tất cả ứng viên NẰM TRONG viewport ± 1.5 màn hình
  //  - Cùng trục chính (dx hoặc dy) theo đúng hướng
  //  - Ưu tiên ứng viên overlap theo trục phụ ≥ 25% (cùng hàng/cột)
  //  - Score = primary*2 + secondary*1.5 (cùng hàng → secondary nhỏ → ưu tiên)
  //  - Nếu KHÔNG có overlap hợp lệ → fallback ứng viên gần nhất theo trục chính
  function pickByDirection(current, dir, candidates) {
    if (!current || candidates.length === 0) return null;
    const curRect = current.getBoundingClientRect();
    const curCenter = rectCenter(curRect);
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const isHorizontal = dir === "left" || dir === "right";
    const sign = (dir === "left" || dir === "up") ? -1 : 1;

    // Bỏ các phần tử quá xa khỏi viewport
    const visible = candidates.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.bottom > -vh && r.top < vh * 2 && r.right > -vw && r.left < vw * 2;
    });

    // Phase 1: tìm ứng viên overlap trục phụ (cùng hàng/cột)
    let bestAligned = null;
    let bestAlignedScore = Infinity;
    const alignedList = [];

    for (const el of visible) {
      if (el === current) continue;
      const r = el.getBoundingClientRect();
      const c = rectCenter(r);

      const dx = c.x - curCenter.x;
      const dy = c.y - curCenter.y;

      // Phải nằm đúng hướng
      if (isHorizontal && sign * dx <= 5) continue;
      if (!isHorizontal && sign * dy <= 5) continue;

      // Tính overlap theo trục phụ
      let overlap;
      if (isHorizontal) {
        overlap = Math.min(r.bottom, curRect.bottom) - Math.max(r.top, curRect.top);
      } else {
        overlap = Math.min(r.right, curRect.right) - Math.max(r.left, curRect.left);
      }
      const minSize = isHorizontal ? Math.min(r.height, curRect.height) : Math.min(r.width, curRect.width);
      const overlapRatio = minSize > 0 ? overlap / minSize : 0;

      const primary   = isHorizontal ? Math.abs(dx) : Math.abs(dy);
      const secondary = isHorizontal ? Math.abs(dy) : Math.abs(dx);

      if (overlapRatio >= 0.25) {
        const score = primary * 2 + secondary * 1.0;
        alignedList.push({ el, score, primary, secondary });
        if (score < bestAlignedScore) {
          bestAlignedScore = score;
          bestAligned = el;
        }
      }
    }

    if (bestAligned) {
      // Trong số aligned, lấy primary gần nhất (chặn primary lệch nhau quá)
      alignedList.sort((a, b) => a.score - b.score);
      const minPrimary = alignedList[0].primary;
      const close = alignedList.filter((c) => c.primary <= minPrimary * 1.8);
      // Trong nhóm "gần", chọn secondary nhỏ nhất (cùng hàng nhất)
      close.sort((a, b) => a.secondary - b.secondary);
      return close[0].el;
    }

    // Phase 2: fallback — không có aligned → tìm primary gần nhất theo hướng
    let bestFallback = null;
    let bestFallbackScore = Infinity;
    for (const el of visible) {
      if (el === current) continue;
      const r = el.getBoundingClientRect();
      const c = rectCenter(r);
      const dx = c.x - curCenter.x;
      const dy = c.y - curCenter.y;

      if (isHorizontal && sign * dx <= 5) continue;
      if (!isHorizontal && sign * dy <= 5) continue;

      const primary   = isHorizontal ? Math.abs(dx) : Math.abs(dy);
      const secondary = isHorizontal ? Math.abs(dy) : Math.abs(dx);
      const score = primary * 2 + secondary * 1.5;

      if (score < bestFallbackScore) {
        bestFallbackScore = score;
        bestFallback = el;
      }
    }
    return bestFallback;
  }

  // ---------- 4. Auto-focus theo trang ----------
  function autoFocusByPage() {
    const path = window.location.pathname.toLowerCase();
    let target = null;

    if (path.includes("index") || path.endsWith("/") || path === "/index.html") {
      target = document.getElementById("heroPlayBtn");
      if (!target || target.offsetParent === null) {
        target = document.querySelector(".movie-card") || document.querySelector(".nav-link");
      }
    } else if (path.includes("catalog")) {
      target = document.querySelector(".filter-select") || document.querySelector(".movie-card") || document.querySelector(".nav-link");
    } else if (path.includes("detail")) {
      target = document.getElementById("watchNowBtn") || document.querySelector(".ep-btn") || document.querySelector(".movie-card");
    } else if (path.includes("player")) {
      target = document.querySelector("#backToDetailBtn") || document.querySelector(".ep-btn");
    } else if (path.includes("danhsach")) {
      target = document.getElementById("sel-tinh") || document.querySelector(".btn-primary");
    }

    if (target && target.offsetParent === null) target = null;
    if (!target) {
      const list = getFocusableList();
      target = list[0] || null;
    }

    if (target) {
      requestAnimationFrame(() => {
        try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
        ensureFocusedVisible(target);
      });
    }
  }

  // ---------- 5. Đảm bảo phần tử focus nằm trong viewport ----------
  function ensureFocusedVisible(el) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const padTop = 100;
    const padBottom = 140;
    let dx = 0, dy = 0;
    if (rect.top < padTop) dy = rect.top - padTop;
    else if (rect.bottom > vh - padBottom) dy = rect.bottom - vh + padBottom;
    if (rect.left < 60) dx = rect.left - 60;
    else if (rect.right > vw - 60) dx = rect.right - vw + 60;
    if (dx !== 0 || dy !== 0) {
      window.scrollBy({ top: dy, left: dx, behavior: "smooth" });
    }
  }

  // ---------- 6. <select> popup cho TV ----------
  // Mở 1 dialog liệt kê các option, ↑↓ di chuyển, OK chọn, Back hủy.
  let activeSelectPopup = null;

  function openSelectPopup(selectEl) {
    if (!selectEl || !selectEl.options || selectEl.options.length === 0) return;
    if (activeSelectPopup) closeSelectPopup();

    const overlay = document.createElement("div");
    overlay.className = "tv-select-popup";

    const panel = document.createElement("div");
    panel.className = "tv-select-popup-panel";

    const title = document.createElement("div");
    title.className = "tv-select-title";
    // Lấy label gần nhất nếu có
    let labelText = selectEl.id || "Chọn";
    if (selectEl.id) {
      const lbl = document.querySelector(`label[for="${selectEl.id}"]`);
      if (lbl) labelText = lbl.textContent.trim();
      else {
        const parent = selectEl.closest(".field, .filter-item, .filter-sheet-group, .qc-item");
        if (parent) {
          const lbl2 = parent.querySelector("label");
          if (lbl2) labelText = lbl2.textContent.trim();
        }
      }
    }
    title.textContent = labelText;

    const list = document.createElement("div");
    list.className = "tv-select-list";

    const options = Array.from(selectEl.options).map((opt, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tv-select-option" + (opt.selected ? " is-current" : "");
      btn.dataset.value = opt.value;
      btn.dataset.index = i;
      btn.textContent = opt.textContent;
      if (opt.selected) btn.dataset.selected = "1";
      list.appendChild(btn);
      return btn;
    });

    const hint = document.createElement("div");
    hint.className = "tv-select-hint";
    hint.innerHTML = `
      <span><span class="tv-kbd">↑</span><span class="tv-kbd">↓</span> Di chuyển</span>
      <span><span class="tv-kbd">OK</span> Chọn</span>
      <span><span class="tv-kbd">Back</span> Hủy</span>
    `;

    panel.appendChild(title);
    panel.appendChild(list);
    panel.appendChild(hint);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    activeSelectPopup = { overlay, panel, list, options, selectEl };

    // Focus option đang chọn (hoặc option đầu)
    let startIdx = options.findIndex((b) => b.dataset.selected === "1");
    if (startIdx < 0) startIdx = 0;
    setHighlight(startIdx);

    // Khóa scroll body khi popup mở
    document.body.style.overflow = "hidden";
  }

  function setHighlight(idx) {
    if (!activeSelectPopup) return;
    const { options } = activeSelectPopup;
    options.forEach((b, i) => {
      if (i === idx) {
        b.classList.add("is-highlighted");
        b.scrollIntoView({ block: "nearest" });
      } else {
        b.classList.remove("is-highlighted");
      }
    });
  }

  function commitSelectPopup(idx) {
    if (!activeSelectPopup) return;
    const { options, selectEl } = activeSelectPopup;
    const opt = options[idx];
    if (!opt) return;
    const newValue = opt.dataset.value;
    if (String(selectEl.value) !== String(newValue)) {
      selectEl.value = newValue;
      selectEl.dispatchEvent(new Event("change", { bubbles: true }));
    }
    closeSelectPopup();
  }

  function closeSelectPopup() {
    if (!activeSelectPopup) return;
    activeSelectPopup.overlay.remove();
    activeSelectPopup = null;
    document.body.style.overflow = "";
  }

  // ---------- 7. Main key handler ----------
  function handleKeydown(e) {
    const ae = document.activeElement;
    const isTyping = ae && (
      ae.tagName === "INPUT" ||
      ae.tagName === "TEXTAREA" ||
      ae.isContentEditable
    );

    const k = e.key;
    const code = e.keyCode;

    // --- Nếu popup select đang mở: xử lý riêng ---
    if (activeSelectPopup) {
      e.preventDefault();
      const { options } = activeSelectPopup;
      const currentIdx = options.findIndex((b) => b.classList.contains("is-highlighted"));
      if (k === "ArrowDown" || code === 40) {
        const next = Math.min(options.length - 1, currentIdx + 1);
        setHighlight(next);
        return;
      }
      if (k === "ArrowUp" || code === 38) {
        const prev = Math.max(0, currentIdx - 1);
        setHighlight(prev);
        return;
      }
      if (k === "Enter" || code === 13 || k === " " || code === 32) {
        commitSelectPopup(currentIdx < 0 ? 0 : currentIdx);
        return;
      }
      if (k === "GoBack" || k === "BrowserBack" || k === "Escape") {
        closeSelectPopup();
        return;
      }
      // Bỏ qua phím khác trong popup
      return;
    }

    // --- Back ---
    if (k === "GoBack" || k === "BrowserBack" || k === "Escape") {
      const searchOverlay = document.getElementById("searchOverlay");
      if (searchOverlay && !searchOverlay.hidden) {
        e.preventDefault();
        const closeBtn = document.getElementById("searchCloseBtn");
        if (closeBtn) closeBtn.click();
        else searchOverlay.hidden = true;
        return;
      }
      const filterSheet = document.getElementById("filterSheet");
      if (filterSheet && !filterSheet.hidden) {
        e.preventDefault();
        const close = document.getElementById("filterSheetClose");
        if (close) close.click();
        else filterSheet.hidden = true;
        return;
      }
      if (isTyping) {
        e.preventDefault();
        ae.blur();
        return;
      }
      const path = window.location.pathname.toLowerCase();
      if (path.includes("player")) {
        e.preventDefault();
        const back = document.getElementById("backToDetailBtn");
        if (back) back.click();
        else history.back();
        return;
      }
      if (path.includes("detail")) {
        e.preventDefault();
        const link = document.querySelector(".back-link");
        if (link) link.click();
        else history.back();
        return;
      }
      return;
    }

    // --- Media keys: cho iframe player xử lý ---
    if (k === "MediaPlayPause" || k === "MediaPlay" || k === "MediaPause" ||
        code === 102 || code === 119 || code === 120) {
      return;
    }

    // --- Đang gõ trong input search ---
    if (isTyping && ae.tagName === "INPUT") {
      if (k === "Enter") {
        e.preventDefault();
        if (ae.id === "searchInput") ae.dispatchEvent(new Event("input"));
        return;
      }
      if (k === "ArrowLeft" || k === "ArrowRight") return;
      if ((k === "ArrowUp" || k === "ArrowDown") && ae.id === "searchInput") {
        e.preventDefault();
        const delta = k === "ArrowUp" ? -1 : 1;
        const chars = "abcdefghijklmnopqrstuvwxyz0123456789 ";
        const last = ae.value.slice(-1).toLowerCase();
        let idx = chars.indexOf(last);
        if (idx < 0) idx = 0;
        else idx = (idx + delta + chars.length) % chars.length;
        ae.value = ae.value.slice(0, -1) + chars[idx];
        ae.dispatchEvent(new Event("input"));
        return;
      }
      return;
    }

    // --- Enter / OK ---
    if (k === "Enter" || code === 13 || k === " " || code === 32) {
      // <select>: mở popup thay vì trigger native dropdown
      if (ae && ae.tagName === "SELECT") {
        e.preventDefault();
        openSelectPopup(ae);
        return;
      }
      // <a> / <button>: browser tự click
      if (ae && (ae.tagName === "A" || ae.tagName === "BUTTON")) return;
      // Các class khác → click
      if (ae && (
        ae.classList.contains("movie-card") ||
        ae.classList.contains("ep-btn") ||
        ae.classList.contains("nav-link") ||
        ae.classList.contains("page-btn") ||
        ae.classList.contains("server-select-btn") ||
        ae.classList.contains("search-result-card")
      )) {
        e.preventDefault();
        ae.click();
        return;
      }
    }

    // --- D-pad arrows ---
    let dir = null;
    if (k === "ArrowLeft"  || code === 37) dir = "left";
    if (k === "ArrowRight" || code === 39) dir = "right";
    if (k === "ArrowUp"    || code === 38) dir = "up";
    if (k === "ArrowDown"  || code === 40) dir = "down";

    if (!dir) return;
    e.preventDefault();

    // Nếu chưa focus gì → focus vào phần tử đầu tiên
    if (!ae || ae === document.body || !isFocusable(ae)) {
      const list = getFocusableList();
      if (list.length) {
        try { list[0].focus({ preventScroll: true }); } catch (e) { list[0].focus(); }
        ensureFocusedVisible(list[0]);
      }
      return;
    }

    // ←→↑↓ trên <select>: di chuyển focus (KHÔNG đổi value)
    // ↑/↓ trong popup select đã được xử lý ở trên

    // Spatial nav
    const list = getFocusableList();
    const next = pickByDirection(ae, dir, list);
    if (next) {
      try { next.focus({ preventScroll: true }); } catch (e) { next.focus(); }
      ensureFocusedVisible(next);
      return;
    }

    // Không có ứng viên nào trong hướng đó → scroll page
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    if (dir === "down") window.scrollBy({ top: vh * 0.7, behavior: "smooth" });
    else if (dir === "up") window.scrollBy({ top: -vh * 0.7, behavior: "smooth" });
    else if (dir === "right") window.scrollBy({ left: vw * 0.6, behavior: "smooth" });
    else if (dir === "left") window.scrollBy({ left: -vw * 0.6, behavior: "smooth" });
  }

  document.addEventListener("keydown", handleKeydown, { capture: true });

  // ---------- 8. Click chuột (remote) cũng focus luôn ----------
  document.addEventListener("click", (e) => {
    const t = e.target.closest(FOCUSABLE_SELECTORS);
    if (t && isFocusable(t)) {
      try { t.focus({ preventScroll: true }); } catch (err) {}
    }
  }, true);

  // ---------- 9. Auto-focus sau khi DOM ready + sau khi swiper render ----------
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(autoFocusByPage, 400));
  } else {
    setTimeout(autoFocusByPage, 400);
  }

  document.addEventListener("DOMContentLoaded", () => {
    let tries = 0;
    const retry = setInterval(() => {
      tries++;
      const ae = document.activeElement;
      const isOk = ae && isFocusable(ae) && ae !== document.body;
      if (isOk || tries > 12) {
        clearInterval(retry);
        return;
      }
      const first = getFocusableList()[0];
      if (first) {
        try { first.focus({ preventScroll: true }); } catch (err) {}
        clearInterval(retry);
      }
    }, 300);
  });

  // ---------- 10. Hint bar ----------
  function buildHintBar() {
    if (document.querySelector(".tv-hint-bar")) return;
    const bar = document.createElement("div");
    bar.className = "tv-hint-bar";
    bar.innerHTML = `
      <span class="hint-item"><span class="hint-key">←</span><span class="hint-key">→</span><span class="hint-key">↑</span><span class="hint-key">↓</span> Di chuyển</span>
      <span class="hint-item"><span class="hint-key">OK</span> Chọn</span>
      <span class="hint-item"><span class="hint-key">Back</span> Quay lại</span>
      <span class="hint-item"><span class="hint-key">/</span> Tìm kiếm</span>
    `;
    document.body.appendChild(bar);
    let firstFocus = true;
    document.addEventListener("focusin", () => {
      if (firstFocus) { firstFocus = false; return; }
      setTimeout(() => document.body.classList.add("tv-hint-hidden"), 2500);
    }, true);
    setTimeout(() => document.body.classList.add("tv-hint-hidden"), 9000);
  }
  if (document.body) buildHintBar();
  else document.addEventListener("DOMContentLoaded", buildHintBar);

  console.info("[SFLIX] TV mode active (D-pad enabled, select popup enabled)");
})();
