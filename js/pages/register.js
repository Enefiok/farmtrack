const form = document.getElementById("signup-form");
    const submitBtn = document.getElementById("submit");
    const formError = document.getElementById("form-error");
    const fields = ["full_name", "email", "password", "confirm_password", "terms"];
    let redirecting = false;

    if (AgroAPI.mock) document.getElementById("mock-note").hidden = false;

    // Already signed in? Skip straight to the app.
    AgroAPI.me().then(() => { redirecting = true; location.replace(AgroAPI.pages.app); }).catch(() => {});

    // ---- Show / hide password ----
    document.querySelectorAll(".toggle").forEach((btn) => {
      btn.addEventListener("click", () => {
        const input = document.getElementById(btn.dataset.target);
        const showing = input.type === "text";
        input.type = showing ? "password" : "text";
        btn.textContent = showing ? "Show" : "Hide";
        btn.setAttribute("aria-label", showing ? "Show password" : "Hide password");
      });
    });

    // ---- Helpers ----
    function setError(name, message) {
      const el = document.getElementById(name + "-error");
      const wrapper = document.querySelector(`[data-field="${name}"]`);
      if (el) el.textContent = message || "";
      if (wrapper) wrapper.classList.toggle("invalid", Boolean(message));
      const input = document.getElementById(name);
      if (input) input.setAttribute("aria-invalid", message ? "true" : "false");
    }
    function clearErrors() { fields.forEach((f) => setError(f, "")); formError.textContent = ""; }

    // Format-level checks only. Duplicate email and password strength are decided by the server.
    function validate(values) {
      const errors = {};
      if (!values.full_name.trim()) errors.full_name = "Enter your full name.";
      if (!values.email.trim()) errors.email = "Enter your email address.";
      else if (!/^\S+@\S+\.\S+$/.test(values.email.trim())) errors.email = "Enter a valid email address.";
      if (!values.password) errors.password = "Enter a password.";
      else if (values.password.length < 8) errors.password = "Password must be at least 8 characters.";
      if (!values.confirm_password) errors.confirm_password = "Confirm your password.";
      else if (values.password !== values.confirm_password) errors.confirm_password = "Passwords do not match.";
      if (!values.terms) errors.terms = "You must agree to the Terms & Conditions and Privacy Policy.";
      return errors;
    }

    // ---- Submit ----
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (submitBtn.disabled) return; // blocks double taps
      clearErrors();

      const values = {
        full_name: form.full_name.value,
        email: form.email.value,
        password: form.password.value,
        confirm_password: form.confirm_password.value,
        terms: form.terms.checked,
      };

      const errors = validate(values);
      const firstInvalid = fields.find((f) => errors[f]);
      if (firstInvalid) {
        fields.forEach((f) => setError(f, errors[f] || ""));
        document.getElementById(firstInvalid).focus();
        return; // typed values are kept
      }

      submitBtn.disabled = true;
      submitBtn.textContent = "Creating account...";

      try {
        await AgroAPI.register({
          full_name: values.full_name.trim(),
          email: values.email.trim().toLowerCase(),
          password: values.password,
          password2: values.confirm_password,
        });
        redirecting = true;
        location.assign(AgroAPI.pages.app); // the app shows "No farms yet" for a new account
      } catch (err) {
        const fe = (err && err.fields) || {};
        let shown = false;
        fields.forEach((f) => { if (fe[f]) { setError(f, fe[f]); shown = true; } });
        if (shown) { const first = fields.find((f) => fe[f]); if (first) document.getElementById(first).focus(); }
        else formError.textContent = (err && err.message) || "We could not create your account. Please try again.";
      } finally {
        if (!redirecting) { submitBtn.disabled = false; submitBtn.textContent = "Create Account"; }
      }
    });

    // Clear a field's error as soon as the user edits it
    fields.forEach((f) => {
      const el = document.getElementById(f);
      el.addEventListener(el.type === "checkbox" ? "change" : "input", () => setError(f, ""));
    });