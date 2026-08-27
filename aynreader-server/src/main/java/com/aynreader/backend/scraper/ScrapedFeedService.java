package com.aynreader.backend.scraper;

import com.aynreader.backend.Digests;
import com.aynreader.backend.dao.ScrapedFeedConfigDAO;
import com.aynreader.backend.dao.UnitOfWork;
import com.aynreader.backend.feed.FeedRefreshIntervalCalculator;
import com.aynreader.backend.feed.FeedRefreshWorker.FeedRefreshWorkerResult;
import com.aynreader.backend.feed.parser.FeedParserResult;
import com.aynreader.backend.feed.parser.FeedParserResult.Content;
import com.aynreader.backend.feed.parser.FeedParserResult.Entry;
import com.aynreader.backend.feed.parser.FeedParserResult.Media;
import com.aynreader.backend.model.Feed;
import com.aynreader.backend.model.ScrapedFeedConfig;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.inject.Singleton;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.URI;
import java.text.Normalizer;
import java.time.DateTimeException;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.apache.commons.lang3.Strings;
import org.jsoup.Connection;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;

@Singleton
@RequiredArgsConstructor
@Slf4j
public class ScrapedFeedService {

    private static final String USER_AGENT =
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
    private static final String READER_PROXY_PREFIX = "https://r.jina.ai/http://";
    private static final String LOCAL_BROWSER_SCRAPER_URL =
            StringUtils.defaultIfBlank(
                    System.getenv("SCRAPER_BROWSER_SERVICE_URL"), "http://127.0.0.1:3000/api/load");
    private static final String SCRAPER_PROXY_URL = System.getenv("SCRAPER_PROXY_URL");

    private static final Map<String, Integer> MONTHS =
            Map.ofEntries(
                    Map.entry("janvier", 1),
                    Map.entry("janv", 1),
                    Map.entry("fevrier", 2),
                    Map.entry("fevr", 2),
                    Map.entry("mars", 3),
                    Map.entry("avril", 4),
                    Map.entry("avr", 4),
                    Map.entry("mai", 5),
                    Map.entry("juin", 6),
                    Map.entry("juillet", 7),
                    Map.entry("juil", 7),
                    Map.entry("aout", 8),
                    Map.entry("septembre", 9),
                    Map.entry("sept", 9),
                    Map.entry("octobre", 10),
                    Map.entry("oct", 10),
                    Map.entry("novembre", 11),
                    Map.entry("nov", 11),
                    Map.entry("decembre", 12),
                    Map.entry("dec", 12),
                    Map.entry("january", 1),
                    Map.entry("february", 2),
                    Map.entry("march", 3),
                    Map.entry("april", 4),
                    Map.entry("may", 5),
                    Map.entry("june", 6),
                    Map.entry("july", 7),
                    Map.entry("august", 8),
                    Map.entry("september", 9),
                    Map.entry("october", 10),
                    Map.entry("november", 11),
                    Map.entry("december", 12));

    private final ScrapedFeedConfigDAO scrapedFeedConfigDAO;
    private final UnitOfWork unitOfWork;
    private final FeedRefreshIntervalCalculator refreshIntervalCalculator;
    private final ObjectMapper objectMapper;

    public ScrapedFeedConfig findConfig(Feed feed) {
        if (feed.getId() == null) {
            return null;
        }
        return unitOfWork.call(() -> scrapedFeedConfigDAO.findByFeedId(feed.getId()));
    }

    public FeedRefreshWorkerResult refresh(Feed feed, ScrapedFeedConfig config) throws IOException {
        Document document = fetchDocument(config.getPageUrl());
        Elements items = selectItems(document, config.getItemSelector());
        if (items.isEmpty()) {
            Document fallbackDocument = fetchFallbackDocument(config.getPageUrl());
            if (fallbackDocument != null) {
                items = selectItems(fallbackDocument, config.getItemSelector());
            }
        }
        List<Entry> entries =
                items.stream()
                        .limit(100)
                        .filter(item -> !isCallToAction(item))
                        .map(item -> toEntry(item, config))
                        .filter(entry -> StringUtils.isNotBlank(entry.content().title()))
                        .toList();
        log.debug(
                "scraped {} items and {} entries from {} with selector {}",
                items.size(),
                entries.size(),
                config.getPageUrl(),
                config.getItemSelector());

        Instant now = Instant.now();
        Instant lastPublishedDate =
                entries.stream().map(Entry::published).max(Instant::compareTo).orElse(now);

        feed.setUrlAfterRedirect(null);
        feed.setLink(config.getPageUrl());
        feed.setLastModifiedHeader(null);
        feed.setEtagHeader(null);
        feed.setLastContentHash(Digests.sha1Hex(entries.toString()));
        feed.setLastPublishedDate(lastPublishedDate);
        feed.setAverageEntryInterval(Duration.ofHours(24).toMillis());
        feed.setLastEntryDate(lastPublishedDate);
        feed.setErrorCount(0);
        feed.setMessage(null);
        feed.setDisabledUntil(
                refreshIntervalCalculator.onFetchSuccess(
                        lastPublishedDate, feed.getAverageEntryInterval(), Duration.ZERO));

        return new FeedRefreshWorkerResult(feed, entries);
    }

    private Document fetchDocument(String pageUrl) throws IOException {
        Document browserDocument = fetchBrowserDocument(pageUrl);
        if (browserDocument != null) {
            return browserDocument;
        }

        Connection.Response response =
                withProxy(Jsoup.connect(pageUrl))
                        .userAgent(USER_AGENT)
                        .header(
                                "Accept",
                                "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8")
                        .header("Accept-Language", "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7")
                        .header("Cache-Control", "no-cache")
                        .header("Pragma", "no-cache")
                        .header(
                                "Sec-CH-UA",
                                "\"Not/A)Brand\";v=\"8\", \"Chromium\";v=\"126\", \"Google Chrome\";v=\"126\"")
                        .header("Sec-CH-UA-Mobile", "?0")
                        .header("Sec-CH-UA-Platform", "\"macOS\"")
                        .header("Sec-Fetch-Dest", "document")
                        .header("Sec-Fetch-Mode", "navigate")
                        .header("Sec-Fetch-Site", "none")
                        .header("Sec-Fetch-User", "?1")
                        .header("Upgrade-Insecure-Requests", "1")
                        .referrer(pageUrl)
                        .timeout(20000)
                        .ignoreHttpErrors(true)
                        .execute();
        if (response.statusCode() >= 200 && response.statusCode() < 400) {
            return response.parse();
        }
        if (List.of(401, 403, 429).contains(response.statusCode())) {
            Document fallbackDocument = fetchFallbackDocument(pageUrl);
            if (fallbackDocument != null) {
                return fallbackDocument;
            }
        }
        throw new IOException("HTTP " + response.statusCode());
    }

    private Document fetchBrowserDocument(String pageUrl) {
        try {
            Connection.Response response =
                    Jsoup.connect(LOCAL_BROWSER_SCRAPER_URL)
                            .method(Connection.Method.POST)
                            .header("Content-Type", "application/json")
                            .requestBody(objectMapper.writeValueAsString(Map.of("url", pageUrl)))
                            .timeout(30000)
                            .ignoreContentType(true)
                            .ignoreHttpErrors(true)
                            .execute();
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                return null;
            }
            JsonNode payload = objectMapper.readTree(response.body());
            String html = payload.path("html").asText("");
            String finalUrl = payload.path("finalUrl").asText(pageUrl);
            return StringUtils.isBlank(html) ? null : Jsoup.parse(html, finalUrl);
        } catch (Exception e) {
            log.debug("Local browser scraper unavailable for {}: {}", pageUrl, e.getMessage());
            return null;
        }
    }

    private Document fetchFallbackDocument(String pageUrl) throws IOException {
        Document readerDocument = fetchReaderDocument(pageUrl);
        if (readerDocument != null && !readerDocument.select("article.reader-card").isEmpty()) {
            return readerDocument;
        }
        return null;
    }

    private Document fetchReaderDocument(String pageUrl) throws IOException {
        Connection.Response readerResponse =
                withProxy(Jsoup.connect(READER_PROXY_PREFIX + pageUrl))
                        .userAgent(USER_AGENT)
                        .header("Accept", "text/plain,text/markdown,*/*")
                        .header("Accept-Language", "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7")
                        .timeout(20000)
                        .ignoreContentType(true)
                        .ignoreHttpErrors(true)
                        .execute();
        if (readerResponse.statusCode() >= 200 && readerResponse.statusCode() < 400) {
            return parseReaderMarkdown(readerResponse.body(), pageUrl);
        }
        return null;
    }

    private Connection withProxy(Connection connection) {
        if (StringUtils.isBlank(SCRAPER_PROXY_URL)) {
            return connection;
        }
        try {
            URI proxyUri = URI.create(SCRAPER_PROXY_URL);
            if (StringUtils.isBlank(proxyUri.getHost()) || proxyUri.getPort() < 1) {
                log.warn("Ignoring invalid SCRAPER_PROXY_URL {}", SCRAPER_PROXY_URL);
                return connection;
            }
            return connection.proxy(
                    new Proxy(
                            Proxy.Type.HTTP,
                            new InetSocketAddress(proxyUri.getHost(), proxyUri.getPort())));
        } catch (IllegalArgumentException e) {
            log.warn("Ignoring invalid SCRAPER_PROXY_URL {}", SCRAPER_PROXY_URL);
            return connection;
        }
    }

    private Document parseReaderMarkdown(String markdown, String pageUrl) {
        Document document = Document.createShell(pageUrl);
        Element main = document.body().appendElement("main");
        String pendingImage = "";
        for (String line : markdown.split("\\R")) {
            java.util.regex.Matcher image =
                    java.util.regex.Pattern.compile("!\\[[^\\]]*\\]\\((https?://[^)]+)\\)")
                            .matcher(line);
            if (image.find()) {
                pendingImage = image.group(1);
                continue;
            }

            java.util.regex.Matcher link =
                    java.util.regex.Pattern.compile("^\\[([^\\]]+)\\]\\((https?://[^)]+)\\)$")
                            .matcher(line.trim());
            if (!link.find()) {
                continue;
            }
            String text = StringUtils.normalizeSpace(link.group(1));
            String href = link.group(2);
            if (StringUtils.isBlank(text)
                    || Strings.CI.startsWith(text, "afficher")
                    || Strings.CI.startsWith(text, "switch cards")) {
                continue;
            }

            ReaderCardText cardText = splitReaderLinkText(text);
            Element article = main.appendElement("article").addClass("reader-card");
            Element anchor = article.appendElement("a").attr("href", href);
            if (StringUtils.isNotBlank(pendingImage)) {
                anchor.appendElement("img").attr("src", pendingImage).attr("alt", "");
            }
            anchor.appendElement("h2").text(cardText.title());
            if (StringUtils.isNotBlank(cardText.category())) {
                anchor.appendElement("p")
                        .addClass("reader-card__category")
                        .text(cardText.category());
            }
            if (StringUtils.isNotBlank(cardText.date())) {
                anchor.appendElement("time")
                        .attr("datetime", cardText.date())
                        .text(cardText.date());
            }
            pendingImage = "";
        }
        return document;
    }

    private Elements selectItems(Document document, String itemSelector) {
        Elements items = document.select(itemSelector);
        if (items.size() == 1) {
            Elements siblingItems = selectRepeatedSiblings(items.first());
            if (siblingItems.size() > 1) {
                return siblingItems;
            }

            Elements childItems = selectRepeatedChildren(items.first());
            if (childItems.size() > 1) {
                return childItems;
            }
        }
        if (!items.isEmpty()) {
            return items;
        }

        Elements readerCards = document.select("article.reader-card");
        if (!readerCards.isEmpty()) {
            log.debug(
                    "selector {} matched no items, using {} reader fallback cards",
                    itemSelector,
                    readerCards.size());
            return readerCards;
        }

        return document.select("article");
    }

    private Elements selectRepeatedSiblings(Element item) {
        if (item == null || item.parent() == null) {
            return new Elements();
        }
        Elements siblings = item.parent().children();
        if (siblings.size() < 2) {
            return new Elements();
        }

        String tagName = item.tagName();
        return new Elements(
                siblings.stream()
                        .filter(sibling -> Strings.CS.equals(sibling.tagName(), tagName))
                        .filter(
                                sibling ->
                                        StringUtils.length(
                                                        StringUtils.normalizeSpace(sibling.text()))
                                                >= 20)
                        .toList());
    }

    private Elements selectRepeatedChildren(Element container) {
        if (container == null) {
            return new Elements();
        }
        Elements children = container.children();
        if (children.size() < 2) {
            return new Elements();
        }

        String tagName = children.first().tagName();
        boolean sameTag =
                children.stream().allMatch(child -> Strings.CS.equals(child.tagName(), tagName));
        if (sameTag) {
            return children;
        }

        return new Elements(
                children.stream()
                        .filter(
                                child ->
                                        StringUtils.length(StringUtils.normalizeSpace(child.text()))
                                                >= 20)
                        .toList());
    }

    private ReaderCardText splitReaderLinkText(String text) {
        String date = extractDateText(text);
        String title =
                StringUtils.isBlank(date)
                        ? text
                        : StringUtils.normalizeSpace(StringUtils.substringBefore(text, date));
        String category = "";
        java.util.regex.Matcher categoryMatcher =
                java.util.regex.Pattern.compile(
                                "\\s+(produit|entreprise|securite|sécurité|recherche|actualites|actualités|adoption de l’ia|adoption de l'ia|product|company|security|research|safety|news|policy|developers)$",
                                java.util.regex.Pattern.CASE_INSENSITIVE)
                        .matcher(title);
        if (categoryMatcher.find()) {
            category = StringUtils.normalizeSpace(categoryMatcher.group(1));
            title = StringUtils.normalizeSpace(title.substring(0, categoryMatcher.start()));
        }
        return new ReaderCardText(StringUtils.defaultIfBlank(title, text), category, date);
    }

    Entry toEntry(Element item, ScrapedFeedConfig config) {
        String title =
                StringUtils.defaultIfBlank(
                        findTextBySelector(item, config.getTitleSelector()), findTitle(item));
        String extractedUrl =
                StringUtils.defaultIfBlank(
                        findUrlBySelector(item, config.getUrlSelector()), findUrl(item));
        String url = StringUtils.defaultIfBlank(extractedUrl, config.getPageUrl());
        String image =
                StringUtils.defaultIfBlank(
                        findImageBySelector(item, config.getImageSelector()),
                        findImage(item, config.getPageUrl()));
        Instant published =
                StringUtils.isBlank(config.getDateSelector())
                        ? findPublishedDate(item)
                        : parseDate(findDateBySelector(item, config.getDateSelector()));
        if (published == null) {
            published = findPublishedDate(item);
        }
        String description =
                StringUtils.defaultIfBlank(
                        findTextBySelector(item, config.getDescriptionSelector()),
                        findDescription(item, title));
        String guid = StringUtils.defaultIfBlank(extractedUrl, Digests.sha1Hex(item.text()));

        Content content =
                new Content(
                        StringUtils.abbreviate(title, 2048),
                        description,
                        null,
                        null,
                        null,
                        StringUtils.isBlank(image) ? null : new Media(null, image, null, null));
        return new FeedParserResult.Entry(guid, url, published, content);
    }

    private String findTextBySelector(Element item, String selector) {
        if (StringUtils.isBlank(selector)) {
            return "";
        }
        return selectIncludingSelf(item, selector).stream()
                .map(Element::text)
                .map(StringUtils::normalizeSpace)
                .filter(StringUtils::isNotBlank)
                .findFirst()
                .orElse("");
    }

    private String findUrlBySelector(Element item, String selector) {
        if (StringUtils.isBlank(selector)) {
            return "";
        }
        return selectIncludingSelf(item, selector).stream()
                .map(
                        element ->
                                StringUtils.defaultIfBlank(
                                        element.attr("abs:href"), element.attr("href")))
                .filter(StringUtils::isNotBlank)
                .findFirst()
                .orElse("");
    }

    private String findImageBySelector(Element item, String selector) {
        if (StringUtils.isBlank(selector)) {
            return "";
        }
        return selectIncludingSelf(item, selector).stream()
                .map(this::findImageUrl)
                .filter(StringUtils::isNotBlank)
                .findFirst()
                .orElse("");
    }

    private String findDateBySelector(Element item, String selector) {
        if (StringUtils.isBlank(selector)) {
            return "";
        }
        return selectIncludingSelf(item, selector).stream()
                .map(
                        element ->
                                StringUtils.defaultIfBlank(
                                        element.attr("datetime"), element.text()))
                .map(StringUtils::normalizeSpace)
                .filter(StringUtils::isNotBlank)
                .findFirst()
                .orElse("");
    }

    private String findTitle(Element item) {
        String heading =
                selectIncludingSelf(item, "h1,h2,h3,h4,[class*=title],[class*=headline]").stream()
                        .map(Element::text)
                        .filter(StringUtils::isNotBlank)
                        .findFirst()
                        .orElse(null);
        if (StringUtils.isNotBlank(heading)) {
            return heading;
        }
        String linkText =
                selectIncludingSelf(item, "a[href]").stream()
                        .map(Element::text)
                        .filter(StringUtils::isNotBlank)
                        .findFirst()
                        .orElse(null);
        return StringUtils.defaultIfBlank(linkText, StringUtils.abbreviate(item.text(), 140));
    }

    private String findUrl(Element item) {
        String href =
                selectIncludingSelf(item, "a[href]").stream()
                        .filter(link -> StringUtils.isNotBlank(link.attr("href")))
                        .filter(link -> !link.attr("href").contains("/vote?"))
                        .filter(
                                link ->
                                        StringUtils.isNotBlank(link.text())
                                                || StringUtils.isNotBlank(link.attr("href")))
                        .map(link -> link.attr("abs:href"))
                        .filter(StringUtils::isNotBlank)
                        .findFirst()
                        .orElse("");
        return href;
    }

    private String findImage(Element item, String pageUrl) {
        return selectIncludingSelf(item, "img,[style*=background-image]").stream()
                .map(this::findImageUrl)
                .filter(StringUtils::isNotBlank)
                .findFirst()
                .orElse(null);
    }

    private String findImageUrl(Element element) {
        for (String attribute : List.of("data-src", "data-lazy-src", "data-original", "src")) {
            String value = element.attr(attribute);
            if (StringUtils.isNotBlank(value)) {
                return StringUtils.defaultIfBlank(element.absUrl(attribute), value);
            }
        }
        java.util.regex.Matcher backgroundImage =
                java.util.regex.Pattern.compile(
                                "background-image\\s*:\\s*url\\(\\s*['\\\"]?([^'\\\")\\s]+)['\\\"]?\\s*\\)",
                                java.util.regex.Pattern.CASE_INSENSITIVE)
                        .matcher(element.attr("style"));
        if (backgroundImage.find()) {
            String value = backgroundImage.group(1);
            try {
                return URI.create(element.baseUri()).resolve(value).toString();
            } catch (IllegalArgumentException ignored) {
                return value;
            }
        }
        return "";
    }

    private boolean isCallToAction(Element item) {
        String text = normalizeText(item.text());
        if (text.matches(
                ".*\\b(newsletter|subscribe|subscription|sign up|register|s'abonner|inscrivez|inscription|create an account)\\b.*")) {
            return true;
        }
        return selectIncludingSelf(item, "a[href]").stream()
                .map(link -> link.attr("href"))
                .anyMatch(
                        href ->
                                href.matches(
                                        ".*\\/(user\\/register|register|subscribe|newsletter)([/?#].*)?$"));
    }

    private Instant findPublishedDate(Element item) {
        String value =
                selectIncludingSelf(item, "time[datetime],[datetime]").stream()
                        .map(
                                element ->
                                        StringUtils.defaultIfBlank(
                                                element.attr("datetime"), element.text()))
                        .filter(StringUtils::isNotBlank)
                        .findFirst()
                        .orElse(null);
        Instant parsed = parseDate(value);
        if (parsed != null) {
            return parsed;
        }

        parsed =
                selectIncludingSelf(
                                item, "[class*=date],[class*=time],[class*=meta],[class*=detail]")
                        .stream()
                        .map(Element::text)
                        .map(this::extractDateText)
                        .filter(StringUtils::isNotBlank)
                        .map(this::parseDate)
                        .filter(date -> date != null)
                        .findFirst()
                        .orElse(null);
        if (parsed != null) {
            return parsed;
        }

        parsed = parseDate(extractDateText(item.text()));
        if (parsed != null) {
            return parsed;
        }
        return Instant.now();
    }

    private String findDescription(Element item, String title) {
        String dateText = extractDateText(item.text());
        String paragraph =
                item.select("p").stream()
                        .map(Element::text)
                        .filter(
                                text ->
                                        StringUtils.isNotBlank(text)
                                                && !Strings.CS.equals(text, title))
                        .filter(text -> StringUtils.isBlank(extractDateText(text)))
                        .findFirst()
                        .orElse("");
        if (StringUtils.isNotBlank(paragraph)) {
            return paragraph;
        }
        String description = item.text().replace(title, "").replace(dateText, "");
        for (Element link : selectIncludingSelf(item, "a[href]")) {
            description = description.replace(link.text(), "");
        }
        return StringUtils.normalizeSpace(description);
    }

    private Elements selectIncludingSelf(Element item, String cssQuery) {
        Elements elements = new Elements();
        if (item.is(cssQuery)) {
            elements.add(item);
        }
        elements.addAll(item.select(cssQuery));
        return elements;
    }

    private String extractDateText(String value) {
        String text = normalizeText(value);
        String monthAlternatives = String.join("|", MONTHS.keySet());
        List<String> patterns =
                List.of(
                        "\\b\\d{1,2}\\s+(?:"
                                + monthAlternatives
                                + ")\\.?\\s+\\d{4}(?:\\s+(?:a|at)?\\s*\\d{1,2}[:h]\\d{2})?\\b",
                        "\\b\\d{1,2}[\\/.-]\\d{1,2}[\\/.-]\\d{2,4}(?:\\s+\\d{1,2}[:h]\\d{2})?\\b",
                        "\\b\\d{4}-\\d{2}-\\d{2}(?:[T\\s]\\d{1,2}:\\d{2}(?::\\d{2})?)?\\b",
                        "\\b(?:aujourd'hui|hier|avant-hier|today|yesterday|the day before yesterday)\\b",
                        "\\b(?:il y a\\s+\\d+\\s+(?:minutes?|heures?|hours?|jours?|days?|semaines?|weeks?)|\\d+\\s+(?:minutes?|hours?|days?|weeks?)\\s+ago)\\b");
        return patterns.stream()
                .map(
                        pattern ->
                                java.util.regex.Pattern.compile(
                                                pattern, java.util.regex.Pattern.CASE_INSENSITIVE)
                                        .matcher(text))
                .filter(java.util.regex.Matcher::find)
                .map(java.util.regex.Matcher::group)
                .findFirst()
                .orElse("");
    }

    private Instant parseDate(String value) {
        return parseDate(value, Instant.now());
    }

    static Instant parseDate(String value, Instant referenceTime) {
        String raw = StringUtils.trimToEmpty(value);
        if (StringUtils.isBlank(raw)) {
            return null;
        }
        try {
            return Instant.parse(raw);
        } catch (DateTimeParseException ignored) {
            // Try looser website date formats below.
        }
        try {
            return ZonedDateTime.parse(raw, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant();
        } catch (DateTimeParseException ignored) {
            // Try looser website date formats below.
        }

        String normalized = normalizeText(raw).replaceAll("\\.$", "");
        Instant relativeDate = parseRelativeDate(normalized, referenceTime);
        if (relativeDate != null) {
            return relativeDate;
        }

        java.util.regex.Matcher iso =
                java.util.regex.Pattern.compile(
                                "\\b(\\d{4})-(\\d{2})-(\\d{2})(?:[t\\s](\\d{1,2}):(\\d{2})(?::\\d{2})?)?\\b")
                        .matcher(normalized);
        if (iso.find()) {
            return toInstant(iso.group(1), iso.group(2), iso.group(3), iso.group(4), iso.group(5));
        }

        java.util.regex.Matcher numeric =
                java.util.regex.Pattern.compile(
                                "\\b(\\d{1,2})[\\/.-](\\d{1,2})[\\/.-](\\d{2,4})(?:\\s+(\\d{1,2})[:h](\\d{2}))?\\b")
                        .matcher(normalized);
        if (numeric.find()) {
            return toInstant(
                    normalizeYear(numeric.group(3)),
                    numeric.group(2),
                    numeric.group(1),
                    numeric.group(4),
                    numeric.group(5));
        }

        String monthAlternatives = String.join("|", MONTHS.keySet());
        java.util.regex.Matcher textDate =
                java.util.regex.Pattern.compile(
                                "\\b(\\d{1,2})\\s+("
                                        + monthAlternatives
                                        + ")\\.?\\s+(\\d{4})(?:\\s+(?:a|at)?\\s*(\\d{1,2})[:h](\\d{2}))?\\b",
                                java.util.regex.Pattern.CASE_INSENSITIVE)
                        .matcher(normalized);
        if (textDate.find()) {
            return toInstant(
                    textDate.group(3),
                    String.valueOf(MONTHS.get(textDate.group(2).toLowerCase(Locale.ROOT))),
                    textDate.group(1),
                    textDate.group(4),
                    textDate.group(5));
        }
        return null;
    }

    private static Instant parseRelativeDate(String normalized, Instant referenceTime) {
        Instant startOfToday =
                referenceTime.atZone(ZoneOffset.UTC).truncatedTo(ChronoUnit.DAYS).toInstant();
        if (normalized.equals("aujourd'hui") || normalized.equals("today")) {
            return startOfToday;
        }
        if (normalized.equals("hier") || normalized.equals("yesterday")) {
            return startOfToday.minus(1, ChronoUnit.DAYS);
        }
        if (normalized.equals("avant-hier") || normalized.equals("the day before yesterday")) {
            return startOfToday.minus(2, ChronoUnit.DAYS);
        }

        java.util.regex.Matcher french =
                java.util.regex.Pattern.compile(
                                "\\bil y a\\s+(\\d+)\\s+(minute|minutes|heure|heures|jour|jours|semaine|semaines)\\b")
                        .matcher(normalized);
        if (french.find()) {
            return subtractRelativeTime(referenceTime, french.group(1), french.group(2));
        }

        java.util.regex.Matcher english =
                java.util.regex.Pattern.compile(
                                "\\b(\\d+)\\s+(minute|minutes|hour|hours|day|days|week|weeks)\\s+ago\\b")
                        .matcher(normalized);
        if (english.find()) {
            return subtractRelativeTime(referenceTime, english.group(1), english.group(2));
        }
        return null;
    }

    private static Instant subtractRelativeTime(Instant referenceTime, String amount, String unit) {
        long value;
        try {
            value = Long.parseLong(amount);
        } catch (NumberFormatException e) {
            return null;
        }
        return switch (unit) {
            case "minute", "minutes" -> referenceTime.minus(value, ChronoUnit.MINUTES);
            case "heure", "heures", "hour", "hours" -> referenceTime.minus(value, ChronoUnit.HOURS);
            case "jour", "jours", "day", "days" -> referenceTime.minus(value, ChronoUnit.DAYS);
            case "semaine", "semaines", "week", "weeks" ->
                    referenceTime.minus(value, ChronoUnit.WEEKS);
            default -> null;
        };
    }

    private static String normalizeText(String value) {
        return Normalizer.normalize(StringUtils.normalizeSpace(value), Normalizer.Form.NFD)
                .replaceAll("\\p{M}", "")
                .replace('’', '\'')
                .toLowerCase(Locale.ROOT);
    }

    private static String normalizeYear(String value) {
        if (value.length() == 2) {
            int year = Integer.parseInt(value);
            return (year >= 70 ? "19" : "20") + value;
        }
        return value;
    }

    private static Instant toInstant(String year, String month, String day) {
        return toInstant(year, month, day, null, null);
    }

    private static Instant toInstant(
            String year, String month, String day, String hour, String minute) {
        try {
            return LocalDate.of(
                            Integer.parseInt(year), Integer.parseInt(month), Integer.parseInt(day))
                    .atTime(
                            StringUtils.isBlank(hour) ? 0 : Integer.parseInt(hour),
                            StringUtils.isBlank(minute) ? 0 : Integer.parseInt(minute))
                    .toInstant(ZoneOffset.UTC);
        } catch (DateTimeException | NumberFormatException e) {
            return null;
        }
    }

    private record ReaderCardText(String title, String category, String date) {}
}
