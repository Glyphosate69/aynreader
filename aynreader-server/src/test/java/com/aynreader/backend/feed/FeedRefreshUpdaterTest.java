package com.aynreader.backend.feed;

import com.aynreader.backend.dao.FeedSubscriptionDAO;
import com.aynreader.backend.dao.UnitOfWork;
import com.aynreader.backend.feed.parser.FeedParserResult.Content;
import com.aynreader.backend.feed.parser.FeedParserResult.Entry;
import com.aynreader.backend.model.Feed;
import com.aynreader.backend.model.FeedEntry;
import com.aynreader.backend.service.FeedEntryService;
import com.aynreader.backend.service.FeedService;
import com.codahale.metrics.MetricRegistry;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.Callable;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.Mockito;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class FeedRefreshUpdaterTest {

    @Mock private UnitOfWork unitOfWork;
    @Mock private FeedService feedService;
    @Mock private FeedEntryService feedEntryService;
    @Mock private FeedSubscriptionDAO feedSubscriptionDAO;
    @Mock private GoogleNewsUrlDecoder googleNewsUrlDecoder;

    private FeedRefreshUpdater updater;

    @BeforeEach
    void init() throws Exception {
        Mockito.when(unitOfWork.call(Mockito.any()))
                .thenAnswer(invocation -> invocation.<Callable<?>>getArgument(0).call());
        Mockito.doAnswer(
                        invocation -> {
                            invocation.<Runnable>getArgument(0).run();
                            return null;
                        })
                .when(unitOfWork)
                .run(Mockito.any());

        updater =
                new FeedRefreshUpdater(
                        unitOfWork,
                        feedService,
                        feedEntryService,
                        new MetricRegistry(),
                        feedSubscriptionDAO,
                        googleNewsUrlDecoder);
    }

    @Test
    void decodesEntriesOneByOneBeforeInsertingThem() {
        Feed feed = new Feed();
        feed.setId(1L);
        feed.setUrl("https://news.google.com/rss/search?q=incendie");
        Content content = new Content("title", "content", null, null, null, null);
        Entry first =
                new Entry(
                        "guid-1",
                        "https://news.google.com/rss/articles/CBMi1?oc=5",
                        Instant.EPOCH,
                        content);
        Entry second =
                new Entry(
                        "guid-2",
                        "https://news.google.com/rss/articles/CBMi2?oc=5",
                        Instant.EPOCH,
                        content);
        Entry decodedFirst = new Entry("guid-1", "https://example.com/1", Instant.EPOCH, content);
        Entry decodedSecond = new Entry("guid-2", "https://example.com/2", Instant.EPOCH, content);

        Mockito.when(googleNewsUrlDecoder.decode(first)).thenReturn(decodedFirst);
        Mockito.when(googleNewsUrlDecoder.decode(second)).thenReturn(decodedSecond);
        Mockito.when(
                        feedEntryService.removeExistingEntries(
                                feed, List.of(decodedFirst, decodedSecond)))
                .thenReturn(List.of(decodedFirst, decodedSecond));
        Mockito.when(feedSubscriptionDAO.findByFeed(feed)).thenReturn(List.of());
        Mockito.when(feedEntryService.create(Mockito.eq(feed), Mockito.any()))
                .thenReturn(new FeedEntry());

        updater.update(feed, List.of(first, second));

        Mockito.verify(googleNewsUrlDecoder).decode(first);
        Mockito.verify(googleNewsUrlDecoder).decode(second);
        Mockito.verify(feedEntryService).create(feed, decodedFirst);
        Mockito.verify(feedEntryService).create(feed, decodedSecond);
    }
}
