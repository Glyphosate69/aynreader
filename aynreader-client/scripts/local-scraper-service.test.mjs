import http from "node:http"
import { JSDOM } from "jsdom"
import { describe, expect, it } from "vitest"
import {
    bestDate,
    createScraperServer,
    extractAllFields,
    findCardGroupFromSelection,
    normalizeManualSelectors,
} from "./local-scraper-service.mjs"

const baseUrl = "https://news.example.test/"

function documentFrom(body) {
    return new JSDOM(`<!doctype html><body>${body}</body>`, { url: baseUrl }).window.document
}

function listen(server) {
    return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server.address().port)))
}

function close(server) {
    return new Promise(resolve => server.close(resolve))
}

describe("automatic scraper detection", () => {
    it("removes target page scripts from the selectable preview", async () => {
        const target = http.createServer((_req, res) => {
            res.writeHead(200, { "content-type": "text/html" })
            res.end(`
                <!doctype html>
                <html><head><script src="/next-app.js"></script></head>
                <body><article><h2>Rendered server content</h2></article><script>window.nextApp = true</script></body></html>
            `)
        })
        const targetPort = await listen(target)
        const scraper = createScraperServer()
        const scraperPort = await listen(scraper)

        try {
            const response = await fetch(`http://127.0.0.1:${scraperPort}/api/load`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ url: `http://127.0.0.1:${targetPort}/news` }),
            })
            const payload = await response.json()
            const document = new JSDOM(payload.html).window.document

            expect(response.status).toBe(200)
            expect(document.querySelector("h2").textContent).toBe("Rendered server content")
            expect(document.querySelectorAll("script[src]")).toHaveLength(0)
            expect(document.body.textContent).not.toContain("window.nextApp")
        } finally {
            await close(scraper)
            await close(target)
        }
    })

    it("keeps detection inside the list selected by the user", () => {
        const document = documentFrom(`
            <nav><ul><li><a href="/about">About the organisation</a></li><li><a href="/contact">Contact us now</a></li></ul></nav>
            <section id="news-list"><ul class="menu">
                <li class="nv-item nv-item-1 first" id="news-1"><a href="/news/one"><h2>First research announcement</h2></a><p>First summary of the announcement.</p></li>
                <li class="nv-item nv-item-2" id="news-2"><a href="/news/two"><h2>Second research announcement</h2></a><p>Second summary of the announcement.</p></li>
                <li class="nv-item nv-item-3 last" id="news-3"><a href="/news/three"><h2>Third research announcement</h2></a><p>Third summary of the announcement.</p></li>
            </ul></section>
            <section id="other-list"><article class="news-card"><a href="/other">Other list announcement</a></article></section>
        `)

        const group = findCardGroupFromSelection(document.querySelector("#news-2 h2"), baseUrl)

        expect(group.items.map(item => item.id)).toEqual(["news-1", "news-2", "news-3"])
        expect(group.selector).toBe("#news-list > ul.menu > li.nv-item")
    })

    it("keeps a long unclassed card list within the saved selector limit", () => {
        const cards = Array.from(
            { length: 60 },
            (_, index) => `<li id="news-${index + 1}"><a href="/news/${index + 1}"><h2>Research announcement ${index + 1}</h2></a></li>`
        ).join("")
        const document = documentFrom(`
            <section id="news-list"><ul>
                ${cards}
                <li><a href="/newsletter"><h2>Subscribe to our newsletter</h2></a></li>
            </ul></section>
        `)

        const group = findCardGroupFromSelection(document.querySelector("#news-30 h2"), baseUrl)

        expect(group.items).toHaveLength(60)
        expect(group.selector).toBe("#news-list > ul > li")
        expect(group.selector.length).toBeLessThanOrEqual(2048)
    })

    it("excludes a newsletter card from an otherwise repeated news list", () => {
        const document = documentFrom(`
            <section id="news-list">
                <article class="news-card" id="news-1"><a href="/news/one"><h2>First research announcement</h2></a></article>
                <article class="news-card" id="newsletter"><a href="/user/register"><h2>Subscribe to our newsletter</h2></a></article>
                <article class="news-card" id="news-2"><a href="/news/two"><h2>Second research announcement</h2></a></article>
            </section>
        `)

        const group = findCardGroupFromSelection(document.querySelector("#news-1 h2"), baseUrl)

        expect(group.items.map(item => item.id)).toEqual(["news-1", "news-2"])
    })

    it("extracts a complete French or numeric date instead of a month name", () => {
        const frenchDate = documentFrom("<article><p>31 juillet 2026 | Communique de presse</p></article>")
        const numericDate = documentFrom("<article><span>22.07.2026</span></article>")

        expect(bestDate(frenchDate.querySelector("article"))).toBe("31 juillet 2026")
        expect(bestDate(numericDate.querySelector("article"))).toBe("22.07.2026")
    })

    it("extracts title, URL, lazy image, description, and date from each selected card", () => {
        const document = documentFrom(`
            <section id="news-list">
                <article class="news-card"><a href="/news/one"><h2>First research announcement</h2></a><img data-src="/images/one.jpg"><time datetime="2026-07-31T09:30:00Z">31 July 2026</time><p>A useful article summary that belongs to the first card.</p></article>
                <article class="news-card"><a href="/news/two"><h2>Second research announcement</h2></a><img data-src="/images/two.jpg"><time datetime="2026-07-30T09:30:00Z">30 July 2026</time><p>A useful article summary that belongs to the second card.</p></article>
            </section>
        `)
        const group = findCardGroupFromSelection(document.querySelector("h2"), baseUrl)
        const fields = extractAllFields(group.items, baseUrl)

        expect(fields).toMatchObject([
            {
                title: "First research announcement",
                url: "https://news.example.test/news/one",
                image: "https://news.example.test/images/one.jpg",
                date: "2026-07-31T09:30:00Z",
            },
            {
                title: "Second research announcement",
                url: "https://news.example.test/news/two",
                image: "https://news.example.test/images/two.jpg",
                date: "2026-07-30T09:30:00Z",
            },
        ])
    })

    it("uses a title paragraph instead of the card text that includes its date", () => {
        const document = documentFrom(`
            <section id="news-list">
                <a class="c-showcase-news" href="/news/one">
                    <div class="c-showcase-news__image"><div class="c-showcase-news__image-background" style="background-image: url('/images/one.jpg')"></div></div>
                    <div class="c-showcase-news__content"><div class="infos"><div class="infos__date">20.07.2026</div></div><p>First technical news title</p></div>
                </a>
                <a class="c-showcase-news" href="/news/two">
                    <div class="c-showcase-news__image"><div class="c-showcase-news__image-background" style="background-image: url('/images/two.jpg')"></div></div>
                    <div class="c-showcase-news__content"><div class="infos"><div class="infos__date">19.07.2026</div></div><p>Second technical news title</p></div>
                </a>
            </section>
        `)
        const items = Array.from(document.querySelectorAll("a.c-showcase-news"))

        expect(extractAllFields(items, baseUrl)).toMatchObject([
            {
                title: "First technical news title",
                description: "",
                date: "20.07.2026",
                image: "https://news.example.test/images/one.jpg",
            },
            {
                title: "Second technical news title",
                description: "",
                date: "19.07.2026",
                image: "https://news.example.test/images/two.jpg",
            },
        ])
    })

    it("converts an inspector selector into one relative to every card", () => {
        const document = documentFrom(`
            <main id="main-content"><section><a class="card" href="/one"><p>First title</p></a><a class="card" href="/two"><p>Second title</p></a></section></main>
        `)
        const items = Array.from(document.querySelectorAll("a.card"))
        const selectors = normalizeManualSelectors(items, {
            titleSelector: "#main-content > section > a:nth-child(1) > p",
            descriptionSelector: "",
            urlSelector: "",
            imageSelector: "",
            dateSelector: "",
        })

        expect(selectors.titleSelector).toBe("p")
    })
})
