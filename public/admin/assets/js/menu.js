let menuItems = [];
let menuCategories = [];
let selectedCategory = "ALL";
let activeTab = "catalog";
let expandedItemId = null;

function ussdCategoryPriority(category) {
  const key = String(category || "").trim().toLowerCase();
  if (!key) return 99;
  if (key.includes("shawarma")) return 1;
  if (key.includes("jollof")) return 2;
  if (key.includes("fried rice")) return 3;
  if (key.includes("assorted")) return 4;
  return 99;
}

function compareUssdCategoryNames(a, b) {
  const priorityDiff = ussdCategoryPriority(a) - ussdCategoryPriority(b);
  if (priorityDiff !== 0) return priorityDiff;
  return String(a || "").localeCompare(String(b || ""));
}

function compareItemsByUssdOrder(a, b) {
  const categoryDiff = compareUssdCategoryNames(a.category, b.category);
  if (categoryDiff !== 0) return categoryDiff;
  return String(a.name || "").localeCompare(String(b.name || ""));
}

function sortedCategoryNames() {
  return menuCategories
    .map((row) => row.category)
    .slice()
    .sort(compareUssdCategoryNames);
}

function getUssdItemSlots(items) {
  const visible = (Array.isArray(items) ? items : [])
    .filter((item) => item.isActive && item.ussdVisible !== false)
    .slice()
    .sort(compareItemsByUssdOrder);

  const categoryRanks = new Map();
  const perCategoryCounters = new Map();
  const slots = new Map();

  visible.forEach((item) => {
    const category = String(item.category || "");
    if (!categoryRanks.has(category)) {
      categoryRanks.set(category, categoryRanks.size + 1);
    }
    const nextItemRank = (perCategoryCounters.get(category) || 0) + 1;
    perCategoryCounters.set(category, nextItemRank);
    slots.set(item.id, `Cat #${categoryRanks.get(category)} | Item #${nextItemRank}`);
  });

  return slots;
}

function ussdDisplayPrice(item) {
  if (item.ussdPriceCedis != null) return Number(item.ussdPriceCedis || 0);
  return Number(item.priceCedis || 0);
}

function renderSummary(items) {
  const total = items.length;
  const active = items.filter((item) => item.isActive).length;
  const inactive = total - active;
  document.getElementById("menuTotal").textContent = String(total);
  document.getElementById("menuActive").textContent = String(active);
  document.getElementById("menuInactive").textContent = String(inactive);
}

function setActiveTab(nextTab) {
  const tab = String(nextTab || "catalog");
  activeTab = tab;

  document.querySelectorAll("[data-menu-tab]").forEach((btn) => {
    const isActive = btn.dataset.menuTab === tab;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
  });

  document.querySelectorAll("[data-menu-panel]").forEach((panel) => {
    const isActive = panel.dataset.menuPanel === tab;
    panel.hidden = !isActive;
    panel.classList.toggle("is-active", isActive);
  });

  if (tab === "ussd") {
    renderUssdPreview();
  }
}

function initializeTabs() {
  document.querySelectorAll("[data-menu-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setActiveTab(btn.dataset.menuTab);
    });
  });
}

function renderCategoryButtons() {
  const container = document.getElementById("categoryButtons");
  if (!container) return;

  const categories = sortedCategoryNames();
  if (selectedCategory !== "ALL" && !categories.includes(selectedCategory)) {
    selectedCategory = "ALL";
  }

  container.innerHTML = "";

  const allButton = document.createElement("button");
  allButton.type = "button";
  allButton.className = `cat-btn ${selectedCategory === "ALL" ? "active" : ""}`;
  allButton.textContent = "All";
  allButton.addEventListener("click", () => {
    selectedCategory = "ALL";
    renderCategoryButtons();
    applyFilters();
  });
  container.appendChild(allButton);

  categories.forEach((category, index) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `cat-btn ${selectedCategory === category ? "active" : ""}`;
    btn.textContent = `${index + 1}. ${category}`;
    btn.addEventListener("click", () => {
      selectedCategory = category;
      renderCategoryButtons();
      applyFilters();
    });
    container.appendChild(btn);
  });
}

function renderCategorySelectors() {
  const selectors = ["itemCategory", "renameFromCategory", "deleteCategoryName"];
  const categories = sortedCategoryNames();

  selectors.forEach((id) => {
    const select = document.getElementById(id);
    if (!select) return;
    const current = select.value;
    select.innerHTML = "";
    categories.forEach((category) => {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = category;
      select.appendChild(option);
    });
    if (categories.includes(current)) {
      select.value = current;
    }
  });
}

function categoryOptionsHtml(currentCategory) {
  const escape = AdminCore.escapeHtml;
  const categories = sortedCategoryNames();
  if (currentCategory && !categories.includes(currentCategory)) {
    categories.unshift(currentCategory);
  }
  return categories
    .map((category) => {
      const selected = category === currentCategory ? " selected" : "";
      return `<option value="${escape(category)}"${selected}>${escape(category)}</option>`;
    })
    .join("");
}

async function deleteMenuItem(item) {
  const confirmed = await AdminLayout.confirmAction(
    `Delete "${item.name}" permanently?`,
    { title: "Confirm Menu Deletion", confirmLabel: "Delete" },
  );
  if (!confirmed) return;
  await AdminCore.api(`/api/admin/menu/${item.id}`, {
    method: "DELETE",
    body: JSON.stringify({}),
  });
}

async function updateMenuItemDetails(item, { name, category }) {
  const nextName = String(name || "").trim();
  const nextCategory = String(category || "").trim();

  if (!nextName || nextName.length < 2) {
    throw new Error("Item name must be at least 2 characters.");
  }
  if (!nextCategory || nextCategory.length < 2) {
    throw new Error("Select a valid category.");
  }

  const payload = {};
  if (nextName !== item.name) payload.name = nextName;
  if (nextCategory !== item.category) payload.category = nextCategory;

  if (!Object.keys(payload).length) return false;

  await AdminCore.api(`/api/admin/menu/${item.id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });

  return true;
}

async function updateMenuItemPrice(item, nextPriceRaw) {
  const nextPrice = Number(nextPriceRaw);
  if (!Number.isFinite(nextPrice) || nextPrice <= 0) {
    throw new Error("Price must be greater than zero.");
  }

  await AdminCore.api(`/api/admin/menu/${item.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      priceCedis: nextPrice,
    }),
  });

  return true;
}

async function editUssdMapping(item) {
  const shortCurrent = item.ussdShortName || "";
  const shortNext = prompt("USSD short name (e.g. Shawarma)", shortCurrent);
  if (shortNext === null) return;

  const priceCurrent = item.ussdPriceCedis == null ? "" : String(item.ussdPriceCedis);
  const priceNextRaw = prompt(
    "USSD display price (GHS). Leave blank to use menu price.",
    priceCurrent,
  );
  if (priceNextRaw === null) return;
  const priceNextTrimmed = String(priceNextRaw).trim();
  const priceNext = priceNextTrimmed === "" ? null : Number(priceNextTrimmed);
  if (priceNextTrimmed !== "" && (!Number.isFinite(priceNext) || priceNext <= 0)) {
    throw new Error("USSD display price must be greater than zero.");
  }

  const visibilityCurrent = item.ussdVisible !== false ? "yes" : "no";
  const visibilityRaw = prompt("Show this item on USSD? (yes/no)", visibilityCurrent);
  if (visibilityRaw === null) return;
  const visibility = String(visibilityRaw).trim().toLowerCase();
  const ussdVisible = visibility === "yes" || visibility === "y" || visibility === "true" || visibility === "1";

  await AdminCore.api(`/api/admin/menu/${item.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      ussdShortName: shortNext.trim() || null,
      ussdPriceCedis: priceNext,
      ussdVisible,
    }),
  });
}

function renderUssdPreview() {
  const container = document.getElementById("ussdPreviewList");
  if (!container) return;

  const escape = AdminCore.escapeHtml;
  const visible = menuItems
    .filter((item) => item.isActive && item.ussdVisible !== false)
    .slice()
    .sort(compareItemsByUssdOrder);

  if (!visible.length) {
    container.innerHTML = '<div class="helper">No visible USSD items to preview.</div>';
    return;
  }

  const slots = getUssdItemSlots(menuItems);

  container.innerHTML = visible
    .map((item, index) => `
      <article class="menu-ussd-preview-row">
        <span class="menu-ussd-rank">${index + 1}</span>
        <div class="menu-ussd-main">
          <div class="menu-ussd-title">${escape(item.ussdShortName || item.name)}</div>
          <div class="menu-ussd-meta">${escape(item.category)} | ${escape(slots.get(item.id) || "-")}</div>
        </div>
        <button type="button" class="btn btn-sm btn-tone-violet" data-role="preview-ussd" data-item-id="${escape(item.id)}">Configure</button>
      </article>
    `)
    .join("");

  container.querySelectorAll('[data-role="preview-ussd"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const item = menuItems.find((row) => String(row.id) === String(btn.dataset.itemId));
      if (!item) return;
      try {
        await editUssdMapping(item);
        await loadData();
        AdminLayout.setStatus(`USSD mapping updated for ${item.name}.`, "success");
        await AdminLayout.notifyAction(`USSD mapping updated for ${item.name}.`, { title: "Menu Updated" });
      } catch (error) {
        AdminLayout.setStatus(error.message, "error");
      }
    });
  });
}

function renderMenu(rows) {
  const escape = AdminCore.escapeHtml;
  const tbody = document.getElementById("menuBody");
  const ussdSlots = getUssdItemSlots(menuItems);
  tbody.innerHTML = "";

  if (!rows.length) {
    const row = document.createElement("tr");
    row.innerHTML = '<td colspan="6" class="order-meta">No menu items found for this filter.</td>';
    tbody.appendChild(row);
    return;
  }

  const rowIds = new Set(rows.map((item) => String(item.id)));
  if (expandedItemId && !rowIds.has(String(expandedItemId))) {
    expandedItemId = null;
  }

  rows.forEach((item) => {
    const isExpanded = String(expandedItemId) === String(item.id);
    const currentAvailability = item.isActive;
    const summaryRow = document.createElement("tr");
    summaryRow.className = `menu-row-summary ${isExpanded ? "is-expanded" : ""}`;

    summaryRow.innerHTML = `
      <td>
        <div class="menu-main-info">
          <div class="menu-row-title">${escape(item.name)}</div>
          <div class="menu-row-id">ID: ${escape(item.id)}</div>
        </div>
      </td>
      <td>${escape(item.category)}</td>
      <td>
        <div class="menu-row-price">GHS ${AdminCore.money(item.priceCedis)}</div>
      </td>
      <td>
        <div class="menu-ussd-name">${escape(item.ussdShortName || item.name)}</div>
        <div class="menu-subtext">${item.ussdVisible === false ? "Hidden" : "Visible"} | ${escape(ussdSlots.get(item.id) || "-")}</div>
      </td>
      <td>
        <span class="menu-availability-pill ${item.isActive ? "is-on" : "is-off"}">${item.isActive ? "Available" : "Unavailable"}</span>
      </td>
      <td>
        <button type="button" class="btn btn-sm btn-tone-blue menu-manage-btn" data-role="toggle-manage">
          ${isExpanded ? "Close" : "Manage"}
        </button>
      </td>
    `;

    summaryRow.querySelector('[data-role="toggle-manage"]').addEventListener("click", () => {
      expandedItemId = isExpanded ? null : item.id;
      renderMenu(rows);
    });

    tbody.appendChild(summaryRow);
    if (!isExpanded) return;

    const drawerRow = document.createElement("tr");
    drawerRow.className = "menu-row-drawer";
    drawerRow.innerHTML = `
      <td colspan="6">
        <div class="menu-drawer">
          <div class="menu-drawer-grid">
            <section class="menu-drawer-block">
              <h4>Item Details</h4>
              <label class="menu-field-label" for="itemName-${escape(item.id)}">Name</label>
              <input id="itemName-${escape(item.id)}" type="text" class="input row-name-input" value="${escape(item.name)}" />
              <label class="menu-field-label" for="itemCategory-${escape(item.id)}">Category</label>
              <select id="itemCategory-${escape(item.id)}" class="select row-category-select">
                ${categoryOptionsHtml(item.category)}
              </select>
              <button type="button" class="btn btn-sm btn-tone-sky" data-role="save-details">Save Name & Category</button>
            </section>

            <section class="menu-drawer-block">
              <h4>Pricing & Availability</h4>
              <label class="menu-field-label" for="itemPrice-${escape(item.id)}">Price (GHS)</label>
              <div class="menu-inline-controls">
                <input id="itemPrice-${escape(item.id)}" type="number" step="0.01" min="0.01" class="input price-input" value="${Number(item.priceCedis).toFixed(2)}" />
                <button type="button" class="btn btn-sm btn-tone-orange" data-role="save-price">Save Price</button>
              </div>
              <div class="menu-inline-controls">
                <input type="checkbox" class="toggle" ${item.isActive ? "checked" : ""} aria-label="Availability toggle for ${escape(item.name)}" />
                <button type="button" class="btn btn-sm btn-tone-mint" data-role="apply-availability">Apply Availability</button>
              </div>
              <span class="menu-availability-pill ${item.isActive ? "is-on" : "is-off"}">${item.isActive ? "Available" : "Unavailable"}</span>
            </section>

            <section class="menu-drawer-block">
              <h4>USSD & Actions</h4>
              <div class="menu-subtext">Label: ${escape(item.ussdShortName || item.name)}</div>
              <div class="menu-subtext">Display Price: GHS ${AdminCore.money(ussdDisplayPrice(item))}</div>
              <div class="menu-subtext">Slot: ${escape(ussdSlots.get(item.id) || "-")}</div>
              <div class="menu-drawer-actions">
                <button type="button" class="btn btn-sm btn-tone-violet" data-role="ussd">Configure USSD</button>
                <button type="button" class="btn btn-sm danger" data-role="delete">Delete Item</button>
                <button type="button" class="btn btn-sm" data-role="close-drawer">Done</button>
              </div>
            </section>
          </div>
        </div>
      </td>
    `;

    const nameInput = drawerRow.querySelector(".row-name-input");
    const categorySelect = drawerRow.querySelector(".row-category-select");
    const priceInput = drawerRow.querySelector(".price-input");
    const toggle = drawerRow.querySelector(".toggle");
    const availabilityPills = drawerRow.querySelectorAll(".menu-availability-pill");

    const syncAvailabilityPills = (nextChecked, pending = false) => {
      availabilityPills.forEach((pill) => {
        pill.classList.toggle("is-on", nextChecked);
        pill.classList.toggle("is-off", !nextChecked);
        pill.textContent = nextChecked
          ? (pending ? "Available (pending)" : "Available")
          : (pending ? "Unavailable (pending)" : "Unavailable");
      });
    };

    toggle.addEventListener("change", () => {
      syncAvailabilityPills(toggle.checked, true);
    });

    drawerRow.querySelector('[data-role="save-details"]').addEventListener("click", async () => {
      try {
        const changed = await updateMenuItemDetails(item, {
          name: nameInput.value,
          category: categorySelect.value,
        });

        if (!changed) {
          AdminLayout.setStatus("No item name/category change to save.", "helper");
          return;
        }

        expandedItemId = item.id;
        await loadData();
        AdminLayout.setStatus(`Saved updates for ${item.name}.`, "success");
        await AdminLayout.notifyAction(`Saved updates for ${item.name}.`, { title: "Menu Updated" });
      } catch (error) {
        nameInput.value = item.name;
        categorySelect.value = item.category;
        AdminLayout.setStatus(error.message, "error");
      }
    });

    drawerRow.querySelector('[data-role="save-price"]').addEventListener("click", async () => {
      try {
        await updateMenuItemPrice(item, priceInput.value);
        expandedItemId = item.id;
        await loadData();
        AdminLayout.setStatus(`Price updated for ${item.name}.`, "success");
        await AdminLayout.notifyAction(`Price updated for ${item.name}.`, { title: "Menu Updated" });
      } catch (error) {
        priceInput.value = Number(item.priceCedis).toFixed(2);
        AdminLayout.setStatus(error.message, "error");
      }
    });

    drawerRow.querySelector('[data-role="apply-availability"]').addEventListener("click", async () => {
      const nextValue = toggle.checked;
      if (nextValue === currentAvailability) {
        AdminLayout.setStatus("No availability change to apply.", "helper");
        return;
      }

      try {
        const confirmed = await AdminLayout.confirmAction(
          `Set "${item.name}" to ${nextValue ? "Available" : "Unavailable"}?`,
          { title: "Confirm Availability Change" },
        );
        if (!confirmed) {
          toggle.checked = currentAvailability;
          syncAvailabilityPills(currentAvailability, false);
          return;
        }

        await AdminCore.api(`/api/admin/menu/${item.id}/availability`, {
          method: "PATCH",
          body: JSON.stringify({ isActive: nextValue }),
        });

        expandedItemId = item.id;
        await loadData();
        AdminLayout.setStatus(`${item.name} is now ${nextValue ? "Available" : "Unavailable"}.`, "success");
        await AdminLayout.notifyAction(`${item.name} is now ${nextValue ? "Available" : "Unavailable"}.`, {
          title: "Menu Updated",
        });
      } catch (error) {
        toggle.checked = currentAvailability;
        syncAvailabilityPills(currentAvailability, false);
        AdminLayout.setStatus(error.message, "error");
      }
    });

    drawerRow.querySelector('[data-role="ussd"]').addEventListener("click", async () => {
      try {
        await editUssdMapping(item);
        expandedItemId = item.id;
        await loadData();
        AdminLayout.setStatus(`USSD mapping updated for ${item.name}.`, "success");
        await AdminLayout.notifyAction(`USSD mapping updated for ${item.name}.`, { title: "Menu Updated" });
      } catch (error) {
        AdminLayout.setStatus(error.message, "error");
      }
    });

    drawerRow.querySelector('[data-role="delete"]').addEventListener("click", async () => {
      try {
        await deleteMenuItem(item);
        expandedItemId = null;
        await loadData();
        AdminLayout.setStatus(`Deleted ${item.name}.`, "success");
        await AdminLayout.notifyAction(`Deleted ${item.name}.`, { title: "Menu Updated" });
      } catch (error) {
        AdminLayout.setStatus(error.message, "error");
      }
    });

    drawerRow.querySelector('[data-role="close-drawer"]').addEventListener("click", () => {
      expandedItemId = null;
      renderMenu(rows);
    });

    tbody.appendChild(drawerRow);
  });
}

function applyFilters() {
  const query = document.getElementById("menuSearch").value.trim().toLowerCase();
  const availability = document.getElementById("availabilityFilter").value;

  const rows = menuItems.filter((item) => {
    const matchesQuery =
      !query ||
      item.name.toLowerCase().includes(query) ||
      item.category.toLowerCase().includes(query);

    const matchesCategory = selectedCategory === "ALL" || item.category === selectedCategory;

    const matchesAvailability =
      !availability ||
      (availability === "active" && item.isActive) ||
      (availability === "inactive" && !item.isActive);

    return matchesQuery && matchesCategory && matchesAvailability;
  });

  rows.sort(compareItemsByUssdOrder);

  const countHint = document.getElementById("menuShowing");
  if (countHint) {
    const categoryHint = selectedCategory === "ALL" ? "all categories" : selectedCategory;
    countHint.textContent = `${rows.length} items showing (${categoryHint}).`;
  }

  renderMenu(rows);
}

async function loadData() {
  const [menuPayload, categoriesPayload] = await Promise.all([
    AdminCore.api("/api/admin/menu"),
    AdminCore.api("/api/admin/menu/categories"),
  ]);

  menuItems = menuPayload.data || [];
  menuCategories = categoriesPayload.data || [];

  renderSummary(menuItems);
  renderCategoryButtons();
  renderCategorySelectors();
  applyFilters();
  renderUssdPreview();
}

async function createCategory() {
  const value = document.getElementById("newCategoryName").value.trim();
  if (!value) return;
  await AdminCore.api("/api/admin/menu/categories", {
    method: "POST",
    body: JSON.stringify({ category: value }),
  });
}

async function renameCategory() {
  const fromCategory = document.getElementById("renameFromCategory").value;
  const toCategory = document.getElementById("renameToCategory").value.trim();
  if (!fromCategory || !toCategory) return;
  await AdminCore.api("/api/admin/menu/categories/rename", {
    method: "PATCH",
    body: JSON.stringify({ fromCategory, toCategory }),
  });
}

async function deleteCategory() {
  const category = document.getElementById("deleteCategoryName").value;
  if (!category) return;
  const confirmed = await AdminLayout.confirmAction(
    `Delete category "${category}" and all items under it?`,
    { title: "Confirm Category Deletion", confirmLabel: "Delete" },
  );
  if (!confirmed) return;

  await AdminCore.api("/api/admin/menu/categories/remove", {
    method: "DELETE",
    body: JSON.stringify({ category }),
  });
}

async function optimizeUssdNames() {
  const confirmed = await AdminLayout.confirmAction(
    "Auto-generate shorter USSD names for long menu items? Existing compact custom names will be preserved.",
    { title: "Bulk Optimize USSD Names", confirmLabel: "Optimize" },
  );
  if (!confirmed) return null;

  const payload = await AdminCore.api("/api/admin/menu/ussd/optimize", {
    method: "POST",
    body: JSON.stringify({}),
  });

  return payload?.data || null;
}

async function createItem() {
  const category = document.getElementById("itemCategory").value;
  const name = document.getElementById("itemName").value.trim();
  const priceCedis = Number(document.getElementById("itemPrice").value);

  if (!category || !name || !Number.isFinite(priceCedis) || priceCedis <= 0) {
    throw new Error("Enter category, valid item name, and valid price.");
  }

  await AdminCore.api("/api/admin/menu", {
    method: "POST",
    body: JSON.stringify({
      category,
      name,
      priceCedis,
      ussdShortName: name,
      ussdPriceCedis: priceCedis,
      ussdVisible: true,
      isActive: true,
    }),
  });
}

(async function initMenuPage() {
  await AdminLayout.initProtectedPage();
  AdminLayout.setStatus("Menu workspace ready. Use tabs for catalog, categories, and USSD.", "helper");

  const backBtn = document.getElementById("backBtn");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      if (window.history.length > 1) {
        window.history.back();
        return;
      }
      window.location.href = backBtn.dataset.fallback;
    });
  }

  initializeTabs();

  document.getElementById("menuSearch").addEventListener("input", applyFilters);
  document.getElementById("availabilityFilter").addEventListener("change", applyFilters);

  document.getElementById("refreshMenuBtn").addEventListener("click", async () => {
    try {
      await loadData();
      AdminLayout.setStatus("Catalog refreshed.", "success");
    } catch (error) {
      AdminLayout.setStatus(error.message, "error");
    }
  });

  document.getElementById("optimizeUssdBtn").addEventListener("click", async () => {
    try {
      const result = await optimizeUssdNames();
      if (!result) {
        AdminLayout.setStatus("Bulk USSD optimization canceled.", "helper");
        return;
      }

      await loadData();
      const message =
        `USSD optimization done: ${result.updatedCount}/${result.scannedCount} updated, ` +
        `${result.skippedCustomCount} custom preserved, ${result.skippedShortCount} skipped.`;
      AdminLayout.setStatus(message, result.updatedCount > 0 ? "success" : "helper");
      await AdminLayout.notifyAction(message, { title: "USSD Optimization Complete" });
    } catch (error) {
      AdminLayout.setStatus(error.message, "error");
    }
  });

  document.getElementById("createCategoryForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await createCategory();
      document.getElementById("createCategoryForm").reset();
      await loadData();
      setActiveTab("categories");
      AdminLayout.setStatus("Category added.", "success");
      await AdminLayout.notifyAction("Category added.", { title: "Menu Updated" });
    } catch (error) {
      AdminLayout.setStatus(error.message, "error");
    }
  });

  document.getElementById("renameCategoryForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await renameCategory();
      document.getElementById("renameToCategory").value = "";
      await loadData();
      setActiveTab("categories");
      AdminLayout.setStatus("Category renamed.", "success");
      await AdminLayout.notifyAction("Category renamed.", { title: "Menu Updated" });
    } catch (error) {
      AdminLayout.setStatus(error.message, "error");
    }
  });

  document.getElementById("deleteCategoryForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await deleteCategory();
      await loadData();
      setActiveTab("categories");
      AdminLayout.setStatus("Category deleted.", "success");
      await AdminLayout.notifyAction("Category deleted.", { title: "Menu Updated" });
    } catch (error) {
      AdminLayout.setStatus(error.message, "error");
    }
  });

  document.getElementById("createItemForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await createItem();
      document.getElementById("itemName").value = "";
      document.getElementById("itemPrice").value = "";
      await loadData();
      setActiveTab("catalog");
      AdminLayout.setStatus("Menu item added.", "success");
      await AdminLayout.notifyAction("Menu item added.", { title: "Menu Updated" });
    } catch (error) {
      AdminLayout.setStatus(error.message, "error");
    }
  });

  await loadData();
  setActiveTab(activeTab);
})();
