import "../../token_switcher/switcher.js";
import "../../swatch_maker/swatch_maker.js";

window.tokenSwapDefaults = {
    breakpoint: "mobile"
};

(() => {
    const SIZES = [
        0,
        2,
        4,
        8,
        12,
        16,
        20,
        24,
        32,
        40,
        48,
        56,
        64,
        72,
        80,
        96,
        144
    ];

    function build(listEl) {
        const frag = document.createDocumentFragment();

        for (const n of SIZES) {
            const li = document.createElement("li");

            const article = document.createElement("article");
            article.className = "card hide-resolved-values";
            article.dataset.token = `--spacing-x${n}`;

            const aside = document.createElement("aside");
            // inline style width tied to the same token
            aside.setAttribute("style", `--spacing-demo:var(--spacing-x${n});`);
            aside.setAttribute("data-swap-allow", `breakpoint`);

            li.append(article, aside);
            frag.appendChild(li);
        }

        listEl.replaceChildren(frag);
    }

    const run = () => document.querySelectorAll(".spacing-list").forEach(build);

    document.readyState === "loading" ?
        document.addEventListener("DOMContentLoaded", run, {
            once: true
        }) :
        run();
})();


// Toggle for resolved values

(function () {
    const toggle = document.getElementById('toggleResolved');

    // Ensure default OFF: all .card elements carry .hide-resolved-values
    function applyDefaultOff() {
      document.querySelectorAll('.card').forEach(card => {
        card.classList.add('hide-resolved-values');
      });
    }

    function updateCards(isOn) {
      const cards = document.querySelectorAll('.card');
      cards.forEach(card => {
        if (isOn) {
          card.classList.remove('hide-resolved-values');
        } else {
          card.classList.add('hide-resolved-values');
        }
      });
      // Keep ARIA in sync for button-like semantics
      toggle.setAttribute('aria-pressed', String(isOn));
    }

    // Init
    applyDefaultOff();
    updateCards(toggle.checked); // should be false initially

    // Wire up
    toggle.addEventListener('change', () => updateCards(toggle.checked));
  })();