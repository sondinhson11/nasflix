(function () {
  let currentPage = 1;
  let isFetching = false;
  let allMovies = [];
  let filteredMovies = [];
  let pageType = "series"; // "series" or "movies"
  let maxPages = 5; // số trang tối đa load được (mỗi trang 10 phim)

const API_ENDPOINTS = {
  phimapi: {
    series: "https://phimapi.com/v1/api/danh-sach/phim-bo",
    movies: "https://phimapi.com/v1/api/danh-sach/phim-le",
    "hoat-hinh": "https://phimapi.com/v1/api/danh-sach/hoat-hinh",
  },
  ophim: {
    series: "https://ophim1.com/v1/api/danh-sach/phim-bo",
    movies: "https://ophim1.com/v1/api/danh-sach/phim-le",
    "hoat-hinh": "https://ophim1.com/v1/api/danh-sach/hoat-hinh",
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

function buildApiUrl(base, type, page, year, country, genre) {
  const params = new URLSearchParams();
  params.set("page", String(page));
  if (year) params.set("year", String(year));
  if (country) {
    // Lấy slug từ country (lowercase, không dấu, gạch ngang)
    const slug = countryToSlug(country);
    if (slug) params.set("country", slug);
  }
  if (genre) {
    const slug = genreToSlug(genre);
    if (slug) params.set("category", slug);
  }
  return `${base}?${params.toString()}`;
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
  const results = await Promise.allSettled([
    axios.get(buildApiUrl(API_ENDPOINTS.phimapi[type], type, page, year, country, genre)),
    axios.get(buildApiUrl(API_ENDPOINTS.ophim[type], type, page, year, country, genre)),
  ]);

  const allMovies = [];
  results.forEach((result) => {
    if (result.status === "fulfilled") {
      const data = result.value.data;
      const payload = data.data || data;
      const items = payload.items || [];
      const isOphim = result.value.config.url.includes("ophim");
      const cdnBase = payload.APP_DOMAIN_CDN_IMAGE || (isOphim
        ? "https://img.ophim.live"
        : "https://phimimg.com");
      const cdnPath = isOphim ? "/uploads/movies/" : "/";

      items.forEach((item) => {
        let thumb = item.thumb_url;
        if (thumb) {
          if (!thumb.startsWith("http")) {
            const cleanThumb = thumb.startsWith("/") ? thumb.slice(1) : thumb;
            const needsPrefix = isOphim && !cleanThumb.startsWith("uploads/");
            thumb = cdnBase + (needsPrefix ? cdnPath : "/") + cleanThumb;
          }
        }

        allMovies.push({
          name: item.name,
          slug: item.slug,
          year: item.year || new Date().getFullYear(),
          type: item.type || (item.tmdb?.type === "tv" ? "series" : item.tmdb?.type === "movie" ? "single" : ""),
          time: item.time || "",
          episode_current: item.episode_current || "",
          thumb: thumb,
          country: item.country?.[0]?.name || "Không xác định",
          category: item.category?.[0]?.name || "Khác",
        });
      });
    }
  });

  // Loại trùng dựa trên name + year
  const merged = {};
  allMovies.forEach((movie) => {
    const key = `${movie.name.toLowerCase()}|${movie.year}`;
    if (!merged[key]) {
      merged[key] = movie;
    }
  });

  return Object.values(merged);
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
  FILTERS.countries.clear();
  FILTERS.genres.clear();

  movies.forEach((movie) => {
    if (movie.year) FILTERS.years.add(movie.year);
    if (movie.country) FILTERS.countries.add(movie.country);
    if (movie.category) FILTERS.genres.add(movie.category);
  });

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
        opt1.value = country;
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
        opt1.value = genre;
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

async function applyFilters() {
  const yearVal = getFilterValue("Year");
  const countryVal = getFilterValue("Country");
  const genreVal = getFilterValue("Genre");
  const sortVal = getFilterValue("Sort") || "updated";

  // Reset dữ liệu và fetch từ API với filter
  currentPage = 1;
  allMovies = [];
  filteredMovies = [];
  updateFilterCount();

  const grid = document.getElementById("catalogGrid");
  if (grid) {
    grid.innerHTML = Array(12)
      .fill(
        '<div class="col-6 col-md-3 col-lg-2"><div class="skeleton skeleton-card"></div></div>',
      )
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
          '<div class="col-12"><p class="text-muted text-center py-5">Không tìm thấy phim phù hợp với bộ lọc.</p></div>';
      }
      const loadMoreBtn = document.getElementById("loadMoreBtn");
      if (loadMoreBtn) loadMoreBtn.style.display = "none";
      return;
    }

    allMovies = movies;

    // Áp dụng sort
    if (sortVal === "newest") {
      allMovies.sort((a, b) => b.year - a.year);
    } else if (sortVal === "trending") {
      allMovies.reverse();
    }

    filteredMovies = allMovies;
    renderMovieGrid();
  } catch (e) {
    console.error("Filter fetch error:", e);
    if (grid) {
      grid.innerHTML =
        '<div class="col-12"><p class="text-danger text-center py-5">Lỗi tải dữ liệu. Vui lòng thử lại!</p></div>';
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

  const itemsPerPage = 24;
  const start = (currentPage - 1) * itemsPerPage;
  const end = currentPage * itemsPerPage;
  const paginated = filteredMovies.slice(start, end);

  if (currentPage === 1) {
    grid.innerHTML = "";
  }

  paginated.forEach((movie) => {
    const safeThumb = movie.thumb || "";
    const safeName = (movie.name || "").replace(/"/g, "&quot;");
    const meta = formatMovieMeta(movie);
    const cardHTML = `
      <a href="detail.html?slug=${movie.slug}" class="movie-card position-relative">
        <img src="${safeThumb}" alt="${safeName}" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 9%22><rect width=%2216%22 height=%229%22 fill=%22%23222%22/></svg>';this.style.background='%23222';">
        <div class="movie-info">
          <div class="movie-title">${safeName}</div>
          <div class="movie-meta-card">${meta}</div>
        </div>
      </a>
    `;
    grid.innerHTML += `<div class="col-6 col-md-3 col-lg-2">${cardHTML}</div>`;
  });

  updateLoadMoreButton();
}

function updateLoadMoreButton() {
  const itemsPerPage = 24;
  const end = currentPage * itemsPerPage;
  const loadMoreBtn = document.getElementById("loadMoreBtn");
  if (!loadMoreBtn) return;

  loadMoreBtn.disabled = isFetching;
  loadMoreBtn.textContent = isFetching ? "Đang tải..." : "Xem thêm";

  // Còn dữ liệu chưa hiển thị (local) hoặc còn có thể fetch thêm từ API
  const localRemain = end < filteredMovies.length;
  // Ước lượng trang API kế tiếp dựa trên tổng số phim đã fetch
  const approxFetchedPages = Math.ceil(allMovies.length / 18);
  const apiRemain = approxFetchedPages < maxPages;

  loadMoreBtn.style.display = (localRemain || apiRemain) ? "inline-block" : "none";
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

  try {
    const catalogGrid = document.getElementById("catalogGrid");
    if (catalogGrid) {
      catalogGrid.innerHTML = Array(12)
        .fill(
          '<div class="col-6 col-md-3 col-lg-2"><div class="skeleton skeleton-card"></div></div>',
        )
        .join("");
    }

    // Load vài trang đầu không filter để có danh sách year/country/genre phong phú
    allMovies = await fetchMultiplePages(pageType, 1, 3);

    if (!allMovies || allMovies.length === 0) {
      if (catalogGrid) {
        catalogGrid.innerHTML =
          '<div class="col-12"><p class="text-muted text-center">Không có dữ liệu</p></div>';
      }
      console.warn("No movies found for type:", pageType);
      return;
    }

    populateFilters(allMovies);
    filteredMovies = allMovies;
    currentPage = 1;
    renderMovieGrid();
    updateFilterCount();

    // Setup filter listeners
    const onFilterChange = (kind) => () => {
      const value = getFilterValue(kind);
      // Sync giá trị giữa desktop/sheet/mobile
      if (kind === "Sort") {
        setFilterValue("Sort", value);
      }
      currentPage = 1;
      updateFilterCount();
      applyFilters();
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

    // Load more button - fetch trang mới từ API với filter hiện tại
    document.getElementById("loadMoreBtn")?.addEventListener("click", async () => {
      if (isFetching) return;

      const yearVal = getFilterValue("Year");
      const countryVal = getFilterValue("Country");
      const genreVal = getFilterValue("Genre");

      // Trang kế tiếp dựa trên currentPage (1 trang = 24 phim hiển thị,
      // nhưng API trả ~18 unique nên cứ +1)
      const nextApiPage = currentPage + 1;

      if (nextApiPage > maxPages) {
        currentPage++;
        renderMovieGrid();
        updateLoadMoreButton();
        return;
      }

      isFetching = true;
      updateLoadMoreButton();
      try {
        const more = await fetchCatalogMovies(pageType, nextApiPage, {
          year: yearVal,
          country: countryVal,
          genre: genreVal,
        });
        if (more && more.length > 0) {
          const existing = new Set(allMovies.map(m => `${m.name.toLowerCase()}|${m.year}`));
          more.forEach(m => {
            const key = `${m.name.toLowerCase()}|${m.year}`;
            if (!existing.has(key)) {
              allMovies.push(m);
              existing.add(key);
            }
          });
          currentPage++;
          renderMovieGrid();
        } else {
          // Hết dữ liệu từ API
          currentPage++;
          renderMovieGrid();
        }
      } catch (e) {
        console.error("Load more error:", e);
      } finally {
        isFetching = false;
        updateLoadMoreButton();
      }
    });
  } catch (error) {
    console.error("Error initializing catalog:", error);
    const catalogGrid = document.getElementById("catalogGrid");
    if (catalogGrid) {
      catalogGrid.innerHTML =
        '<div class="col-12"><p class="text-danger text-center">Lỗi tải dữ liệu. Vui lòng thử lại!</p></div>';
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("view-catalog")) {
    initCatalog();
  }
});
})();
