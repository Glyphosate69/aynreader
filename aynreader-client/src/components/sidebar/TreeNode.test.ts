import { describe, expect, it } from "vitest"
import { treeNodeLayout } from "./TreeNode"

describe("treeNodeLayout", () => {
    it("allows a long source name to shrink before the unread count", () => {
        expect(treeNodeLayout.label).toMatchObject({
            flexGrow: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
        })
        expect(treeNodeLayout.unreadCount).toMatchObject({
            flexShrink: 0,
        })
    })
})
