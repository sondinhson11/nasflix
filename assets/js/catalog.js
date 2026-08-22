(function () {
  let currentPage = 1;
  let allMovies = [];
  let filteredMovies = [];
  let pageType = "series"; // "series" or "movies"
  let maxPages = 10; // fallback tạm thời, sẽ được cập nhật thành số trang THẬT lấy từ API
let filterDebounceTimer = null; // debounce cho filter change
// Số trang API đã fetch thật sự (track riêng vì currentPage đếm theo client 24 items/page)
let apiPagesFetched = 0;
// Tổng số trang / tổng số item THẬT mà NguonC trả về (đọc từ field paginate/pagination của API)
// Dùng để tính đúng số trang pagination thay vì chỉ đoán dựa trên số trang đã tải.
let apiTotalPages = 0;
let apiTotalItems = 0;
let apiPageCache = {};

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

// Cache kết quả matchMedia("max-width: 767.98px").matches — không truy vấn DOM mỗi lần gọi
// (mỗi getFilterValue() đều gọi matchMedia trước đây, vừa tốn CPU vừa trigger layout).
// Cập nhật khi user resize chéo breakpoint.
let isMobileViewport = typeof window !== "undefined"
  && window.matchMedia("(max-width: 767.98px)").matches;
if (typeof window !== "undefined") {
  window.matchMedia("(max-width: 767.98px)").addEventListener?.("change", (e) => {
    isMobileViewport = e.matches;
  });
}

// Số items hiển thị mỗi "trang client" (cho infinite scroll). Const để đồng bộ
// giữa render, skeleton, loadMore.
const ITEMS_PER_PAGE = 24;

// Skeleton HTML dùng cho cả init/filter/load-more — đồng bộ số lượng với ITEMS_PER_PAGE
// để tránh flash "12 skeleton → 24 cards" (12 chỉ đủ 2 hàng đầu với grid 6 cột).
const SKELETON_HTML = Array(ITEMS_PER_PAGE)
  .fill('<div class="skeleton skeleton-card"></div>')
  .join("");

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
    } else {
      // Khi CÓ filter country/genre/year, API endpoint trả lẫn nhiều type nên
      // paginate.total_page không phản ánh đúng số trang của riêng type hiện tại
      // (sau khi lọc client-side). Tăng maxPages lên rất cao để infinite scroll
      // không bị chặn cứng — loadMore sẽ tự dừng khi batch không thêm items mới.
      if (maxPages < 200) maxPages = 200;
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
    // Suppress log: lỗi mạng/CORS/502/timeout là chuyện thường với nguonc.com (host yếu).
    // Nếu log đầy đủ AxiosError stack trace mỗi lần fail, console sẽ bị spam hàng chục dòng
    // chỉ vì bấm sang trang cuối → trông như "lỗi tùm lum" dù thực tế chỉ là API chập chờn.
    // Vẫn để 1 dòng gọn để dev biết có lỗi.
    console.warn(`[catalog] fetch ${url} failed: ${err?.message || err}`);
    // Trả về object báo lỗi để caller phân biệt "lỗi mạng/CORS/5xx" với "trang rỗng hợp lệ".
    // Trước đây luôn return [] → retry loop tưởng là trang rỗng, spam request vào trang kế → đốt API.
    return { ok: false, items: [], error: err };
  }

  return { ok: true, items: allMovies };
}

// Note: hàm fetchMultiplePages đã được loại bỏ — init chỉ fetch 1 trang,
// các trang tiếp theo do IntersectionObserver trigger loadMore() tải tự động
// (giảm request thừa khi user không cuộn tới).

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

  // Reset dữ liệu và fetch từ API với filter
  currentPage = 1;
  allMovies = [];
  filteredMovies = [];
  apiPagesFetched = 0;
  // Infinite scroll: reset trạng thái load-more
  isLoadingMore = false;
  loadMoreExhausted = false;
  // Disconnect observer (nếu có) trước khi replaceChildren → tránh observer vẫn
  // gắn vào sentinel cũ đã bị remove khỏi DOM (gây callback thừa + leak).
  loadMoreObserver?.disconnect();
  // Filter mới → cache cũ không dùng được, phải xóa
  apiPageCache = {};
  resetMergeState();
  // Bump filterReqToken (trong onFilterChange) sẽ huỷ mọi applyFilters đang chạy dở.
  // loadMore() cũng tự check isLoadingMore để tránh overlap.
  updateFilterCount();
  syncURLFromFilters();

  const grid = document.getElementById("catalogGrid");
  if (grid) {
    grid.innerHTML = SKELETON_HTML;
  }

  try {
    const result = await fetchCatalogMovies(pageType, 1, {
      year: yearVal,
      country: countryVal,
      genre: genreVal,
    });
    // Tương thích cả 2 dạng: mới (object) và cũ (array)
    const movies = Array.isArray(result) ? result : (result && result.ok ? result.items : null);
    const fetchOk = Array.isArray(result) || (result && result.ok);

    if (!fetchOk) {
      // Lỗi mạng/CORS/502 → hiện thông báo lỗi (KHÔNG hiện "không tìm thấy phim")
      throw new Error("API fetch failed");
    }

    if (!movies || movies.length === 0) {
      if (grid) {
        grid.innerHTML =
          '<p class="text-muted text-center py-5" style="grid-column:1/-1;">Không tìm thấy phim phù hợp với bộ lọc.</p>';
      }
      loadMoreExhausted = true;
      return;
    }

    allMovies = movies;
    apiPagesFetched = 1;
    apiPageCache[1] = movies;
    resetMergeState();
    applySort(allMovies);
    filteredMovies = allMovies;
    renderMovieGrid();
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
  // Dùng biến cached thay vì gọi matchMedia mỗi lần (matchMedia là reflow trigger).
  if (isMobileViewport) {
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

// State của infinite scroll — loadMore() dùng các biến này để chặn gọi trùng,
// dừng khi hết phim, và reset khi đổi filter.
let loadMoreObserver = null;
let isLoadingMore = false;
let loadMoreExhausted = false;

/**
 * Render lại grid từ đầu (dùng cho lần load đầu / đổi filter / sort).
 * Append-mode dùng `appendRenderedItems()` riêng.
 */
function renderMovieGrid() {
  const grid = document.getElementById("catalogGrid");
  if (!grid) return;

  const toRender = filteredMovies.slice(0, ITEMS_PER_PAGE);

  // Reset: xóa hết, render lại từ đầu + sentinel + footer
  grid.replaceChildren(
    buildCardsFragment(toRender),
    Object.assign(document.createElement("div"), { id: "loadMoreSentinel", className: "load-more-sentinel", ariaHidden: "true" }),
    Object.assign(document.createElement("div"), { id: "loadMoreFooter", className: "load-more-footer" })
  );
  observeCurrentSentinel();
  updateLoadMoreState();
}

/**
 * Append items từ filteredMovies[startIdx..endIdx] vào grid (không reset DOM).
 * Sau khi append: xóa sentinel/footer cũ (chúng nằm giữa cards), chèn cards mới
 * vào cuối, thêm lại sentinel/footer ở cuối, setup lại observer (sentinel mới).
 *
 * Tại sao phải xóa sentinel cũ trước?
 * Vì renderMovieGrid ban đầu đặt sentinel ở vị trí "cuối grid". Nếu giữ nguyên
 * rồi insertAdjacentHTML("beforeend", cardsHTML), cards mới rơi vào SAU sentinel
 * → sentinel kẹt giữa cards cũ và cards mới. Observer (rootMargin: 400px) kích
 * hoạt khi sentinel vào viewport, nhưng sentinel không còn ở đáy nữa → user
 * phải cuộn lên rồi cuộn xuống lại mới trigger lại được.
 */
function appendRenderedItems() {
  const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIdx = currentPage * ITEMS_PER_PAGE;
  const toRender = filteredMovies.slice(startIdx, endIdx);
  if (toRender.length === 0) return;

  const grid = document.getElementById("catalogGrid");
  if (!grid) return;

  // 1) Gỡ sentinel/footer cũ (đang nằm giữa grid)
  const oldSentinel = document.getElementById("loadMoreSentinel");
  const oldFooter = document.getElementById("loadMoreFooter");
  if (oldSentinel) oldSentinel.remove();
  if (oldFooter) oldFooter.remove();

  // 2) Chèn cards mới vào cuối grid (giờ sentinel đã gỡ → vị trí "cuối" là đúng)
  grid.appendChild(buildCardsFragment(toRender));

  // 3) Thêm lại sentinel/footer ở cuối (sentinel MỚI — observer cũ đã mất target)
  ensureLoadMoreSentinel();

  // 4) Setup lại observer cho sentinel mới
  observeCurrentSentinel();

  // 5) Cập nhật trạng thái footer (loading/hết phim)
  updateLoadMoreState();
}

/**
 * Build DOM nodes cho 1 danh sách cards, trả về DocumentFragment.
 *
 * Dùng DOM API thay vì template literal + innerHTML vì:
 * - XSS-safe: setAttribute() escape tự động, không cần .replace(/'/g, "\\'") thủ công
 *   (trước đây poster URL chứa ký tự lạ có thể phá CSS string trong inline style).
 * - 1 lần reflow thay vì parse HTML string.
 */
function buildCardsFragment(movies) {
  const BLANK = "data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 2 3%22><rect width=%222%22 height=%223%22 fill=%22%23222%22/></svg>";
  const fragment = document.createDocumentFragment();
  for (const movie of movies) {
    const safeName = movie.name || "";
    const safeSlug = movie.slug || "";

    const a = document.createElement("a");
    a.className = "movie-card";
    a.href = `detail.html?slug=${encodeURIComponent(safeSlug)}`;

    const wrap = document.createElement("div");
    wrap.className = "poster-wrap";

    const skeleton = document.createElement("div");
    skeleton.className = "poster-skeleton";

    const img = document.createElement("img");
    img.src = movie.thumb || "";
    img.alt = safeName;
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.onload = () => {
      skeleton.classList.add("hidden");
      img.classList.add("loaded");
    };
    img.onerror = () => {
      img.onerror = null;
      img.src = BLANK;
      skeleton.classList.add("hidden");
      img.classList.add("loaded");
    };

    const overlay = document.createElement("div");
    overlay.className = "poster-overlay";
    const badge = document.createElement("div");
    badge.className = "play-badge";
    badge.innerHTML = '<i class="fa-solid fa-play"></i>';
    overlay.appendChild(badge);

    wrap.append(skeleton, img, overlay);

    const info = document.createElement("div");
    info.className = "movie-info";
    const title = document.createElement("div");
    title.className = "movie-title";
    title.textContent = safeName; // textContent auto-escape
    const meta = document.createElement("div");
    meta.className = "movie-meta-card";
    meta.textContent = formatMovieMeta(movie);
    info.append(title, meta);

    a.append(wrap, info);

    // Poster backdrop dùng CSS variable --card-bg (set inline style bằng setProperty
    // sẽ tự escape giá trị — an toàn với URL chứa ký tự đặc biệt).
    if (movie.poster) wrap.style.setProperty("--card-bg", `url('${movie.poster}')`);

    fragment.appendChild(a);
  }
  return fragment;
}

/**
 * Đảm bảo sentinel tồn tại trong grid (dùng khi append, vì render trước đã chèn).
 */
function ensureLoadMoreSentinel() {
  const grid = document.getElementById("catalogGrid");
  if (!grid) return;
  if (!document.getElementById("loadMoreSentinel")) {
    const s = document.createElement("div");
    s.id = "loadMoreSentinel";
    s.className = "load-more-sentinel";
    s.setAttribute("aria-hidden", "true");
    grid.appendChild(s);
  }
  if (!document.getElementById("loadMoreFooter")) {
    const f = document.createElement("div");
    f.id = "loadMoreFooter";
    f.className = "load-more-footer";
    grid.appendChild(f);
  }
}

// Singleton observer: tạo 1 lần, chỉ swap target khi sentinel bị thay thế.
// Trước đây mỗi lần append lại tạo observer mới → tốn constructor + callback setup.

function getLoadMoreObserver() {
  if (loadMoreObserver) return loadMoreObserver;
  loadMoreObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && !isLoadingMore && !loadMoreExhausted) {
          loadMore();
          // Callback return ngay sau khi trigger loadMore() — tránh observer
          // fire liên tục nếu sentinel vẫn trong viewport. `isLoadingMore` sẽ
          // chặn re-trigger ở lần callback tiếp theo.
          break;
        }
      }
    },
    { rootMargin: "400px 0px" } // bắt đầu load khi còn cách đáy 400px
  );
  return loadMoreObserver;
}

/**
 * Observe sentinel hiện tại. Gọi khi grid được reset hoặc append (sentinel mới).
 * Observer chỉ observe 1 sentinel tại 1 thời điểm → unobserve cũ trước.
 */
function observeCurrentSentinel() {
  const sentinel = document.getElementById("loadMoreSentinel");
  if (!sentinel) return;
  const observer = getLoadMoreObserver();
  // Unobserve tất cả (tránh observer gắn vào sentinel cũ đã bị remove)
  observer.disconnect();
  observer.observe(sentinel);
}

/**
 * Cập nhật text footer (loading / hết phim / ẩn) dựa trên trạng thái.
 */
function updateLoadMoreState() {
  const footer = document.getElementById("loadMoreFooter");
  if (!footer) return;
  if (loadMoreExhausted) {
    footer.innerHTML = filteredMovies.length > 0
      ? '<p class="text-muted text-center py-4"><i class="fa-solid fa-check-circle me-2"></i>Đã hiện hết phim.</p>'
      : "";
  } else if (isLoadingMore) {
    footer.innerHTML = '<p class="text-muted text-center py-3"><i class="fa-solid fa-spinner fa-spin me-2"></i>Đang tải thêm phim…</p>';
  } else {
    footer.innerHTML = "";
  }
}

/**
 * Load thêm trang API kế tiếp, append items mới vào grid.
 */
async function loadMore() {
  if (isLoadingMore || loadMoreExhausted) return;
  isLoadingMore = true;
  updateLoadMoreState();

  // Tăng currentPage để slice đúng items mới
  currentPage++;

  // Nếu đã có đủ items trong filteredMovies để render trang mới → chỉ cần render
  const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIdx = currentPage * ITEMS_PER_PAGE;
  if (endIdx <= filteredMovies.length) {
    // Đã có sẵn items trong cache, không cần fetch
    appendRenderedItems();
    isLoadingMore = false;
    updateLoadMoreState();
    return;
  }

  // Thiếu items → fetch thêm 1 batch (đủ cho vài trang client)
  // Dùng logic batch giống goToPage cũ: batch 3 trang song song, dừng khi đủ.
  const needToReach = currentPage * ITEMS_PER_PAGE;
  const BATCH_SIZE = 3;
  const MAX_BATCHES = 4;
  let batchCount = 0;
  const itemsBeforeFetch = filteredMovies.length;

  while (batchCount < MAX_BATCHES) {
    const missingPages = [];
    for (let p = apiPagesFetched + 1; p <= maxPages; p++) {
      if (apiPageCache[p] === undefined) missingPages.push(p);
    }
    if (missingPages.length === 0) break;

    const batch = missingPages.slice(0, BATCH_SIZE);
    const results = await Promise.allSettled(batch.map((p) => fetchOnePageWithRetry(p)));

    const fetchedPages = results
      .filter((r) => r.status === "fulfilled" && r.value && !r.value.error && Array.isArray(r.value.items))
      .map((r) => r.value.page);
    if (fetchedPages.length === 0) break; // cả batch fail
    apiPagesFetched = Math.max(apiPagesFetched, ...fetchedPages);

    // Merge items mới vào filteredMovies
    mergeCachedIntoFiltered();

    batchCount++;

    // Đủ items chưa?
    if (filteredMovies.length >= needToReach) break;
  }

  // Render items mới (append)
  appendRenderedItems();

  // Hết phim? Kiểm tra 3 điều kiện:
  // (1) Đã fetch tới maxPages (giới hạn cứng) mà vẫn thiếu items
  // (2) Đã tải đủ tổng số phim API báo
  // (3) Batch vừa rồi không thêm được items mới nào (toàn fail/rỗng)
  if (filteredMovies.length < endIdx && apiPagesFetched >= maxPages) {
    loadMoreExhausted = true;
  } else if (apiTotalItems > 0 && filteredMovies.length >= apiTotalItems) {
    loadMoreExhausted = true;
  } else if (batchCount > 0 && filteredMovies.length === itemsBeforeFetch) {
    loadMoreExhausted = true;
  }

  isLoadingMore = false;
  updateLoadMoreState();
}

/**
 * Helper: fetch 1 trang API (lỗi → null, rỗng → skip trang kế, có items → trả về).
 * Đã cache vào apiPageCache. Trả về {page, items, error}.
 */
async function fetchOnePageWithRetry(page) {
  // Cache filter values 1 lần thay vì đọc lại mỗi page trong batch (mỗi batch
  // fetchOnePageWithRetry được gọi cho nhiều page liên tiếp).
  const filters = {
    year: getFilterValue("Year"),
    country: getFilterValue("Country"),
    genre: getFilterValue("Genre"),
  };
  let p = page;
  while (p <= maxPages) {
    let result;
    try {
      result = await fetchCatalogMovies(pageType, p, filters);
    } catch (e) {
      result = { ok: false, error: e };
    }
    if (!result || result.ok === false) {
      apiPageCache[p] = { __failed: true };
      return { page: p, items: null, error: true };
    }
    if (Array.isArray(result.items) && result.items.length > 0) {
      apiPageCache[p] = result.items;
      return { page: p, items: result.items, error: false };
    }
    apiPageCache[p] = [];
    p++;
  }
  return null;
}

// Track page index đã merge xong vào filteredMovies — chỉ merge các page MỚI
// mỗi batch. Trước đây mỗi lần mergeCachedIntoFiltered() đều duyệt từ 1→maxPages,
// với cache lớn (vài nghìn items × 100+ pages) thì tốn không cần thiết.
let lastMergedThroughPage = 0;

function resetMergeState() {
  lastMergedThroughPage = 0;
}

/**
 * Merge items từ apiPageCache[lastMergedThroughPage+1..apiPagesFetched] vào
 * filteredMovies (idempotent — gọi nhiều lần vẫn an toàn).
 */
function mergeCachedIntoFiltered() {
  if (lastMergedThroughPage >= apiPagesFetched) return;
  const existing = new Set(filteredMovies.map((m) => `${m.name.toLowerCase()}|${m.year}`));
  for (let p = lastMergedThroughPage + 1; p <= apiPagesFetched && p <= maxPages; p++) {
    const items = apiPageCache[p];
    if (!Array.isArray(items) || items.length === 0) continue;
    for (const m of items) {
      if (!m._apiPage) m._apiPage = p;
      const key = `${m.name.toLowerCase()}|${m.year}`;
      if (!existing.has(key)) {
        filteredMovies.push(m);
        existing.add(key);
      }
    }
    lastMergedThroughPage = p;
  }
}

/**
 * Đếm tổng items trong cache (gồm cả trang rỗng, fail) → tính số trang client đã có thể render.
 * Dùng cho infinite scroll: biết khi nào đủ items để không cần fetch thêm.
 */
function countCachedItems() {
  let total = 0;
  for (let p = 1; p <= apiPagesFetched && p <= maxPages; p++) {
    const items = apiPageCache[p];
    if (Array.isArray(items)) total += items.length;
  }
  return total;
}

async function initCatalog() {
  // Determine page type from URL parameter
  pageType = getPageType();

  // Infinite scroll: reset trạng thái khi init (tránh cache cũ nếu user back/forward)
  isLoadingMore = false;
  loadMoreExhausted = false;
  loadMoreObserver?.disconnect();

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
    catalogGrid.innerHTML = SKELETON_HTML;
  }

    // Nếu URL có filter → fetch ngay với filter
    // Ngược lại load nhiều trang không filter để có danh sách phong phú
    const hasFilter = urlFilters.country || urlFilters.genre || urlFilters.year;

    if (hasFilter) {
      const result = await fetchCatalogMovies(pageType, 1, urlFilters);
      const movies = Array.isArray(result) ? result : (result && result.ok ? result.items : null);
      const fetchOk = Array.isArray(result) || (result && result.ok);
      if (!fetchOk) {
        if (catalogGrid) {
          catalogGrid.innerHTML =
            '<div class="col-12"><p class="text-danger text-center py-5">Lỗi tải dữ liệu. Vui lòng thử lại!</p></div>';
        }
        return;
      }
      if (!movies || movies.length === 0) {
        if (catalogGrid) {
          catalogGrid.innerHTML =
            '<div class="col-12"><p class="text-muted text-center py-5">Không tìm thấy phim phù hợp với bộ lọc.</p></div>';
        }
        loadMoreExhausted = true;
        return;
      }
      allMovies = movies;
      apiPagesFetched = 1;
      resetMergeState();
      // Cache trang đầu (đã có sẵn → goToPage sẽ không fetch lại)
      apiPageCache[1] = movies;
      populateFilters(allMovies);
      // Set giá trị filter từ URL sau khi populate
      setFilterValue("Year", urlFilters.year);
      setFilterValue("Country", urlFilters.country);
      setFilterValue("Genre", urlFilters.genre);
      setFilterValue("Sort", urlFilters.sort || "updated");
      applySort(allMovies);
      filteredMovies = allMovies;
      currentPage = 1;
      renderMovieGrid();
      updateFilterCount();
      syncURLFromFilters();
    } else {
      // Chỉ fetch 1 trang API (không fetchMultiplePages 3 trang như trước — tốn
      // request khi user chưa cuộn tới). Khi user cuộn xuống, IntersectionObserver
      // sẽ trigger loadMore() để tự động tải các trang tiếp theo.
      const result = await fetchCatalogMovies(pageType, 1, {});
      const movies = Array.isArray(result) ? result : (result && result.ok ? result.items : null);
      const fetchOk = Array.isArray(result) || (result && result.ok);
      if (!fetchOk) {
        if (catalogGrid) {
          catalogGrid.innerHTML =
            '<p class="text-danger text-center py-5" style="grid-column:1/-1;">Lỗi tải dữ liệu. Vui lòng thử lại!</p>';
        }
        return;
      }
      if (!movies || movies.length === 0) {
        if (catalogGrid) {
          catalogGrid.innerHTML =
            '<p class="text-muted text-center py-5" style="grid-column:1/-1;">Không có dữ liệu</p>';
        }
        loadMoreExhausted = true;
        return;
      }
      allMovies = movies;
      apiPageCache[1] = movies;
      apiPagesFetched = 1;
      resetMergeState();
      populateFilters(allMovies);
      if (urlFilters.sort) setFilterValue("Sort", urlFilters.sort);
      applySort(allMovies);
      filteredMovies = allMovies;
      currentPage = 1;
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

      // Token để tránh race condition khi user đổi filter liên tục.
      // Skeleton sẽ hiện SAU khi debounce fire (trong applyFilters) — trước đây
      // hiện ngay lập tức → nếu user click filter nhanh liên tục thì grid flash
      // skeleton ↔ skeleton liên tục rất khó chịu.
      const myToken = ++filterReqToken;
      clearTimeout(filterDebounceTimer);
      filterDebounceTimer = setTimeout(() => {
        if (myToken !== filterReqToken) return; // request bị huỷ bởi lần đổi mới hơn
        const grid = document.getElementById("catalogGrid");
        if (grid) grid.innerHTML = SKELETON_HTML;
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