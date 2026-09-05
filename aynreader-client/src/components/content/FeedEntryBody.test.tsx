import { MantineProvider } from "@mantine/core"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { Entry } from "@/app/types"
import { FeedEntryBody } from "./FeedEntryBody"

vi.mock("@/app/store", () => ({
    useAppSelector: () => undefined,
}))

const entry = (content: string): Entry => ({
    id: "1",
    guid: "article-1",
    title: "Article de recherche",
    content,
    rtl: false,
    mediaThumbnailUrl: "https://example.com/thumbnail.png",
    date: 0,
    insertedDate: 0,
    feedId: "7",
    feedName: "Google Research Blog",
    feedUrl: "https://research.google/blog/rss/",
    feedLink: "https://research.google/blog/",
    iconUrl: "",
    url: "https://research.google/blog/article/",
    read: false,
    starred: false,
    markable: true,
    tags: [],
})

describe("FeedEntryBody", () => {
    it("shows an RSS thumbnail when the content has no image", () => {
        render(<FeedEntryBody entry={entry("Generative AI")} />, { wrapper: MantineProvider })

        expect(screen.getByAltText("media thumbnail")).toHaveAttribute("src", "https://example.com/thumbnail.png")
    })

    it("does not duplicate an image already embedded in the content", () => {
        render(<FeedEntryBody entry={entry('<p>Generative AI</p><img src="https://example.com/article.png" />')} />, {
            wrapper: MantineProvider,
        })

        expect(screen.queryByAltText("media thumbnail")).not.toBeInTheDocument()
    })
})
