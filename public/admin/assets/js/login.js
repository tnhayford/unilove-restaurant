(async function initLogin() {
  AdminCore.initTheme();
  const params = new URLSearchParams(window.location.search);
  const nextPath = AdminCore.toSafeAdminPath(params.get("next") || "");

  const form = document.getElementById("loginForm");
  const status = document.getElementById("loginStatus");

  function setStatus(message, kind = "error") {
    status.className = kind;
    status.textContent = message;
  }

  try {
    await AdminCore.fetchCsrfToken(true);
    await AdminCore.ensureAuthenticated({ redirect: false });
    window.location.href = nextPath;
    return;
  } catch {
    // not logged in yet
  }

  const themeButton = document.getElementById("themeToggle");
  if (themeButton) {
    const current = document.documentElement.getAttribute("data-theme") || "light";
    themeButton.textContent = current === "dark" ? "Light Mode" : "Dark Mode";
    themeButton.addEventListener("click", () => {
      const next = AdminCore.toggleTheme();
      themeButton.textContent = next === "dark" ? "Light Mode" : "Dark Mode";
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    try {
      await AdminCore.fetchCsrfToken(true);
      await AdminCore.api("/api/admin/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setStatus("Login successful. Redirecting...", "success");
      window.location.href = nextPath;
    } catch (error) {
      setStatus(error.message || "Login failed", "error");
    }
  });
})();
