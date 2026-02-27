const AdminLayout = (() => {
  const ENABLE_SHELL_NAV = false;
  const SIDEBAR_COLLAPSED_KEY = "admin_sidebar_collapsed";
  const NAV_GROUP_STATE_KEY = "admin_nav_group_state_v1";
  const STAFF_RESTRICTED_PATHS = new Set([]);
  const SHELL_SCRIPT_BASE = ["/admin/assets/js/core.js", "/admin/assets/js/layout.js"];
  const NAV_GROUPS = [
    {
      label: "Operations",
      links: [
        { href: "/admin/operations.html", label: "Operations Board" },
        { href: "/admin/order-history.html", label: "Order History" },
        { href: "/admin/instore.html", label: "In-Store Orders" },
        { href: "/admin/menu.html", label: "Menu Management" },
      ],
    },
    {
      label: "Insights",
      links: [
        { href: "/admin/analytics.html", label: "Analytics" },
        { href: "/admin/loyalty.html", label: "Loyalty Ops" },
        { href: "/admin/sla.html", label: "SLA Health" },
        { href: "/admin/reports.html", label: "Reports" },
        { href: "/admin/logs.html", label: "Logs" },
      ],
    },
    {
      label: "Governance",
      links: [
        { href: "/admin/incidents.html", label: "Incidents" },
        { href: "/admin/disputes.html", label: "Disputes" },
        { href: "/admin/riders.html", label: "Rider Management", adminOnly: true },
        { href: "/admin/staff.html", label: "Staff Management" },
        { href: "/admin/settings.html", label: "Settings" },
      ],
    },
  ];
  const NAV_LINKS = NAV_GROUPS.flatMap((group) => group.links);
  const PATH_PERMISSION = {
    "/admin/operations.html": "orders.view",
    "/admin/order-history.html": "orders.view",
    "/admin/order-detail.html": "orders.view",
    "/admin/instore.html": "instore.create",
    "/admin/menu.html": "menu.view",
    "/admin/staff.html": "staff.manage",
    "/admin/analytics.html": "analytics.view",
    "/admin/loyalty.html": "analytics.view",
    "/admin/sla.html": ["analytics.view", "settings.sla"],
    "/admin/incidents.html": "incidents.manage",
    "/admin/disputes.html": "disputes.manage",
    "/admin/riders.html": "staff.manage",
    "/admin/logs.html": "logs.view",
    "/admin/reports.html": ["reports.generate", "reports.download"],
    "/admin/settings.html": ["settings.store", "settings.sla"],
  };
  let currentAdmin = null;
  let modalState = null;
  let sidebarState = null;
  let shellNavigationReady = false;
  let currentPagePath = window.location.pathname;
  let navigationInFlight = false;
  let profileMenuOutsideClickHandler = null;
  let lastUiClickKey = "";
  let lastUiClickAt = 0;
  const mountedPageScripts = [];
  const managedIntervals = new Set();
  const managedTimeouts = new Set();
  const nativeSetInterval = window.setInterval.bind(window);
  const nativeClearInterval = window.clearInterval.bind(window);
  const nativeSetTimeout = window.setTimeout.bind(window);
  const nativeClearTimeout = window.clearTimeout.bind(window);
  const RESTRICTED_HINT_ID = "navRestrictedHint";
  let navGroupState = readNavGroupState();

  if (ENABLE_SHELL_NAV) {
    window.setInterval = (...args) => {
      const id = nativeSetInterval(...args);
      managedIntervals.add(id);
      return id;
    };
    window.clearInterval = (id) => {
      managedIntervals.delete(id);
      return nativeClearInterval(id);
    };
    window.setTimeout = (...args) => {
      const id = nativeSetTimeout(...args);
      managedTimeouts.add(id);
      return id;
    };
    window.clearTimeout = (id) => {
      managedTimeouts.delete(id);
      return nativeClearTimeout(id);
    };
  }

  function titleFromEmail(email) {
    const local = String(email || "user").split("@")[0].replace(/[._-]+/g, " ");
    return local
      .split(" ")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  function displayName(admin) {
    const name = String(admin?.fullName || "").trim();
    if (name) return name;
    return titleFromEmail(admin?.email || "");
  }

  function readNavGroupState() {
    try {
      const raw = localStorage.getItem(NAV_GROUP_STATE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      return parsed;
    } catch (_) {
      return {};
    }
  }

  function persistNavGroupState() {
    try {
      localStorage.setItem(NAV_GROUP_STATE_KEY, JSON.stringify(navGroupState));
    } catch (_) {
      // ignore storage quota / private mode issues
    }
  }

  function navGroupKeyFromLabel(label, index) {
    const normalized = String(label || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return normalized || `group_${index + 1}`;
  }

  function rememberGroupState(groupElement, isOpen) {
    const key = groupElement?.dataset?.groupKey;
    if (!key) return;
    navGroupState[key] = Boolean(isOpen);
    persistNavGroupState();
  }

  function ensureStandardNav() {
    const nav = document.querySelector(".nav-links");
    if (!nav) return;
    nav.innerHTML = "";

    NAV_GROUPS.forEach((group, groupIndex) => {
      const groupKey = navGroupKeyFromLabel(group.label, groupIndex);
      const groupEl = document.createElement("details");
      groupEl.className = "nav-group";
      groupEl.dataset.groupKey = groupKey;

      const summary = document.createElement("summary");
      summary.className = "nav-group-summary";

      const label = document.createElement("span");
      label.className = "nav-group-label";
      label.textContent = group.label;
      summary.appendChild(label);

      const caret = document.createElement("span");
      caret.className = "nav-group-caret";
      caret.setAttribute("aria-hidden", "true");
      summary.appendChild(caret);

      const linksWrap = document.createElement("div");
      linksWrap.className = "nav-group-links";

      group.links.forEach((entry) => {
        const link = document.createElement("a");
        link.className = "nav-link";
        link.href = entry.href;
        link.textContent = entry.label;
        if (window.location.pathname === entry.href) {
          link.classList.add("active");
        }
        linksWrap.appendChild(link);
      });

      const hasStoredState = Object.prototype.hasOwnProperty.call(navGroupState, groupKey);
      const isCurrentGroup = group.links.some((entry) => window.location.pathname === entry.href);
      groupEl.open = hasStoredState ? Boolean(navGroupState[groupKey]) : true;
      if (isCurrentGroup) {
        groupEl.open = true;
      }

      if (!hasStoredState) {
        navGroupState[groupKey] = groupEl.open;
      }

      groupEl.appendChild(summary);
      groupEl.appendChild(linksWrap);
      groupEl.addEventListener("toggle", () => {
        rememberGroupState(groupEl, groupEl.open);
      });
      nav.appendChild(groupEl);
    });

    persistNavGroupState();
  }

  function upsertRestrictedHint(hiddenCount) {
    const nav = document.querySelector(".nav-links");
    if (!nav) return;
    let hint = document.getElementById(RESTRICTED_HINT_ID);

    if (hiddenCount > 0) {
      if (!hint) {
        hint = document.createElement("div");
        hint.id = RESTRICTED_HINT_ID;
        hint.className = "nav-restricted-hint";
        nav.appendChild(hint);
      }
      hint.textContent = `${hiddenCount} page${hiddenCount === 1 ? "" : "s"} hidden by your role permissions.`;
      return;
    }

    if (hint && hint.parentNode) {
      hint.parentNode.removeChild(hint);
    }
  }

  function setActiveNav(pathname) {
    const nav = document.querySelector(".nav-links");
    if (!nav) return;
    let activeGroup = null;
    nav.querySelectorAll("a.nav-link[href]").forEach((link) => {
      const path = (link.getAttribute("href") || "").split("?")[0];
      const isActive = path === pathname;
      link.classList.toggle("active", isActive);
      if (isActive) {
        activeGroup = link.closest(".nav-group");
      }
    });

    if (activeGroup && !activeGroup.open) {
      activeGroup.open = true;
      rememberGroupState(activeGroup, true);
    }
  }

  function hasPagePermission(required, permissions) {
    if (!required) return true;
    if (Array.isArray(required)) {
      return required.some((action) => Boolean(permissions[action]));
    }
    return Boolean(permissions[required]);
  }

  function getFirstAllowedPath(isAdmin, permissions = {}) {
    for (const entry of NAV_LINKS) {
      const required = PATH_PERMISSION[entry.href];
      const allowedByPermission = hasPagePermission(required, permissions);
      const allowed = (entry.adminOnly ? isAdmin : true) && allowedByPermission;
      if (allowed) return entry.href;
    }
    return "/admin/login.html";
  }

  function applyRoleAccess(admin) {
    const isAdmin = (admin.role || "staff") === "admin";
    const permissions = admin.permissions || {};
    const nav = document.querySelector(".nav-links");
    let hiddenCount = 0;
    if (nav) {
      nav.querySelectorAll(".nav-group").forEach((groupElement) => {
        let visibleLinks = 0;
        groupElement.querySelectorAll("a.nav-link[href]").forEach((link) => {
          const path = (link.getAttribute("href") || "").split("?")[0];
          const config = NAV_LINKS.find((entry) => entry.href === path);
          if (!config) return;
          const required = PATH_PERMISSION[path];
          const allowedByPermission = hasPagePermission(required, permissions);
          const allowed = (config.adminOnly ? isAdmin : true) && allowedByPermission;
          link.style.display = allowed ? "" : "none";
          if (!allowed) {
            hiddenCount += 1;
            return;
          }
          visibleLinks += 1;
        });

        groupElement.style.display = visibleLinks > 0 ? "" : "none";
        if (visibleLinks > 0 && groupElement.querySelector("a.nav-link.active")) {
          groupElement.open = true;
          rememberGroupState(groupElement, true);
        }
      });
    }

    upsertRestrictedHint(hiddenCount);

    const currentPath = window.location.pathname;
    const currentRequired = PATH_PERMISSION[currentPath];
    const hasCurrentPermission = hasPagePermission(currentRequired, permissions);
    if (!isAdmin && STAFF_RESTRICTED_PATHS.has(currentPath)) {
      window.location.href = getFirstAllowedPath(isAdmin, permissions);
      return false;
    }
    if (!hasCurrentPermission) {
      window.location.href = getFirstAllowedPath(isAdmin, permissions);
      return false;
    }
    return true;
  }

  function setThemeToggleSwitch(input) {
    const theme = document.documentElement.getAttribute("data-theme") || "light";
    input.checked = theme === "dark";
  }

  function buildProfileMenu(admin) {
    const e = AdminCore.escapeHtml;
    const topbarActions = document.querySelector(".topbar-actions");
    if (!topbarActions) return;

    const oldAdminMeta = document.getElementById("adminMeta");
    const oldThemeBtn = document.getElementById("themeToggle");
    const oldLogoutBtn = document.getElementById("logoutBtn");
    const oldAlertBtn = document.getElementById("alertToggleBtn");
    [oldAdminMeta, oldThemeBtn, oldLogoutBtn, oldAlertBtn].forEach((element) => {
      if (element) element.style.display = "none";
    });

    const wrapper = document.createElement("div");
    wrapper.className = "profile-menu";

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "btn profile-trigger";
    trigger.id = "profileMenuBtn";
    trigger.textContent = `${displayName(admin)} ▾`;

    const panel = document.createElement("div");
    panel.className = "profile-panel";
    panel.id = "profilePanel";
    panel.innerHTML = `
      <div class="profile-head">
        <div class="name">${e(displayName(admin))}</div>
        <div class="meta">${e(admin.role || "staff")}</div>
        <div class="meta">${e(admin.email)}</div>
      </div>
      <div class="profile-row">
        <span>Dark mode</span>
        <label class="switch">
          <input id="profileThemeSwitch" type="checkbox" />
          <span class="slider"></span>
        </label>
      </div>
      <div class="profile-row">
        <span>Mute alerts</span>
        <label class="switch">
          <input id="profileMuteSwitch" type="checkbox" />
          <span class="slider"></span>
        </label>
      </div>
      <div class="profile-row actions">
        <button id="profileLogoutBtn" class="btn danger">Logout</button>
      </div>
    `;

    wrapper.appendChild(trigger);
    wrapper.appendChild(panel);
    topbarActions.appendChild(wrapper);

    const themeSwitch = panel.querySelector("#profileThemeSwitch");
    const muteSwitch = panel.querySelector("#profileMuteSwitch");
    const logoutButton = panel.querySelector("#profileLogoutBtn");

    setThemeToggleSwitch(themeSwitch);
    const settings = AdminCore.getSettings();
    muteSwitch.checked = !settings.alertEnabled;

    function closeMenu() {
      panel.classList.remove("open");
    }

    trigger.addEventListener("click", () => {
      panel.classList.toggle("open");
    });

    if (profileMenuOutsideClickHandler) {
      document.removeEventListener("click", profileMenuOutsideClickHandler);
    }
    profileMenuOutsideClickHandler = (event) => {
      if (!wrapper.contains(event.target)) {
        closeMenu();
      }
    };
    document.addEventListener("click", profileMenuOutsideClickHandler);

    themeSwitch.addEventListener("change", () => {
      const current = document.documentElement.getAttribute("data-theme") || "light";
      const shouldBeDark = themeSwitch.checked;
      if ((current === "dark") !== shouldBeDark) {
        AdminCore.toggleTheme();
      }
      window.dispatchEvent(
        new CustomEvent("admin:theme-changed", {
          detail: { theme: shouldBeDark ? "dark" : "light" },
        }),
      );
    });

    muteSwitch.addEventListener("change", () => {
      const alertEnabled = !muteSwitch.checked;
      AdminCore.updateSettings({ alertEnabled });
      window.dispatchEvent(
        new CustomEvent("admin:alert-setting-changed", {
          detail: { alertEnabled },
        }),
      );
    });

    logoutButton.addEventListener("click", async () => {
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      const next = encodeURIComponent(AdminCore.toSafeAdminPath(current));
      try {
        await AdminCore.logout();
      } catch (_) {
        // best-effort logout
      }
      window.location.href = `/admin/login.html?next=${next}`;
    });
  }

  function initSidebarLayout() {
    const shell = document.querySelector(".page-shell");
    const sidebar = document.querySelector(".sidebar");
    if (!shell || !sidebar) return;

    if (sidebarState) {
      sidebarState.applyState();
      return;
    }

    const mediaQuery = window.matchMedia("(max-width: 1024px)");
    let desktopCollapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
    let mobileOpen = false;

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "sidebar-edge-toggle";
    toggleBtn.id = "sidebarToggleBtn";
    toggleBtn.setAttribute("aria-controls", "adminSidebar");
    toggleBtn.setAttribute("aria-expanded", "true");
    toggleBtn.setAttribute("aria-label", "Toggle navigation menu");

    sidebar.id = "adminSidebar";
    document.body.appendChild(toggleBtn);

    const overlay = document.createElement("button");
    overlay.type = "button";
    overlay.className = "sidebar-overlay";
    overlay.setAttribute("aria-label", "Close navigation menu");
    document.body.appendChild(overlay);

    function applyState() {
      const isMobile = mediaQuery.matches;

      if (isMobile) {
        document.body.classList.remove("sidebar-collapsed");
        document.body.classList.toggle("sidebar-open", mobileOpen);
        toggleBtn.textContent = mobileOpen ? "×" : "☰";
        toggleBtn.setAttribute("aria-expanded", mobileOpen ? "true" : "false");
        return;
      }

      mobileOpen = false;
      document.body.classList.remove("sidebar-open");
      document.body.classList.toggle("sidebar-collapsed", desktopCollapsed);
      toggleBtn.textContent = desktopCollapsed ? "»" : "«";
      toggleBtn.setAttribute("aria-expanded", desktopCollapsed ? "false" : "true");
    }

    toggleBtn.addEventListener("click", () => {
      if (mediaQuery.matches) {
        mobileOpen = !mobileOpen;
      } else {
        desktopCollapsed = !desktopCollapsed;
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, desktopCollapsed ? "1" : "0");
      }
      applyState();
    });

    overlay.addEventListener("click", () => {
      mobileOpen = false;
      applyState();
    });

    sidebar.addEventListener("click", (event) => {
      const link = event.target.closest(".nav-link");
      if (!link) return;
      if (!sidebar.contains(link)) return;
      {
        const targetPath = (link.getAttribute("href") || "").split("?")[0];
        if (targetPath === window.location.pathname) {
          event.preventDefault();
          return;
        }
        if (!mediaQuery.matches) return;
        mobileOpen = false;
        applyState();
      }
    });

    mediaQuery.addEventListener("change", () => {
      mobileOpen = false;
      applyState();
    });

    sidebarState = {
      applyState,
      openMobile: () => {
        mobileOpen = true;
        applyState();
      },
      closeMobile: () => {
        mobileOpen = false;
        applyState();
      },
    };

    applyState();
  }

  function mountCommonHandlers(admin) {
    currentAdmin = admin;
    initSidebarLayout();
    buildProfileMenu(admin);
    ensureActionModal();
  }

  function ensureActionModal() {
    if (document.getElementById("actionModalBackdrop")) return;
    const backdrop = document.createElement("div");
    backdrop.id = "actionModalBackdrop";
    backdrop.className = "action-modal-backdrop";
    backdrop.innerHTML = `
      <div class="action-modal">
        <h3 id="actionModalTitle">Confirm Action</h3>
        <div id="actionModalMessage" class="msg"></div>
        <div class="actions">
          <button type="button" id="actionModalCancel" class="btn">Cancel</button>
          <button type="button" id="actionModalConfirm" class="btn primary">Confirm</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    const cancelBtn = backdrop.querySelector("#actionModalCancel");
    const confirmBtn = backdrop.querySelector("#actionModalConfirm");

    cancelBtn.addEventListener("click", () => {
      if (!modalState) return;
      const state = modalState;
      modalState = null;
      backdrop.classList.remove("open");
      state.resolve(false);
    });

    confirmBtn.addEventListener("click", () => {
      if (!modalState) return;
      const state = modalState;
      modalState = null;
      backdrop.classList.remove("open");
      state.resolve(true);
    });
  }

  function openModal({ title, message, confirmLabel = "Confirm", cancelLabel = "Cancel" }) {
    ensureActionModal();
    const backdrop = document.getElementById("actionModalBackdrop");
    const titleEl = document.getElementById("actionModalTitle");
    const messageEl = document.getElementById("actionModalMessage");
    const confirmEl = document.getElementById("actionModalConfirm");
    const cancelEl = document.getElementById("actionModalCancel");

    titleEl.textContent = title || "Confirm Action";
    messageEl.textContent = message || "";
    confirmEl.textContent = confirmLabel;
    cancelEl.textContent = cancelLabel;
    cancelEl.style.display = cancelLabel ? "" : "none";
    backdrop.classList.add("open");

    return new Promise((resolve) => {
      modalState = { resolve };
    });
  }

  function resetModalState() {
    modalState = null;
    const backdrop = document.getElementById("actionModalBackdrop");
    if (backdrop) backdrop.classList.remove("open");
  }

  async function confirmAction(message, options = {}) {
    return openModal({
      title: options.title || "Confirm Action",
      message,
      confirmLabel: options.confirmLabel || "Apply",
      cancelLabel: options.cancelLabel || "Cancel",
    });
  }

  async function notifyAction(message, options = {}) {
    await openModal({
      title: options.title || "Update Applied",
      message,
      confirmLabel: "OK",
      cancelLabel: "",
    });
  }

  function setStatus(message, kind = "helper") {
    const element = document.getElementById("statusText");
    if (!element) return;
    element.className = kind;
    element.textContent = message;
  }

  function trackUiButtonClick(button) {
    if (!button) return;
    const targetId = button.id || "";
    const targetText = String(button.textContent || "").trim().replace(/\s+/g, " ").slice(0, 180);
    const targetClass = String(button.className || "").trim().slice(0, 200);
    const pagePath = window.location.pathname;
    const key = `${pagePath}|${targetId}|${targetText}|${targetClass}`;
    const now = Date.now();
    if (key === lastUiClickKey && now - lastUiClickAt < 350) {
      return;
    }
    lastUiClickKey = key;
    lastUiClickAt = now;

    const csrf = sessionStorage.getItem("admin_csrf_token") || "";
    fetch("/api/admin/ui-events", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrf,
      },
      body: JSON.stringify({
        eventType: "button_click",
        targetId,
        targetText,
        targetClass,
        pagePath,
      }),
    }).catch(() => {
      // best-effort telemetry only
    });
  }

  function clearManagedIntervals() {
    managedIntervals.forEach((id) => nativeClearInterval(id));
    managedIntervals.clear();
  }

  function clearManagedTimeouts() {
    managedTimeouts.forEach((id) => nativeClearTimeout(id));
    managedTimeouts.clear();
  }

  function clearMountedPageScripts() {
    mountedPageScripts.forEach((script) => {
      if (script && script.parentNode) {
        script.parentNode.removeChild(script);
      }
    });
    mountedPageScripts.length = 0;
  }

  function normalizeScriptSrc(src) {
    try {
      return new URL(src, window.location.origin).pathname;
    } catch (_) {
      return src || "";
    }
  }

  function getPageScriptPaths(doc) {
    const paths = [];
    doc.querySelectorAll("script[src]").forEach((script) => {
      const path = normalizeScriptSrc(script.getAttribute("src") || "");
      if (!path.startsWith("/admin/assets/js/")) return;
      if (SHELL_SCRIPT_BASE.includes(path)) return;
      paths.push(path);
    });
    return paths;
  }

  async function mountPageScripts(paths) {
    clearMountedPageScripts();
    for (const path of paths) {
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = path;
        script.async = false;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load script ${path}`));
        mountedPageScripts.push(script);
        document.body.appendChild(script);
      });
    }
  }

  async function navigateTo(path, { pushState = true } = {}) {
    if (!path || path === currentPagePath || navigationInFlight) return;
    navigationInFlight = true;
    try {
      resetModalState();
      const controller = new AbortController();
      const timeoutId = nativeSetTimeout(() => controller.abort(), 12000);
      const response = await fetch(path, {
        credentials: "include",
        headers: {
          "x-admin-shell-nav": "1",
        },
        signal: controller.signal,
      });
      nativeClearTimeout(timeoutId);

      if (!response.ok) {
        window.location.href = path;
        return;
      }

      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const nextMain = doc.querySelector(".main-panel");
      if (!nextMain) {
        window.location.href = path;
        return;
      }

      const currentMain = document.querySelector(".main-panel");
      if (!currentMain) {
        window.location.href = path;
        return;
      }

      clearManagedIntervals();
      clearManagedTimeouts();
      currentMain.replaceWith(nextMain);
      document.title = doc.title || document.title;
      currentPagePath = path;
      setActiveNav(path);

      if (pushState) {
        window.history.pushState({ path }, "", path);
      }

      const scripts = getPageScriptPaths(doc);
      await mountPageScripts(scripts);
    } catch (_) {
      window.location.href = path;
    } finally {
      navigationInFlight = false;
    }
  }

  function ensureShellNavigation() {
    if (!ENABLE_SHELL_NAV) return;
    if (shellNavigationReady) return;
    const nav = document.querySelector(".nav-links");
    if (!nav) return;

    nav.addEventListener("click", async (event) => {
      const link = event.target.closest("a.nav-link[href]");
      if (!link) return;
      const href = link.getAttribute("href");
      if (!href) return;
      const targetPath = href.split("?")[0];
      if (!targetPath.startsWith("/admin/")) return;
      if (targetPath === "/admin/login.html") return;
      event.preventDefault();
      await navigateTo(targetPath, { pushState: true });
    });

    window.addEventListener("popstate", async () => {
      const targetPath = window.location.pathname;
      if (!targetPath.startsWith("/admin/") || targetPath === "/admin/login.html") {
        window.location.reload();
        return;
      }
      await navigateTo(targetPath, { pushState: false });
    });

    shellNavigationReady = true;
  }

  async function initProtectedPage() {
    AdminCore.initTheme();
    await AdminCore.fetchCsrfToken();
    const admin = await AdminCore.ensureAuthenticated({ redirect: true });
    currentPagePath = window.location.pathname;
    ensureStandardNav();
    ensureShellNavigation();
    setActiveNav(window.location.pathname);
    if (!applyRoleAccess(admin)) return admin;
    mountCommonHandlers(admin);
    if (!document.body.dataset.uiClickLoggerBound) {
      document.addEventListener("click", (event) => {
        const button = event.target.closest("button");
        if (!button) return;
        trackUiButtonClick(button);
      });
      document.body.dataset.uiClickLoggerBound = "1";
    }
    return admin;
  }

  return {
    initProtectedPage,
    setStatus,
    confirmAction,
    notifyAction,
    getCurrentAdmin: () => currentAdmin,
  };
})();

if (typeof window !== "undefined") {
  window.AdminLayout = AdminLayout;
}
