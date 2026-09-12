import { describe, expect, it } from "vitest"
import type { Category, Entry } from "@/app/types"
import {
    buildNewsletter,
    getCategoryFeedIds,
    getNewsletterPageCount,
    getNewsletterStartDate,
    hasNewsletterScopeChanged,
    newsletterEntryExcerpt,
    selectNewsletterEntries,
    toggleNewsletterEntry,
} from "./newsletter"

const categories = [
    {
        id: "technology",
        name: "Technologie",
        parentId: "all",
        feeds: [{ id: 10 }],
    },
    {
        id: "ai",
        name: "Intelligence artificielle",
        parentId: "technology",
        feeds: [{ id: 11 }],
    },
] as Category[]

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
    it("includes feeds from selected categories and their descendants", () => {
        expect(getCategoryFeedIds(categories, ["technology"])).toEqual(["10", "11"])
    })

    it("keeps article selections while moving between pages", () => {
        const firstPageSelection = toggleNewsletterEntry({}, entries[0])
        const secondPageSelection = toggleNewsletterEntry(firstPageSelection, entries[1])

        expect(Object.values(secondPageSelection)).toEqual([entries[0], entries[1]])
        expect(toggleNewsletterEntry(secondPageSelection, entries[0])).toEqual({
            "10:2": entries[1],
        })
    })

    it("selects every matching article across all newsletter pages", () => {
        expect(selectNewsletterEntries(entries)).toEqual({
            "10:1": entries[0],
            "10:2": entries[1],
            "11:3": entries[2],
        })
    })

    it("uses the selected period start", () => {
        const now = new Date("2026-08-26T14:30:00Z")

        expect(getNewsletterStartDate("today", undefined, now)).toBe(new Date("2026-08-25T14:30:00Z").getTime())
        expect(getNewsletterStartDate("week", undefined, now)).toBe(new Date("2026-08-19T00:00:00Z").getTime())
        expect(getNewsletterStartDate("month", undefined, now)).toBe(new Date("2026-07-27T00:00:00Z").getTime())
        expect(getNewsletterStartDate("custom", "2026-08-01", now)).toBe(new Date("2026-08-01T00:00:00Z").getTime())
    })

    it("keeps empty article content from crashing the selection or the newsletter", () => {
        const entryWithoutText = {
            ...entries[0],
            content: null,
            mediaDescription: null,
        } as unknown as Entry

        expect(newsletterEntryExcerpt(entryWithoutText)).toBe("")
        expect(() =>
            buildNewsletter({
                entries: [entryWithoutText],
                template: "digest",
                includeImages: false,
                generatedAt: new Date("2026-08-26T10:00:00Z"),
                title: "Veille IA",
            })
        ).not.toThrow()
    })

    it("calculates the visible number of newsletter pages", () => {
        expect(getNewsletterPageCount(51, 25)).toBe(3)
        expect(getNewsletterPageCount(0, 25)).toBe(1)
    })

    it("resets the draft when its source scope or period changes", () => {
        const current = {
            categoryIds: ["technology"],
            feedIds: ["11", "10"],
            period: "week" as const,
            customStartDate: undefined,
        }

        expect(hasNewsletterScopeChanged(current, { ...current, feedIds: ["10", "11"] })).toBe(false)
        expect(hasNewsletterScopeChanged(current, { ...current, categoryIds: ["ai"] })).toBe(true)
        expect(hasNewsletterScopeChanged(current, { ...current, feedIds: ["10"] })).toBe(true)
        expect(hasNewsletterScopeChanged(current, { ...current, period: "month" })).toBe(true)
    })

    it("generates an HTML newsletter with its editable title and selected articles", () => {
        const html = buildNewsletter({
            entries: [entries[0]],
            template: "digest",
            includeImages: false,
            generatedAt: new Date("2026-08-26T10:00:00Z"),
            title: "Veille IA du 26 aout",
        })

        expect(html).toContain("Veille IA du 26 aout")
        expect(html).toContain("Premier signal")
        expect(html).toContain("https://example.com/one")
        expect(html).not.toContain("Article écarté")
        expect(html).toContain("Ayn Reader OS")
    })
})
