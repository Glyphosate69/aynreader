import "vite/client"

declare global {
    interface ImportMetaEnv {
        readonly VITE_SCRAPER_API_BASE?: string
    }
}
