interface EntryFaviconSource {
    feedUrl: string
    iconUrl: string
    url: string
}

export interface EntryFaviconUrls {
    url: string
    fallbackUrl?: string
}

export function entryFaviconUrls(entry: EntryFaviconSource): EntryFaviconUrls {
    const publisherFaviconUrl = googleNewsPublisherFaviconUrl(entry.feedUrl, entry.url)
    return publisherFaviconUrl ? { url: publisherFaviconUrl, fallbackUrl: entry.iconUrl } : { url: entry.iconUrl }
}

function googleNewsPublisherFaviconUrl(feedUrl: string, entryUrl: string): string | undefined {
    try {
        const feed = new URL(feedUrl)
        if (feed.hostname !== "news.google.com" || !feed.pathname.startsWith("/rss/")) return undefined

        const publisher = new URL(entryUrl)
        if (publisher.protocol !== "http:" && publisher.protocol !== "https:") return undefined

        return new URL("/favicon.ico", publisher).href
    } catch {
        return undefined
    }
}
