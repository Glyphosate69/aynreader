import { describe, expect, it } from "vitest"
import { treeGridLayout } from "./Tree"

describe("sidebar tree layout", () => {
    it("constrains tree rows to the sidebar width", () => {
        expect(treeGridLayout).toEqual({ gridTemplateColumns: "minmax(0, 1fr)" })
    })
})
