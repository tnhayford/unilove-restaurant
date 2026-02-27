const AdminCore = (() => {
  const THEME_KEY = "admin_theme";
  const CSRF_KEY = "admin_csrf_token";
  const SETTINGS_KEY = "admin_settings_v1";
  const DEFAULT_SETTINGS = {
    alertEnabled: true,
    alertVolume: 0.75,
    alertTone: "ops_default",
    alertIntervalMs: 1400,
    autoRefreshMs: 6000,
  };
  let pendingRequestCount = 0;

  function setBusyState(isBusy) {
    document.body.classList.toggle("api-busy", isBusy);
  }

  function toSafeAdminPath(input) {
    if (!input || typeof input !== "string") {
      return "/admin/operations.html";
    }

    try {
      const decoded = decodeURIComponent(input);
      if (!decoded.startsWith("/")) return "/admin/operations.html";
      if (decoded.startsWith("//")) return "/admin/operations.html";
      if (!decoded.startsWith("/admin/")) return "/admin/operations.html";
      return decoded;
    } catch (_) {
      return "/admin/operations.html";
    }
  }

  function setTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }

  function initTheme() {
    const preferred = localStorage.getItem(THEME_KEY) || "light";
    setTheme(preferred);
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme") || "light";
    const next = current === "light" ? "dark" : "light";
    setTheme(next);
    return next;
  }

  function getSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_SETTINGS,
        ...(parsed || {}),
      };
    } catch (_) {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings(nextSettings) {
    const merged = {
      ...DEFAULT_SETTINGS,
      ...(nextSettings || {}),
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
    return merged;
  }

  function updateSettings(partialSettings) {
    const current = getSettings();
    return saveSettings({
      ...current,
      ...(partialSettings || {}),
    });
  }

  function getStoredCsrfToken() {
    return sessionStorage.getItem(CSRF_KEY) || "";
  }

  function storeCsrfToken(token) {
    if (token) {
      sessionStorage.setItem(CSRF_KEY, token);
    }
    return token;
  }

  async function fetchCsrfToken(force = false) {
    if (!force) {
      const existing = getStoredCsrfToken();
      if (existing) return existing;
    }

    const response = await fetch("/api/admin/auth/csrf-token", {
      credentials: "include",
    });
    const payload = await response.json();
    if (!response.ok || !payload.csrfToken) {
      throw new Error(payload.error || "Unable to initialize CSRF token");
    }
    return storeCsrfToken(payload.csrfToken);
  }

  async function api(path, options = {}) {
    const method = (options.method || "GET").toUpperCase();
    const isMutating = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
    const headers = {
      ...(options.headers || {}),
    };

    if (isMutating) {
      const csrf = await fetchCsrfToken();
      headers["x-csrf-token"] = csrf;
      if (!headers["Content-Type"] && options.body) {
        headers["Content-Type"] = "application/json";
      }
    }

    pendingRequestCount += 1;
    setBusyState(true);
    try {
      const requestOptions = {
        credentials: "include",
        ...options,
        method,
        headers,
      };
      if (!isMutating) {
        requestOptions.cache = "no-store";
        requestOptions.headers = {
          ...requestOptions.headers,
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        };
      }

      const response = await fetch(path, {
        ...requestOptions,
      });

      let payload = {};
      try {
        payload = await response.json();
      } catch {
        payload = {};
      }

      if (!response.ok) {
        const firstDetail = Array.isArray(payload.details) && payload.details.length
          ? payload.details[0]
          : null;
        const detailText = firstDetail
          ? `${firstDetail.path || "request"}: ${firstDetail.message || "invalid value"}`
          : "";
        const baseMessage = payload.error || `Request failed (${response.status})`;
        const err = new Error(detailText ? `${baseMessage}. ${detailText}` : baseMessage);
        err.status = response.status;
        err.payload = payload;
        throw err;
      }

      return payload;
    } finally {
      pendingRequestCount = Math.max(0, pendingRequestCount - 1);
      if (pendingRequestCount === 0) {
        setBusyState(false);
      }
    }
  }

  async function ensureAuthenticated({ redirect = true } = {}) {
    try {
      const payload = await api("/api/admin/auth/me");
      return payload.data;
    } catch (error) {
      if (error.status === 401 && redirect) {
        const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        const next = encodeURIComponent(toSafeAdminPath(current));
        window.location.href = `/admin/login.html?next=${next}`;
      }
      throw error;
    }
  }

  async function logout() {
    await api("/api/admin/auth/logout", {
      method: "POST",
      body: JSON.stringify({}),
    });
    sessionStorage.removeItem(CSRF_KEY);
  }

  function shortId(value = "") {
    if (!value) return "-";
    return `${value.slice(0, 8)}...`;
  }

  function money(value) {
    return Number(value || 0).toFixed(2);
  }

  function timeAgo(timestamp) {
    if (!timestamp) return "-";
    const date = new Date(timestamp + "Z");
    const diffMs = Date.now() - date.getTime();
    const mins = Math.max(1, Math.floor(diffMs / 60000));
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  return {
    initTheme,
    toggleTheme,
    getSettings,
    saveSettings,
    updateSettings,
    fetchCsrfToken,
    api,
    ensureAuthenticated,
    toSafeAdminPath,
    logout,
    shortId,
    money,
    timeAgo,
    escapeHtml,
  };
})();
