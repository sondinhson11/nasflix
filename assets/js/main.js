const API_CONFIG = {
  phimapi: {
    list: "https://phimapi.com/danh-sach/phim-moi-cap-nhat",
    detail: "https://phimapi.com/phim/",
  },
  ophim: {
    list: "https://ophim1.com/danh-sach/phim-moi-cap-nhat",
    detail: "https://ophim1.com/phim/",
  },
};

const MERGE_SOURCES = ["phimapi", "ophim"];
const MOVIE_MAP_KEY = "SFLIX_merged_movies";
const SOURCE_LABELS = {
  phimapi: "PhimAPI",
  ophim: "OPhim",
};

let currentPage = 1;
let isFetching = false;
let swiperInstance = null;

window.addEventListener("scroll", () => {
  const nav = document.getElementById("navbar");
  if (nav) {
    if (window.scrollY > 20) nav.classList.add("scrolled");
    else nav.classList.remove("scrolled");
  }
});

const DEFAULT_OG_IMAGE = "assets/images/og-image.svg";
const SITE_NAME = "SFLIX";
const SITE_TAGLINE = "Xem phim bản quyền chất lượng cao, vietsub cập nhật nhanh";

function ensureMeta(attr, key, content) {
  if (!content) return;
  let sel = `meta[${attr}="${key}"]`;
  let el = document.head.querySelector(sel);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setPageTitle(title) {
  if (title) document.title = `${title} | ${SITE_NAME}`;
}

function setMetaTags({
  title,
  description,
  image,
  url,
  type = "website",
  siteName = SITE_NAME,
}) {
  if (title) setPageTitle(title);
  const desc = description || SITE_TAGLINE;
  const img = image || DEFAULT_OG_IMAGE;
  const u = url || window.location.href;
  const absImg = (() => {
    try {
      return new URL(img, window.location.href).toString();
    } catch {
      return img;
    }
  })();

  ensureMeta("name", "description", desc);
  ensureMeta("name", "theme-color", "#0b0b0b");

  // Open Graph
  ensureMeta("property", "og:title", title || SITE_NAME);
  ensureMeta("property", "og:description", desc);
  ensureMeta("property", "og:image", absImg);
  ensureMeta("property", "og:image:width", "1200");
  ensureMeta("property", "og:image:height", "630");
  ensureMeta("property", "og:url", u);
  ensureMeta("property", "og:type", type);
  ensureMeta("property", "og:site_name", siteName);
  ensureMeta("property", "og:locale", "vi_VN");

  // Twitter
  ensureMeta("name", "twitter:card", "summary_large_image");
  ensureMeta("name", "twitter:title", title || SITE_NAME);
  ensureMeta("name", "twitter:description", desc);
  ensureMeta("name", "twitter:image", absImg);
}

function saveMergedMoviesMap(map) {
  localStorage.setItem(MOVIE_MAP_KEY, JSON.stringify(map));
}

function getMergedMoviesMap() {
  try {
    return JSON.parse(localStorage.getItem(MOVIE_MAP_KEY)) || {};
  } catch {
    return {};
  }
}

function normalizeData(source, data) {
  const items = data.items || [];
  // pathImage từ phimapi đôi khi null — luôn fallback về chuỗi rỗng
  const domainImg = source === "phimapi" ? (data.pathImage || "") : "";
  const ophimBase = "https://img.ophim.live/uploads/movies/";

  function fixUrl(raw) {
    // Bỏ qua null, undefined, chuỗi "null", "undefined", rỗng
    if (!raw || raw === "null" || raw === "undefined") return "";
    if (raw.startsWith("http")) return raw;
    // Nếu domainImg rỗng (phimapi không trả pathImage) thì không ghép vô nghĩa
    const base = source === "ophim" ? ophimBase : domainImg;
    if (!base) return "";
    return base + raw;
  }

  return items.map((item) => {
    let thumb = fixUrl(item.thumb_url);
    let poster = fixUrl(item.poster_url);

    // Một số endpoint (vd /phim-moi-cap-nhat) không trả về `type`,
    // nhưng có `tmdb.type` = "tv" (series) hoặc "movie" (single).
    const tmdbType = item.tmdb?.type || "";
    let inferredType = item.type || "";
    if (!inferredType) {
      if (tmdbType === "tv") inferredType = "series";
      else if (tmdbType === "movie") inferredType = "single";
    }

    return {
      source,
      name: item.name,
      slug: item.slug,
      year: item.year || new Date().getFullYear(),
      type: inferredType,
      time: item.time || "",
      episode_current: item.episode_current || "",
      thumb,
      poster: poster || thumb,
    };
  });
}

function createMovieKey(movie) {
  return `${movie.name.trim().toLowerCase()}|${movie.year}`;
}

// Trả về chuỗi meta hiển thị dưới tên phim:
// - Phim bộ (type=series/hoathinh): số tập
// - Phim lẻ (type=single): thời lượng
// Trả về "" nếu không có dữ liệu
function formatMovieMeta(movie) {
  const t = (movie.type || "").toLowerCase();
  const isSeries = t === "series" || t === "hoathinh" || t === "tv";
  if (isSeries) {
    if (movie.episode_current) return movie.episode_current;
    if (movie.year) return `Phim bộ • ${movie.year}`;
    return "Phim bộ";
  }
  // phim lẻ hoặc không rõ
  if (movie.time) return movie.time;
  if (movie.year) return `Phim lẻ • ${movie.year}`;
  return "Phim lẻ";
}

async function fetchSourceList(source, page) {
  const response = await axios.get(`${API_CONFIG[source].list}?page=${page}`);
  return normalizeData(source, response.data);
}

async function fetchAndMergeMovies(page) {
  const results = await Promise.allSettled(
    MERGE_SOURCES.map((source) => fetchSourceList(source, page)),
  );

  const allMovies = [];
  results.forEach((result) => {
    if (result.status === "fulfilled") {
      allMovies.push(...result.value);
    }
  });

  const merged = getMergedMoviesMap();
  allMovies.forEach((movie) => {
    const key = createMovieKey(movie);
    if (!merged[key]) {
      merged[key] = {
        name: movie.name,
        year: movie.year,
        type: movie.type,
        time: movie.time,
        episode_current: movie.episode_current,
        thumb: movie.thumb,
        poster: movie.poster,
        sources: [{ source: movie.source, slug: movie.slug }],
      };
    } else {
      if (!merged[key].thumb && movie.thumb) merged[key].thumb = movie.thumb;
      if (!merged[key].poster && movie.poster)
        merged[key].poster = movie.poster;
      if (!merged[key].type && movie.type) merged[key].type = movie.type;
      if (!merged[key].time && movie.time) merged[key].time = movie.time;
      if (!merged[key].episode_current && movie.episode_current)
        merged[key].episode_current = movie.episode_current;
      const exists = merged[key].sources.some(
        (item) => item.source === movie.source && item.slug === movie.slug,
      );
      if (!exists) {
        merged[key].sources.push({ source: movie.source, slug: movie.slug });
      }
    }
  });

  saveMergedMoviesMap(merged);
  return Object.entries(merged).map(([key, movie]) => ({ key, ...movie }));
}

function goToDetail(movieKey) {
  window.location.href = `detail.html?movieKey=${encodeURIComponent(movieKey)}`;
}

// Gọi chi tiết để lấy đoạn mô tả (Content) cho Hero Banner
async function fetchDescriptionForHero(source, slug) {
  try {
    const response = await axios.get(`${API_CONFIG[source].detail}${slug}`);
    const content = response.data.movie?.content || "";
    const tmp = document.createElement("DIV");
    tmp.innerHTML = content;
    const text =
      tmp.textContent ||
      tmp.innerText ||
      "Trải nghiệm rạp chiếu phim tại gia với hệ thống NAS...";

    document.getElementById("heroDesc").innerText = text;
  } catch (e) {
    document.getElementById("heroDesc").innerText =
      "Trải nghiệm không gian điện ảnh đỉnh cao.";
  }
}

async function fetchHomeMovies(page = 1, append = false) {
  if (isFetching) return;
  isFetching = true;

  const grid = document.getElementById("movieGrid");
  const slider = document.getElementById("trendingSlider");

  if (!grid || !slider) return;

  if (!append) {
    grid.innerHTML = Array(12)
      .fill(
        '<div class="col-6 col-md-3 col-lg-2"><div class="skeleton skeleton-card"></div></div>',
      )
      .join("");
  }

  try {
    const movies = await fetchAndMergeMovies(page);

    if (!append) {
      grid.innerHTML = "";
      slider.innerHTML = "";
    }

    movies.forEach((movie, index) => {
      if (!append && index === 0) {
        document.getElementById("heroBanner").style.backgroundImage =
          `url('${movie.poster}')`;
        document.getElementById("heroTitle").innerText = movie.name;
        document.getElementById("heroMeta").innerHTML =
          `<span class="text-white border px-1 me-2" ">S</span> Series Mới Cập Nhật • ${movie.year}`;

        setMetaTags({
          title: `${movie.name} (${movie.year}) - SFLIX`,
          description: `Xem ${movie.name} (${movie.year}) vietsub chất lượng cao trên SFLIX. Phim bộ, phim lẻ, hoạt hình cập nhật nhanh nhất.`,
          image: movie.poster,
        });

        const playBtn = document.getElementById("heroPlayBtn");
        const detailBtn = document.getElementById("heroDetailBtn");
        playBtn.style.display = "inline-block";
        detailBtn.style.display = "inline-block";

        playBtn.onclick = () => goToDetail(movie.key);
        detailBtn.onclick = () => goToDetail(movie.key);

        if (movie.sources.length > 0) {
          fetchDescriptionForHero(
            movie.sources[0].source,
            movie.sources[0].slug,
          );
        }
      }

      const duplicateBadge =
        movie.sources.length > 1
          ? `<span class="badge bg-warning text-dark position-absolute top-0 end-0 m-2">${movie.sources.length} nguồn</span>`
          : "";

      const meta = formatMovieMeta(movie);
      const safeName = (movie.name || "").replace(/"/g, "&quot;");
      const thumbSrc = movie.thumb || movie.poster || "";
      const BLANK_IMG = "data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 2 3%22><rect width=%222%22 height=%223%22 fill=%22%23222%22/></svg>";
      const cardHTML = `
                <a href="detail.html?movieKey=${encodeURIComponent(movie.key)}" class="movie-card position-relative">
                    <img src="${thumbSrc || BLANK_IMG}" alt="${safeName}" loading="lazy" onerror="this.onerror=null;this.src='${BLANK_IMG}';this.style.background='%23222';">
                    ${duplicateBadge}
                    <div class="movie-info">
                        <div class="movie-title">${safeName}</div>
                        <div class="movie-meta-card">${meta}</div>
                    </div>
                </a>
            `;

      if (!append && index < 10)
        slider.innerHTML += `<div class="swiper-slide">${cardHTML}</div>`;
      else
        grid.innerHTML += `<div class="col-6 col-md-3 col-lg-2">${cardHTML}</div>`;
    });

    if (!append && window.Swiper) {
      if (swiperInstance) swiperInstance.destroy(true, true);
      swiperInstance = new Swiper(".mySwiper", {
        slidesPerView: 2,
        spaceBetween: 10,
        breakpoints: {
          576: { slidesPerView: 3, spaceBetween: 15 },
          768: { slidesPerView: 4, spaceBetween: 15 },
          992: { slidesPerView: 5, spaceBetween: 15 },
          1200: { slidesPerView: 6, spaceBetween: 15 },
        },
        freeMode: true,
      });
    }
  } catch (error) {
    console.error(error);
  } finally {
    isFetching = false;
  }
}

async function fetchSourceDetail(source, slug) {
  const response = await axios.get(`${API_CONFIG[source].detail}${slug}`);
  const movieData = response.data.movie;
  const ophimBase = "https://img.ophim.live/uploads/movies/";
  const domainImg =
    source === "ophim"
      ? ophimBase
      : response.data.pathImage || "";

  function fixUrl(raw) {
    if (!raw || raw === "null" || raw === "undefined") return "";
    if (raw.startsWith("http")) return raw;
    if (!domainImg) return "";
    return domainImg + raw;
  }

  const thumb = fixUrl(movieData.thumb_url);
  const poster = fixUrl(movieData.poster_url);

  const episodes = response.data.episodes?.[0]?.server_data || [];

  return {
    source,
    slug,
    movieData,
    episodes,
    thumb,
    poster: poster || thumb,
  };
}

function renderSourceButtons(sources, activeEntry) {
  const container = document.getElementById("sourceButtons");
  if (!container || !sources || sources.length <= 1) return;

  container.innerHTML = "";
  sources.forEach((entry) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-outline-light btn-sm me-2 mb-2 server-select-btn";
    if (
      activeEntry &&
      activeEntry.source === entry.source &&
      activeEntry.slug === entry.slug
    ) {
      btn.classList.add("active");
    }
    btn.innerText = SOURCE_LABELS[entry.source] || entry.source;
    btn.onclick = async () => {
      document
        .querySelectorAll("#sourceButtons .server-select-btn")
        .forEach((button) => button.classList.remove("active"));
      btn.classList.add("active");
      await loadMovieDetailSource(entry.source, entry.slug);
    };
    container.appendChild(btn);
  });
}

async function renderMovieDetail(detail) {
  const movieData = detail.movieData;
  const epListContainer = document.getElementById("episodeList");
  const epListPlayerContainer = document.getElementById("episodeListPlayer");
  if (!movieData || !epListContainer) return;

  document.getElementById("detailTitle").innerText = movieData.name;
  document.getElementById("detailOriginName").innerText =
    movieData.origin_name || "";
  document.getElementById("detailYear").innerText = movieData.year || "N/A";
  document.getElementById("detailContent").innerHTML =
    movieData.content || "Đang cập nhật...";
  document.getElementById("detailPoster").src = detail.thumb;
  document.getElementById("detailBackdrop").style.backgroundImage =
    `url('${detail.poster}')`;

  const cleanContent = (movieData.content || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  const descParts = [];
  if (movieData.origin_name) descParts.push(movieData.origin_name);
  if (movieData.year) descParts.push(`(${movieData.year})`);
  if (movieData.episode_current) descParts.push(`· ${movieData.episode_current}`);
  if (cleanContent) descParts.push(`· ${cleanContent}…`);
  setMetaTags({
    title: movieData.name,
    description: descParts.join(" ") || SITE_TAGLINE,
    image: detail.poster,
    type: "video.other",
  });

  epListContainer.innerHTML = "";
  if (epListPlayerContainer) epListPlayerContainer.innerHTML = "";

  if (!detail.episodes.length) {
    epListContainer.innerHTML =
      '<span class="text-muted">Không có tập/phim trong nguồn này.</span>';
    return;
  }

  detail.episodes.forEach((ep) => {
    const btn = document.createElement("button");
    btn.className = "ep-btn m-1";
    btn.innerText = ep.name || ep.episode || "Tập";
    btn.onclick = () => {
      document
        .querySelectorAll(".ep-btn")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      // Update player view buttons
      document
        .querySelectorAll("#episodeListPlayer .ep-btn")
        .forEach((b) => b.classList.remove("active"));

      playVideo(
        ep.embed || ep.link_embed || ep.url || ep.file,
        `Tập ${ep.name || ep.episode}`,
      );
    };
    epListContainer.appendChild(btn);

    // Create button for player view
    if (epListPlayerContainer) {
      const btnPlayer = document.createElement("button");
      btnPlayer.className = "ep-btn";
      btnPlayer.innerText = ep.name || ep.episode || "Tập";
      btnPlayer.onclick = () => {
        document
          .querySelectorAll(".ep-btn")
          .forEach((b) => b.classList.remove("active"));
        btnPlayer.classList.add("active");

        // Update detail view buttons
        document
          .querySelectorAll("#episodeList .ep-btn")
          .forEach((b) => b.classList.remove("active"));

        playVideo(
          ep.embed || ep.link_embed || ep.url || ep.file,
          `Tập ${ep.name || ep.episode}`,
        );
      };
      epListPlayerContainer.appendChild(btnPlayer);
    }
  });
}

async function loadMovieDetailBySlug(slug) {
  const results = await Promise.allSettled(
    MERGE_SOURCES.map(async (source) => ({
      source,
      slug,
      detail: await fetchSourceDetail(source, slug),
    })),
  );

  const available = results
    .filter((item) => item.status === "fulfilled")
    .map((item) => item.value);

  if (!available.length) {
    throw new Error("Không tìm thấy dữ liệu phim");
  }

  renderSourceButtons(
    available.map((item) => ({ source: item.source, slug: item.slug })),
    available[0],
  );
  await renderMovieDetail(available[0].detail);
}

async function loadMovieDetailSource(source, slug) {
  const detail = await fetchSourceDetail(source, slug);
  await renderMovieDetail(detail);
}

async function loadMovieDetail() {
  const urlParams = new URLSearchParams(window.location.search);
  const movieKey = urlParams.get("movieKey");
  const slug = urlParams.get("slug");
  const epListContainer = document.getElementById("episodeList");

  try {
    if (movieKey) {
      const movieMap = getMergedMoviesMap();
      const movieEntry = movieMap[movieKey];
      if (movieEntry) {
        renderSourceButtons(movieEntry.sources, movieEntry.sources[0]);
        await loadMovieDetailSource(
          movieEntry.sources[0].source,
          movieEntry.sources[0].slug,
        );
        return;
      }
    }

    if (slug) {
      await loadMovieDetailBySlug(slug);
    }
  } catch (error) {
    if (epListContainer) {
      epListContainer.innerHTML =
        '<span class="text-danger">Lỗi dữ liệu! Thử lại sau.</span>';
    }
    console.error(error);
  }
}

function playVideo(url, epName) {
  document.getElementById("videoPlayer").src = url;
  document.getElementById("playerTitleNav").innerText =
    document.getElementById("detailTitle").innerText + " - " + epName;

  document.getElementById("view-detail").style.display = "none";
  document.getElementById("view-player").style.display = "block";
  window.scrollTo(0, 0);
}

function switchToDetail() {
  document.getElementById("view-player").style.display = "none";
  document.getElementById("view-detail").style.display = "block";
  document.getElementById("videoPlayer").src = "";
  window.scrollTo(0, 0);
}

document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("view-home")) {
    fetchHomeMovies(1, false);
    document
      .getElementById("loadMoreBtn")
      .addEventListener("click", () => fetchHomeMovies(++currentPage, true));
  } else if (document.getElementById("view-detail")) {
    loadMovieDetail();
  }
});

// ============================================================
//  SEARCH — tìm kiếm phim theo tên qua phimapi
// ============================================================

(function () {
  const SEARCH_API = "https://phimapi.com/v1/api/tim-kiem";
  let searchTimer = null;
  let lastQuery = "";

  // ---- helpers ----

  function openSearch() {
    const overlay = document.getElementById("searchOverlay");
    if (!overlay) return;
    overlay.hidden = false;
    document.body.style.overflow = "hidden";
    setTimeout(() => {
      const input = document.getElementById("searchInput");
      if (input) input.focus();
    }, 50);
  }

  function closeSearch() {
    const overlay = document.getElementById("searchOverlay");
    if (!overlay) return;
    overlay.hidden = true;
    document.body.style.overflow = "";
    const input = document.getElementById("searchInput");
    if (input) input.value = "";
    lastQuery = "";
    const results = document.getElementById("searchResults");
    if (results) results.innerHTML = "";
  }

  function showStatus(html) {
    const el = document.getElementById("searchResults");
    if (el) el.innerHTML = `<div class="search-status">${html}</div>`;
  }

  function renderSearchResults(movies) {
    const el = document.getElementById("searchResults");
    if (!el) return;

    if (!movies || movies.length === 0) {
      showStatus("Không tìm thấy phim nào phù hợp.");
      return;
    }

    const cards = movies
      .map((movie) => {
        // Chuẩn hóa ảnh
        let thumb = movie.thumb_url || movie.poster_url || "";
        // Bỏ qua giá trị "null" dạng chuỗi từ API
        if (thumb === "null" || thumb === "undefined") thumb = "";
        if (thumb && !thumb.startsWith("http")) {
          thumb = "https://img.ophim.live/uploads/movies/" + thumb;
        }
        const fallback =
          "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 2 3'><rect width='2' height='3' fill='%23222'/></svg>";

        // Key để sang trang detail
        const key = `${(movie.name || "").trim().toLowerCase()}|${movie.year || ""}`;
        const href = `detail.html?movieKey=${encodeURIComponent(key)}&slug=${encodeURIComponent(movie.slug || "")}`;

        const safeName = (movie.name || "").replace(/"/g, "&quot;");
        const meta = movie.year
          ? movie.episode_current
            ? `${movie.year} • ${movie.episode_current}`
            : String(movie.year)
          : "";

        return `
          <a href="${href}" class="search-result-card" title="${safeName}">
            <img
              src="${thumb || fallback}"
              alt="${safeName}"
              loading="lazy"
              onerror="this.onerror=null;this.src='${fallback}';"
            />
            <div class="search-result-info">
              <div class="search-result-name">${safeName}</div>
              ${meta ? `<div class="search-result-meta">${meta}</div>` : ""}
            </div>
          </a>`;
      })
      .join("");

    el.innerHTML = `<div class="search-grid">${cards}</div>`;
  }

  async function doSearch(query) {
    query = query.trim();
    if (!query) {
      const el = document.getElementById("searchResults");
      if (el) el.innerHTML = "";
      return;
    }
    if (query === lastQuery) return;
    lastQuery = query;

    showStatus(
      '<i class="fa-solid fa-spinner fa-spin d-block mx-auto mb-2"></i>Đang tìm kiếm...'
    );

    try {
      const res = await axios.get(SEARCH_API, {
        params: { keyword: query, limit: 24 },
      });

      // phimapi trả về data.data.items hoặc data.items
      const items =
        res.data?.data?.items ||
        res.data?.items ||
        [];

      renderSearchResults(items);
    } catch (err) {
      console.error("Search error:", err);
      showStatus("Không thể tìm kiếm lúc này. Vui lòng thử lại.");
    }
  }

  // ---- wire up events after DOM ready ----

  function initSearch() {
    const overlay = document.getElementById("searchOverlay");
    if (!overlay) return; // trang không có overlay thì bỏ qua

    const input = document.getElementById("searchInput");
    const closeBtn = document.getElementById("searchCloseBtn");
    const btnDesktop = document.getElementById("searchBtnDesktop");

    // Mở overlay
    if (btnDesktop) btnDesktop.addEventListener("click", openSearch);

    // Đóng overlay
    if (closeBtn) closeBtn.addEventListener("click", closeSearch);

    // Click vào phần backdrop (ngoài search-box) để đóng
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeSearch();
    });

    // Phím Escape
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !overlay.hidden) closeSearch();
    });

    // Gõ vào ô input — debounce 400ms
    if (input) {
      input.addEventListener("input", () => {
        clearTimeout(searchTimer);
        const q = input.value.trim();
        if (!q) {
          lastQuery = "";
          const el = document.getElementById("searchResults");
          if (el) el.innerHTML = "";
          return;
        }
        searchTimer = setTimeout(() => doSearch(q), 400);
      });

      // Enter ngay lập tức
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          clearTimeout(searchTimer);
          doSearch(input.value);
        }
      });
    }
  }

  // Chạy sau khi DOM sẵn sàng (file này load ở cuối body nên thường đã sẵn)
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initSearch);
  } else {
    initSearch();
  }
})();
