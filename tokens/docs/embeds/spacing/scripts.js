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
            article.className = "card";
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