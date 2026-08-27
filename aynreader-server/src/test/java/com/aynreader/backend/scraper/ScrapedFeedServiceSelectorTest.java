package com.aynreader.backend.scraper;

import com.aynreader.backend.feed.parser.FeedParserResult.Entry;
import com.aynreader.backend.model.ScrapedFeedConfig;
import java.time.Instant;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Element;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

class ScrapedFeedServiceSelectorTest {

    @Test
    void usesTheSavedManualSelectorsBeforeAutomaticDetection() {
        ScrapedFeedConfig config = new ScrapedFeedConfig();
        config.setPageUrl("https://example.test/news");
        config.setTitleSelector(".chosen-title");
        config.setDescriptionSelector(".chosen-description");
        config.setUrlSelector("a.chosen-link");
        config.setImageSelector("img.chosen-image");
        config.setDateSelector("time.chosen-date");
        Element card =
                Jsoup.parse(
                                """
                                <article>
                                  <h2>Automatically detected title</h2>
                                  <a href="/automatic">Automatically detected link</a>
                                  <p>Automatically detected description</p>
                                  <span class="chosen-title">Edited title</span>
                                  <p class="chosen-description">Edited description</p>
                                  <a class="chosen-link" href="/edited">Edited link</a>
                                  <img class="chosen-image" data-src="/image.jpg">
                                  <time class="chosen-date" datetime="2026-07-31T09:30:00Z">31 July 2026</time>
                                </article>
                                """,
                                "https://example.test/news")
                        .selectFirst("article");

        Entry entry = new ScrapedFeedService(null, null, null, null).toEntry(card, config);

        Assertions.assertEquals("Edited title", entry.content().title());
        Assertions.assertEquals("Edited description", entry.content().content());
        Assertions.assertEquals("https://example.test/edited", entry.url());
        Assertions.assertEquals("https://example.test/edited", entry.guid());
        Assertions.assertEquals(
                "https://example.test/image.jpg", entry.content().media().thumbnailUrl());
        Assertions.assertEquals(Instant.parse("2026-07-31T09:30:00Z"), entry.published());
    }

    @Test
    void readsAnImageStoredInABackgroundStyle() {
        ScrapedFeedConfig config = new ScrapedFeedConfig();
        config.setPageUrl("https://example.test/news");
        Element card =
                Jsoup.parse(
                                "<article><h2>Title</h2><div style=\"background-image: url('/image.jpg')\"></div></article>",
                                "https://example.test/news")
                        .selectFirst("article");

        Entry entry = new ScrapedFeedService(null, null, null, null).toEntry(card, config);

        Assertions.assertEquals(
                "https://example.test/image.jpg", entry.content().media().thumbnailUrl());
    }
}
