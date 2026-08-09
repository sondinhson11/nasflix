(function () {
  let currentPage = 1;
  let isFetching = false;
  let allMovies = [];
  let filteredMovies = [];
  let pageType = "series"; // "series" or "movies"
  let maxPages = 10; // fallback tạm thời, sẽ được cập nhật thành số trang THẬT lấy từ API
  // Số lần load more liên tiếp trả 0 item mới → dùng để ẩn button nếu API hết
let consecutiveEmptyFetches = 0;
let filterDebounceTimer = null; // debounce cho filter change
// Số trang API đã fetch thật sự (track riêng vì currentPage đếm theo client 24 items/page)
let apiPagesFetched = 0;
// Tổng số trang / tổng số item THẬT mà NguonC trả về (đọc từ field paginate/pagination của API)
// Dùng để tính đúng số trang pagination thay vì chỉ đoán dựa trên số trang đã tải.
let apiTotalPages = 0;
let apiTotalItems = 0;

// NguonC API — endpoint chính
const NGUONC_BASE = "https://phim.nguonc.com/api";
const API_ENDPOINTS = {
  nguonc: {
    list: NGUONC_BASE + "/films/danh-sach",
    byCountry: (slug) => `${NGUONC_BASE}/films/quoc-gia/${slug}`,
    byGenre: (slug) => `${NGUONC_BASE}/films/the-loai/${slug}`,
    byYear: (year) => `${NGUONC_BASE}/films/nam-phat-hanh/${year}`,
  },
};

const PAGE_TITLES = {
  series: "Phim Bộ",
  movies: "Phim Lẻ",
  "hoat-hinh": "Hoạt Hình",
};

const FILTERS = {
  years: new Set(),
  countries: new Set(),
  genres: new Set(),
};

function getPageType() {
  const params = new URLSearchParams(window.location.search);
  return params.get("type") || "series";
}

// Đọc các filter từ URL (?type=series&country=han-quoc&year=2024&genre=hanh-dong&sort=newest)
function getFiltersFromURL() {
  const params = new URLSearchParams(window.location.search);
  // Country & genre trong URL là slug (han-quoc), ta map sang tên hiển thị
  const countrySlug = params.get("country") || "";
  const genreSlug = params.get("genre") || "";
  const year = params.get("year") || "";
  const sort = params.get("sort") || "";
  return {
    country: slugToCountryName(countrySlug),
    genre: slugToGenreName(genreSlug),
    year,
    sort,
  };
}

// Map slug -> tên hiển thị (để set giá trị cho <select>)
function slugToCountryName(slug) {
  if (!slug) return "";
  const map = {
    "trung-quoc": "trung quốc",
    "han-quoc": "hàn quốc",
    "nhat-ban": "nhật bản",
    "thai-lan": "thái lan",
    "au-my": "mỹ",
    "an-do": "ấn độ",
    "dai-loan": "đài loan",
    "viet-nam": "việt nam",
    "anh": "anh",
    "phap": "pháp",
    "hong-kong": "hồng kông",
    "duc": "đức",
    "canada": "canada",
    "uc": "úc",
    "singapore": "singapore",
  };
  return map[slug] || slug;
}

function slugToGenreName(slug) {
  if (!slug) return "";
  const map = {
    "hanh-dong": "hành động",
    "tinh-cam": "tình cảm",
    "hai-huoc": "hài hước",
    "kinh-di": "kinh dị",
    "phieu-luu": "phiêu lưu",
    "vien-tuong": "viễn tưởng",
    "chinh-kich": "chính kịch",
    "tam-ly": "tâm lý",
    "co-trang": "cổ trang",
    "hinh-su": "hình sự",
    "bi-an": "bí ẩn",
    "khoa-hoc": "khoa học",
    "gia-dinh": "gia đình",
    "lich-su": "lịch sử",
    "am-nhac": "âm nhạc",
    "than-thoai": "thần thoại",
    "chien-tranh": "chiến tranh",
  };
  return map[slug] || slug;
}

// Cập nhật URL để URL luôn phản ánh filter hiện tại (dễ share)
function syncURLFromFilters() {
  const yearVal = getFilterValue("Year");
  const countryVal = getFilterValue("Country");
  const genreVal = getFilterValue("Genre");
  const sortVal = getFilterValue("Sort") || "updated";

  const params = new URLSearchParams();
  params.set("type", pageType);
  if (yearVal) params.set("year", yearVal);
  if (countryVal) {
    const slug = countryToSlug(countryVal);
    if (slug) params.set("country", slug);
  }
  if (genreVal) {
    const slug = genreToSlug(genreVal);
    if (slug) params.set("genre", slug);
  }
  if (sortVal && sortVal !== "updated") params.set("sort", sortVal);

  const newUrl = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState({}, "", newUrl);
}

// NguonC: list theo thể loại dùng path riêng, country dùng path riêng, year dùng path riêng
// QUAN TRỌNG: type (series/movies/hoat-hinh) LUÔN được áp dụng để tránh trộn lẫn
// giữa phim bộ / phim lẻ / hoạt hình trên các page khác nhau.
function buildApiUrl(type, page, year, country, genre) {
  const cfg = API_ENDPOINTS.nguonc;
  // Map type nội bộ (English) → slug NguonC (Tiếng Việt)
  const TYPE_SLUG_MAP = {
    "series":    "phim-bo",
    "movies":    "phim-le",
    "hoat-hinh": "hoat-hinh",
  };
  const typeSlug = TYPE_SLUG_MAP[type] || type;
  const baseList = `${cfg.list}/${typeSlug}`;

  // Nếu có filter country → dùng endpoint byCountry (lọc theo country)
  // NHƯNG vẫn cần lọc type phía client vì endpoint này không phân biệt type
  if (country) {
    const slug = countryToSlug(String(country).toLowerCase());
    if (slug) return `${cfg.byCountry(slug)}?page=${page}`;
  }
  // Nếu có filter genre → dùng endpoint byGenre
  if (genre) {
    const slug = genreToSlug(String(genre).toLowerCase());
    if (slug) return `${cfg.byGenre(slug)}?page=${page}`;
  }
  // Nếu có filter year → dùng endpoint byYear
  if (year) {
    return `${cfg.byYear(year)}?page=${page}`;
  }
  // Mặc định: list theo type (series/movies/hoat-hinh)
  return `${baseList}?page=${page}`;
}

function countryToSlug(name) {
  // Map tên hiển thị -> slug phổ biến (cũng thử nhiều biến thể)
  const map = {
    "trung quốc": "trung-quoc",
    "hàn quốc": "han-quoc",
    "nhật bản": "nhat-ban",
    "thái lan": "thai-lan",
    "mỹ": "au-my",
    "ấn độ": "an-do",
    "đài loan": "dai-loan",
    "việt nam": "viet-nam",
    "anh": "anh",
    "pháp": "phap",
    "hồng kông": "hong-kong",
    "đức": "duc",
    "canada": "canada",
    "úc": "uc",
    "singapore": "singapore",
  };
  return map[name.toLowerCase()] || slugify(name);
}

function genreToSlug(name) {
  const map = {
    "hành động": "hanh-dong",
    "tình cảm": "tinh-cam",
    "hài hước": "hai-huoc",
    "kinh dị": "kinh-di",
    "phiêu lưu": "phieu-luu",
    "viễn tưởng": "vien-tuong",
    "chính kịch": "chinh-kich",
    "tâm lý": "tam-ly",
    "cổ trang": "co-trang",
    "hình sự": "hinh-su",
    "bí ẩn": "bi-an",
    "khoa học": "khoa-hoc",
    "gia đình": "gia-dinh",
    "lịch sử": "lich-su",
    "âm nhạc": "am-nhac",
    "thần thoại": "than-thoai",
    "chiến tranh": "chien-tranh",
  };
  return map[name.toLowerCase()] || slugify(name);
}

function slugify(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

async function fetchCatalogMovies(type, page = 1, filters = {}) {
  const { year = "", country = "", genre = "" } = filters;
  const url = buildApiUrl(type, page, year, country, genre);

  const allMovies = [];
  try {
    const res = await axios.get(url, { timeout: 15000 });
    const items = res.data?.items || [];
    console.log(`[catalog] type=${type} page=${page} url=${url} → got ${items.length} items`);

    // NguonC trả kèm object phân trang thật trong `paginate` (đôi khi là `pagination`).
    // Trước đây field này bị bỏ qua hoàn toàn → client tự đoán tổng số trang dựa trên
    // số trang ĐÃ tải (bị chặn cứng ở maxPages=10) → luôn chỉ hiện được vài trang dù
    // API có hàng nghìn phim. Giờ đọc thật để cập nhật apiTotalPages/apiTotalItems.
    // CHỈ cập nhật khi KHÔNG có filter country/genre/year, vì các endpoint đó trả lẫn
    // nhiều type khác nhau nên tổng số trang của chúng KHÔNG phản ánh đúng tổng số
    // phim của riêng `type` (series/movies/hoat-hinh) sau khi lọc client-side.
    if (!country && !genre && !year) {
      const pg = res.data?.paginate || res.data?.pagination || {};
      const totalPage =
        pg.total_page ?? pg.totalPages ?? pg.total_pages ?? pg.totalPage ?? 0;
      const totalItems =
        pg.total_items ?? pg.totalItems ?? pg.total_items_count ?? 0;
      if (totalPage) {
        apiTotalPages = totalPage;
        // Bỏ giới hạn cứng 10 trang: cho phép fetch tới đúng số trang mà API thật sự có.
        maxPages = totalPage;
      }
      if (totalItems) apiTotalItems = totalItems;
    }

    items.forEach((item) => {
      // NguonC:
      //   thumb_url  = ảnh dọc 2/3 (poster thật, ~400x603) → dùng cho grid
      //   poster_url = ảnh ngang 16/9 (backdrop, ~792x445) → dùng cho hero/banner
      const thumb  = item.thumb_url || "";   // 2/3 cho card
      const poster = item.poster_url || "";  // 16/9 cho hero

      // Suy ra type từ total_episodes
      const totalEp = parseInt(item.total_episodes, 10) || 0;
      const inferredType = totalEp > 1 ? "series" : "single";

      // Suy ra episode_current từ current_episode (vd "Tập 10", "Hoàn tất (12/12)")
      let epCur = "";
      const cur = item.current_episode || "";
      const m = cur.match(/(\d+)/);
      if (m) {
        const curNum = parseInt(m[1], 10);
        epCur = totalEp > 0 ? `${curNum}/${totalEp}` : `Tập ${curNum}`;
      } else if (cur) {
        epCur = cur;
      }

      // Lấy category từ API nếu có (NguonC list trả `category` array hoặc string)
      const rawCategory = item.category;
      let categoryText = "";
      if (Array.isArray(rawCategory)) {
        categoryText = rawCategory.map((c) => (typeof c === "string" ? c : c?.name || "")).filter(Boolean).join(", ");
      } else if (typeof rawCategory === "string") {
        categoryText = rawCategory;
      }

      allMovies.push({
        name: item.name,
        slug: item.slug,
        year: parseInt(item.year, 10) || new Date().getFullYear(),
        type: inferredType,
        time: item.time || "",
        episode_current: epCur,
        // QUAN TRỌNG: card grid dùng thumb_url (ảnh dọc đúng tỉ lệ 2/3)
        thumb: thumb,
        poster: poster,
        country: "",       // NguonC list không trả country — set sau qua detail
        category: categoryText,
        modifiedTime: item.modified || item.created || "",
      });
    });

    // ===== LỌC CLIENT-SIDE THEO `type` =====
    // Khi có filter country/genre/year, NguonC trả mix tất cả type.
    // Phải lọc lại theo `type` để giữ phim bộ / phim lẻ / hoạt hình tách biệt.
    // Heuristic:
    //   - "series"   : total_episodes > 1
    //   - "movies"   : total_episodes <= 1
    //   - "hoat-hinh": cần check category chứa "hoạt hình"/"anime"/"cartoon"
    //                  (không đáng tin nếu API không trả category → vẫn dùng heuristic total_episodes)
    if (country || genre || year) {
      const filtered = allMovies.filter((m) => {
        const totalEp = parseInt(m.episode_current?.match(/\/(\d+)/)?.[1] || "0", 10)
          || (m.episode_current?.startsWith("Tập") ? 1 : 0);
        const isSeries = totalEp > 1;
        const cat = (m.category || "").toLowerCase();
        const isAnime = /hoạt hình|anime|cartoon|hoathinh/.test(cat);

        if (type === "series") return isSeries;
        if (type === "movies") return !isSeries && !isAnime;
        if (type === "hoat-hinh") return isAnime || (totalEp > 1 && cat.includes("hoạt"));
        return true;
      });
      return filtered;
    }
  } catch (err) {
    console.error("fetchCatalogMovies error:", err);
  }

  return allMovies;
}

async function fetchMultiplePages(type, startPage, count, filters = {}) {
  const pages = [];
  for (let i = 0; i < count; i++) {
    pages.push(fetchCatalogMovies(type, startPage + i, filters));
  }
  const results = await Promise.all(pages);
  const merged = {};
  results.flat().forEach((m) => {
    const key = `${m.name.toLowerCase()}|${m.year}`;
    if (!merged[key]) merged[key] = m;
  });
  return Object.values(merged);
}

function populateFilters(movies) {
  FILTERS.years.clear();
  // Country & genre: NguonC list KHÔNG trả → dùng danh sách cứng.
  // Year: lấy từ data (vì có `year`).
  FILTERS.countries.clear();
  FILTERS.genres.clear();

  movies.forEach((movie) => {
    if (movie.year) FILTERS.years.add(movie.year);
  });

  // Danh sách country cứng — đồng bộ với countryToSlug()
  const HARDCODED_COUNTRIES = [
    "trung quốc", "hàn quốc", "nhật bản", "thái lan", "mỹ",
    "ấn độ", "đài loan", "việt nam", "anh", "pháp",
    "hồng kông", "đức", "canada", "úc", "singapore",
  ];
  HARDCODED_COUNTRIES.forEach((c) => FILTERS.countries.add(c));

  // Danh sách genre cứng — đồng bộ với genreToSlug()
  const HARDCODED_GENRES = [
    "hành động", "tình cảm", "hài hước", "kinh dị", "phiêu lưu",
    "viễn tưởng", "chính kịch", "tâm lý", "cổ trang", "hình sự",
    "bí ẩn", "khoa học", "gia đình", "lịch sử", "âm nhạc",
    "thần thoại", "chiến tranh",
  ];
  HARDCODED_GENRES.forEach((g) => FILTERS.genres.add(g));

  const yearDesktop = document.getElementById("filterYear");
  const yearSheet = document.getElementById("filterYearSheet");
  const countryDesktop = document.getElementById("filterCountry");
  const countrySheet = document.getElementById("filterCountrySheet");
  const genreDesktop = document.getElementById("filterGenre");
  const genreSheet = document.getElementById("filterGenreSheet");

  if (yearDesktop) {
    Array.from(FILTERS.years)
      .sort((a, b) => b - a)
      .forEach((year) => {
        const opt1 = document.createElement("option");
        opt1.value = year;
        opt1.textContent = year;
        yearDesktop.appendChild(opt1);
        if (yearSheet) {
          const opt2 = opt1.cloneNode(true);
          yearSheet.appendChild(opt2);
        }
      });
  }

  if (countryDesktop) {
    Array.from(FILTERS.countries)
      .sort()
      .forEach((country) => {
        const opt1 = document.createElement("option");
        opt1.value = country.toLowerCase();
        opt1.textContent = country;
        countryDesktop.appendChild(opt1);
        if (countrySheet) {
          const opt2 = opt1.cloneNode(true);
          countrySheet.appendChild(opt2);
        }
      });
  }

  if (genreDesktop) {
    Array.from(FILTERS.genres)
      .sort()
      .forEach((genre) => {
        const opt1 = document.createElement("option");
        opt1.value = genre.toLowerCase();
        opt1.textContent = genre;
        genreDesktop.appendChild(opt1);
        if (genreSheet) {
          const opt2 = opt1.cloneNode(true);
          genreSheet.appendChild(opt2);
        }
      });
  }
}

function formatMovieMeta(movie) {
  const t = (movie.type || "").toLowerCase();
  const isSeries = t === "series" || t === "hoathinh" || t === "tv";
  if (isSeries) {
    if (movie.episode_current) return movie.episode_current;
    if (movie.year) return `Phim bộ • ${movie.year}`;
    return "Phim bộ";
  }
  if (movie.time) return movie.time;
  if (movie.year) return `Phim lẻ • ${movie.year}`;
  return "Phim lẻ";
}

function applySort(list) {
  const sortVal = getFilterValue("Sort") || "updated";
  if (sortVal === "newest") {
    list.sort((a, b) => (b.year || 0) - (a.year || 0));
  } else if (sortVal === "trending") {
    list.reverse();
  }
  // "updated" = giữ nguyên thứ tự API (mới cập nhật)
  return list;
}

async function applyFilters() {
  const yearVal = getFilterValue("Year");
  const countryVal = getFilterValue("Country");
  const genreVal = getFilterValue("Genre");
  const sortVal = getFilterValue("Sort") || "updated";

  // Reset dữ liệu và fetch từ API với filter
  currentPage = 1;
  allMovies = [];
  filteredMovies = [];
  apiPagesFetched = 0;
  consecutiveEmptyFetches = 0;
  updateFilterCount();
  syncURLFromFilters();

  const grid = document.getElementById("catalogGrid");
  if (grid) {
    grid.innerHTML = Array(12)
      .fill('<div class="skeleton skeleton-card"></div>')
      .join("");
  }

  try {
    const movies = await fetchCatalogMovies(pageType, 1, {
      year: yearVal,
      country: countryVal,
      genre: genreVal,
    });

    if (!movies || movies.length === 0) {
      if (grid) {
        grid.innerHTML =
          '<p class="text-muted text-center py-5" style="grid-column:1/-1;">Không tìm thấy phim phù hợp với bộ lọc.</p>';
      }
      hidePagination();
      return;
    }

    allMovies = movies;
    apiPagesFetched = 1;
    applySort(allMovies);
    filteredMovies = allMovies;
    renderMovieGrid();
    updateLoadMoreButton();
  } catch (e) {
    console.error("Filter fetch error:", e);
    if (grid) {
      grid.innerHTML =
        '<p class="text-danger text-center py-5" style="grid-column:1/-1;">Lỗi tải dữ liệu. Vui lòng thử lại!</p>';
    }
  }
}

function getFilterValue(kind) {
  const desktop = document.getElementById(`filter${kind}`);
  const sheet = document.getElementById(`filter${kind}Sheet`);
  const mobile = document.getElementById(`filter${kind}Mobile`);
  const isMobile = window.matchMedia("(max-width: 767.98px)").matches;
  if (isMobile) {
    if (kind === "Sort" && mobile) return mobile.value;
    return (sheet || desktop)?.value || "";
  }
  return desktop?.value || "";
}

function setFilterValue(kind, value) {
  if (!value) {
    value = "";
  } else {
    // Chuẩn hóa: country/genre lưu lowercase, year lưu số, sort lưu key
    const v = String(value).trim();
    if (kind === "Country" || kind === "Genre") {
      value = v.toLowerCase();
    } else {
      value = v;
    }
  }
  const ids = [
    `filter${kind}`,
    `filter${kind}Sheet`,
    kind === "Sort" ? `filter${kind}Mobile` : null,
  ].filter(Boolean);
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  });
}

function updateFilterCount() {
  const badge = document.getElementById("filterCount");
  if (!badge) return;
  let count = 0;
  if (getFilterValue("Year")) count++;
  if (getFilterValue("Country")) count++;
  if (getFilterValue("Genre")) count++;
  if (getFilterValue("Sort") && getFilterValue("Sort") !== "updated") count++;
  if (count > 0) {
    badge.textContent = String(count);
    badge.hidden = false;
    document.getElementById("filterToggleBtn")?.classList.add("is-active");
  } else {
    badge.hidden = true;
    document.getElementById("filterToggleBtn")?.classList.remove("is-active");
  }
}

function openFilterSheet() {
  const sheet = document.getElementById("filterSheet");
  if (!sheet) return;
  // Sync desktop -> sheet khi mở
  setFilterValue("Year", getFilterValue("Year"));
  setFilterValue("Country", getFilterValue("Country"));
  setFilterValue("Genre", getFilterValue("Genre"));
  setFilterValue("Sort", getFilterValue("Sort") || "updated");
  sheet.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeFilterSheet() {
  const sheet = document.getElementById("filterSheet");
  if (!sheet) return;
  sheet.hidden = true;
  document.body.style.overflow = "";
}

function renderMovieGrid() {
  const grid = document.getElementById("catalogGrid");
  if (!grid) return;

  // Pagination: mỗi page client = 24 items. Render slice đúng trang hiện tại.
  const itemsPerPage = 24;
  const start = (currentPage - 1) * itemsPerPage;
  const end = currentPage * itemsPerPage;
  const paginated = filteredMovies.slice(start, end);

  const BLANK = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 2 3'><rect width='2' height='3' fill='%23222'/></svg>";
  const cardsHTML = paginated.map((movie) => {
    const safeThumb = movie.thumb || "";
    const safeName = (movie.name || "").replace(/"/g, "&quot;");
    const safePoster = movie.poster || "";
    const meta = formatMovieMeta(movie);
    return `
      <a href="detail.html?slug=${encodeURIComponent(movie.slug || "")}" class="movie-card">
        <div class="poster-wrap" ${safePoster ? `style="--card-bg:url('${safePoster.replace(/'/g, "\\'")}')"` : ""}>
          <div class="poster-skeleton"></div>
          <img src="${safeThumb}" alt="${safeName}" loading="lazy" referrerpolicy="no-referrer"
               onload="this.parentElement.querySelector('.poster-skeleton')?.classList.add('hidden');this.classList.add('loaded');"
               onerror="this.onerror=null;this.src='${BLANK}';this.parentElement.querySelector('.poster-skeleton')?.classList.add('hidden');this.classList.add('loaded');">
          <div class="poster-overlay">
            <div class="play-badge"><i class="fa-solid fa-play"></i></div>
          </div>
        </div>
        <div class="movie-info">
          <div class="movie-title">${safeName}</div>
          <div class="movie-meta-card">${meta}</div>
        </div>
      </a>
    `;
  }).join("");

  grid.innerHTML = cardsHTML;
  updatePagination();
}

/**
 * Tính số trang pagination dựa trên filteredMovies + API pages đã fetch.
 */
function updatePagination() {
  const itemsPerPage = 24;
  const totalLoaded = filteredMovies.length;
  const loadedPages = Math.ceil(totalLoaded / itemsPerPage);
  const safeCurrentPage = currentPage;

  let totalPages;
  if (apiTotalItems > 0) {
    // Đã biết tổng số phim THẬT từ API (paginate.total_items) → tính đúng luôn,
    // không cần chờ tải hết mới hiện đủ số trang.
    totalPages = Math.max(1, Math.ceil(apiTotalItems / itemsPerPage));
  } else {
    // Chưa biết tổng thật (vd: đang lọc theo country/genre/year, hoặc API không
    // trả field paginate) → dùng lại cách đoán cũ dựa trên số trang đã tải được.
    const canFetchMore = apiPagesFetched < maxPages && consecutiveEmptyFetches < 2;
    totalPages = canFetchMore ? Math.max(loadedPages, safeCurrentPage) + 1 : loadedPages;
  }
  const isLastPage = safeCurrentPage >= totalPages;

  const wrapper = document.getElementById("paginationWrapper");
  if (!wrapper) return;

  // Build pagination HTML - windowed: hiển thị current ± 2 + đầu/cuối
  const windowSize = 2;
  const startP = Math.max(1, safeCurrentPage - windowSize);
  const endP = Math.min(totalPages, safeCurrentPage + windowSize);

  let html = '';

  // Nút prev
  html += `<button class="page-btn" data-action="prev" ${safeCurrentPage === 1 ? "disabled" : ""} aria-label="Trang trước">
    <i class="fa-solid fa-chevron-left"></i>
  </button>`;

  // Trang đầu
  if (startP > 1) {
    html += `<button class="page-btn" data-page="1">1</button>`;
    if (startP > 2) html += `<span class="page-dots">...</span>`;
  }

  // Window pages
  for (let p = startP; p <= endP; p++) {
    const isActive = p === safeCurrentPage;
    html += `<button class="page-btn ${isActive ? "active" : ""}" data-page="${p}">${p}</button>`;
  }

  // Trang cuối
  if (endP < totalPages) {
    if (endP < totalPages - 1) html += `<span class="page-dots">...</span>`;
    html += `<button class="page-btn" data-page="${totalPages}">${totalPages}</button>`;
  }

  // Nút next
  html += `<button class="page-btn" data-action="next" ${isLastPage ? "disabled" : ""} aria-label="Trang sau">
    <i class="fa-solid fa-chevron-right"></i>
  </button>`;

  wrapper.innerHTML = html;

  // Bind click
  wrapper.querySelectorAll("[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = parseInt(btn.dataset.page, 10);
      if (target === safeCurrentPage || btn.disabled) return;
      goToPage(target);
    });
  });
  wrapper.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;
      if (action === "prev" && safeCurrentPage > 1) goToPage(safeCurrentPage - 1);
      if (action === "next" && !isLastPage) goToPage(safeCurrentPage + 1);
    });
  });

  // Hiện/ẩn wrapper
  wrapper.style.display = totalPages > 1 ? "flex" : "none";
}

async function goToPage(targetPage) {
  if (targetPage < 1) return;
  const itemsPerPage = 24;
  const needToReach = targetPage * itemsPerPage;

  // Fetch thêm API pages nếu chưa đủ items
  while (filteredMovies.length < needToReach && apiPagesFetched < maxPages) {
    const nextApiPage = apiPagesFetched + 1;
    const yearVal = getFilterValue("Year");
    const countryVal = getFilterValue("Country");
    const genreVal = getFilterValue("Genre");
    const more = await fetchCatalogMovies(pageType, nextApiPage, {
      year: yearVal,
      country: countryVal,
      genre: genreVal,
    });
    if (more && more.length > 0) {
      const existing = new Set(filteredMovies.map(m => `${m.name.toLowerCase()}|${m.year}`));
      more.forEach(m => {
        const key = `${m.name.toLowerCase()}|${m.year}`;
        if (!existing.has(key)) {
          filteredMovies.push(m);
          existing.add(key);
        }
      });
      apiPagesFetched++;
    } else {
      apiPagesFetched = maxPages;
      break;
    }
  }

  currentPage = targetPage;
  renderMovieGrid();
  // Scroll to top of grid
  document.getElementById("catalogGrid")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function initCatalog() {
  // Determine page type from URL parameter
  pageType = getPageType();

  // Update page title and active nav link
  const catalogTitle = document.getElementById("catalogTitle");
  if (catalogTitle) {
    catalogTitle.textContent = PAGE_TITLES[pageType] || "Phim";
  }

  // Update active nav link
  document
    .getElementById("seriesLink")
    ?.classList.toggle("active", pageType === "series");
  document
    .getElementById("moviesLink")
    ?.classList.toggle("active", pageType === "movies");
  document
    .getElementById("animeLink")
    ?.classList.toggle("active", pageType === "hoat-hinh");

  // Đọc filter từ URL (?type=series&country=han-quoc...)
  const urlFilters = getFiltersFromURL();

  try {
    const catalogGrid = document.getElementById("catalogGrid");
    if (catalogGrid) {
      catalogGrid.innerHTML = Array(12)
        .fill('<div class="skeleton skeleton-card"></div>')
        .join("");
    }

    // Nếu URL có filter → fetch ngay với filter
    // Ngược lại load nhiều trang không filter để có danh sách phong phú
    const hasFilter = urlFilters.country || urlFilters.genre || urlFilters.year;

    if (hasFilter) {
      const movies = await fetchCatalogMovies(pageType, 1, urlFilters);
      if (!movies || movies.length === 0) {
        if (catalogGrid) {
          catalogGrid.innerHTML =
            '<div class="col-12"><p class="text-muted text-center py-5">Không tìm thấy phim phù hợp với bộ lọc.</p></div>';
        }
        hidePagination();
        return;
      }
      allMovies = movies;
      apiPagesFetched = 1;
      populateFilters(allMovies);
      // Set giá trị filter từ URL sau khi populate
      setFilterValue("Year", urlFilters.year);
      setFilterValue("Country", urlFilters.country);
      setFilterValue("Genre", urlFilters.genre);
      setFilterValue("Sort", urlFilters.sort || "updated");
      applySort(allMovies);
      filteredMovies = allMovies;
      currentPage = 1;
      apiPagesFetched = 1;
      consecutiveEmptyFetches = 0;
      renderMovieGrid();
      updateFilterCount();
      syncURLFromFilters();
    } else {
      // Load vài trang đầu không filter để có danh sách year/country/genre phong phú
      allMovies = await fetchMultiplePages(pageType, 1, 3);
      apiPagesFetched = 3;

    if (!allMovies || allMovies.length === 0) {
      if (catalogGrid) {
        catalogGrid.innerHTML =
          '<p class="text-muted text-center py-5" style="grid-column:1/-1;">Không có dữ liệu</p>';
      }
      console.warn("No movies found for type:", pageType);
      return;
    }

      populateFilters(allMovies);
      // Set sort từ URL nếu có
      if (urlFilters.sort) setFilterValue("Sort", urlFilters.sort);
      applySort(allMovies);
      filteredMovies = allMovies;
      currentPage = 1;
      apiPagesFetched = 3;
      consecutiveEmptyFetches = 0;
      renderMovieGrid();
      updateFilterCount();
    }

    // Setup filter listeners
    let filterReqToken = 0;
    const onFilterChange = (kind) => () => {
      const value = getFilterValue(kind);
      // Sync giá trị giữa desktop/sheet/mobile
      if (kind === "Sort") {
        setFilterValue("Sort", value);
      }
      currentPage = 1;
      updateFilterCount();

      // Skeleton + token để tránh race condition khi user đổi filter liên tục
      const grid = document.getElementById("catalogGrid");
      if (grid) {
        grid.innerHTML = Array(12)
          .fill('<div class="skeleton skeleton-card"></div>')
          .join("");
      }
      const myToken = ++filterReqToken;
      // Debounce 250ms cho cảm giác mượt + chỉ chốt request cuối
      clearTimeout(filterDebounceTimer);
      filterDebounceTimer = setTimeout(() => {
        if (myToken !== filterReqToken) return; // request bị huỷ bởi lần đổi mới hơn
        applyFilters();
      }, 250);
    };

    document
      .getElementById("filterYear")
      ?.addEventListener("change", onFilterChange("Year"));
    document
      .getElementById("filterCountry")
      ?.addEventListener("change", onFilterChange("Country"));
    document
      .getElementById("filterGenre")
      ?.addEventListener("change", onFilterChange("Genre"));
    document
      .getElementById("filterSort")
      ?.addEventListener("change", onFilterChange("Sort"));

    // Sheet listeners
    document
      .getElementById("filterYearSheet")
      ?.addEventListener("change", onFilterChange("Year"));
    document
      .getElementById("filterCountrySheet")
      ?.addEventListener("change", onFilterChange("Country"));
    document
      .getElementById("filterGenreSheet")
      ?.addEventListener("change", onFilterChange("Genre"));

    // Mobile quick sort
    document
      .getElementById("filterSortMobile")
      ?.addEventListener("change", onFilterChange("Sort"));

    // Open/close filter sheet
    document
      .getElementById("filterToggleBtn")
      ?.addEventListener("click", openFilterSheet);
    document
      .getElementById("filterSheetClose")
      ?.addEventListener("click", closeFilterSheet);
    document
      .getElementById("filterSheetBackdrop")
      ?.addEventListener("click", closeFilterSheet);

    // Apply & reset trong sheet
    document
      .getElementById("filterSheetApply")
      ?.addEventListener("click", () => {
        // Đồng bộ giá trị từ sheet -> desktop
        setFilterValue("Year", getFilterValue("Year"));
        setFilterValue("Country", getFilterValue("Country"));
        setFilterValue("Genre", getFilterValue("Genre"));
        setFilterValue("Sort", getFilterValue("Sort") || "updated");
        currentPage = 1;
        updateFilterCount();
        applyFilters();
        closeFilterSheet();
      });

    document
      .getElementById("filterSheetReset")
      ?.addEventListener("click", () => {
        setFilterValue("Year", "");
        setFilterValue("Country", "");
        setFilterValue("Genre", "");
        setFilterValue("Sort", "updated");
        currentPage = 1;
        updateFilterCount();
        applyFilters();
      });

    // Pagination: đã chuyển sang click nút page number → xem updatePagination()

function hidePagination() {
  const wrapper = document.getElementById("paginationWrapper");
  if (wrapper) wrapper.style.display = "none";
}
  } catch (error) {
    console.error("Error initializing catalog:", error);
    const catalogGrid = document.getElementById("catalogGrid");
    if (catalogGrid) {
      catalogGrid.innerHTML =
        '<p class="text-danger text-center py-5" style="grid-column:1/-1;">Lỗi tải dữ liệu. Vui lòng thử lại!</p>';
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("view-catalog")) {
    initCatalog();
  }
});
})();