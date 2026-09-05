import { Box, Center } from "@mantine/core"
import type React from "react"
import type { EntrySourceType } from "@/app/entries/slice"
import { FeedFavicon } from "@/components/content/FeedFavicon"
import { tss } from "@/tss"
import { UnreadCount } from "./UnreadCount"

interface TreeNodeProps {
    id: string
    type: EntrySourceType
    name: React.ReactNode
    icon: React.ReactNode
    unread: number
    selected: boolean
    expanded?: boolean
    level: number
    hasError: boolean
    hasWarning: boolean
    hasNewEntries: boolean
    onClick: (e: React.MouseEvent, id: string) => void
    onIconClick?: (e: React.MouseEvent, id: string) => void
}

export const treeNodeLayout = {
    label: {
        flexGrow: 1,
        minWidth: 0,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
    },
    unreadCount: {
        flexShrink: 0,
    },
}

const useStyles = tss
    .withParams<{
        selected: boolean
        hasError: boolean
        hasWarning: boolean
        hasUnread: boolean
    }>()
    .create(({ colorScheme, selected, hasError, hasWarning, hasUnread }) => {
        let backgroundColor = "inherit"
        if (selected) backgroundColor = colorScheme === "dark" ? "var(--ayn-dark-surface-high)" : "var(--ayn-gray-50)"

        let color: string
        if (hasError) {
            color = "#E5484D"
        } else if (hasWarning) {
            color = "#E0A32E"
        } else if (colorScheme === "dark") {
            color = hasUnread ? "var(--ayn-text)" : "var(--ayn-muted)"
        } else {
            color = hasUnread ? "var(--ayn-ink)" : "var(--ayn-gray-600)"
        }

        return {
            node: {
                display: "flex",
                alignItems: "center",
                cursor: "pointer",
                color,
                backgroundColor,
                borderLeft: "0",
                boxShadow: "none",
                "&:hover": {
                    backgroundColor: colorScheme === "dark" ? "var(--ayn-dark-surface-high)" : "var(--ayn-gray-50)",
                },
            },
            nodeText: treeNodeLayout.label,
            unreadCount: treeNodeLayout.unreadCount,
        }
    })

export function TreeNode(props: Readonly<TreeNodeProps>) {
    const { classes } = useStyles({
        selected: props.selected,
        hasError: props.hasError,
        hasWarning: props.hasWarning,
        hasUnread: props.unread > 0,
    })
    return (
        <Box
            py={1}
            pl={props.level * 20}
            className={`${classes.node} cf-treenode cf-treenode-${props.type}`}
            onClick={(e: React.MouseEvent) => props.onClick(e, props.id)}
            data-id={props.id}
            data-type={props.type}
            data-unread-count={props.unread}
        >
            <Box mr={6} onClick={(e: React.MouseEvent) => props.onIconClick?.(e, props.id)} className="cf-treenode-icon">
                <Center>{typeof props.icon === "string" ? <FeedFavicon url={props.icon} /> : props.icon}</Center>
            </Box>
            <Box className={classes.nodeText}>{props.name}</Box>
            {!props.expanded && (
                <Box className={`${classes.unreadCount} cf-treenode-unread-count`}>
                    <UnreadCount unreadCount={props.unread} showIndicator={props.hasNewEntries} />
                </Box>
            )}
        </Box>
    )
}
