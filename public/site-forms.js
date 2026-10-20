/*!
 * Gavrion \u00b7 Formularios del sitio web
 * Uso: <script src="https://TU-CRM/site-forms.js" data-tenant="WIDGET_KEY" data-color="#4b49ac" defer></script>
 * Opcional: data-section="false" para no insertar la secci\u00f3n y usar solo ventanas emergentes.
 * Botones: <button data-gavrion-form="reservation" data-prefill-party_size="4">Reservar</button>
 * API: window.GavrionForms.open(tipo, valores), .has(tipo), .primary(), .forms
 */
(function () {
  "use strict";
  var script = document.currentScript;
  var key = script && script.dataset.tenant;
  if (!key || window.GavrionForms) return;
  var api = new URL(script.src).origin;
  var color = script.dataset.color || "#4b49ac";
  var withSection = script.dataset.section !== "false";
  var visitorKey = "gavrion_visitor_" + key;
  var primaryOrder = ["reservation", "lodging_reservation", "appointment", "order", "advisory", "availability", "quote", "product_inquiry", "contact"];

  function visitorId() {
    try {
      var id = localStorage.getItem(visitorKey);
      if (!id) { id = (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(36).slice(2)); localStorage.setItem(visitorKey, id); }
      return id;
    } catch (e) { return ""; }
  }
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (name) {
      var value = attrs[name];
      if (value === undefined || value === null || value === false) return;
      if (name === "text") node.textContent = value;
      else if (name === "className") node.className = value;
      else if (name.slice(0, 2) === "on") node.addEventListener(name.slice(2), value);
      else node.setAttribute(name, value === true ? "" : value);
    });
    (children || []).forEach(function (child) { if (child) node.appendChild(typeof child === "string" ? document.createTextNode(child) : child); });
    return node;
  }
  function today() { var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }

  var css = ":host{all:initial}*{box-sizing:border-box;font-family:inherit}" +
    ".gf{--brand:" + color + ";font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1f2430;line-height:1.45}" +
    ".section{max-width:1080px;margin:0 auto;padding:64px 20px}.section h2{font-size:clamp(26px,4vw,38px);margin:0 0 8px;line-height:1.15}.section>p{margin:0 0 26px;color:#5d6475}" +
    ".tabs{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:18px}.tab{border:1px solid #d9dce5;background:#fff;color:#363c4b;border-radius:999px;padding:9px 16px;font-size:14px;font-weight:600;cursor:pointer}.tab.active{background:var(--brand);border-color:var(--brand);color:#fff}" +
    ".card{background:#fff;border:1px solid #e3e6ee;border-radius:16px;padding:24px;box-shadow:0 12px 34px rgba(25,30,50,.07)}.card h3{margin:0 0 4px;font-size:20px}.card .desc{margin:0 0 18px;color:#5d6475;font-size:14px}" +
    ".grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.full{grid-column:1/-1}label{display:grid;gap:6px;font-size:13px;font-weight:600;color:#3a4050}label .req{color:#c03a4c}" +
    "input,select,textarea{width:100%;border:1px solid #d5d9e3;border-radius:10px;padding:11px 12px;font-size:15px;background:#fff;color:#1f2430;font-family:inherit}textarea{min-height:96px;resize:vertical}input:focus,select:focus,textarea:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px color-mix(in srgb,var(--brand) 18%,transparent)}" +
    ".invalid input,.invalid select,.invalid textarea{border-color:#c03a4c}.field-error{color:#b3283d;font-size:12px;font-weight:500}" +
    ".actions{display:flex;align-items:center;gap:14px;margin-top:18px;flex-wrap:wrap}.submit{border:0;border-radius:10px;background:var(--brand);color:#fff;font-weight:700;font-size:15px;padding:13px 22px;cursor:pointer}.submit:disabled{opacity:.6;cursor:wait}.privacy{font-size:12px;color:#7a8091;flex:1;min-width:200px}" +
    ".alert{padding:12px 14px;border-radius:10px;font-size:14px;margin-top:14px}.alert.error{background:#fdecef;color:#9b2336}.success{text-align:center;padding:26px 10px}.success .icon{width:56px;height:56px;border-radius:50%;margin:0 auto 12px;display:grid;place-items:center;background:color-mix(in srgb,var(--brand) 14%,#fff);color:var(--brand);font-size:28px}.success h3{margin:0 0 6px}.success p{color:#5d6475;margin:0 0 6px}.success small{color:#8a90a0}.again{margin-top:14px;border:1px solid #d5d9e3;background:#fff;border-radius:10px;padding:10px 16px;font-weight:600;cursor:pointer}" +
    ".hp{position:absolute!important;left:-9999px!important;width:1px;height:1px;overflow:hidden}" +
    ".overlay{position:fixed;inset:0;background:rgba(14,17,28,.55);display:flex;align-items:flex-start;justify-content:center;padding:5vh 14px;z-index:2147483646;overflow:auto}.modal{width:min(620px,100%);position:relative}.close{position:absolute;right:14px;top:12px;border:0;background:transparent;font-size:26px;line-height:1;cursor:pointer;color:#6b7180}" +
    "@media(max-width:640px){.grid{grid-template-columns:1fr}.section{padding:44px 16px}.card{padding:18px}}";

  var state = { forms: [], company: "", ready: false, startedAt: Date.now() };
  var readyResolve;
  var ready = new Promise(function (resolve) { readyResolve = resolve; });

  function fieldVisible(field, values) { return !field.showIf || String(values[field.showIf.field] || "") === field.showIf.equals; }

  /** Construye un formulario completo con validaci\u00f3n, env\u00edo y pantalla de confirmaci\u00f3n. */
  function buildForm(form, prefill, onDone) {
    var values = {};
    form.fields.forEach(function (field) { values[field.name] = (prefill && prefill[field.name] != null ? String(prefill[field.name]) : field.defaultValue || ""); });
    var extra = {};
    if (prefill && prefill.items_json) extra.items_json = prefill.items_json;
    var startedAt = Date.now();
    var card = el("div", { className: "card" });
    var wrappers = {};

    function render() {
      card.innerHTML = "";
      card.appendChild(el("h3", { text: form.title }));
      card.appendChild(el("p", { className: "desc", text: form.description }));
      var grid = el("div", { className: "grid" });
      form.fields.forEach(function (field) {
        var id = "gf-" + form.type + "-" + field.name;
        var input;
        var common = { id: id, name: field.name, required: field.required || false, placeholder: field.placeholder || "", oninput: function (event) { values[field.name] = event.target.value; if (field.name === "fulfillment") toggle(); } };
        if (field.type === "select") {
          input = el("select", { id: id, name: field.name, required: field.required || false, onchange: function (event) { values[field.name] = event.target.value; toggle(); } });
          var options = (field.options || []).slice();
          if (values[field.name] && !options.some(function (o) { return o.value === values[field.name]; })) options.unshift({ value: values[field.name], label: values[field.name] });
          if (!options.some(function (o) { return o.value === ""; })) input.appendChild(el("option", { value: "", text: field.required ? "Selecciona una opci\u00f3n" : "Sin especificar" }));
          options.forEach(function (option) { input.appendChild(el("option", { value: option.value, text: option.label, selected: option.value === values[field.name] })); });
          if (!options.length && field.name === "product") input = el("input", Object.assign({}, common, { type: "text", maxlength: 160 }));
        } else if (field.type === "textarea") {
          input = el("textarea", Object.assign({}, common, { maxlength: field.maxLength || 1500 }));
          input.value = values[field.name];
        } else {
          input = el("input", Object.assign({}, common, { type: field.type, maxlength: field.maxLength, min: field.type === "date" ? today() : field.min, max: field.max, inputmode: field.type === "number" ? "numeric" : field.type === "tel" ? "tel" : undefined, autocomplete: field.name === "full_name" ? "name" : field.name === "phone" ? "tel" : field.name === "email" ? "email" : undefined }));
          input.value = values[field.name];
        }
        var wrap = el("label", { className: (field.type === "textarea" || field.name === "items" || field.name === "address") ? "full" : "", for: id }, [el("span", {}, [field.label, field.required ? el("span", { className: "req", text: " *" }) : null]), input, el("span", { className: "field-error", role: "alert" })]);
        wrappers[field.name] = { wrap: wrap, field: field };
        grid.appendChild(wrap);
      });
      grid.appendChild(el("label", { className: "hp", "aria-hidden": "true" }, ["Sitio web", el("input", { name: "website", tabindex: "-1", autocomplete: "off" })]));
      var error = el("div", { className: "alert error", role: "alert", hidden: true });
      var submit = el("button", { className: "submit", type: "submit", text: form.submitLabel });
      var formNode = el("form", { novalidate: true, onsubmit: function (event) { event.preventDefault(); send(formNode, submit, error); } }, [grid, el("div", { className: "actions" }, [submit, el("span", { className: "privacy", text: "Usaremos tus datos solo para atender esta solicitud." })]), error]);
      card.appendChild(formNode);
      toggle();
    }
    function toggle() {
      Object.keys(wrappers).forEach(function (name) { var item = wrappers[name]; item.wrap.hidden = !fieldVisible(item.field, values); });
    }
    function showErrors(errors) {
      Object.keys(wrappers).forEach(function (name) {
        var item = wrappers[name]; var message = errors[name] || "";
        item.wrap.classList.toggle("invalid", Boolean(message));
        item.wrap.querySelector(".field-error").textContent = message;
      });
      var first = Object.keys(errors)[0];
      if (first && wrappers[first]) { var target = wrappers[first].wrap.querySelector("input,select,textarea"); if (target) target.focus(); }
    }
    function localErrors() {
      var errors = {};
      form.fields.forEach(function (field) {
        if (!fieldVisible(field, values)) return;
        var value = String(values[field.name] || "").trim();
        if (field.required && !value) errors[field.name] = "Este campo es obligatorio.";
        else if (value && field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) errors[field.name] = "Escribe un correo v\u00e1lido.";
        else if (value && field.type === "tel" && value.replace(/\D/g, "").length < 8) errors[field.name] = "Escribe un tel\u00e9fono v\u00e1lido.";
        else if (value && field.type === "date" && value < today()) errors[field.name] = "La fecha no puede estar en el pasado.";
      });
      if (values.check_in && values.check_out && values.check_out <= values.check_in) errors.check_out = "La salida debe ser posterior a la llegada.";
      return errors;
    }
    function send(formNode, submit, error) {
      error.hidden = true;
      var errors = localErrors();
      showErrors(errors);
      if (Object.keys(errors).length) return;
      submit.disabled = true; submit.textContent = "Enviando\u2026";
      var payload = { form: form.type, values: Object.assign({}, values, extra), visitorId: visitorId(), pageUrl: location.href, startedAt: startedAt, website: formNode.querySelector('[name="website"]').value };
      fetch(api + "/api/public/forms/" + encodeURIComponent(key), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        .then(function (response) { return response.json().catch(function () { return {}; }).then(function (data) { return { ok: response.ok, data: data }; }); })
        .then(function (result) {
          if (!result.ok) {
            if (result.data.fields) showErrors(result.data.fields);
            error.textContent = result.data.error || "No pudimos enviar tu solicitud. Int\u00e9ntalo de nuevo.";
            error.hidden = false; submit.disabled = false; submit.textContent = form.submitLabel; return;
          }
          card.innerHTML = "";
          card.appendChild(el("div", { className: "success", role: "status" }, [
            el("div", { className: "icon", text: "\u2713" }), el("h3", { text: "\u00a1Solicitud enviada!" }), el("p", { text: result.data.message || form.successMessage }),
            result.data.reference && result.data.reference !== "\u2014" ? el("small", { text: "Referencia: " + result.data.reference }) : null,
            el("div", {}, [el("button", { className: "again", type: "button", text: "Enviar otra solicitud", onclick: function () { values = {}; form.fields.forEach(function (f) { values[f.name] = f.defaultValue || ""; }); extra = {}; startedAt = Date.now(); render(); } })])
          ]));
          window.dispatchEvent(new CustomEvent("gavrion-forms:submitted", { detail: { form: form.type, reference: result.data.reference } }));
          if (onDone) onDone(result.data);
        })
        .catch(function () { error.textContent = "Sin conexi\u00f3n. Revisa tu internet e int\u00e9ntalo de nuevo."; error.hidden = false; submit.disabled = false; submit.textContent = form.submitLabel; });
    }
    render();
    return card;
  }

  // ---------- Montaje ----------
  var host = document.createElement("div");
  host.id = "gavrion-forms-root";
  var root = host.attachShadow({ mode: "open" });
  root.appendChild(el("style", { text: css }));
  var container = el("div", { className: "gf" });
  root.appendChild(container);

  function mountSection() {
    if (!withSection || !state.forms.length) return;
    var mountPoint = document.querySelector("[data-gavrion-forms]");
    var section = el("section", { className: "section", id: "solicitudes" });
    var title = el("h2", { text: "\u00bfC\u00f3mo podemos ayudarte?" });
    var intro = el("p", { text: "Env\u00eda tu solicitud y el equipo de " + (state.company || "la empresa") + " te responder\u00e1 con informaci\u00f3n confirmada." });
    var tabs = el("div", { className: "tabs", role: "tablist" });
    var panel = el("div");
    function select(index) {
      Array.prototype.forEach.call(tabs.children, function (tab, i) { tab.classList.toggle("active", i === index); tab.setAttribute("aria-selected", String(i === index)); });
      panel.innerHTML = ""; panel.appendChild(buildForm(state.forms[index]));
    }
    state.forms.forEach(function (form, index) { tabs.appendChild(el("button", { className: "tab", type: "button", role: "tab", text: form.title, onclick: function () { select(index); } })); });
    section.appendChild(title); section.appendChild(intro);
    if (state.forms.length > 1) section.appendChild(tabs);
    section.appendChild(panel);
    container.appendChild(section);
    select(0);
    if (mountPoint) mountPoint.appendChild(host);
    else {
      var footer = document.querySelector("footer");
      if (footer && footer.parentNode) footer.parentNode.insertBefore(host, footer);
      else (document.querySelector("main") || document.body).appendChild(host);
    }
  }

  var overlay = null;
  function close() { if (overlay) { overlay.remove(); overlay = null; document.removeEventListener("keydown", onKey); } }
  function onKey(event) { if (event.key === "Escape") close(); }
  function open(type, prefill) {
    var form = state.forms.find(function (item) { return item.type === type; });
    if (!form) return false;
    close();
    if (!host.isConnected) document.body.appendChild(host);
    var modal = el("div", { className: "modal", role: "dialog", "aria-modal": "true", "aria-label": form.title }, [buildForm(form, prefill || {}), el("button", { className: "close", type: "button", "aria-label": "Cerrar", text: "\u00d7", onclick: close })]);
    overlay = el("div", { className: "overlay", onclick: function (event) { if (event.target === overlay) close(); } }, [modal]);
    container.appendChild(overlay);
    document.addEventListener("keydown", onKey);
    var first = modal.querySelector("input,select,textarea"); if (first) setTimeout(function () { first.focus(); }, 50);
    return true;
  }
  function has(type) { return state.forms.some(function (item) { return item.type === type; }); }
  function primary() { for (var i = 0; i < primaryOrder.length; i++) { var form = state.forms.find(function (item) { return item.type === primaryOrder[i]; }); if (form) return form; } return state.forms[0] || null; }

  document.addEventListener("click", function (event) {
    var trigger = event.target && event.target.closest ? event.target.closest("[data-gavrion-form]") : null;
    if (!trigger || !state.ready) return;
    var type = trigger.getAttribute("data-gavrion-form");
    if (type === "primary") { var main = primary(); type = main && main.type; }
    var prefill = {};
    Array.prototype.forEach.call(trigger.attributes, function (attribute) { if (attribute.name.indexOf("data-prefill-") === 0) prefill[attribute.name.slice(13).replace(/-/g, "_")] = attribute.value; });
    if (type && open(type, prefill)) event.preventDefault();
  });

  window.GavrionForms = { ready: ready, open: open, has: has, primary: primary, close: close, get forms() { return state.forms.slice(); } };

  fetch(api + "/api/public/forms/" + encodeURIComponent(key), { cache: "no-store" })
    .then(function (response) { return response.ok ? response.json() : Promise.reject(new Error("HTTP " + response.status)); })
    .then(function (data) {
      state.forms = Array.isArray(data.forms) ? data.forms : [];
      state.company = data.company || "";
      state.ready = true;
      mountSection();
      readyResolve(window.GavrionForms);
      window.dispatchEvent(new CustomEvent("gavrion-forms:ready", { detail: { forms: state.forms.map(function (f) { return f.type; }) } }));
    })
    .catch(function (error) { console.warn("[Gavrion] No se pudieron cargar los formularios", error); readyResolve(window.GavrionForms); });
})();
