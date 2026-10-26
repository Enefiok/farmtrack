const form = document.getElementById("signin-form");
    const submitBtn = document.getElementById("submit");
    const formError = document.getElementById("form-error");
    const fields = ["email", "password"];
    let redirecting = false;

    if (AgroAPI.mock) document.getElementById("mock-note").hidden = false;

    // Already signed in? Skip straight to the app.
    AgroAPI.me().then(() => { redirecting = true; location.replace(AgroAPI.pages.app); }).catch(() => {});

    // ---- Show / hide password ----
    const toggle = document.getElementById("toggle-password");
    toggle.addEventListener("click", () => {
      const input = document.getElementById("password");
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      toggle.textContent = showing ? "Show" : "Hide";
      toggle.setAttribute("aria-label", showing ? "Show password" : "Hide password");
    });

    // ---- Helpers ----
    function setError(name, message) {
      const el = document.getElementById(name + "-error");
      const wrapper = document.querySelector(`[data-field="${name}"]`);
      if (el) el.textContent = message || "";
      if (wrapper) wrapper.classList.toggle("invalid", Boolean(message));
      document.getElementById(name).setAttribute("aria-invalid", message ? "true" : "false");
    }
    function clearErrors() { fields.forEach((f) => setError(f, "")); formError.textContent = ""; }

    // ---- Submit ----
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (submitBtn.disabled) return; // blocks double taps
      clearErrors();

      const email = form.email.value.trim();
      const password = form.password.value;

      let invalid = null;
      if (!email) { setError("email", "Enter your email address."); invalid = invalid || "email"; }
      else if (!/^\S+@\S+\.\S+$/.test(email)) { setError("email", "Enter a valid email address."); invalid = invalid || "email"; }
      if (!password) { setError("password", "Enter your password."); invalid = invalid || "password"; }
      if (invalid) { document.getElementById(invalid).focus(); return; } // typed values are kept

      submitBtn.disabled = true;
      submitBtn.textContent = "Signing in...";

      try {
        await AgroAPI.login({ email: email.toLowerCase(), password });
        redirecting = true;
        // The app decides what to show: "No farms yet", the dashboard, or the farm switcher.
        location.assign(AgroAPI.pages.app);
      } catch (err) {
        const status = err && err.status;
        if (status === 429) {
          formError.textContent = "Too many attempts. Wait a few minutes and try again.";
        } else if (status === 400 || status === 401) {
          // One message for a wrong email or a wrong password, so we never reveal which accounts exist
          formError.textContent = "Email or password is incorrect.";
        } else {
          formError.textContent = (err && err.message) || "We could not sign you in. Please try again.";
        }
      } finally {
        if (!redirecting) { submitBtn.disabled = false; submitBtn.textContent = "Sign in"; }
      }
    });

    // Clear a field's error as soon as the user edits it
    fields.forEach((f) => document.getElementById(f).addEventListener("input", () => setError(f, "")));