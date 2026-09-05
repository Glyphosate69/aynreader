import { MantineProvider } from "@mantine/core"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { FeedFavicon } from "./FeedFavicon"

describe("FeedFavicon", () => {
    it("uses its fallback icon when the primary favicon cannot load", () => {
        render(<FeedFavicon url="https://publisher.example/favicon.ico" fallbackUrl="rest/feed/favicon/2003" />, {
            wrapper: MantineProvider,
        })

        const image = screen.getByAltText("feed favicon")
        fireEvent.error(image)

        expect(image).toHaveAttribute("src", "rest/feed/favicon/2003")
    })
})
