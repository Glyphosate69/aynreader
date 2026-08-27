import http from "node:http"
import { pathToFileURL, URL } from "node:url"
import { JSDOM } from "jsdom"
import { ProxyAgent } from "undici"

const port = Number(process.env.SCRAPER_PORT || 3000)
const requestTimeoutMs = Number(process.env.SCRAPER_TIMEOUT_MS || 20000)
const fallbackTimeoutMs = Number(process.env.SCRAPER_FALLBACK_TIMEOUT_MS || 10000)
const pageCacheMs = Number(process.env.SCRAPER_PAGE_CACHE_MS || 45000)
const maxSavedSelectorLength = 2048
const scraperProxyUrl = process.env.SCRAPER_PROXY_URL || ""
const scraperDispatcher = scraperProxyUrl ? new ProxyAgent(scraperProxyUrl) : null
const pageCache = new Map()
const scraperUserAgent =
    process.env.SCRAPER_USER_AGENT ||
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
const readerProxyPrefix = "https://r.jina.ai/http://"

const browserHeaders = {
    "user-agent": scraperUserAgent,
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "accept-language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
    "cache-control": "no-cache",
    pragma: "no-cache",
    "sec-ch-ua": '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "none",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
}

const corsHeaders = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
}

function sendJson(res, status, payload) {
    res.writeHead(status, {
        ...corsHeaders,
        "content-type": "application/json; charset=utf-8",
    })
    res.end(JSON.stringify(payload))
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = ""
        req.setEncoding("utf8")
        req.on("data", chunk => {
            body += chunk
            if (body.length > 2_000_000) {
                req.destroy()
                reject(new Error("Request body is too large."))
            }
        })
        req.on("end", () => resolve(body))
        req.on("error", reject)
    })
}

async function readJson(req) {
    const body = await readBody(req)
    if (!body.trim()) return {}
    try {
        return JSON.parse(body)
    } catch {
        throw new Error("Invalid JSON body.")
    }
}

function normalizeUrl(value) {
    const trimmed = String(value || "").trim()
    if (!trimmed) throw new Error("Missing URL.")
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed.replace(/^\/+/, "")}`
}

function escapeHtml(value) {
    return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
}

function escapeCss(value) {
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&")
}

const cookieBannerSelectors =
    'dialog,[role="dialog"],[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],[id*="privacy" i],[class*="privacy" i]'
const cookieBannerText =
    /\b(?:cookies?|cookie policy|consent|gdpr|privacy preferences|manage preferences|accept all|reject all|accepter|refuser|param[eè]tres des cookies|politique de confidentialit[eé])\b/i

function stripCookieBanners(html) {
    const dom = new JSDOM(html)
    const document = dom.window.document
    document
        .querySelectorAll('script[src*="cmp" i],script[src*="consent" i],script[src*="gdpr" i],script[data-gdpr-purposes]')
        .forEach(script => {
            script.remove()
        })
    document.querySelectorAll("script:not([src])").forEach(script => {
        if (/__tcfapi|GDPR_CONFIG|cookie consent|consent management/i.test(script.textContent || "")) {
            script.remove()
        }
    })
    document.querySelectorAll(cookieBannerSelectors).forEach(element => {
        const text = cleanText(element.textContent)
        const attributes = [element.id, element.className, element.getAttribute("role")].join(" ")
        const isDialog = element.matches('dialog,[role="dialog"]')
        const hasConsentMarker = /cookie|consent|privacy|gdpr/i.test(attributes)
        if (text && cookieBannerText.test(text) && (isDialog || hasConsentMarker)) {
            element.remove()
        }
    })
    return dom.serialize()
}

function injectSelector(html, finalUrl) {
    const previewDom = new JSDOM(html)
    previewDom.window.document.querySelectorAll("script").forEach(script => {
        script.remove()
    })
    const sanitizedHtml = previewDom.serialize()
    const script = `
<script>
(() => {
  let selected = null;
  let level = 0;
  const marker = "data-ayn-scraper-selected";
  const cssEscape = window.CSS && CSS.escape ? CSS.escape : value => String(value).replace(/[^a-zA-Z0-9_-]/g, "\\\\$&");

  const style = document.createElement("style");
  style.textContent = "*[data-ayn-scraper-hover='true']{outline:2px solid #B8F03C!important;cursor:pointer!important}*[data-ayn-scraper-selected='true']{outline:3px solid #B8F03C!important;background:rgba(184,240,60,.12)!important}#onetrust-banner-sdk,#CybotCookiebotDialog,[id*='cookie' i],[class*='cookie' i],[id*='consent' i],[class*='consent' i]{display:none!important}";
  document.documentElement.appendChild(style);

  const cookieBannerText = /(?:\\b(?:cookies?|cookie policy|consent|gdpr|privacy preferences|manage preferences|accept all|reject all|accepter|refuser|param[eè]tres des cookies|politique de confidentialit[eé])\\b|soutenez un journalisme fiable|accepter et continuer|consentement sur l.{0,10}utilisation|données personnelles)/i;
  function removeCookieBanners() {
    document.querySelectorAll('dialog,[role="dialog"],[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],[id*="privacy" i],[class*="privacy" i],body *').forEach(element => {
      const text = (element.textContent || '').replace(/\\s+/g, ' ').trim();
      const attributes = [element.id, element.className, element.getAttribute('role')].join(' ');
      const style = window.getComputedStyle(element);
      const isOverlay = style.position === 'fixed' || style.position === 'sticky';
      const hasConsentMarker = /cookie|consent|privacy|gdpr/i.test(attributes) || element.matches('dialog,[role="dialog"]');
      const hasConsentPhrase = /soutenez un journalisme fiable|accepter et continuer|consentement sur l.{0,10}utilisation|données personnelles/i.test(text);
      const hasConsentAction = /accepter|refuser|continuer|s.abonner|se connecter/i.test(text);
      if (text && cookieBannerText.test(text) && (hasConsentMarker || (hasConsentPhrase && (isOverlay || (text.length > 250 && hasConsentAction))))) {
        element.remove();
      }
    });
  }
  removeCookieBanners();
  new MutationObserver(removeCookieBanners).observe(document.documentElement, { childList: true, subtree: true });

  function elementSelector(element) {
    if (element.id) return "#" + cssEscape(element.id);
    const parts = [];
    let node = element;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      let part = node.localName.toLowerCase();
      const stableClass = Array.from(node.classList || []).find(name => !/^\\d/.test(name) && !/^mantine-/.test(name));
      if (stableClass) part += "." + cssEscape(stableClass);
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(child => child.localName === node.localName);
        if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")";
      }
      parts.unshift(part);
      const selector = parts.join(" > ");
      try {
        if (document.querySelectorAll(selector).length === 1) return selector;
      } catch {}
      node = parent;
    }
    return parts.join(" > ");
  }

  function candidatesFrom(target) {
    const chain = [];
    let node = target && target.nodeType === 1 ? target : target?.parentElement;
    while (node && node !== document.body && node !== document.documentElement) {
      chain.push(node);
      node = node.parentElement;
    }
    return chain;
  }

  function publish() {
    if (!selected) return;
    document.querySelectorAll("[" + marker + "]").forEach(node => node.removeAttribute(marker));
    selected.setAttribute(marker, "true");
    const chain = candidatesFrom(selected);
    window.parent.postMessage({
      type: "visual-scraper:selected",
      selector: elementSelector(selected),
      level,
      maxLevel: Math.max(0, chain.length - 1),
      tag: selected.localName
    }, "*");
  }

  document.addEventListener("mouseover", event => {
    const target = event.target && event.target.closest ? event.target.closest("article,li,tr,.card,.item,.post,.entry,section,div") : null;
    if (!target || target === document.body) return;
    document.querySelectorAll("[data-ayn-scraper-hover='true']").forEach(node => node.removeAttribute("data-ayn-scraper-hover"));
    target.setAttribute("data-ayn-scraper-hover", "true");
  }, true);

  document.addEventListener("click", event => {
    const chain = candidatesFrom(event.target);
    selected = chain[0];
    level = 0;
    event.preventDefault();
    event.stopPropagation();
    publish();
  }, true);

  document.addEventListener("keydown", event => {
    if (!selected) return;
    const chain = candidatesFrom(selected);
    if (event.key === "ArrowUp" && selected.parentElement && selected.parentElement !== document.body) {
      selected = selected.parentElement;
      level = Math.min(level + 1, chain.length);
    } else if (event.key === "ArrowDown" && selected.children.length > 0) {
      selected = selected.children[0];
      level = Math.max(0, level - 1);
    } else {
      return;
    }
    event.preventDefault();
    publish();
  }, true);
})();
</script>`

    const base = `<base href="${escapeHtml(finalUrl)}">`
    const withBase = /<head[^>]*>/i.test(sanitizedHtml)
        ? sanitizedHtml.replace(/<head([^>]*)>/i, `<head$1>${base}`)
        : `${base}${sanitizedHtml}`
    return /<\/body>/i.test(withBase) ? withBase.replace(/<\/body>/i, () => `${script}</body>`) : `${withBase}${script}`
}

function readerProxyUrl(url) {
    return `${readerProxyPrefix}${url}`
}

function splitReaderLinkText(text) {
    const datePattern =
        /\b(?:\d{1,2}\s+(?:janv\.?|janvier|févr\.?|fevr\.?|février|fevrier|mars|avr\.?|avril|mai|juin|juil\.?|juillet|août|aout|sept\.?|septembre|oct\.?|octobre|nov\.?|novembre|déc\.?|dec\.?|décembre|decembre)\s+\d{4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b/i
    const match = text.match(datePattern)
    const date = match?.[0] || ""
    let title = date ? cleanText(text.slice(0, match.index)) : text
    let category = ""
    const categoryPattern =
        /\s+(produit|entreprise|sécurité|securite|recherche|actualités|actualites|adoption de l’ia|adoption de l'ia|product|company|security|research|safety|news|policy|developers)$/i
    const categoryMatch = title.match(categoryPattern)
    if (categoryMatch) {
        category = cleanText(categoryMatch[1])
        title = cleanText(title.slice(0, categoryMatch.index))
    }
    return { title: title || text, category, date }
}

function markdownReaderToHtml(markdown, baseUrl) {
    const cards = []
    let pendingImage = ""
    for (const line of markdown.split(/\r?\n/)) {
        const image = line.match(/!\[[^\]]*]\((https?:\/\/[^)]+)\)/)
        if (image) {
            pendingImage = image[1]
            continue
        }

        const link = line.match(/^\[([^\]]+)]\((https?:\/\/[^)]+)\)$/)
        if (!link) continue
        const text = cleanText(link[1])
        const href = absoluteUrl(link[2], baseUrl)
        if (!text || href === baseUrl || /^(afficher|switch cards)/i.test(text)) continue
        const { title, category, date } = splitReaderLinkText(text)
        cards.push({ title, category, date, href, image: pendingImage })
        pendingImage = ""
    }

    const body = cards
        .slice(0, 100)
        .map(
            card => `<article class="reader-card">
  <a href="${escapeHtml(card.href)}">
    ${card.image ? `<img src="${escapeHtml(card.image)}" alt="">` : ""}
    <h2>${escapeHtml(card.title)}</h2>
    ${card.category ? `<p class="reader-card__category">${escapeHtml(card.category)}</p>` : ""}
    ${card.date ? `<time datetime="${escapeHtml(card.date)}">${escapeHtml(card.date)}</time>` : ""}
  </a>
</article>`
        )
        .join("\n")

    return `<!doctype html><html><head><meta charset="utf-8"><title>Reader fallback</title></head><body><main>${body}</main></body></html>`
}

async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal,
            ...(scraperDispatcher ? { dispatcher: scraperDispatcher } : {}),
        })
    } finally {
        clearTimeout(timer)
    }
}

async function fetchReaderPage(url) {
    const response = await fetchWithTimeout(
        readerProxyUrl(url),
        {
            redirect: "follow",
            headers: {
                "user-agent": scraperUserAgent,
                "accept-language": browserHeaders["accept-language"],
                accept: "text/plain,text/markdown,*/*",
            },
        },
        fallbackTimeoutMs
    )
    const markdown = await response.text()
    return response.ok ? { html: markdownReaderToHtml(markdown, url), finalUrl: url } : null
}

async function fetchFallbackPage(url) {
    return await fetchReaderPage(url)
}

async function fetchPageUncached(url) {
    const response = await fetchWithTimeout(
        url,
        {
            redirect: "follow",
            headers: browserHeaders,
        },
        requestTimeoutMs
    )
    const text = await response.text()
    if (!response.ok) {
        if ([401, 403, 429].includes(response.status)) {
            const fallback = await fetchFallbackPage(url)
            if (fallback) return fallback
        }
        const retryAfter = response.headers.get("retry-after")
        const retryMessage = retryAfter ? ` Réessaie après ${retryAfter}.` : ""
        throw new Error(`Le site cible a répondu HTTP ${response.status}.${retryMessage}`)
    }
    return { html: stripCookieBanners(text), finalUrl: response.url || url }
}

async function fetchPage(url) {
    const cached = pageCache.get(url)
    if (cached && cached.expiresAt > Date.now()) return cached.page
    if (cached) pageCache.delete(url)

    const page = await fetchPageUncached(url)
    pageCache.set(url, { page, expiresAt: Date.now() + pageCacheMs })
    return page
}

function cleanText(value) {
    return String(value || "")
        .replace(/\s+/g, " ")
        .trim()
}

function absoluteUrl(value, baseUrl) {
    if (!value) return ""
    try {
        return new URL(value, baseUrl).href
    } catch {
        return value
    }
}

function stableClasses(element, limit = 3) {
    return Array.from(element.classList || [])
        .filter(name => !/^\d/.test(name) && !/^(?:css-|mantine-|mui|sc-)/i.test(name))
        .slice(0, limit)
}

function signature(element) {
    const className = stableClasses(element).join(".")
    return `${element.localName}${className ? `.${className}` : ""}`
}

function selectorForSimilar(element) {
    const parent = element.parentElement
    if (!parent) return element.localName
    const { siblings, sharedClasses } = repeatedSiblings(element)
    if (siblings.length > 1) {
        if (sharedClasses.length > 0) {
            return `${element.localName}.${sharedClasses.map(escapeCss).join(".")}`
        }
        return `${element.localName}`
    }
    return element.localName
}

function repeatedSiblings(element) {
    const parent = element.parentElement
    if (!parent) return { siblings: [], sharedClasses: [] }

    const sameTag = Array.from(parent.children).filter(child => child.localName === element.localName)
    const sharedClasses = stableClasses(element).filter(
        className => sameTag.filter(child => child.classList.contains(className)).length > 1
    )
    const siblings =
        sharedClasses.length === 0
            ? sameTag
            : sameTag.filter(child => sharedClasses.every(className => child.classList.contains(className)))
    return { siblings, sharedClasses }
}

function isNavigationElement(element) {
    if (element.closest("nav,header,footer,aside,[role=navigation]")) return true

    let node = element
    for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
        const marker = `${node.localName} ${node.id || ""} ${node.getAttribute("class") || ""}`
        if (
            /(^|[-_\s])(nav|navigation|top-bar|header|footer|breadcrumb|pagination|social|share|login|account|utility|toolbar)([-_\s]|$)/i.test(
                marker
            )
        ) {
            return true
        }
    }
    return false
}

function isCallToAction(element) {
    const value = cleanText(element.textContent)
    const hrefs = Array.from(element.querySelectorAll("a[href]")).map(link => link.getAttribute("href") || "")
    return (
        /\b(?:newsletter|subscribe|subscription|sign up|register|s[’']abonner|inscri(?:vez|ption)|create an account)\b/i.test(value) ||
        hrefs.some(href => /\/(?:user\/register|register|subscribe|newsletter)(?:[/?#]|$)/i.test(href))
    )
}

function isLikelyArticleItem(element) {
    if (isNavigationElement(element)) return false

    const text = cleanText(element.textContent)
    if (text.length < 20 || text.length > 1800) return false

    const links = Array.from(element.querySelectorAll("a[href]"))
    const titledLinks = links.filter(link => {
        const href = link.getAttribute("href") || ""
        return !href.startsWith("#") && cleanText(link.textContent).length >= 8
    })
    const titleNodes = Array.from(element.querySelectorAll("h1,h2,h3,h4,h5,h6,figcaption,[class*=title i],[class*=headline i]"))
    const hasTitle = titleNodes.some(node => cleanText(node.textContent).length >= 8)

    if (!hasTitle && !titledLinks.some(link => cleanText(link.textContent).length >= 18)) return false
    if (titledLinks.length > 10 && text.length < 500) return false
    return true
}

function candidateTextScore(text) {
    if (text.length < 8) return -40
    if (text.length > 220) return -20
    if (/^(accueil|home|lire la suite|read more|voir plus|plus|autres actualités|actualités)$/i.test(text)) return -80
    return Math.min(text.length, 120)
}

function hasTitleLikeClass(element) {
    return /(^|[-_\s])(title|titre|headline|heading|name|subject)([-_\s]|$)/i.test(element.getAttribute("class") || "")
}

function titleCandidates(element, baseUrl) {
    const candidates = []
    const nodes = Array.from(element.querySelectorAll("h1,h2,h3,h4,h5,h6,a[href],strong,p,span,[class]"))

    for (const node of nodes) {
        const text = cleanText(node.textContent)
        if (!text) continue
        const link = node.closest("a[href]") || node.querySelector?.("a[href]")
        let score = candidateTextScore(text)
        if (/^h[1-6]$/i.test(node.localName)) score += 70
        if (hasTitleLikeClass(node)) score += 60
        if (node.matches("a[href]") || link) score += 35
        if (node.matches("strong")) score += 10
        if (node.matches("p,span")) score += 8
        if (text.length > 160 && !/^h[1-6]$/i.test(node.localName) && !hasTitleLikeClass(node)) score -= 45
        const date = dateTextFromValue(text)
        if (date && normalizeFieldValue(text) !== normalizeFieldValue(date)) score -= 120
        if (node.matches("a[href]") && node.querySelector("h1,h2,h3,h4,h5,h6,p,[class*=title i],[class*=headline i]")) score -= 45
        candidates.push({
            text,
            url: absoluteUrl(link?.getAttribute("href") || "", baseUrl),
            score,
        })
    }

    if (!candidates.some(candidate => candidate.score > 0)) {
        const fallbackText = cleanText(element.textContent).slice(0, 180)
        if (fallbackText) candidates.push({ text: fallbackText, url: "", score: candidateTextScore(fallbackText) - 70 })
    }

    return candidates
}

function pickTitleCandidates(items, baseUrl) {
    const perItemCandidates = items.map(item => titleCandidates(item, baseUrl))
    const counts = new Map()
    for (const candidates of perItemCandidates) {
        const uniqueTexts = new Set(candidates.map(candidate => normalizeFieldValue(candidate.text)).filter(Boolean))
        for (const text of uniqueTexts) counts.set(text, (counts.get(text) || 0) + 1)
    }

    return perItemCandidates.map(candidates => {
        const sorted = [...candidates].sort((a, b) => {
            const aCount = counts.get(normalizeFieldValue(a.text)) || 0
            const bCount = counts.get(normalizeFieldValue(b.text)) || 0
            const aPenalty = aCount > 1 ? 160 + aCount * 30 : 0
            const bPenalty = bCount > 1 ? 160 + bCount * 30 : 0
            return b.score - bPenalty - (a.score - aPenalty)
        })
        return sorted[0] || { text: "", url: "", score: 0 }
    })
}

function bestDescription(element, title) {
    const normalizedTitle = normalizeFieldValue(title)
    const isUsefulDescription = value => {
        const normalized = normalizeFieldValue(value)
        const withoutDate = normalizeFieldValue(value.replace(dateTextFromValue(value), ""))
        return (
            value.length > 30 &&
            value.length < 420 &&
            normalized !== normalizedTitle &&
            !normalized.startsWith(normalizedTitle) &&
            withoutDate !== normalizedTitle
        )
    }
    const description =
        Array.from(element.querySelectorAll("p"))
            .map(node => cleanText(node.textContent))
            .find(isUsefulDescription) ||
        Array.from(element.querySelectorAll("span,div"))
            .map(node => cleanText(node.textContent))
            .find(isUsefulDescription) ||
        ""
    return description
}

function dateTextFromValue(value) {
    const normalized = cleanText(value)
    const patterns = [
        /\b\d{4}-\d{2}-\d{2}(?:[T\s]\d{1,2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)?\b/i,
        /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}(?:\s+\d{1,2}[:h]\d{2})?(?=\D|$)/i,
        /\b\d{1,2}\s+(?:janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre|january|february|march|april|may|june|july|august|september|october|november|december)\.?\s+\d{4}(?:\s+(?:à|a|at)?\s*\d{1,2}[:h]\d{2})?\b/i,
        /\b(?:aujourd'hui|hier|avant-hier|today|yesterday|the day before yesterday)\b/i,
        /\b(?:il y a\s+\d+\s+(?:minutes?|heures?|hours?|jours?|days?|semaines?|weeks?)|\d+\s+(?:minutes?|hours?|days?|weeks?)\s+ago)\b/i,
    ]
    return patterns.map(pattern => normalized.match(pattern)?.[0]).find(Boolean) || ""
}

function bestDate(element) {
    const time = element.querySelector("time")
    const explicitDate =
        time?.getAttribute("datetime") ||
        time?.getAttribute("data-dateap") ||
        time?.getAttribute("data-dateago") ||
        cleanText(time?.textContent)
    if (explicitDate) return explicitDate

    for (const value of Array.from(element.querySelectorAll("span,div,p,[class]")).map(node => cleanText(node.textContent))) {
        if (value.length >= 80) continue
        const date = dateTextFromValue(value)
        if (date) return date
    }
    return ""
}

function bestLink(element, title, baseUrl) {
    const normalizedTitle = normalizeFieldValue(title)
    const links = Array.from(element.querySelectorAll("a[href]"))
        .map(link => ({
            link,
            href: absoluteUrl(link.getAttribute("href") || "", baseUrl),
            text: normalizeFieldValue(link.textContent),
        }))
        .filter(candidate => candidate.href && !candidate.href.startsWith("#"))

    return (
        links.find(candidate => candidate.text === normalizedTitle)?.href ||
        links.find(candidate => /\/(?:article|story|stories|news)\//i.test(candidate.href))?.href ||
        links.at(-1)?.href ||
        ""
    )
}

function bestImage(element, baseUrl) {
    const nodes = Array.from(element.querySelectorAll("img,[style*='background-image']"))
    const image = nodes.map(imageSource).find(Boolean) || ""
    return absoluteUrl(image, baseUrl)
}

function selectorPart(element) {
    const classes = stableClasses(element, 2)
    let part = element.localName
    if (element.id) return `${part}#${escapeCss(element.id)}`
    if (classes.length > 0) part += `.${classes.map(escapeCss).join(".")}`
    const parent = element.parentElement
    if (parent) {
        const siblings = Array.from(parent.children).filter(child => child.localName === element.localName)
        if (siblings.length > 1 && classes.length === 0) part += `:nth-of-type(${siblings.indexOf(element) + 1})`
    }
    return part
}

function uniqueSelectorFor(element) {
    const anchor = element.closest("[id]")
    if (anchor) {
        const parts = []
        let node = element
        while (node && node !== anchor) {
            parts.unshift(selectorPart(node))
            node = node.parentElement
        }
        return [`#${escapeCss(anchor.id)}`, ...parts].join(" > ")
    }

    const parts = []
    let node = element
    while (node && node.nodeType === 1 && node !== node.ownerDocument.documentElement) {
        parts.unshift(selectorPart(node))
        const selector = parts.join(" > ")
        try {
            if (node.ownerDocument.querySelectorAll(selector).length === 1) return selector
        } catch {}
        node = node.parentElement
    }
    return parts.join(" > ")
}

function scopedGroupSelector(parent, items, sharedClasses) {
    const parentSelector = uniqueSelectorFor(parent)
    const first = items[0]
    const childSelector = `${first.localName}${sharedClasses.length > 0 ? `.${sharedClasses.map(escapeCss).join(".")}` : ""}`
    if (sharedClasses.length > 0) return `${parentSelector} > ${childSelector}`

    const siblings = Array.from(parent.children).filter(child => child.localName === first.localName)
    const compactSelector = `${parentSelector} > ${first.localName}`
    const individualSelector = items
        .map(item => `${parentSelector} > ${first.localName}:nth-of-type(${siblings.indexOf(item) + 1})`)
        .join(", ")
    if (items.length === siblings.length || individualSelector.length > maxSavedSelectorLength) return compactSelector

    return individualSelector
}

function relativeSelector(root, element) {
    if (!element || element === root) return ""
    const parts = []
    let node = element
    while (node && node !== root && node.nodeType === 1) {
        parts.unshift(selectorPart(node))
        const selector = parts.join(" > ")
        try {
            if (root.querySelectorAll(selector).length === 1) return selector
        } catch {}
        node = node.parentElement
    }
    return parts.join(" > ")
}

function bestTitleNode(element, title) {
    const normalizedTitle = normalizeFieldValue(title)
    if (normalizedTitle) {
        const exactMatch = Array.from(element.querySelectorAll("h1,h2,h3,h4,h5,h6,p,span,a[href],[class]")).find(
            node => normalizeFieldValue(node.textContent) === normalizedTitle
        )
        if (exactMatch) return exactMatch
    }
    return (
        element.querySelector("h1,h2,h3,h4,h5,h6,[class*=title i],[class*=headline i]") ||
        Array.from(element.querySelectorAll("p,span")).find(node => cleanText(node.textContent).length >= 8) ||
        Array.from(element.querySelectorAll("a[href]")).find(link => cleanText(link.textContent).length >= 8) ||
        null
    )
}

function bestDescriptionNode(element, title) {
    const normalizedTitle = normalizeFieldValue(title)
    const isUsefulDescription = node => {
        const value = cleanText(node.textContent)
        const normalized = normalizeFieldValue(value)
        const withoutDate = normalizeFieldValue(value.replace(dateTextFromValue(value), ""))
        return (
            value.length > 30 &&
            value.length < 420 &&
            normalized !== normalizedTitle &&
            !normalized.startsWith(normalizedTitle) &&
            withoutDate !== normalizedTitle
        )
    }
    return (
        Array.from(element.querySelectorAll("p")).find(isUsefulDescription) ||
        Array.from(element.querySelectorAll("span,div")).find(isUsefulDescription) ||
        null
    )
}

function bestUrlNode(element, title, baseUrl) {
    const normalizedTitle = normalizeFieldValue(title)
    const links = Array.from(element.querySelectorAll("a[href]")).filter(link => {
        const href = absoluteUrl(link.getAttribute("href") || "", baseUrl)
        return href && !href.startsWith("#")
    })
    return (
        links.find(link => normalizeFieldValue(link.textContent) === normalizedTitle) ||
        links.find(link => /\/(?:article|story|stories|news)\//i.test(absoluteUrl(link.getAttribute("href") || "", baseUrl))) ||
        links.at(-1) ||
        null
    )
}

function bestImageNode(element) {
    return Array.from(element.querySelectorAll("img,[style*='background-image']")).find(node => imageSource(node)) || null
}

function bestDateNode(element) {
    const time = element.querySelector("time")
    if (time) return time
    return (
        Array.from(element.querySelectorAll("[datetime],[class*=date i],[class*=time i],span,p,div")).find(node => {
            const value = cleanText(node.textContent)
            return value.length < 80 && Boolean(dateTextFromValue(value))
        }) || null
    )
}

function inferFieldSelectors(items, baseUrl, fields) {
    const item = items.find(candidate => cleanText(candidate.textContent).length >= 20)
    if (!item) return {}
    const firstField = fields[0] || {}
    return {
        titleSelector: relativeSelector(item, bestTitleNode(item, firstField.title || "")),
        descriptionSelector: relativeSelector(item, bestDescriptionNode(item, firstField.title || "")),
        urlSelector: relativeSelector(item, bestUrlNode(item, firstField.title || "", baseUrl)),
        imageSelector: relativeSelector(item, bestImageNode(item)),
        dateSelector: relativeSelector(item, bestDateNode(item)),
    }
}

function extractFields(element, baseUrl, titleCandidate) {
    const title = titleCandidate.text
    return {
        title,
        description: bestDescription(element, title),
        url: titleCandidate.url || bestLink(element, title, baseUrl),
        date: bestDate(element),
        image: bestImage(element, baseUrl),
    }
}

function extractAllFields(items, baseUrl) {
    const titles = pickTitleCandidates(items, baseUrl)
    return items.map((item, index) => extractFields(item, baseUrl, titles[index]))
}

function firstTextBySelector(element, selector) {
    if (!selector) return ""
    const node = element.matches(selector) ? element : element.querySelector(selector)
    return cleanText(node?.textContent || "")
}

function firstUrlBySelector(element, selector, baseUrl) {
    if (!selector) return ""
    const node = element.matches(selector) ? element : element.querySelector(selector)
    const value = node?.getAttribute("href") || ""
    return absoluteUrl(value, baseUrl)
}

function firstImageBySelector(element, selector, baseUrl) {
    if (!selector) return ""
    const node = element.matches(selector) ? element : element.querySelector(selector)
    const value = imageSource(node)
    return absoluteUrl(value, baseUrl)
}

function firstDateBySelector(element, selector) {
    if (!selector) return ""
    const node = element.matches(selector) ? element : element.querySelector(selector)
    return cleanText(node?.getAttribute("datetime") || node?.textContent || "")
}

function imageSource(node) {
    if (!node) return ""
    const attribute =
        node.getAttribute("data-src") ||
        node.getAttribute("data-lazy-src") ||
        node.getAttribute("data-original") ||
        node.getAttribute("src") ||
        ""
    if (attribute && !attribute.startsWith("data:")) return attribute
    const style = node.getAttribute("style") || ""
    return style.match(/background-image\s*:\s*url\(\s*['"]?([^'")\s]+)['"]?\s*\)/i)?.[1] || ""
}

function selectorMatchesItem(item, selector) {
    try {
        return item.matches(selector) || Boolean(item.querySelector(selector))
    } catch {
        return false
    }
}

function normalizeSelectorForItems(items, selector) {
    const value = selector.trim()
    const matchingItems = items.filter(item => selectorMatchesItem(item, value))
    const isInspectorPath = value.includes("#") || /:nth-(?:child|of-type)\(/.test(value)
    if (!value || matchingItems.length === items.length || !isInspectorPath) return value

    try {
        const matchingNode = Array.from(items[0]?.ownerDocument.querySelectorAll(value) || []).find(node =>
            items.some(item => item === node || item.contains(node))
        )
        const item = items.find(candidate => candidate === matchingNode || candidate.contains(matchingNode))
        return item && matchingNode ? relativeSelector(item, matchingNode) : value
    } catch {
        return value
    }
}

function normalizeManualSelectors(items, selectors) {
    return Object.fromEntries(Object.entries(selectors).map(([field, selector]) => [field, normalizeSelectorForItems(items, selector)]))
}

function extractManualFields(items, baseUrl, selectors) {
    const fallbackFields = extractAllFields(items, baseUrl)
    return items.map((item, index) => ({
        title: firstTextBySelector(item, selectors.titleSelector) || fallbackFields[index].title,
        description: firstTextBySelector(item, selectors.descriptionSelector) || fallbackFields[index].description,
        url: firstUrlBySelector(item, selectors.urlSelector, baseUrl) || fallbackFields[index].url,
        date: firstDateBySelector(item, selectors.dateSelector) || fallbackFields[index].date,
        image: firstImageBySelector(item, selectors.imageSelector, baseUrl) || fallbackFields[index].image,
    }))
}

function directChildItems(container) {
    const children = Array.from(container.children || [])
    const likelyChildren = children.filter(isLikelyArticleItem)
    if (likelyChildren.length > 1) return likelyChildren

    const signatureCounts = new Map()
    for (const child of children) {
        const sig = signature(child)
        signatureCounts.set(sig, (signatureCounts.get(sig) || 0) + 1)
    }
    return children.filter(child => signatureCounts.get(signature(child)) > 1 && cleanText(child.textContent).length >= 20)
}

function itemsFromManualSelector(document, itemSelector) {
    const matches = Array.from(document.querySelectorAll(itemSelector))
    if (matches.length !== 1) return { items: matches, selector: itemSelector, detection: "direct" }

    const group = findCardGroupFromSelection(matches[0], document.baseURI)
    if (group) {
        return { items: group.items, selector: group.selector, detection: "sample" }
    }

    const childItems = directChildItems(matches[0])
    if (childItems.length < 2) return { items: matches, selector: itemSelector, detection: "direct" }

    const firstChild = childItems[0]
    const childSelector = firstChild.classList.length > 0 ? selectorForSimilar(firstChild) : firstChild.localName
    return {
        items: childItems,
        selector: `${itemSelector} > ${childSelector}`,
        detection: "container",
    }
}

function normalizeFieldValue(value) {
    return String(value || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLocaleLowerCase()
}

function findRepeatedTitle(fields) {
    const seen = new Set()
    for (const field of fields) {
        const title = normalizeFieldValue(field.title)
        if (!title) continue
        if (seen.has(title)) return field.title
        seen.add(title)
    }
    return undefined
}

function dedupeFields(fields) {
    const seen = new Set()
    const unique = []
    for (const field of fields) {
        const key = normalizeFieldValue(field.url) || normalizeFieldValue(field.title)
        if (!key || seen.has(key)) continue
        seen.add(key)
        unique.push(field)
    }
    return unique
}

function findCardGroupFromSelection(selected, baseUrl) {
    let node = selected
    while (node && node.nodeType === 1 && node !== node.ownerDocument.body && node !== node.ownerDocument.documentElement) {
        const parent = node.parentElement
        if (parent) {
            const { siblings: candidates, sharedClasses } = repeatedSiblings(node)
            const siblings = candidates.filter(child => isLikelyArticleItem(child) && !isCallToAction(child))
            if (siblings.length > 1) {
                const titles = pickTitleCandidates(siblings.slice(0, 20), baseUrl)
                const uniqueTitles = new Set(titles.map(title => normalizeFieldValue(title.text)).filter(Boolean))
                const withUrls = titles.filter(title => title.url).length
                if (uniqueTitles.size > 1 && withUrls > 1) {
                    return {
                        items: siblings,
                        selector: scopedGroupSelector(parent, siblings, sharedClasses),
                    }
                }
            }
        }
        node = parent
    }
    return null
}

async function handleLoad(req, res) {
    const { url } = await readJson(req)
    const normalizedUrl = normalizeUrl(url)
    const page = await fetchPage(normalizedUrl)
    sendJson(res, 200, {
        finalUrl: page.finalUrl,
        html: injectSelector(page.html, page.finalUrl),
    })
}

async function handleExtract(req, res) {
    const { url, selector } = await readJson(req)
    const normalizedUrl = normalizeUrl(url)
    if (!selector) throw new Error("Missing selector.")
    const page = await fetchPage(normalizedUrl)
    const dom = new JSDOM(page.html)
    const document = dom.window.document
    const selected = document.querySelector(selector)
    if (!selected) {
        sendJson(res, 422, { error: "La zone sélectionnée n'existe plus sur la page. Recharge-la puis sélectionne une carte d'actualité." })
        return
    }

    const group = findCardGroupFromSelection(selected, page.finalUrl)
    if (!group) {
        sendJson(res, 422, {
            error: "La zone sélectionnée ne contient pas plusieurs cartes d'actualité semblables. Sélectionne une carte complète dans la liste voulue.",
        })
        return
    }

    const fields = dedupeFields(extractAllFields(group.items.slice(0, 30), page.finalUrl)).slice(0, 20)
    const repeatedTitle = findRepeatedTitle(fields)
    if (repeatedTitle) {
        sendJson(res, 422, {
            error: `Titre répété détecté: "${repeatedTitle}". La zone sélectionnée n'est pas une carte d'article valide. Sélectionne un élément plus précis qui contient un titre unique par ligne.`,
        })
        return
    }

    sendJson(res, 200, {
        count: fields.length,
        similarSelector: group.selector,
        usedFallback: false,
        fieldSelectors: inferFieldSelectors(group.items, page.finalUrl, fields),
        fields,
    })
}

async function handleManualExtract(req, res) {
    const {
        url,
        itemSelector,
        titleSelector = "",
        descriptionSelector = "",
        urlSelector = "",
        imageSelector = "",
        dateSelector = "",
    } = await readJson(req)
    const normalizedUrl = normalizeUrl(url)
    if (!itemSelector) throw new Error("Missing item selector.")
    const page = await fetchPage(normalizedUrl)
    const dom = new JSDOM(page.html)
    const document = dom.window.document
    const manualItems = itemsFromManualSelector(document, itemSelector)
    const items = manualItems.items
    const selectors = normalizeManualSelectors(items, {
        titleSelector,
        descriptionSelector,
        urlSelector,
        imageSelector,
        dateSelector,
    })
    const fields = dedupeFields(extractManualFields(items.slice(0, 30), page.finalUrl, selectors)).slice(0, 20)

    sendJson(res, 200, {
        count: items.length,
        similarSelector: manualItems.selector,
        usedFallback: manualItems.detection !== "direct",
        detection: manualItems.detection,
        fieldSelectors: {
            titleSelector: selectors.titleSelector || inferFieldSelectors(items, page.finalUrl, fields).titleSelector,
            descriptionSelector: selectors.descriptionSelector || inferFieldSelectors(items, page.finalUrl, fields).descriptionSelector,
            urlSelector: selectors.urlSelector || inferFieldSelectors(items, page.finalUrl, fields).urlSelector,
            imageSelector: selectors.imageSelector || inferFieldSelectors(items, page.finalUrl, fields).imageSelector,
            dateSelector: selectors.dateSelector || inferFieldSelectors(items, page.finalUrl, fields).dateSelector,
        },
        fields,
    })
}

export function createScraperServer() {
    return http.createServer(async (req, res) => {
        try {
            if (req.method === "OPTIONS") {
                res.writeHead(204, corsHeaders)
                res.end()
                return
            }

            const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`)
            if (req.method === "GET" && url.pathname === "/api/health") {
                sendJson(res, 200, { ok: true })
                return
            }
            if (req.method === "POST" && url.pathname === "/api/load") {
                await handleLoad(req, res)
                return
            }
            if (req.method === "POST" && url.pathname === "/api/extract") {
                await handleExtract(req, res)
                return
            }
            if (req.method === "POST" && url.pathname === "/api/manual-extract") {
                await handleManualExtract(req, res)
                return
            }

            sendJson(res, 404, { error: "Not found." })
        } catch (error) {
            sendJson(res, 500, { error: error instanceof Error ? error.message : "Unexpected scraper error." })
        }
    })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    createScraperServer().listen(port, "127.0.0.1", () => {
        console.log(`Ayn local scraper service listening on http://127.0.0.1:${port}`)
    })
}

export { bestDate, extractAllFields, findCardGroupFromSelection, normalizeManualSelectors }
