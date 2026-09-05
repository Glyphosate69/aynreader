import { describe, expect, it } from "vitest"
import { entryFaviconUrls } from "./entryFavicon"

describe("entryFaviconUrls", () => {
    it("uses the decoded publisher favicon for a Google News entry", () => {
        expect(
            entryFaviconUrls({
                feedUrl: "https://news.google.com/rss/search?q=intelligence+artificielle",
                url: "https://www.bfmtv.com/tech/article.html",
                iconUrl: "rest/feed/favicon/2003",
            })
        ).toEqual({
            url: "https://www.bfmtv.com/favicon.ico",
            fallbackUrl: "rest/feed/favicon/2003",
        })
    })

    it("keeps the feed favicon for a regular feed", () => {
        expect(
            entryFaviconUrls({
                feedUrl: "https://example.com/rss.xml",
                url: "https://example.com/article.html",
                iconUrl: "rest/feed/favicon/42",
            })
        ).toEqual({ url: "rest/feed/favicon/42" })
    })

    it("keeps the Google News favicon when the publisher URL is not usable", () => {
        expect(
            entryFaviconUrls({
                feedUrl: "https://news.google.com/rss/search?q=intelligence+artificielle",
                url: "not-a-url",
                iconUrl: "rest/feed/favicon/2003",
            })
        ).toEqual({ url: "rest/feed/favicon/2003" })
    })
})
