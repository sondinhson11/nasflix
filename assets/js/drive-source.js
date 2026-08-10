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

const DRIVE_ADMIN_USER = "sondinhson11";
const DRIVE_ADMIN_PASS = "As1029384";
const DRIVE_ADMIN_STORAGE_KEY = "SFLIX_drive_movies_raw";
const DRIVE_ADMIN_SESSION_KEY = "SFLIX_drive_admin_logged_in";
const DRIVE_ADMIN_REMOTE_DATA_URL = "assets/data/drive-movies.json";
let driveMoviesRawState = null;
let driveAdminOverlayEl = null;
let driveAdminActiveEditIndex = -1;

function getDriveMoviesRaw() {
  if (driveMoviesRawState) return driveMoviesRawState;

  try {
    const stored = localStorage.getItem(DRIVE_ADMIN_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        driveMoviesRawState = parsed;
        return driveMoviesRawState;
      }
    }
  } catch (err) {
    console.warn(
      "Không thể đọc DRIVE_MOVIES_RAW từ localStorage:",
      err.message,
    );
  }

  driveMoviesRawState = JSON.parse(JSON.stringify(DRIVE_MOVIES_RAW));
  return driveMoviesRawState;
}

function saveDriveMoviesRaw(movies) {
  driveMoviesRawState = movies;
  invalidateDriveCatalogCache();

  try {
    localStorage.setItem(DRIVE_ADMIN_STORAGE_KEY, JSON.stringify(movies));
  } catch (err) {
    console.warn(
      "Không thể lưu DRIVE_MOVIES_RAW vào localStorage:",
      err.message,
    );
  }
}

async function fetchRemoteDriveMoviesRaw() {
  if (!DRIVE_ADMIN_REMOTE_DATA_URL) return null;

  try {
    const response = await fetch(DRIVE_ADMIN_REMOTE_DATA_URL, {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const remoteData = await response.json();
    if (!Array.isArray(remoteData)) {
      throw new Error("Dữ liệu remote không phải mảng.");
    }

    return remoteData;
  } catch (err) {
    console.warn("Không thể lấy dữ liệu Drive remote:", err.message);
    return null;
  }
}

async function refreshDriveMoviesRawFromRemote() {
  const remoteMovies = await fetchRemoteDriveMoviesRaw();
  if (!remoteMovies) return;

  const localMovies = getDriveMoviesRaw();
  const localJson = JSON.stringify(localMovies);
  const remoteJson = JSON.stringify(remoteMovies);
  if (localJson !== remoteJson) {
    saveDriveMoviesRaw(remoteMovies);
    console.info("Drive movies đã được làm mới từ dữ liệu remote.");
  }
}

function invalidateDriveCatalogCache() {
  _driveCatalogCache = null;
}

function isDriveAdminLoggedIn() {
  return localStorage.getItem(DRIVE_ADMIN_SESSION_KEY) === "1";
}

function setDriveAdminLoggedIn(value) {
  if (value) {
    localStorage.setItem(DRIVE_ADMIN_SESSION_KEY, "1");
  } else {
    localStorage.removeItem(DRIVE_ADMIN_SESSION_KEY);
  }
}

function parseDriveEpisodesString(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("|").map((part) => part.trim());
      return {
        name: parts[0] || "",
        slug: parts[1] || "",
        embed: parts[2] || "",
      };
    });
}

function formatDriveEpisodes(episodes) {
  return (episodes || [])
    .map((episode) => `${episode.name} | ${episode.slug} | ${episode.embed}`)
    .join("\n");
}

function createDriveAdminOverlay() {
  if (driveAdminOverlayEl) return;

  const overlay = document.createElement("div");
  overlay.className = "drive-admin-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="drive-admin-panel">
      <div class="drive-admin-header">
        <div>
          <h3>Quản lý Phim Drive</h3>
          <p class="drive-admin-subtitle">Đăng nhập để thêm, sửa, xóa phim Drive.</p>
        </div>
        <button type="button" class="drive-admin-close" aria-label="Đóng">×</button>
      </div>
      <div class="drive-admin-body">
        <div id="driveAdminLogin" class="drive-admin-login">
          <div class="drive-admin-field">
            <label for="driveAdminUsername">Tài khoản</label>
            <input id="driveAdminUsername" type="text" autocomplete="username" placeholder="Tài khoản" />
          </div>
          <div class="drive-admin-field">
            <label for="driveAdminPassword">Mật khẩu</label>
            <input id="driveAdminPassword" type="password" autocomplete="current-password" placeholder="Mật khẩu" />
          </div>
          <div class="drive-admin-actions">
            <button type="button" id="driveAdminLoginBtn" class="drive-admin-btn">Đăng nhập</button>
          </div>
          <div id="driveAdminMessage" class="drive-admin-message"></div>
        </div>
        <div id="driveAdminManage" class="drive-admin-manage" hidden>
          <div class="drive-admin-actions-row">
            <button type="button" id="driveAdminAddBtn" class="drive-admin-btn drive-admin-btn-primary">Thêm phim mới</button>
            <button type="button" id="driveAdminLogoutBtn" class="drive-admin-btn drive-admin-btn-secondary">Đăng xuất</button>
          </div>
          <div id="driveAdminMovieList" class="drive-admin-movie-list"></div>
          <div class="drive-admin-form" id="driveAdminFormContainer" hidden>
            <h4 id="driveAdminFormTitle">Thêm / Sửa phim Drive</h4>
            <div class="drive-admin-field">
              <label for="driveMovieSlug">Slug</label>
              <input id="driveMovieSlug" type="text" placeholder="spider-man-brand-new-day" />
            </div>
            <div class="drive-admin-field">
              <label for="driveMovieQuery">TMDB Query</label>
              <input id="driveMovieQuery" type="text" placeholder="Spider-Man: Brand New Day" />
            </div>
            <div class="drive-admin-field">
              <label for="driveMovieYear">Năm</label>
              <input id="driveMovieYear" type="number" placeholder="2026" />
            </div>
            <div class="drive-admin-field drive-admin-checkbox-field">
              <label><input id="driveMovieUseLocalPoster" type="checkbox" /> Dùng ảnh poster local</label>
            </div>
            <div class="drive-admin-field">
              <label for="driveMovieEpisodes">Tập phim (1 dòng = name | slug | embed)</label>
              <textarea id="driveMovieEpisodes" rows="6" placeholder="HD | spider-man-brand-new-day | https://drive.google.com/file/d/…/preview"></textarea>
            </div>
            <div class="drive-admin-actions-row">
              <button type="button" id="driveAdminSaveBtn" class="drive-admin-btn drive-admin-btn-primary">Lưu</button>
              <button type="button" id="driveAdminCancelBtn" class="drive-admin-btn drive-admin-btn-secondary">Hủy</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  driveAdminOverlayEl = overlay;

  overlay
    .querySelector(".drive-admin-close")
    .addEventListener("click", closeDriveAdminPanel);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      closeDriveAdminPanel();
    }
  });

  const loginBtn = overlay.querySelector("#driveAdminLoginBtn");
  const logoutBtn = overlay.querySelector("#driveAdminLogoutBtn");
  const addBtn = overlay.querySelector("#driveAdminAddBtn");
  const saveBtn = overlay.querySelector("#driveAdminSaveBtn");
  const cancelBtn = overlay.querySelector("#driveAdminCancelBtn");

  loginBtn.addEventListener("click", handleDriveAdminLogin);
  logoutBtn.addEventListener("click", handleDriveAdminLogout);
  addBtn.addEventListener("click", () => openDriveAdminForm());
  saveBtn.addEventListener("click", handleDriveAdminSave);
  cancelBtn.addEventListener("click", () => closeDriveAdminForm());
}

function updateDriveAdminUI() {
  if (!driveAdminOverlayEl) return;
  const loggedIn = isDriveAdminLoggedIn();
  const loginPane = driveAdminOverlayEl.querySelector("#driveAdminLogin");
  const managePane = driveAdminOverlayEl.querySelector("#driveAdminManage");
  const messageEl = driveAdminOverlayEl.querySelector("#driveAdminMessage");

  if (loggedIn) {
    loginPane.hidden = true;
    managePane.hidden = false;
    messageEl.textContent =
      "Bạn đã đăng nhập. Quản lý phim Drive ngay bên dưới.";
    renderDriveAdminMovieList().catch(() => {});
  } else {
    loginPane.hidden = false;
    managePane.hidden = true;
    messageEl.textContent = "";
  }
}

function setDriveAdminMessage(text) {
  if (!driveAdminOverlayEl) return;
  const messageEl = driveAdminOverlayEl.querySelector("#driveAdminMessage");
  if (messageEl) messageEl.textContent = text;
}

function openDriveAdminForm(editIndex = -1) {
  const formContainer = driveAdminOverlayEl.querySelector(
    "#driveAdminFormContainer",
  );
  const titleEl = driveAdminOverlayEl.querySelector("#driveAdminFormTitle");
  const slugEl = driveAdminOverlayEl.querySelector("#driveMovieSlug");
  const queryEl = driveAdminOverlayEl.querySelector("#driveMovieQuery");
  const yearEl = driveAdminOverlayEl.querySelector("#driveMovieYear");
  const posterEl = driveAdminOverlayEl.querySelector(
    "#driveMovieUseLocalPoster",
  );
  const episodesEl = driveAdminOverlayEl.querySelector("#driveMovieEpisodes");

  driveAdminActiveEditIndex = editIndex;
  if (editIndex >= 0) {
    const movies = getDriveMoviesRaw();
    const item = movies[editIndex];
    titleEl.textContent = "Sửa phim Drive";
    slugEl.value = item.slug || "";
    queryEl.value = item.tmdbQuery || "";
    yearEl.value = item.year || "";
    posterEl.checked = !!item.useLocalPoster;
    episodesEl.value = formatDriveEpisodes(item.episodes || []);
  } else {
    titleEl.textContent = "Thêm phim Drive mới";
    slugEl.value = "";
    queryEl.value = "";
    yearEl.value = "";
    posterEl.checked = false;
    episodesEl.value = "";
  }

  formContainer.hidden = false;
}

function closeDriveAdminForm() {
  if (!driveAdminOverlayEl) return;
  const formContainer = driveAdminOverlayEl.querySelector(
    "#driveAdminFormContainer",
  );
  if (formContainer) {
    formContainer.hidden = true;
  }
  driveAdminActiveEditIndex = -1;
}

async function renderDriveAdminMovieList() {
  if (!driveAdminOverlayEl) return;
  const listEl = driveAdminOverlayEl.querySelector("#driveAdminMovieList");
  const movies = getDriveMoviesRaw();
  const catalog = await buildDriveCatalog();

  listEl.innerHTML = movies
    .map((movie, index) => {
      const meta = catalog[index] || {};
      const localPoster = `${LOCAL_POSTER_DIR}${movie.slug}.jpg`;
      const poster =
        meta.poster ||
        (movie.useLocalPoster ? localPoster : "assets/images/favicon.svg");
      const safeTitle = movie.tmdbQuery || movie.slug;
      return `
        <div class="drive-admin-movie-item">
          <div class="drive-admin-movie-thumb">
            <img src="${poster}" alt="${safeTitle}" loading="lazy"
                 onerror="this.onerror=null;this.src='assets/images/favicon.svg';" />
          </div>
          <div class="drive-admin-movie-main">
            <div class="drive-admin-movie-meta">
              <div class="drive-admin-movie-title">${safeTitle}</div>
              <div class="drive-admin-movie-subtitle">Slug: ${movie.slug} · Năm: ${movie.year || "-"} · ${movie.episodes.length} tập</div>
            </div>
            <div class="drive-admin-movie-actions">
              <button type="button" data-index="${index}" class="drive-admin-action-btn drive-admin-action-edit">Sửa</button>
              <button type="button" data-index="${index}" class="drive-admin-action-btn drive-admin-action-delete">Xóa</button>
            </div>
          </div>
        </div>`;
    })
    .join("");

  listEl.querySelectorAll(".drive-admin-action-edit").forEach((btn) => {
    btn.addEventListener("click", () =>
      openDriveAdminForm(Number(btn.dataset.index)),
    );
  });
  listEl.querySelectorAll(".drive-admin-action-delete").forEach((btn) => {
    btn.addEventListener("click", () =>
      handleDriveAdminDelete(Number(btn.dataset.index)),
    );
  });
}

function handleDriveAdminLogin() {
  if (!driveAdminOverlayEl) return;
  const usernameEl = driveAdminOverlayEl.querySelector("#driveAdminUsername");
  const passwordEl = driveAdminOverlayEl.querySelector("#driveAdminPassword");
  const username = usernameEl.value.trim();
  const password = passwordEl.value;

  if (username === DRIVE_ADMIN_USER && password === DRIVE_ADMIN_PASS) {
    setDriveAdminLoggedIn(true);
    usernameEl.value = "";
    passwordEl.value = "";
    updateDriveAdminUI();
    setDriveAdminMessage(
      "Đăng nhập thành công. Bạn đã có thể quản lý danh sách Drive.",
    );
  } else {
    setDriveAdminMessage("Sai tài khoản hoặc mật khẩu. Vui lòng thử lại.");
  }
}

function handleDriveAdminLogout() {
  setDriveAdminLoggedIn(false);
  updateDriveAdminUI();
}

function handleDriveAdminSave() {
  if (!driveAdminOverlayEl) return;
  const slugEl = driveAdminOverlayEl.querySelector("#driveMovieSlug");
  const queryEl = driveAdminOverlayEl.querySelector("#driveMovieQuery");
  const yearEl = driveAdminOverlayEl.querySelector("#driveMovieYear");
  const posterEl = driveAdminOverlayEl.querySelector(
    "#driveMovieUseLocalPoster",
  );
  const episodesEl = driveAdminOverlayEl.querySelector("#driveMovieEpisodes");

  const slug = slugEl.value.trim();
  const tmdbQuery = queryEl.value.trim();
  const year = parseInt(yearEl.value, 10) || "";
  const useLocalPoster = posterEl.checked;
  const episodes = parseDriveEpisodesString(episodesEl.value);

  if (!slug) {
    setDriveAdminMessage("Slug không được để trống.");
    return;
  }
  if (!episodes.length) {
    setDriveAdminMessage("Ít nhất một tập phim cần được khai báo.");
    return;
  }

  const movies = getDriveMoviesRaw();
  const newItem = {
    slug,
    tmdbQuery,
    year,
    useLocalPoster,
    episodes,
  };

  if (driveAdminActiveEditIndex >= 0) {
    movies[driveAdminActiveEditIndex] = newItem;
    setDriveAdminMessage("Cập nhật phim Drive thành công.");
  } else {
    movies.push(newItem);
    setDriveAdminMessage("Đã thêm phim Drive mới.");
  }

  saveDriveMoviesRaw(movies);
  renderDriveAdminMovieList().catch(() => {});
  closeDriveAdminForm();
  if (typeof renderDriveHomeSection === "function") {
    renderDriveHomeSection();
  }
}

function handleDriveAdminDelete(index) {
  const movies = getDriveMoviesRaw();
  const item = movies[index];
  if (!item) return;
  const confirmed = window.confirm(
    `Xóa phim Drive “${item.tmdbQuery || item.slug}”?`,
  );
  if (!confirmed) return;

  movies.splice(index, 1);
  saveDriveMoviesRaw(movies);
  renderDriveAdminMovieList().catch(() => {});
  if (typeof renderDriveHomeSection === "function") {
    renderDriveHomeSection();
  }
}

function openDriveAdminPanel() {
  if (!driveAdminOverlayEl) createDriveAdminOverlay();
  driveAdminOverlayEl.hidden = false;
  document.body.style.overflow = "hidden";
  updateDriveAdminUI();
}

function closeDriveAdminPanel() {
  if (!driveAdminOverlayEl) return;
  driveAdminOverlayEl.hidden = true;
  document.body.style.overflow = "";
  closeDriveAdminForm();
}

function initDriveAdmin() {
  createDriveAdminOverlay();
  const avatarBox = document.querySelector(".avatar-box");
  if (!avatarBox) return;
  avatarBox.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!isDriveAdminLoggedIn()) {
      openDriveAdminPanel();
      return;
    }
    openDriveAdminPanel();
  });

  document.addEventListener("click", (event) => {
    if (!driveAdminOverlayEl || driveAdminOverlayEl.hidden) return;
    if (!driveAdminOverlayEl.contains(event.target)) {
      closeDriveAdminPanel();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      driveAdminOverlayEl &&
      !driveAdminOverlayEl.hidden
    ) {
      closeDriveAdminPanel();
    }
  });
}

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
      {
        name: "HD",
        slug: "spider-man-brand-new-day",
        embed:
          "https://drive.google.com/file/d/1ArV2mZ6ccJ7gj7VHK6PTliZUkMGYvRaR/preview",
      },
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
      year:
        (item.release_date || item.first_air_date || "").slice(0, 4) ||
        year ||
        "",
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
  const movies = getDriveMoviesRaw();
  _driveCatalogCache = await Promise.all(
    movies.map(async (raw) => {
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
  const raw = getDriveMoviesRaw().find((m) => m.slug === slug);
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
  const movies = getDriveMoviesRaw();
  if (!wrapper || !movies.length) return;

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

document.addEventListener("DOMContentLoaded", async () => {
  await refreshDriveMoviesRawFromRemote();
  renderDriveHomeSection();
  initDriveAdmin();
});
