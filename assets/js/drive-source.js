// ============================================================
//  DRIVE SOURCE — nguồn phim thủ công dùng Google Drive làm
//  video, tự động lấy tên phim + poster từ TMDB (fallback:
//  ảnh poster tự upload trong repo).
//
//  CÁCH DÙNG:
//  1. Lấy TMDB API key miễn phí tại:
//     https://www.themoviedb.org/settings/api
//  2. Điền vào TMDB_API_KEY bên dưới.
//  3. Thêm phim vào mảng DRIVE_MOVIES_RAW (chỉ cần slug, tên
//     tìm trên TMDB, và link Drive từng tập).
//  4. Include file này SAU main.js, TRƯỚC catalog.js/player.js
//     trong index.html / catalog.html / detail.html / player.html:
//       <script src="assets/js/drive-source.js"></script>
//  5. Trong main.js, tìm hàm fetchSourceDetail(source, slug) và
//     thêm 1 nhánh:
//       if (source === "drive") return await fetchDriveDetail(slug);
//     (Nếu hàm route theo case/switch, thêm case "drive" tương tự.)
//  6. Trong detail.html, phần #sourceButtons, thêm 1 nút:
//       <button data-source="drive">Drive</button>
//     (dùng đúng cách render nút nguồn hiện có trong main.js).
// ============================================================

const TMDB_API_KEY = "f5712ab1ab154951fab1c90db6e7d66a";
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";
const LOCAL_POSTER_DIR = "assets/images/posters/"; // ảnh tự up, đặt tên = slug.jpg

// ------------------------------------------------------------
// 1. Khai báo phim thủ công — CHỈ CẦN ĐIỀN PHẦN NÀY
// ------------------------------------------------------------
const DRIVE_MOVIES_RAW = [
  {
    slug: "spider-man-brand-new-day",
    tmdbQuery: "Spider-Man: Brand New Day",
    year: 2026,
    useLocalPoster: false,
    episodes: [
      { name: "HD", slug: "spider-man-brand-new-day", embed: "https://drive.google.com/file/d/1FOyr9bfBzT_g_OiRh2i2f1Th4nceZg-_/preview" },
    ],
  },
  // Thêm phim tiếp theo ở đây...
];

// ------------------------------------------------------------
// 2. Lấy metadata (tên, poster, mô tả) từ TMDB
// ------------------------------------------------------------
async function fetchTmdbMeta(query, year) {
  if (!query) return null;
  try {
    const res = await axios.get(`${TMDB_BASE}/search/multi`, {
      params: {
        api_key: TMDB_API_KEY,
        query,
        language: "vi-VN",
        year: year || undefined,
      },
    });
    const item = res.data?.results?.[0];
    if (!item) return null;
    return {
      name: item.title || item.name || query,
      origin_name: item.original_title || item.original_name || "",
      poster: item.poster_path ? `${TMDB_IMG}${item.poster_path}` : "",
      content: item.overview || "",
      year: (item.release_date || item.first_air_date || "").slice(0, 4) || year || "",
    };
  } catch (err) {
    console.warn("TMDB fetch lỗi, sẽ dùng fallback:", err.message);
    return null;
  }
}

// ------------------------------------------------------------
// 3. Ghép metadata: ưu tiên local poster nếu đánh dấu, không
//    thì thử TMDB, cuối cùng fallback placeholder.
// ------------------------------------------------------------
async function resolveMovieMeta(raw) {
  const localPoster = `${LOCAL_POSTER_DIR}${raw.slug}.jpg`;

  if (raw.useLocalPoster || !raw.tmdbQuery) {
    return {
      name: raw.tmdbQuery || raw.slug,
      origin_name: "",
      poster: localPoster,
      content: "",
      year: raw.year || "",
    };
  }

  const meta = await fetchTmdbMeta(raw.tmdbQuery, raw.year);
  if (meta) {
    // TMDB không có poster (hiếm) -> fallback local
    if (!meta.poster) meta.poster = localPoster;
    return meta;
  }

  // TMDB lỗi/không tìm thấy -> fallback toàn bộ về local + tên đã gõ
  return {
    name: raw.tmdbQuery,
    origin_name: "",
    poster: localPoster,
    content: "",
    year: raw.year || "",
  };
}

// ------------------------------------------------------------
// 4. Build catalog đầy đủ (dùng cho trang chủ / catalog.html)
//    Cache lại để khỏi gọi TMDB nhiều lần trong 1 phiên.
// ------------------------------------------------------------
let _driveCatalogCache = null;

async function buildDriveCatalog() {
  if (_driveCatalogCache) return _driveCatalogCache;
  _driveCatalogCache = await Promise.all(
    DRIVE_MOVIES_RAW.map(async (raw) => {
      const meta = await resolveMovieMeta(raw);
      return {
        slug: raw.slug,
        name: meta.name,
        origin_name: meta.origin_name,
        poster: meta.poster,
        thumb: meta.poster,
        year: meta.year,
        content: meta.content,
        episodeCount: raw.episodes.length,
      };
    }),
  );
  return _driveCatalogCache;
}

// ------------------------------------------------------------
// 5. Hàm tương thích với fetchSourceDetail(source, slug) sẵn có
//    Trả về đúng shape mà detail.html / player.js đang dùng:
//    { movieData: { name, ... }, poster, thumb, episodes }
// ------------------------------------------------------------
async function fetchDriveDetail(slug) {
  const raw = DRIVE_MOVIES_RAW.find((m) => m.slug === slug);
  if (!raw) throw new Error(`Không tìm thấy phim Drive với slug: ${slug}`);

  const meta = await resolveMovieMeta(raw);

  return {
    source: "drive",
    slug: raw.slug,
    movieData: {
      name: meta.name,
      origin_name: meta.origin_name,
      year: meta.year,
      description: meta.content,
    },
    poster: meta.poster,
    thumb: meta.poster,
    episodes: raw.episodes, // đã đúng shape { name, slug, embed } cho playEpisode()
  };
}

// ------------------------------------------------------------
// 6. Render section "Phim Drive" trên trang chủ (index.html)
//    Chỉ chạy nếu tìm thấy container #sliderDrive trên trang.
// ------------------------------------------------------------
async function renderDriveHomeSection() {
  const wrapper = document.getElementById("sliderDrive");
  if (!wrapper || !DRIVE_MOVIES_RAW.length) return;

  const catalog = await buildDriveCatalog();
  wrapper.innerHTML = catalog
    .map((movie) => {
      const safeName = (movie.name || "").replace(/"/g, "&quot;");
      return `
        <div class="swiper-slide">
          <a href="detail.html?slug=${encodeURIComponent(movie.slug)}&source=drive" class="movie-card">
            <div class="poster-wrap" style="--card-bg:url('${(movie.poster || "").replace(/'/g, "\\'")}')">
              <img src="${movie.poster || ""}" alt="${safeName}" loading="lazy"
                   onerror="this.onerror=null;this.src='assets/images/favicon.svg';">
              <div class="poster-overlay">
                <div class="play-badge"><i class="fa-solid fa-play"></i></div>
              </div>
            </div>
            <div class="movie-info">
              <div class="movie-title">${safeName}</div>
              <div class="movie-meta-card">${movie.year || ""} · ${movie.episodeCount} tập</div>
            </div>
          </a>
        </div>`;
    })
    .join("");

  if (window.Swiper) {
    new Swiper("#swiperDrive", {
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
  }
}

document.addEventListener("DOMContentLoaded", renderDriveHomeSection);