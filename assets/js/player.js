// ============================================================
//  PLAYER PAGE — load slug từ URL, render danh sách tập,
//  tự play tập tương ứng ?ep=...
// ============================================================

(async function () {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get("slug");
  const source = params.get("source") || "nguonc";
  const epParam = params.get("ep") || "";

  // Nút "Quay lại" — quay về detail.html (cố gắng giữ movieKey nếu có)
  const backBtn = document.getElementById("backToDetailBtn");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      // Ưu tiên dùng movieKey trong localStorage nếu slug khớp
      const movieKey = params.get("movieKey");
      const url = movieKey
        ? `detail.html?movieKey=${encodeURIComponent(movieKey)}`
        : `detail.html?slug=${encodeURIComponent(slug || "")}`;
      window.location.href = url;
    });
  }

  if (!slug) {
    document.getElementById("playerTitleNav").innerText = "Không tìm thấy phim";
    return;
  }

  try {
    const detail = await fetchSourceDetail(source, slug);
    renderPlayerEpisodeList(detail);
    document.getElementById("playerTitleNav").innerText = detail.movieData.name;

    setMetaTags({
      title: `${detail.movieData.name} - Đang phát`,
      description: `Đang phát ${detail.movieData.name} trên SFLIX`,
      image: detail.poster || detail.thumb,
      type: "video.other",
    });

    // Tự động phát tập theo URL
    const targetBtn = epParam
      ? document.querySelector(`.ep-btn[data-ep-key="${cssEscape(epParam)}"]`)
      : document.querySelector(".ep-btn");
    if (targetBtn) {
      targetBtn.classList.add("active");
      const ep = readEpFromButton(targetBtn, detail.episodes);
      if (ep) {
        playEpisode(ep, detail.movieData.name);
      }
    }
  } catch (err) {
    console.error("Player load error:", err);
    document.getElementById("playerTitleNav").innerText =
      "Lỗi tải dữ liệu phim";
  }
})();

// Render sidebar danh sách tập
function renderPlayerEpisodeList(detail) {
  const container = document.getElementById("episodeListPlayer");
  if (!container) return;
  container.innerHTML = "";

  if (!detail.episodes || !detail.episodes.length) {
    container.innerHTML =
      '<p class="text-muted small">Không có tập khả dụng.</p>';
    return;
  }

  detail.episodes.forEach((ep, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ep-btn";
    btn.dataset.epKey = ep.slug || `${ep.name || ep.episode || "tap"}-${idx}`;
    btn.innerText = ep.name || ep.episode || "Tập";
    btn.addEventListener("click", () => {
      // Active chỉ trong danh sách tập của player (chỉ có 1 danh sách ở đây)
      container
        .querySelectorAll(".ep-btn")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      playEpisode(ep, detail.movieData.name);

      // Cập nhật URL để có thể share / refresh
      const url = new URL(window.location.href);
      url.searchParams.set("ep", btn.dataset.epKey || "");
      window.history.replaceState({}, "", url.toString());
    });
    container.appendChild(btn);
  });
}

// Tìm object episode tương ứng với button đã click
function readEpFromButton(btn, episodes) {
  const key = btn.dataset.epKey || "";
  // key có dạng "<slug>" hoặc "<name>-<idx>"
  const matchBySlug = episodes.find((ep) => ep.slug === key);
  if (matchBySlug) return matchBySlug;
  const idxPart = key.split("-").pop();
  const idx = parseInt(idxPart, 10);
  if (!Number.isNaN(idx) && episodes[idx]) return episodes[idx];
  // fallback: khớp theo name
  const txt = btn.innerText.trim();
  return episodes.find((ep) => (ep.name || ep.episode || "Tập") === txt);
}

function playEpisode(ep, movieName) {
  const url = ep.embed || ep.link_embed || ep.url || ep.file;
  if (!url) return;
  const iframe = document.getElementById("videoPlayer");
  if (iframe) iframe.src = url;
  const nav = document.getElementById("playerTitleNav");
  if (nav) nav.innerText = `${movieName} - Tập ${ep.name || ep.episode || ""}`;
}
