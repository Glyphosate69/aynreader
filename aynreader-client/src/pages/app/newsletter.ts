import type { Category, Entry } from "@/app/types"

export type NewsletterTemplate = "brief" | "digest" | "editorial" | "radar"
export type NewsletterPeriod = "today" | "week" | "month" | "custom"

export interface NewsletterScope {
    categoryIds: string[]
    feedIds: string[]
    period: NewsletterPeriod
    customStartDate?: string
}

export type SelectedNewsletterEntries = Record<string, Entry>

interface NewsletterDocument {
    entries: Entry[]
    template: NewsletterTemplate
    includeImages: boolean
    generatedAt: Date
    title: string
}

const palettes: Record<NewsletterTemplate, { accent: string; canvas: string; surface: string; text: string }> = {
    brief: { accent: "#B8F03C", canvas: "#F2F4F0", surface: "#101413", text: "#F2F4F0" },
    digest: { accent: "#0F62FE", canvas: "#F3F7FF", surface: "#12325F", text: "#FFFFFF" },
    editorial: { accent: "#D94841", canvas: "#FFF5F2", surface: "#4A2420", text: "#FFF9F7" },
    radar: { accent: "#2E8B70", canvas: "#F0FAF5", surface: "#173D33", text: "#F4FFFA" },
}

export const newsletterEntryId = (entry: Entry) => `${entry.feedId}:${entry.id}`

export function getCategoryFeedIds(categories: Category[], selectedCategoryIds: string[]) {
    const categoryIds = new Set(selectedCategoryIds)
    const categoriesById = new Map(categories.map(category => [category.id, category]))

    return [
        ...new Set(
            categories
                .filter(category => categoryOrAncestorIsSelected(category, categoryIds, categoriesById))
                .flatMap(category => category.feeds.map(feed => String(feed.id)))
        ),
    ]
}

export function toggleNewsletterEntry(selectedEntries: SelectedNewsletterEntries, entry: Entry): SelectedNewsletterEntries {
    const entryId = newsletterEntryId(entry)
    if (selectedEntries[entryId]) {
        const { [entryId]: _, ...remainingEntries } = selectedEntries
        return remainingEntries
    }

    return { ...selectedEntries, [entryId]: entry }
}

export function selectNewsletterEntries(entries: Entry[]): SelectedNewsletterEntries {
    return Object.fromEntries(entries.map(entry => [newsletterEntryId(entry), entry]))
}

export function hasNewsletterScopeChanged(current: NewsletterScope, next: NewsletterScope) {
    return (
        current.period !== next.period ||
        (current.period === "custom" && current.customStartDate !== next.customStartDate) ||
        normalizedIds(current.categoryIds) !== normalizedIds(next.categoryIds) ||
        normalizedIds(current.feedIds) !== normalizedIds(next.feedIds)
    )
}

export function getNewsletterStartDate(period: NewsletterPeriod, customStartDate?: string, now = new Date()) {
    if (period === "custom" && customStartDate) {
        return new Date(`${customStartDate}T00:00:00Z`).getTime()
    }

    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    if (period === "week") start.setUTCDate(start.getUTCDate() - 7)
    if (period === "month") start.setUTCDate(start.getUTCDate() - 30)
    return start.getTime()
}

export function getNewsletterPageCount(total: number | undefined, pageSize: number) {
    if (!total || total <= 0) return 1
    return Math.ceil(total / pageSize)
}

export function newsletterEntryExcerpt(entry: Pick<Entry, "mediaDescription" | "content">) {
    return plainText(entry.mediaDescription || entry.content)
}

export function buildNewsletter(document: NewsletterDocument) {
    const palette = palettes[document.template]
    const articles = document.entries
        .toSorted((left, right) => right.date - left.date)
        .map(entry => {
            const image = document.includeImages && (entry.mediaThumbnailUrl || entry.enclosureUrl)
            const description = newsletterEntryExcerpt(entry)
            return `<article class="article">
                ${image ? `<img class="image" src="${escapeHtml(image)}" alt="" />` : ""}
                <p class="meta">${escapeHtml(entry.feedName)} · ${formatDate(entry.date)}</p>
                <h2><a href="${escapeHtml(entry.url)}">${escapeHtml(entry.title)}</a></h2>
                ${description ? `<p class="description">${escapeHtml(description)}</p>` : ""}
            </article>`
        })
        .join("\n")

    return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(document.title)}</title>
<style>
    body { margin: 0; background: ${palette.canvas}; color: ${palette.surface}; font-family: Arial, sans-serif; line-height: 1.5; }
    main { max-width: 720px; margin: 0 auto; padding: 32px 20px 48px; }
    header { margin: -32px -20px 32px; padding: 42px 20px 34px; background: ${palette.surface}; color: ${palette.text}; }
    .brand { color: ${palette.accent}; font-size: 12px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; }
    h1 { margin: 8px 0 0; font-size: 32px; }
    .article { padding: 24px 0; border-bottom: 1px solid color-mix(in srgb, ${palette.surface} 18%, transparent); }
    .article:first-of-type { padding-top: 0; }
    .meta { margin: 0 0 8px; color: ${palette.surface}; font-size: 13px; font-weight: 700; opacity: 0.7; }
    h2 { margin: 0; font-size: 23px; line-height: 1.22; }
    a { color: inherit; }
    .description { margin: 10px 0 0; }
    .image { width: 100%; max-height: 340px; margin-bottom: 16px; object-fit: cover; }
    footer { margin-top: 30px; color: ${palette.surface}; font-size: 13px; opacity: 0.7; }
</style>
</head>
<body>
<main>
    <header><div class="brand">Ayn Reader OS</div><h1>${escapeHtml(document.title)}</h1></header>
    ${articles || "<p>Aucun article n’a été retenu pour cette newsletter.</p>"}
    <footer>Générée le ${formatDate(document.generatedAt.getTime())}.</footer>
</main>
</body>
</html>`
}

function categoryOrAncestorIsSelected(category: Category, selectedCategoryIds: Set<string>, categoriesById: Map<string, Category>) {
    let currentCategory: Category | undefined = category
    while (currentCategory) {
        if (selectedCategoryIds.has(currentCategory.id)) return true
        currentCategory = currentCategory.parentId ? categoriesById.get(currentCategory.parentId) : undefined
    }
    return false
}

function normalizedIds(ids: string[]) {
    return [...new Set(ids)].sort().join(",")
}

function plainText(value?: string | null) {
    return (value ?? "")
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
}

function escapeHtml(value: string) {
    const entities: Record<string, string> = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
    }
    return value.replace(/[&<>'"]/g, character => entities[character])
}

function formatDate(timestamp: number) {
    return new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date(timestamp))
}
