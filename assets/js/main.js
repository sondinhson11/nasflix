// NguonC API - nguồn phim vietsub lớn nhất, cập nhật liên tục
const API_CONFIG = {
  nguonc: {
    base: "https://phim.nguonc.com/api",
    listNew: "/films/phim-moi-cap-nhat",
    listSeries: "/films/danh-sach/phim-bo",
    listMovies: "/films/danh-sach/phim-le",
    listAnime: "/films/danh-sach/hoat-hinh",
    detail: (slug) => `/film/${slug}`,
    byCountry: (slug) => `/films/quoc-gia/${slug}`,
    byGenre: (slug) => `/films/the-loai/${slug}`,
    byYear: (year) => `/films/nam-phat-hanh/${year}`,
    search: (keyword) => `/films/search?keyword=${encodeURIComponent(keyword)}`,
    // CDN ảnh cố định
    imageBase: "https://phim.nguonc.com",
  },
};

// PhimAPI giữ làm fallback khi NguonC lỗi (chỉ dùng cho list/detail khi cần)
const API_CONFIG_FALLBACK = {
  phimapi: {
    base: "https://phimapi.com",
    listNew: "/danh-sach/phim-moi-cap-nhat",
    listSeries: "/v1/api/danh-sach/phim-bo",
    listMovies: "/v1/api/danh-sach/phim-le",
    listAnime: "/v1/api/danh-sach/hoat-hinh",
    detail: (slug) => `/phim/${slug}`,
  },
};

const MERGE_SOURCES = ["nguonc"];
const MOVIE_MAP_KEY = "SFLIX_merged_movies";
const MOVIE_MAP_VERSION = 1; // bump để vô hiệu hoá cache cũ khi schema đổi
const MOVIE_MAP_TTL_MS = 60 * 60 * 1000; // 1 giờ — sau đó reload từ API
const MOVIE_MAP_MAX_ENTRIES = 500; // LRU cap — tránh localStorage phình vô hạn
const SOURCE_LABELS = {
  nguonc: "NguonC",
  phimapi: "PhimAPI",
};

let currentPage = 1;
let isFetching = false;
// Registry để destroy swiper cũ trước khi tạo mới (tránh memory leak)
const swiperInstances = {};
// Track xem section country nào đang fetch để tránh duplicate request
const countryFetchState = {};

window.addEventListener("scroll", () => {
  const nav = document.getElementById("navbar");
  if (nav) {
    if (window.scrollY > 20) nav.classList.add("scrolled");
    else nav.classList.remove("scrolled");
  }
});

/* === MOBILE DROPDOWN NAV === */
(function initMobileMenu() {
  const navMenu = document.getElementById("navMenu");
  const navbar = document.getElementById("navbar");
  const toggler = document.querySelector(".navbar-toggler[data-bs-target='#navMenu']");
  if (!navMenu || !navbar || !toggler) return;

  // Helper: đồng bộ class .show với Bootstrap collapse & body.nav-open
  const sync = (open) => {
    if (open) {
      navMenu.classList.add("show");
      document.body.classList.add("nav-open");
    } else {
      navMenu.classList.remove("show");
      document.body.classList.remove("nav-open");
    }
  };

  // Bootstrap toggle — bắt sự kiện đóng/mở collapse
  navMenu.addEventListener("show.bs.collapse", () => sync(true));
  navMenu.addEventListener("hide.bs.collapse", () => sync(false));

  // Click vào link → đóng dropdown (auto-navigate)
  navMenu.querySelectorAll(".nav-link").forEach((a) => {
    a.addEventListener("click", () => {
      navMenu.classList.remove("show");
      document.body.classList.remove("nav-open");
    });
  });

  // Click vào backdrop / ngoài navbar → đóng dropdown
  document.addEventListener("click", (e) => {
    if (!document.body.classList.contains("nav-open")) return;
    if (!navbar.contains(e.target)) {
      navMenu.classList.remove("show");
      document.body.classList.remove("nav-open");
    }
  });

  // Phím Escape đóng dropdown
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.classList.contains("nav-open")) {
      navMenu.classList.remove("show");
      document.body.classList.remove("nav-open");
    }
  });
})();

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
  try {
    // LRU evict nếu vượt quá cap. Entry truy cập gần nhất nằm cuối object
    // → giữ lại MOVIE_MAP_MAX_ENTRIES entry cuối (mới nhất).
    const entries = Object.entries(map);
    let trimmed = map;
    if (entries.length > MOVIE_MAP_MAX_ENTRIES) {
      trimmed = Object.fromEntries(entries.slice(-MOVIE_MAP_MAX_ENTRIES));
    }
    const payload = {
      v: MOVIE_MAP_VERSION,
      t: Date.now(),
      map: trimmed,
    };
    localStorage.setItem(MOVIE_MAP_KEY, JSON.stringify(payload));
  } catch (e) {
    // localStorage full / disabled → bỏ qua, không crash
  }
}

function getMergedMoviesMap() {
  try {
    const raw = localStorage.getItem(MOVIE_MAP_KEY);
    if (!raw) return {};
    const payload = JSON.parse(raw);
    // Bỏ cache nếu version khác hoặc đã quá TTL
    if (!payload || payload.v !== MOVIE_MAP_VERSION) return {};
    if (typeof payload.t !== "number" || Date.now() - payload.t > MOVIE_MAP_TTL_MS) {
      return {};
    }
    return payload.map || {};
  } catch {
    return {};
  }
}

function normalizeData(source, data) {
  const items = data.items || data.data?.items || [];

  return items.map((item) => {
    // NguonC trả URL ảnh đầy đủ (https://phim.nguonc.com/...) — không cần build
    const thumb  = item.thumb_url || "";
    const poster = item.poster_url || item.thumb_url || "";

    // NguonC không trả type — phải suy ra từ total_episodes hoặc category từ detail
    let inferredType = item.type || "";
    if (!inferredType) {
      const totalEp = parseInt(item.total_episodes, 10);
      if (totalEp > 1) inferredType = "series";
      else inferredType = "single";
    }

    // Suy ra số tập hiện tại từ current_episode (vd "Tập 10", "Hoàn tất (12/12)")
    let episodeCurrent = "";
    const cur = item.current_episode || "";
    const match = cur.match(/(\d+)/);
    if (match) {
      const curEp = parseInt(match[1], 10);
      const totalEp = parseInt(item.total_episodes, 10);
      episodeCurrent = totalEp > 0 ? `${curEp}/${totalEp}` : `Tập ${curEp}`;
    } else if (cur) {
      episodeCurrent = cur;
    }

    return {
      source,
      name: item.name,
      slug: item.slug,
      year: parseInt(item.year, 10) || new Date().getFullYear(),
      type: inferredType,
      time: item.time || "",
      episode_current: episodeCurrent,
      thumb,
      poster,
      modifiedTime: item.modified || item.created || "",
    };
  });
}

// Parse chuỗi thời gian kiểu "2024-08-15 10:30:00" hoặc ISO về timestamp.
// Trả về 0 nếu không parse được — đẩy về cuối danh sách.
function parseModifiedTime(str) {
  if (!str) return 0;
  // thay space bằng "T" để trình duyệt hiểu là local datetime
  const normalized = String(str).trim().replace(" ", "T");
  const t = Date.parse(normalized);
  return Number.isFinite(t) ? t : 0;
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
  // NguonC dùng base + endpoint
  if (source === "nguonc") {
    const cfg = API_CONFIG.nguonc;
    const res = await axios.get(cfg.base + cfg.listNew, {
      params: { page },
    });
    return normalizeData("nguonc", res.data);
  }
  // Fallback (nếu cần)
  const cfg = API_CONFIG_FALLBACK[source];
  if (!cfg) throw new Error(`Unknown source: ${source}`);
  const res = await axios.get(cfg.base + cfg.listNew, { params: { page } });
  return normalizeData(source, res.data);
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
        modifiedTime: movie.modifiedTime || "",
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
      // Lấy thời gian cập nhật mới nhất trong mọi nguồn
      const newTs = parseModifiedTime(movie.modifiedTime);
      const oldTs = parseModifiedTime(merged[key].modifiedTime);
      if (newTs > oldTs) merged[key].modifiedTime = movie.modifiedTime;
      const exists = merged[key].sources.some(
        (item) => item.source === movie.source && item.slug === movie.slug,
      );
      if (!exists) {
        merged[key].sources.push({ source: movie.source, slug: movie.slug });
      }
    }
  });

  saveMergedMoviesMap(merged);

  // Sắp xếp theo modified.time mới nhất trước, có fallback về năm
  const list = Object.entries(merged).map(([key, movie]) => ({ key, ...movie }));
  list.sort((a, b) => {
    const ta = parseModifiedTime(a.modifiedTime);
    const tb = parseModifiedTime(b.modifiedTime);
    if (tb !== ta) return tb - ta;
    return (b.year || 0) - (a.year || 0);
  });
  return list;
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

async function fetchHomeMovies(page = 1) {
  if (isFetching) return;
  isFetching = true;

  const newUpdatedSlider = document.getElementById("movieGrid");

  if (!newUpdatedSlider) return;

  // Skeleton cho slider
  const skeletonSlides = Array(10)
    .fill('<div class="swiper-slide"><div class="skeleton skeleton-card"></div></div>')
    .join("");
  newUpdatedSlider.innerHTML = skeletonSlides;

  try {
    const [movies, rawList] = await Promise.all([
      fetchAndMergeMovies(page),
      fetchSourceList("nguonc", page),
    ]);

    newUpdatedSlider.innerHTML = "";

    const BLANK_IMG = "data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 2 3%22><rect width=%222%22 height=%223%22 fill=%22%23222%22/></svg>";

    // Enrich slider items: gắn `key` để card link đúng detail
    // Giữ nguyên thứ tự từ API (modified.time DESC).
    // `recentMap` dùng để truy sources, fallback nếu phim không có trong merged.
    const recentMap = {};
    movies.forEach((m) => { if (m.key) recentMap[m.key] = m; });
    const recent = rawList.slice(0, 20).map((item) => {
      const key = createMovieKey(item);
      const enriched = recentMap[key];
      return enriched
        ? { ...item, ...enriched }
        : { ...item, key, sources: [{ source: "nguonc", slug: item.slug }] };
    });
    const hero = movies[0];

    const renderCard = (movie) => {
      const meta     = formatMovieMeta(movie);
      const safeName = (movie.name || "").replace(/"/g, "&quot;");
      // Ưu tiên thumb (2/3 dọc) cho slider/card; poster (16/9 ngang) chỉ dùng cho Hero Banner
      const posterSrc = movie.thumb || movie.poster || "";
      const backdrop  = movie.poster || movie.thumb || "";
      return `
        <a href="detail.html?movieKey=${encodeURIComponent(movie.key)}" class="movie-card">
          <div class="poster-wrap" style="--card-bg:url('${backdrop.replace(/'/g, "\\'")}')">
            <div class="poster-skeleton"></div>
            <img src="${posterSrc || BLANK_IMG}" alt="${safeName}" loading="lazy"
                 referrerpolicy="no-referrer"
                 onload="this.parentElement.querySelector('.poster-skeleton')?.classList.add('hidden');this.classList.add('loaded');"
                 onerror="this.onerror=null;this.src='${BLANK_IMG}';this.parentElement.querySelector('.poster-skeleton')?.classList.add('hidden');this.classList.add('loaded');">
            <div class="poster-overlay">
              <div class="play-badge"><i class="fa-solid fa-play"></i></div>
            </div>
          </div>
          <div class="movie-info">
            <div class="movie-title">${safeName}</div>
            <div class="movie-meta-card">${meta}</div>
          </div>
        </a>`;
    };

    // ---- Hero Banner ----
    if (hero) {
      // Ưu tiên poster (thường là ảnh dọc, đẹp hơn thumb ngang),
      // nhưng pseudo ::before có sẵn blur + scale nên sẽ tự fill hero
      const heroBg = hero.poster || hero.thumb || "";
      if (heroBg) {
        document.getElementById("heroBanner").style.setProperty(
          "--hero-bg",
          `url('${heroBg}')`
        );
      }
      document.getElementById("heroTitle").innerText = hero.name;
      const heroTypeLabel =
        (hero.type === "single" || hero.type === "movie")
          ? "Phim Lẻ"
          : "Series Mới Cập Nhật";

      // Hero badge
      const heroBadge = document.getElementById("heroBadge");
      const heroBadgeText = document.getElementById("heroBadgeText");
      if (heroBadge && heroBadgeText) {
        heroBadge.style.display = "inline-flex";
        heroBadgeText.innerText = heroTypeLabel;
      }

      // Hero meta với pill style
      const metaYear = hero.year || "";
      const metaEp = formatMovieMeta(hero);
      document.getElementById("heroMeta").innerHTML = `
        <span class="match"><i class="fa-solid fa-circle-check"></i> 98% Phù hợp</span>
        <span class="meta-pill">${metaYear}</span>
        <span class="meta-pill meta-hd">HD</span>
        <span class="meta-pill">${metaEp}</span>
      `;

      setMetaTags({
        title: `${hero.name} (${hero.year}) - SFLIX`,
        description: `Xem ${hero.name} (${hero.year}) vietsub chất lượng cao trên SFLIX.`,
        image: hero.poster || hero.thumb,
      });

      const playBtn   = document.getElementById("heroPlayBtn");
      const detailBtn = document.getElementById("heroDetailBtn");
      playBtn.style.display   = "inline-flex";
      detailBtn.style.display = "inline-flex";
      playBtn.onclick   = () => goToDetail(hero.key);
      detailBtn.onclick = () => goToDetail(hero.key);

      if (hero.sources.length > 0) {
        fetchDescriptionForHero(hero.sources[0].source, hero.sources[0].slug);
      }
    }

    // ---- Mới Cập Nhật ----
    if (recent.length) {
      newUpdatedSlider.innerHTML = recent
        .map((movie) => `<div class="swiper-slide">${renderCard(movie)}</div>`)
        .join("");
    }

    // Khởi tạo swiper (destroy instance cũ để tránh memory leak)
    if (window.Swiper) {
      if (swiperInstances["mySwiper"]) swiperInstances["mySwiper"].destroy(true, true);
      const swiperConfig = {
        slidesPerView: 2,
        spaceBetween: 12,
        breakpoints: {
          576: { slidesPerView: 3, spaceBetween: 16 },
          768: { slidesPerView: 4, spaceBetween: 16 },
          992: { slidesPerView: 5, spaceBetween: 20 },
          1200: { slidesPerView: 6, spaceBetween: 20 },
        },
        freeMode: true,
        grabCursor: true,
      };
      swiperInstances["mySwiper"] = new Swiper(".mySwiper", swiperConfig);
    }
  } catch (error) {
    console.error(error);
  } finally {
    isFetching = false;
  }
}

async function fetchSourceDetail(source, slug) {
  if (source === "nguonc") {
    const cfg = API_CONFIG.nguonc;
    const res = await axios.get(cfg.base + cfg.detail(slug));
    if (res.data?.status !== "success" || !res.data.movie) {
      throw new Error("NguonC: invalid response");
    }
    const movieData = res.data.movie;
    // NguonC: episodes là array of {server_name, items: [{name, slug, embed}]}
    const servers = movieData.episodes || [];
    const episodes = [];
    servers.forEach((server) => {
      (server.items || []).forEach((item) => {
        episodes.push({
          name: item.name,
          slug: item.slug,
          embed: item.embed,
          filename: item.filename || "",
          server: server.server_name,
        });
      });
    });

    return {
      source,
      slug,
      movieData,
      episodes,
      servers,
      thumb: movieData.thumb_url || "",
      poster: movieData.poster_url || movieData.thumb_url || "",
    };
  }

  // Fallback
  const cfg = API_CONFIG_FALLBACK[source];
  if (!cfg) throw new Error(`Unknown source: ${source}`);
  const response = await axios.get(cfg.base + cfg.detail(slug));
  const movieData = response.data.movie;
  const episodes = response.data.episodes?.[0]?.server_data || [];
  return {
    source,
    slug,
    movieData,
    episodes,
    thumb: movieData.thumb_url || "",
    poster: movieData.poster_url || movieData.thumb_url || "",
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
    movieData.original_name || movieData.origin_name || "";
  document.getElementById("detailYear").innerText = movieData.year || "N/A";
  document.getElementById("detailContent").innerHTML =
    movieData.description || movieData.content || "Đang cập nhật...";
  document.getElementById("detailPoster").src = detail.poster || detail.thumb;
  document.getElementById("detailBackdrop").style.backgroundImage =
    `url('${detail.poster || detail.thumb}')`;

  const cleanContent = (movieData.description || movieData.content || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  const descParts = [];
  if (movieData.original_name || movieData.origin_name) descParts.push(movieData.original_name || movieData.origin_name);
  if (movieData.year) descParts.push(`(${movieData.year})`);
  if (movieData.current_episode || movieData.episode_current) {
    descParts.push(`· ${movieData.current_episode || movieData.episode_current}`);
  }
  if (cleanContent) descParts.push(`· ${cleanContent}…`);
  setMetaTags({
    title: movieData.name,
    description: descParts.join(" ") || SITE_TAGLINE,
    image: detail.poster,
    type: "video.other",
  });

  epListContainer.innerHTML = "";
  if (epListPlayerContainer) epListPlayerContainer.innerHTML = "";

  renderEpisodeLists(detail.episodes, {
    detailContainer: epListContainer,
    playerContainer: epListPlayerContainer,
    source: detail.source,
    slug: detail.slug,
    onPlay: (ep) => {
      // Cập nhật URL query để có thể share / refresh vẫn giữ tập
      const url = new URL(window.location.href);
      url.searchParams.set("source", detail.source);
      url.searchParams.set("slug", detail.slug);
      url.searchParams.set("ep", ep.slug || ep.name || "");
      window.history.replaceState({}, "", url.toString());
    },
  });

  // Nút "Xem ngay" → mở player.html với tập đầu tiên (hoặc tập đang active)
  const watchBtn = document.getElementById("watchNowBtn");
  if (watchBtn) {
    watchBtn.onclick = () => {
      const firstBtn =
        epListContainer.querySelector(".ep-btn") ||
        epListPlayerContainer?.querySelector(".ep-btn");
      if (firstBtn) {
        firstBtn.click();
      } else if (detail.episodes.length > 0) {
        const firstEp = detail.episodes[0];
        playVideo(
          firstEp.embed || firstEp.link_embed || firstEp.url || firstEp.file,
          `Tập ${firstEp.name || firstEp.episode}`,
          { source: detail.source, slug: detail.slug, ep: firstEp },
        );
      }
    };
  }
}

/**
 * Render danh sách tập vào 2 container (detail + player sidebar) một cách đồng bộ.
 * Mỗi episode được gán data-ep-key duy nhất; click ở container nào thì
 * container kia cũng active theo cùng key → không bao giờ lệch.
 */
function renderEpisodeLists(episodes, opts) {
  const { detailContainer, playerContainer, onPlay } = opts || {};
  if (!detailContainer) return;

  // Chuẩn bị key duy nhất cho từng episode để đồng bộ 2 danh sách
  const normalized = episodes.map((ep, idx) => {
    const key = ep.slug || `${ep.name || ep.episode || "tap"}-${idx}`;
    return { ep, key };
  });

  const buildBtn = (epObj, { compact }) => {
    const btn = document.createElement("button");
    btn.className = "ep-btn" + (compact ? "" : " m-1");
    btn.type = "button";
    btn.dataset.epKey = epObj.key;
    btn.innerText = epObj.ep.name || epObj.ep.episode || "Tập";
    btn.addEventListener("click", () => {
      // Đồng bộ active theo key ở cả 2 danh sách
      document
        .querySelectorAll(".ep-btn[data-ep-key]")
        .forEach((b) => b.classList.remove("active"));
      document
        .querySelectorAll(`.ep-btn[data-ep-key="${cssEscape(epObj.key)}"]`)
        .forEach((b) => b.classList.add("active"));
      if (typeof onPlay === "function") onPlay(epObj.ep);
      // Truyền slug + source + ep để playVideo chuyển sang player.html
      playVideo(
        epObj.ep.embed || epObj.ep.link_embed || epObj.ep.url || epObj.ep.file,
        `Tập ${epObj.ep.name || epObj.ep.episode}`,
        {
          source: opts.source,
          slug: opts.slug,
          ep: epObj.ep,
        },
      );
    });
    return btn;
  };

  detailContainer.innerHTML = "";
  if (playerContainer) playerContainer.innerHTML = "";

  if (!normalized.length) {
    detailContainer.innerHTML =
      '<span class="text-muted">Không có tập/phim trong nguồn này.</span>';
    return;
  }

  normalized.forEach((epObj) => {
    detailContainer.appendChild(buildBtn(epObj, { compact: false }));
    if (playerContainer) {
      playerContainer.appendChild(buildBtn(epObj, { compact: true }));
    }
  });
}

// Escape an toàn cho giá trị trong CSS selector
function cssEscape(value) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return String(value).replace(/[^a-zA-Z0-9_\-]/g, (c) => `\\${c}`);
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
  const initialEp = urlParams.get("ep");
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
        activateEpisodeFromQuery(initialEp);
        return;
      }
    }

    if (slug) {
      await loadMovieDetailBySlug(slug);
      activateEpisodeFromQuery(initialEp);
    }
  } catch (error) {
    if (epListContainer) {
      epListContainer.innerHTML =
        '<span class="text-danger">Lỗi dữ liệu! Thử lại sau.</span>';
    }
    console.error(error);
  }
}

// Click tập ứng với ?ep=... nếu có (key khớp)
function activateEpisodeFromQuery(epKey) {
  if (!epKey) return;
  // Đợi DOM render xong danh sách tập
  requestAnimationFrame(() => {
    const btn = document.querySelector(
      `.ep-btn[data-ep-key="${cssEscape(epKey)}"]`,
    );
    if (btn) btn.click();
  });
}

function playVideo(url, epName, opts = {}) {
  // Mặc định: chuyển sang trang player.html riêng (mở như trang mới, không phải modal)
  // Nếu muốn dùng modal cũ, truyền { inline: true } khi gọi
  if (!opts.inline) {
    const params = new URLSearchParams(window.location.search);
    const source = opts.source || params.get("source") || "nguonc";
    const ep = opts.ep || "";
    const slug = opts.slug || params.get("slug") || "";
    const movieKey = params.get("movieKey") || "";

    // Lưu tạm vào sessionStorage để player.html biết đường quay lại
    try {
      sessionStorage.setItem(
        "SFLIX_player_back",
        JSON.stringify({
          movieKey,
          slug,
          source,
        }),
      );
    } catch (e) {
      /* ignore */
    }

    const qs = new URLSearchParams({
      source,
      slug,
      ep: ep.slug || ep.name || ep,
    });
    if (movieKey) qs.set("movieKey", movieKey);

    window.location.href = `player.html?${qs.toString()}`;
    return;
  }

  // Fallback: dùng modal cũ (nếu trang nào đó vẫn còn view-player)
  const player = document.getElementById("videoPlayer");
  if (player) player.src = url;
  const nav = document.getElementById("playerTitleNav");
  if (nav)
    nav.innerText =
      (document.getElementById("detailTitle")?.innerText || "") +
      " - " +
      epName;
  const viewDetail = document.getElementById("view-detail");
  const viewPlayer = document.getElementById("view-player");
  if (viewDetail) viewDetail.style.display = "none";
  if (viewPlayer) viewPlayer.style.display = "block";
  window.scrollTo(0, 0);
}

// (Đã bỏ switchToDetail — player giờ là trang riêng)

// ============================================================
//  COUNTRY SECTIONS — fetch & render slider theo quốc gia
// ============================================================

async function fetchCountrySection(countrySlug, sliderId, swiperId) {
  // Guard: tránh duplicate request khi user refresh/click nhanh
  if (countryFetchState[countrySlug] === "loading") return;
  countryFetchState[countrySlug] = "loading";

  const sliderEl = document.getElementById(sliderId);
  if (!sliderEl) {
    countryFetchState[countrySlug] = "idle";
    return;
  }

  // Skeleton trong khi chờ API
  sliderEl.innerHTML = Array(8)
    .fill('<div class="swiper-slide"><div class="skeleton skeleton-card"></div></div>')
    .join("");

  try {
    const cfg = API_CONFIG.nguonc;
    const res = await axios.get(cfg.base + cfg.byCountry(countrySlug), {
      params: { page: 1 },
    });
    const raw = res.data?.items || [];

    // Chuẩn hoá sang format chung (poster_url, episode_current...)
    const items = raw.map((it) => {
      const totalEp = parseInt(it.total_episodes, 10) || 0;
      let epCur = "";
      const cur = it.current_episode || "";
      const m = cur.match(/(\d+)/);
      if (m) {
        const curNum = parseInt(m[1], 10);
        epCur = totalEp > 0 ? `${curNum}/${totalEp}` : `Tập ${curNum}`;
      } else if (cur) {
        epCur = cur;
      }
      return {
        name: it.name,
        slug: it.slug,
        year: parseInt(it.year, 10) || new Date().getFullYear(),
        type: totalEp > 1 ? "series" : "single",
        time: it.time || "",
        episode_current: epCur,
        poster_url: it.poster_url || "",
        thumb_url: it.thumb_url || "",
        modified: it.modified || "",
      };
    });

    if (!items.length) {
      sliderEl.innerHTML =
        '<div class="swiper-slide"><p class="text-muted small px-2">Không có dữ liệu.</p></div>';
      return;
    }

    const BLANK_IMG =
      "data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 2 3%22><rect width=%222%22 height=%223%22 fill=%22%23222%22/></svg>";

    // Đọc cache TRƯỚC khi sort: country endpoint không trả `modified`,
    // nhưng có thể phim đã từng xuất hiện trong listNew → merged cache có modifiedTime.
    // Ưu tiên sort theo modifiedTime, fallback year DESC.
    const merged = getMergedMoviesMap();

    items.sort((a, b) => {
      const keyA = `${(a.name || "").trim().toLowerCase()}|${a.year || ""}`;
      const keyB = `${(b.name || "").trim().toLowerCase()}|${b.year || ""}`;
      const ta = parseModifiedTime(merged[keyA]?.modifiedTime) || parseModifiedTime(a.modified);
      const tb = parseModifiedTime(merged[keyB]?.modifiedTime) || parseModifiedTime(b.modified);
      if (tb !== ta) return tb - ta;
      return (b.year || 0) - (a.year || 0);
    });

    // Gộp các phim của country vào merged map để khi user click vào xem
    // detail thì loadMovieDetail tìm được entry → có danh sách sources
    items.forEach((item) => {
      const key = `${(item.name || "").trim().toLowerCase()}|${item.year || ""}`;
      const mtime = item.modified || "";
      const existing = merged[key];
      if (!existing) {
        merged[key] = {
          name: item.name,
          year: item.year,
          type: item.type,
          time: item.time || "",
          episode_current: item.episode_current || "",
          thumb: item.thumb_url || "",
          poster: item.poster_url || item.thumb_url || "",
          modifiedTime: mtime,
          sources: [{ source: "nguonc", slug: item.slug }],
        };
      } else {
        if (!existing.poster && item.poster_url) existing.poster = item.poster_url;
        if (!existing.thumb && item.thumb_url) existing.thumb = item.thumb_url;
        const newTs = parseModifiedTime(mtime);
        const oldTs = parseModifiedTime(existing.modifiedTime);
        if (newTs > oldTs) existing.modifiedTime = mtime;
        const hasSource = existing.sources.some(
          (s) => s.source === "nguonc" && s.slug === item.slug,
        );
        if (!hasSource) {
          existing.sources.push({ source: "nguonc", slug: item.slug });
        }
      }
    });
    saveMergedMoviesMap(merged);

    sliderEl.innerHTML = items
      .map((item) => {
        // NguonC: thumb = 2/3 (poster thật), poster = 16/9 (backdrop)
        // Card grid 2/3 cần dùng thumb_url; poster dùng làm background blur
        const thumb  = item.thumb_url || "";
        const poster = item.poster_url || "";

        const key = `${(item.name || "").trim().toLowerCase()}|${item.year || ""}`;
        const href = `detail.html?movieKey=${encodeURIComponent(key)}&slug=${encodeURIComponent(item.slug || "")}`;
        const safeName = (item.name || "").replace(/"/g, "&quot;");
        const ep = item.episode_current || item.time || (item.year ? String(item.year) : "");
        const posterStyle = poster
          ? `style="--card-bg:url('${poster.replace(/'/g, "\\'")}')"`
          : "";

        return `
          <div class="swiper-slide">
            <a href="${href}" class="movie-card">
              <div class="poster-wrap" ${posterStyle}>
                <div class="poster-skeleton"></div>
                <img
                  src="${thumb || BLANK_IMG}"
                  alt="${safeName}"
                  loading="lazy"
                  referrerpolicy="no-referrer"
                  onload="this.parentElement.querySelector('.poster-skeleton')?.classList.add('hidden');this.classList.add('loaded');"
                  onerror="this.onerror=null;this.src='${BLANK_IMG}';this.parentElement.querySelector('.poster-skeleton')?.classList.add('hidden');this.classList.add('loaded');"
                />
                <div class="poster-overlay">
                  <div class="play-badge"><i class="fa-solid fa-play"></i></div>
                </div>
              </div>
              <div class="movie-info">
                <div class="movie-title">${safeName}</div>
                ${ep ? `<div class="movie-meta-card">${ep}</div>` : ""}
              </div>
            </a>
          </div>`;
      })
      .join("");

    // Khởi tạo swiper (destroy cũ nếu có) — dùng registry chung
    if (swiperInstances[swiperId]) {
      swiperInstances[swiperId].destroy(true, true);
    }
    swiperInstances[swiperId] = new Swiper(`#${swiperId}`, {
      slidesPerView: 2,
      spaceBetween: 12,
      breakpoints: {
        576: { slidesPerView: 3, spaceBetween: 16 },
        768: { slidesPerView: 4, spaceBetween: 16 },
        992: { slidesPerView: 5, spaceBetween: 20 },
        1200: { slidesPerView: 6, spaceBetween: 20 },
      },
      freeMode: true,
      grabCursor: true,
    });
  } catch (err) {
    console.error(`fetchCountrySection(${countrySlug}) error:`, err);
    const sliderEl2 = document.getElementById(sliderId);
    if (sliderEl2) {
      sliderEl2.innerHTML =
        '<div class="swiper-slide"><p class="text-danger small px-2">Lỗi tải dữ liệu.</p></div>';
    }
  } finally {
    countryFetchState[countrySlug] = "idle";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("view-home")) {
    fetchHomeMovies(1);

    // Load 3 section quốc gia song song
    fetchCountrySection("han-quoc",   "sliderHanQuoc",   "swiperHanQuoc");
    fetchCountrySection("trung-quoc", "sliderTrungQuoc", "swiperTrungQuoc");
    fetchCountrySection("au-my",      "sliderAuMy",      "swiperAuMy");
  } else if (document.getElementById("view-detail")) {
    loadMovieDetail();
  }
});

// ============================================================
//  SEARCH — tìm kiếm phim theo tên qua NguonC
// ============================================================

(function () {
  const SEARCH_API = "https://phim.nguonc.com/api/films/search";
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

  function buildSearchCardHtml(movie) {
    // NguonC trả URL ảnh đầy đủ
    let thumb = movie.poster_url || movie.thumb_url || "";
    if (thumb === "null" || thumb === "undefined") thumb = "";
    const fallback =
      "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 2 3'><rect width='2' height='3' fill='%23222'/></svg>";

    const key = `${(movie.name || "").trim().toLowerCase()}|${movie.year || ""}`;
    const href = `detail.html?movieKey=${encodeURIComponent(key)}&slug=${encodeURIComponent(movie.slug || "")}`;

    const safeName = (movie.name || "").replace(/"/g, "&quot;");
    // NguonC dùng current_episode thay cho episode_current
    let epCur = "";
    const cur = movie.current_episode || movie.episode_current || "";
    const m = cur.match(/(\d+)/);
    if (m) {
      const totalEp = parseInt(movie.total_episodes, 10);
      epCur = totalEp > 0 ? `${m[1]}/${totalEp}` : `Tập ${m[1]}`;
    } else if (cur) {
      epCur = cur;
    }
    const metaParts = [];
    if (movie.year) metaParts.push(String(movie.year));
    if (epCur) metaParts.push(epCur);
    const meta = metaParts.join(" • ");

    return `
          <a href="${href}" class="search-result-card" title="${safeName}">
            <img
              src="${thumb || fallback}"
              alt="${safeName}"
              loading="lazy"
              referrerpolicy="no-referrer"
              onerror="this.onerror=null;this.src='${fallback}';"
            />
            <div class="search-result-info">
              <div class="search-result-name">${safeName}</div>
              ${meta ? `<div class="search-result-meta">${meta}</div>` : ""}
            </div>
          </a>`;
  }

  function renderSearchResults(movies, paginate) {
    const el = document.getElementById("searchResults");
    if (!el) return;

    if (!movies || movies.length === 0) {
      showStatus("Không tìm thấy phim nào phù hợp.");
      return;
    }

    const cards = movies.map(buildSearchCardHtml).join("");

    const totalItems = paginate?.total_items || movies.length;
    const currentPage = paginate?.current_page || 1;
    const totalPages  = paginate?.total_page || 1;
    const shown       = movies.length;
    const summaryHtml =
      totalItems > shown
        ? `<div class="search-summary">Hiển thị ${shown} / <strong>${totalItems}</strong> kết quả · trang ${currentPage}/${totalPages}</div>`
        : `<div class="search-summary">Tìm thấy <strong>${totalItems}</strong> kết quả</div>`;

    const loadMoreHtml =
      currentPage < totalPages
        ? `<button type="button" class="btn-search-loadmore" id="searchLoadMoreBtn">
             <i class="fa-solid fa-rotate me-2"></i>Xem thêm kết quả (còn ${totalPages - currentPage} trang)
           </button>`
        : "";

    el.innerHTML = `
      ${summaryHtml}
      <div class="search-grid">${cards}</div>
      ${loadMoreHtml}
    `;

    if (currentPage < totalPages) {
      const btn = document.getElementById("searchLoadMoreBtn");
      if (btn) {
        btn.addEventListener("click", () => doSearch(lastQuery, (currentPage + 1), true));
      }
    }
  }

  async function doSearch(query, page = 1, append = false) {
    query = query.trim();
    if (!query) {
      const el = document.getElementById("searchResults");
      if (el) el.innerHTML = "";
      return;
    }
    if (!append && query === lastQuery) return;
    lastQuery = query;

    if (!append) {
      showStatus(
        '<i class="fa-solid fa-spinner fa-spin d-block mx-auto mb-2"></i>Đang tìm kiếm...'
      );
    }

    try {
      const res = await axios.get(SEARCH_API, {
        params: { keyword: query, limit: 24, page },
      });

      // NguonC trả {status, paginate, items}
      const items = res.data?.items || [];
      const paginate = res.data?.paginate || null;

      if (append) {
        // Append kết quả mới vào grid hiện tại
        const grid = document.querySelector(".search-grid");
        const existing = document.querySelectorAll(".search-result-card").length;
        if (grid) {
          const newCards = items
            .map((movie) => buildSearchCardHtml(movie))
            .join("");
          grid.insertAdjacentHTML("beforeend", newCards);
        }
        // Cập nhật tổng kết + nút load more
        const summary = document.querySelector(".search-summary");
        const btn = document.getElementById("searchLoadMoreBtn");
        const totalShown = existing + items.length;
        const totalItems = paginate?.total_items || totalShown;
        const currentPage = paginate?.current_page || page;
        const totalPages = paginate?.total_page || page;
        if (summary) {
          summary.innerHTML = `Hiển thị ${totalShown} / <strong>${totalItems}</strong> kết quả · trang ${currentPage}/${totalPages}`;
        }
        if (currentPage < totalPages && btn) {
          btn.outerHTML = `<button type="button" class="btn-search-loadmore" id="searchLoadMoreBtn">
             <i class="fa-solid fa-rotate me-2"></i>Xem thêm kết quả (còn ${totalPages - currentPage} trang)
           </button>`;
          document
            .getElementById("searchLoadMoreBtn")
            ?.addEventListener("click", () =>
              doSearch(lastQuery, currentPage + 1, true)
            );
        } else if (btn) {
          btn.remove();
        }
      } else {
        renderSearchResults(items, paginate);
      }
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

    // Phím tắt: Ctrl+K / Cmd+K / "/" để mở search (giống GitHub, YouTube)
    document.addEventListener("keydown", (e) => {
      const isTyping =
        document.activeElement &&
        (document.activeElement.tagName === "INPUT" ||
          document.activeElement.tagName === "TEXTAREA" ||
          document.activeElement.isContentEditable);
      if (isTyping) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openSearch();
      } else if (e.key === "/") {
        e.preventDefault();
        openSearch();
      }
    });

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
