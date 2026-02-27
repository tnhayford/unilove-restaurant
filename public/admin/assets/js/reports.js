let currentPage = 1;
const pageSize = 10;
let totalRows = 0;
const seenCompleted = new Set();
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const REPORT_SEEN_KEY = "admin_reports_seen_completed_v1";

function loadSeenCompleted() {
  try {
    const raw = localStorage.getItem(REPORT_SEEN_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    parsed.forEach((id) => {
      if (typeof id === "string" && id) seenCompleted.add(id);
    });
  } catch (_) {
    // ignore invalid local storage
  }
}

function persistSeenCompleted() {
  const values = Array.from(seenCompleted);
  const capped = values.slice(Math.max(0, values.length - 500));
  localStorage.setItem(REPORT_SEEN_KEY, JSON.stringify(capped));
}

function totalPages() {
  return Math.max(1, Math.ceil(totalRows / pageSize));
}

function query() {
  const params = new URLSearchParams({
    limit: String(pageSize),
    offset: String((currentPage - 1) * pageSize),
  });
  return `?${params.toString()}`;
}

function toDate(value) {
  if (!value) return "-";
  return new Date(`${value}Z`).toLocaleString();
}

function scheduleFrequencyLabel(row) {
  if (row.frequency === "weekly") {
    const day = Number(row.day_of_week || 0);
    return `Weekly (${DAY_LABELS[day] || day})`;
  }
  return "Daily";
}

function renderRows(rows) {
  const e = AdminCore.escapeHtml;
  const body = document.getElementById("reportBody");
  body.innerHTML = "";
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="7" class="order-meta">No report jobs yet.</td></tr>';
    return;
  }

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${e(toDate(row.created_at))}</td>
      <td>${e(row.report_type)}</td>
      <td>${e(row.report_format)}</td>
      <td>${e(row.status)}${row.error_message ? `<br /><span class="order-meta">${e(row.error_message)}</span>` : ""}</td>
      <td>${e(row.requested_by_email || "-")}</td>
      <td>${e(toDate(row.completed_at))}</td>
      <td>
        ${row.status === "completed" ? `<button class="btn btn-sm primary" data-role="download" data-id="${e(row.id)}">Download</button>` : "-"}
      </td>
    `;
    body.appendChild(tr);
  });

  body.querySelectorAll('[data-role="download"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      window.location.href = `/api/admin/reports/${encodeURIComponent(btn.dataset.id)}/download`;
    });
  });
}

function renderScheduleRows(rows) {
  const e = AdminCore.escapeHtml;
  const body = document.getElementById("scheduleBody");
  if (!body) return;
  body.innerHTML = "";
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="7" class="order-meta">No schedules configured.</td></tr>';
    return;
  }

  rows.forEach((row) => {
    const scheduleId = e(row.id);
    const runTime = `${String(Number(row.hour_utc || 0)).padStart(2, "0")}:${String(
      Number(row.minute_utc || 0),
    ).padStart(2, "0")}`;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${e(row.report_type)}</td>
      <td>${e(row.report_format)}</td>
      <td>${e(scheduleFrequencyLabel(row))}</td>
      <td>${e(runTime)}</td>
      <td>${e(toDate(row.next_run_at))}</td>
      <td>${row.enabled ? "Enabled" : "Disabled"}</td>
      <td>
        <div style="display:flex; gap:6px;">
          <button class="btn btn-sm" data-role="toggle" data-id="${scheduleId}" data-enabled="${row.enabled ? "1" : "0"}">
            ${row.enabled ? "Disable" : "Enable"}
          </button>
          <button class="btn btn-sm danger" data-role="delete" data-id="${scheduleId}">Delete</button>
        </div>
      </td>
    `;
    body.appendChild(tr);
  });

  body.querySelectorAll('[data-role="toggle"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        const scheduleId = btn.dataset.id;
        const enabled = btn.dataset.enabled === "1";
        const confirmed = await AdminLayout.confirmAction(
          `${enabled ? "Disable" : "Enable"} this report schedule?`,
          { title: "Confirm Schedule Update" },
        );
        if (!confirmed) return;
        await AdminCore.api(`/api/admin/reports/schedules/${encodeURIComponent(scheduleId)}`, {
          method: "PATCH",
          body: JSON.stringify({ enabled: !enabled }),
        });
        await refreshSchedules();
      } catch (error) {
        AdminLayout.setStatus(error.message, "error");
      }
    });
  });

  body.querySelectorAll('[data-role="delete"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        const scheduleId = btn.dataset.id;
        const confirmed = await AdminLayout.confirmAction(
          "Delete this report schedule?",
          { title: "Confirm Schedule Deletion", confirmLabel: "Delete" },
        );
        if (!confirmed) return;
        await AdminCore.api(`/api/admin/reports/schedules/${encodeURIComponent(scheduleId)}`, {
          method: "DELETE",
          body: JSON.stringify({}),
        });
        await refreshSchedules();
      } catch (error) {
        AdminLayout.setStatus(error.message, "error");
      }
    });
  });
}

async function refreshSchedules() {
  const payload = await AdminCore.api("/api/admin/reports/schedules?limit=100&offset=0");
  const rows = payload.data?.rows || [];
  renderScheduleRows(rows);
}

function renderPagination() {
  const pages = totalPages();
  document.getElementById("paginationMeta").textContent = `Page ${currentPage} of ${pages} | Total ${totalRows}`;
  document.getElementById("prevBtn").disabled = currentPage <= 1;
  document.getElementById("nextBtn").disabled = currentPage >= pages;
  document.getElementById("pageInput").value = String(currentPage);
  document.getElementById("pageInput").max = String(pages);

  const holder = document.getElementById("pageNumbers");
  holder.innerHTML = "";
  const start = Math.max(1, currentPage - 2);
  const end = Math.min(pages, currentPage + 2);
  for (let p = start; p <= end; p += 1) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `btn ${p === currentPage ? "primary" : ""}`;
    btn.textContent = String(p);
    btn.addEventListener("click", async () => {
      currentPage = p;
      await refresh();
    });
    holder.appendChild(btn);
  }
}

async function refresh(showReadyModal = true) {
  const payload = await AdminCore.api(`/api/admin/reports${query()}`);
  const data = payload.data || { rows: [], total: 0 };
  totalRows = Number(data.total || 0);
  const rows = data.rows || [];
  renderRows(rows);
  renderPagination();

  if (showReadyModal) {
    for (const row of rows) {
      if (row.status === "completed" && !seenCompleted.has(row.id)) {
        seenCompleted.add(row.id);
        persistSeenCompleted();
        await AdminLayout.notifyAction(
          `${row.report_type} report (${row.report_format}) is ready for download.`,
          { title: "Report Ready" },
        );
      }
      if (row.status !== "completed") {
        seenCompleted.delete(row.id);
        persistSeenCompleted();
      }
    }
    return;
  }

  for (const row of rows) {
    if (row.status === "completed") {
      seenCompleted.add(row.id);
    }
  }
  persistSeenCompleted();
}

async function createReport() {
  const body = {
    type: document.getElementById("reportType").value,
    format: document.getElementById("reportFormat").value,
    startDate: document.getElementById("reportStartDate").value || undefined,
    endDate: document.getElementById("reportEndDate").value || undefined,
  };

  const confirmed = await AdminLayout.confirmAction(
    `Generate ${body.type} report in ${body.format.toUpperCase()} format?`,
    { title: "Confirm Report Generation", confirmLabel: "Generate" },
  );
  if (!confirmed) return;

  await AdminCore.api("/api/admin/reports", {
    method: "POST",
    body: JSON.stringify(body),
  });

  AdminLayout.setStatus("Report queued. You will be notified when it is ready.", "success");
}

async function createSchedule() {
  const frequency = document.getElementById("scheduleFrequency").value;
  const body = {
    type: document.getElementById("scheduleType").value,
    format: document.getElementById("scheduleFormat").value,
    frequency,
    dayOfWeek:
      frequency === "weekly"
        ? Number(document.getElementById("scheduleDayOfWeek").value || 0)
        : undefined,
    hourUtc: Number(document.getElementById("scheduleHourUtc").value || 2),
    minuteUtc: Number(document.getElementById("scheduleMinuteUtc").value || 0),
    startDate: document.getElementById("scheduleStartDate").value || undefined,
    endDate: document.getElementById("scheduleEndDate").value || undefined,
  };

  const confirmed = await AdminLayout.confirmAction(
    `Create ${body.frequency} schedule for ${body.type} (${body.format.toUpperCase()})?`,
    { title: "Confirm Schedule Creation", confirmLabel: "Create" },
  );
  if (!confirmed) return;

  await AdminCore.api("/api/admin/reports/schedules", {
    method: "POST",
    body: JSON.stringify(body),
  });
  await refreshSchedules();
  AdminLayout.setStatus("Report schedule created.", "success");
}

(async function init() {
  await AdminLayout.initProtectedPage();
  loadSeenCompleted();

  const scheduleFrequency = document.getElementById("scheduleFrequency");
  const scheduleDayWrap = document.getElementById("scheduleDayWrap");
  if (scheduleFrequency && scheduleDayWrap) {
    const applyScheduleVisibility = () => {
      scheduleDayWrap.style.display = scheduleFrequency.value === "weekly" ? "" : "none";
    };
    scheduleFrequency.addEventListener("change", applyScheduleVisibility);
    applyScheduleVisibility();
  }

  document.getElementById("backBtn").addEventListener("click", () => {
    if (window.history.length > 1) return window.history.back();
    window.location.href = document.getElementById("backBtn").dataset.fallback;
  });

  document.getElementById("reportForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await createReport();
      currentPage = 1;
      await refresh(false);
    } catch (error) {
      AdminLayout.setStatus(error.message, "error");
    }
  });

  const scheduleForm = document.getElementById("scheduleForm");
  if (scheduleForm) {
    scheduleForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await createSchedule();
      } catch (error) {
        AdminLayout.setStatus(error.message, "error");
      }
    });
  }

  document.getElementById("refreshBtn").addEventListener("click", async () => {
    try {
      await refresh();
      AdminLayout.setStatus("Reports refreshed.", "success");
    } catch (error) {
      AdminLayout.setStatus(error.message, "error");
    }
  });

  document.getElementById("prevBtn").addEventListener("click", async () => {
    currentPage = Math.max(1, currentPage - 1);
    await refresh(false);
  });

  document.getElementById("nextBtn").addEventListener("click", async () => {
    currentPage = Math.min(totalPages(), currentPage + 1);
    await refresh(false);
  });

  document.getElementById("pageJumpForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    currentPage = Math.max(1, Math.min(Number(document.getElementById("pageInput").value || 1), totalPages()));
    await refresh(false);
  });

  await refresh(false);
  await refreshSchedules();

  setInterval(async () => {
    try {
      await refresh(true);
      await refreshSchedules();
    } catch (_) {
      // background polling best-effort
    }
  }, 8000);
})();
