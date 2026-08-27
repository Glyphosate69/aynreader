package com.aynreader.backend.feed;

import com.aynreader.AynReaderConfiguration;
import com.aynreader.backend.feed.FeedFetcher.FeedFetcherResult;
import com.aynreader.backend.feed.FeedRefreshWorker.FeedRefreshWorkerResult;
import com.aynreader.backend.feed.parser.FeedParserResult;
import com.aynreader.backend.feed.parser.FeedParserResult.Content;
import com.aynreader.backend.feed.parser.FeedParserResult.Entry;
import com.aynreader.backend.model.Feed;
import com.aynreader.backend.scraper.ScrapedFeedService;
import com.codahale.metrics.MetricRegistry;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Answers;
import org.mockito.Mock;
import org.mockito.Mockito;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class FeedRefreshWorkerTest {

    @Mock private FeedRefreshIntervalCalculator refreshIntervalCalculator;
    @Mock private FeedFetcher fetcher;
    @Mock private ScrapedFeedService scrapedFeedService;

    @Mock(answer = Answers.RETURNS_DEEP_STUBS)
    private AynReaderConfiguration config;

    private FeedRefreshWorker worker;

    @BeforeEach
    void init() {
        worker =
                new FeedRefreshWorker(
                        refreshIntervalCalculator,
                        fetcher,
                        scrapedFeedService,
                        config,
                        new MetricRegistry());
    }

    @Test
    void limitsGoogleNewsFeedsToTenEntries() throws Exception {
        Mockito.when(config.database().cleanup().maxFeedCapacity()).thenReturn(0);
        Mockito.when(config.database().cleanup().entriesMaxAge()).thenReturn(Duration.ZERO);

        Feed feed = new Feed();
        feed.setUrl("https://news.google.com/rss/search?q=incendie&hl=fr&gl=FR&ceid=FR:fr");
        List<Entry> entries =
                IntStream.range(0, 12)
                        .mapToObj(
                                i ->
                                        new Entry(
                                                "guid-" + i,
                                                "https://news.google.com/rss/articles/CBMi" + i,
                                                Instant.EPOCH,
                                                new Content(
                                                        "title-" + i,
                                                        "content",
                                                        null,
                                                        null,
                                                        null,
                                                        null)))
                        .toList();
        FeedParserResult parserResult =
                new FeedParserResult(
                        "feed", "link", null, Instant.EPOCH, null, Instant.EPOCH, entries);

        Mockito.when(scrapedFeedService.findConfig(feed)).thenReturn(null);
        Mockito.when(fetcher.fetch(feed.getUrl(), false, null, null, null, null))
                .thenReturn(
                        new FeedFetcherResult(
                                parserResult, feed.getUrl(), null, null, "hash", Duration.ZERO));
        Mockito.when(
                        refreshIntervalCalculator.onFetchSuccess(
                                parserResult.lastPublishedDate(),
                                parserResult.averageEntryInterval(),
                                Duration.ZERO))
                .thenReturn(Instant.EPOCH);

        FeedRefreshWorkerResult result = worker.update(feed);

        Assertions.assertEquals(10, result.entries().size());
    }
}
