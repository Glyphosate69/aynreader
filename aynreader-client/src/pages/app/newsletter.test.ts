import { describe, expect, it } from "vitest"
import type { Entry } from "@/app/types"
import { buildNewsletter, selectNewsletterEntries } from "./newsletter"

const entries: Entry[] = [
    {
        id: "1",
        guid: "one",
        title: "Premier signal",
        content: "Le contenu du premier signal.",
        rtl: false,
        date: new Date("2026-08-26T08:00:00Z").getTime(),
        insertedDate: new Date("2026-08-26T08:00:00Z").getTime(),
        feedId: "10",
        feedName: "Source IA",
        feedUrl: "https://example.com/feed",
        feedLink: "https://example.com",
        iconUrl: "",
        url: "https://example.com/one",
        read: false,
        starred: false,
        markable: true,
        tags: [],
    },
    {
        id: "2",
        guid: "two",
        title: "Article écarté",
        content: "Ce contenu ne doit pas être téléchargé.",
        rtl: false,
        date: new Date("2026-08-25T08:00:00Z").getTime(),
        insertedDate: new Date("2026-08-25T08:00:00Z").getTime(),
        feedId: "10",
        feedName: "Source IA",
        feedUrl: "https://example.com/feed",
        feedLink: "https://example.com",
        iconUrl: "",
        url: "https://example.com/two",
        read: false,
        starred: false,
        markable: true,
        tags: [],
    },
    {
        id: "3",
        guid: "three",
        title: "Autre source",
        content: "Un autre contenu.",
        rtl: false,
        date: new Date("2026-08-24T08:00:00Z").getTime(),
        insertedDate: new Date("2026-08-24T08:00:00Z").getTime(),
        feedId: "11",
        feedName: "Source hors sélection",
        feedUrl: "https://example.org/feed",
        feedLink: "https://example.org",
        iconUrl: "",
        url: "https://example.org/three",
        read: false,
        starred: false,
        markable: true,
        tags: [],
    },
]

describe("newsletter", () => {
    it("retains only selected and non-excluded articles within the limit", () => {
        expect(
            selectNewsletterEntries(entries, {
                feedIds: ["10"],
                excludedEntryIds: ["10:2"],
                maximumArticles: 12,
            })
        ).toEqual([entries[0]])
    })

    it("does not replace an ignored article with one outside the configured selection", () => {
        expect(
            selectNewsletterEntries(entries, {
                feedIds: ["10"],
                excludedEntryIds: ["10:1"],
                maximumArticles: 1,
            })
        ).toEqual([])
    })

    it("generates a readable HTML newsletter without excluded articles", () => {
        const html = buildNewsletter({
            entries: [entries[0]],
            template: "digest",
            includeImages: false,
            generatedAt: new Date("2026-08-26T10:00:00Z"),
        })

        expect(html).toContain("Premier signal")
        expect(html).toContain("https://example.com/one")
        expect(html).not.toContain("Article écarté")
        expect(html).toContain("Ayn Reader OS")
    })
})
