// Guía de xenxo: tema de día o de noche y botón de copiar. Archivo aparte: la CSP no deja scripts en línea.
(function () {
  var root = document.documentElement;
  var KEY = "xenxo:docs-theme";
  function stored() {
    try {
      return localStorage.getItem(KEY);
    } catch (e) {
      return null;
    }
  }
  var saved = stored();
  if (saved === "day" || saved === "night") root.setAttribute("data-theme", saved);

  function current() {
    var t = root.getAttribute("data-theme");
    if (t) return t;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "day" : "night";
  }

  document.addEventListener("DOMContentLoaded", function () {
    var btn = document.querySelector(".theme");
    if (btn) {
      btn.addEventListener("click", function () {
        var next = current() === "day" ? "night" : "day";
        root.setAttribute("data-theme", next);
        try {
          localStorage.setItem(KEY, next);
        } catch (e) {
          /* sin almacenamiento: dura lo que la página */
        }
      });
    }

    var copy = root.getAttribute("data-copy") || "Copy";
    var copied = root.getAttribute("data-copied") || "Copied";
    document.querySelectorAll(".code:not(.plain)").forEach(function (box) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "copy";
      b.textContent = copy;
      b.addEventListener("click", function () {
        var text = box.querySelector("code").textContent;
        var done = function () {
          b.textContent = copied;
          b.classList.add("done");
          setTimeout(function () {
            b.textContent = copy;
            b.classList.remove("done");
          }, 1600);
        };
        if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () {});
      });
      box.appendChild(b);
    });

    // En móvil el menú de guías empieza cerrado.
    var menu = document.querySelector(".side-menu");
    if (menu && window.matchMedia("(max-width: 959px)").matches) menu.removeAttribute("open");

    // Índice: marca la sección que se está leyendo.
    var links = document.querySelectorAll(".toc a");
    if (links.length && "IntersectionObserver" in window) {
      var byId = {};
      links.forEach(function (a) {
        byId[a.getAttribute("href").slice(1)] = a;
      });
      var io = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (e) {
            if (!e.isIntersecting) return;
            links.forEach(function (a) {
              a.removeAttribute("aria-current");
            });
            var a = byId[e.target.id];
            if (a) a.setAttribute("aria-current", "true");
          });
        },
        { rootMargin: "0px 0px -70% 0px" }
      );
      document.querySelectorAll(".prose h2[id], .prose h3[id]").forEach(function (h) {
        io.observe(h);
      });
    }
  });
})();
