package com.aynreader.backend.feed;

import com.aynreader.AynReaderConfiguration;
import com.aynreader.backend.HttpGetter.NotModifiedException;
import com.aynreader.backend.HttpGetter.TooManyRequestsException;
import com.aynreader.backend.feed.FeedFetcher.FeedFetcherResult;
import com.aynreader.backend.feed.parser.FeedParserResult.Entry;
import com.aynreader.backend.model.Feed;
import com.aynreader.backend.model.ScrapedFeedConfig;
import com.aynreader.backend.scraper.ScrapedFeedService;
import com.codahale.metrics.Meter;
import com.codahale.metrics.MetricRegistry;
import jakarta.inject.Singleton;
import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.Strings;

/**
 * Calls {@link FeedFetcher} and updates the Feed object, but does not update the database, ({@link
 * FeedRefreshUpdater} does that)
 */
@Slf4j
@Singleton
public class FeedRefreshWorker {

    private static final int GOOGLE_NEWS_MAX_ENTRIES = 10;
    private static final String GOOGLE_NEWS_HOST = "news.google.com";

    private final FeedRefreshIntervalCalculator refreshIntervalCalculator;
    private final FeedFetcher fetcher;
    private final ScrapedFeedService scrapedFeedService;
    private final AynReaderConfiguration config;
    private final Meter feedFetched;

    public FeedRefreshWorker(
            FeedRefreshIntervalCalculator refreshIntervalCalculator,
            FeedFetcher fetcher,
            ScrapedFeedService scrapedFeedService,
            AynReaderConfiguration config,
            MetricRegistry metrics) {
        this.refreshIntervalCalculator = refreshIntervalCalculator;
        this.fetcher = fetcher;
        this.scrapedFeedService = scrapedFeedService;
        this.config = config;
        this.feedFetched = metrics.meter(MetricRegistry.name(getClass(), "feedFetched"));
    }

    public FeedRefreshWorkerResult update(Feed feed) {
        try {
            ScrapedFeedConfig scrapedFeedConfig = scrapedFeedService.findConfig(feed);
            if (scrapedFeedConfig != null) {
                return scrapedFeedService.refresh(feed, scrapedFeedConfig);
            }

            String url = Optional.ofNullable(feed.getUrlAfterRedirect()).orElse(feed.getUrl());
            FeedFetcherResult result =
                    fetcher.fetch(
                            url,
                            false,
                            feed.getLastModifiedHeader(),
                            feed.getEtagHeader(),
                            feed.getLastPublishedDate(),
                            feed.getLastContentHash());
            // stops here if NotModifiedException or any other exception is thrown

            List<Entry> entries = result.feed().entries();
            if (isGoogleNewsFeed(feed.getUrl()) || isGoogleNewsFeed(result.urlAfterRedirect())) {
                entries = entries.stream().limit(GOOGLE_NEWS_MAX_ENTRIES).toList();
            }

            int maxFeedCapacity = config.database().cleanup().maxFeedCapacity();
            if (maxFeedCapacity > 0) {
                entries = entries.stream().limit(maxFeedCapacity).toList();
            }

            Duration entriesMaxAge = config.database().cleanup().entriesMaxAge();
            if (!entriesMaxAge.isZero()) {
                Instant threshold = Instant.now().minus(entriesMaxAge);
                entries =
                        entries.stream()
                                .filter(entry -> entry.published().isAfter(threshold))
                                .toList();
            }

            String urlAfterRedirect = result.urlAfterRedirect();
            if (Strings.CS.equals(url, urlAfterRedirect)) {
                urlAfterRedirect = null;
            }

            feed.setUrlAfterRedirect(urlAfterRedirect);
            feed.setLink(result.feed().link());
            feed.setIconUrl(result.feed().iconUrl());
            feed.setLastModifiedHeader(result.lastModifiedHeader());
            feed.setEtagHeader(result.lastETagHeader());
            feed.setLastContentHash(result.contentHash());
            feed.setLastPublishedDate(result.feed().lastPublishedDate());
            feed.setAverageEntryInterval(result.feed().averageEntryInterval());
            feed.setLastEntryDate(result.feed().lastEntryDate());

            feed.setErrorCount(0);
            feed.setMessage(null);
            feed.setDisabledUntil(
                    refreshIntervalCalculator.onFetchSuccess(
                            result.feed().lastPublishedDate(),
                            result.feed().averageEntryInterval(),
                            result.validFor()));

            return new FeedRefreshWorkerResult(feed, entries);
        } catch (NotModifiedException e) {
            log.debug("Feed not modified : {} - {}", feed.getUrl(), e.getMessage());

            feed.setErrorCount(0);
            feed.setMessage(e.getMessage());
            feed.setDisabledUntil(
                    refreshIntervalCalculator.onFeedNotModified(
                            feed.getLastPublishedDate(), feed.getAverageEntryInterval()));

            if (e.getNewLastModifiedHeader() != null) {
                feed.setLastModifiedHeader(e.getNewLastModifiedHeader());
            }

            if (e.getNewEtagHeader() != null) {
                feed.setEtagHeader(e.getNewEtagHeader());
            }

            return new FeedRefreshWorkerResult(feed, Collections.emptyList());
        } catch (TooManyRequestsException e) {
            log.debug("Too many requests : {}", feed.getUrl());

            feed.setErrorCount(feed.getErrorCount() + 1);
            feed.setMessage("Server indicated that we are sending too many requests");
            feed.setDisabledUntil(
                    refreshIntervalCalculator.onTooManyRequests(
                            e.getRetryAfter(), feed.getErrorCount()));

            return new FeedRefreshWorkerResult(feed, Collections.emptyList());
        } catch (Exception e) {
            log.debug("unable to refresh feed {}", feed.getUrl(), e);

            feed.setErrorCount(feed.getErrorCount() + 1);
            feed.setMessage("Unable to refresh feed : " + e.getMessage());
            feed.setDisabledUntil(refreshIntervalCalculator.onFetchError(feed.getErrorCount()));

            return new FeedRefreshWorkerResult(feed, Collections.emptyList());
        } finally {
            feedFetched.mark();
        }
    }

    static boolean isGoogleNewsFeed(String url) {
        if (url == null) {
            return false;
        }

        try {
            URI uri = URI.create(url);
            return GOOGLE_NEWS_HOST.equalsIgnoreCase(uri.getHost())
                    && uri.getPath() != null
                    && uri.getPath().startsWith("/rss/");
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    public record FeedRefreshWorkerResult(Feed feed, List<Entry> entries) {}
}
