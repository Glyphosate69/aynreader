package com.aynreader.backend.service;

import com.aynreader.AynReaderConfiguration;
import com.aynreader.backend.Digests;
import com.aynreader.backend.Urls;
import com.aynreader.backend.dao.FeedEntryStatusDAO;
import com.aynreader.backend.dao.FeedSubscriptionDAO;
import com.aynreader.backend.dao.ScrapedFeedConfigDAO;
import com.aynreader.backend.feed.FeedRefreshEngine;
import com.aynreader.backend.feed.FeedUtils;
import com.aynreader.backend.model.Feed;
import com.aynreader.backend.model.FeedCategory;
import com.aynreader.backend.model.FeedSubscription;
import com.aynreader.backend.model.ScrapedFeedConfig;
import com.aynreader.backend.model.User;
import com.aynreader.frontend.model.UnreadCount;
import jakarta.inject.Singleton;
import jakarta.transaction.Synchronization;
import jakarta.transaction.TransactionSynchronizationRegistry;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;

@Slf4j
@Singleton
public class FeedSubscriptionService {

    private final FeedEntryStatusDAO feedEntryStatusDAO;
    private final FeedSubscriptionDAO feedSubscriptionDAO;
    private final FeedService feedService;
    private final ScrapedFeedConfigDAO scrapedFeedConfigDAO;
    private final FeedRefreshEngine feedRefreshEngine;
    private final AynReaderConfiguration config;
    private final TransactionSynchronizationRegistry transactionSynchronizationRegistry;

    public FeedSubscriptionService(
            FeedEntryStatusDAO feedEntryStatusDAO,
            FeedSubscriptionDAO feedSubscriptionDAO,
            FeedService feedService,
            ScrapedFeedConfigDAO scrapedFeedConfigDAO,
            FeedRefreshEngine feedRefreshEngine,
            AynReaderConfiguration config,
            TransactionSynchronizationRegistry transactionSynchronizationRegistry) {
        this.feedEntryStatusDAO = feedEntryStatusDAO;
        this.feedSubscriptionDAO = feedSubscriptionDAO;
        this.feedService = feedService;
        this.scrapedFeedConfigDAO = scrapedFeedConfigDAO;
        this.feedRefreshEngine = feedRefreshEngine;
        this.config = config;
        this.transactionSynchronizationRegistry = transactionSynchronizationRegistry;

        // automatically refresh new feeds after they are subscribed to
        // we need to use this hook because the feed needs to have been persisted before being
        // processed
        // by the feed engine
        feedSubscriptionDAO.onPostCommitInsert(
                sub -> {
                    Feed feed = sub.getFeed();
                    if (feed.getDisabledUntil() == null
                            || feed.getDisabledUntil().isBefore(Instant.now())) {
                        feedRefreshEngine.refreshImmediately(feed);
                    }
                });
    }

    public long subscribe(
            User user, String url, String title, FeedCategory category, int position) {
        Integer maxFeedsPerUser = config.database().cleanup().maxFeedsPerUser();
        if (maxFeedsPerUser > 0 && feedSubscriptionDAO.count(user) >= maxFeedsPerUser) {
            String message =
                    String.format(
                            "You cannot subscribe to more feeds on this Ayn Reader OS instance (max %s feeds per user)",
                            maxFeedsPerUser);
            throw new FeedSubscriptionException(message);
        }

        Feed feed = feedService.findOrCreate(url);

        // upgrade feed to https if it was using http
        if (Urls.isHttp(feed.getUrl()) && Urls.isHttps(url)) {
            feed.setUrl(url);
        }

        FeedSubscription sub = feedSubscriptionDAO.findByFeed(user, feed);
        if (sub == null) {
            sub = new FeedSubscription();
            sub.setFeed(feed);
            sub.setUser(user);
        }
        sub.setCategory(category);
        sub.setPosition(position);
        sub.setTitle(FeedUtils.truncate(title, 128));
        return feedSubscriptionDAO.merge(sub).getId();
    }

    public long subscribeScraped(
            User user,
            String pageUrl,
            String itemSelector,
            String titleSelector,
            String descriptionSelector,
            String urlSelector,
            String imageSelector,
            String dateSelector,
            String title,
            FeedCategory category,
            int position) {
        String scraperFeedUrl =
                "https://aynreader.local/scrape/"
                        + Digests.sha1Hex(
                                pageUrl
                                        + "\n"
                                        + itemSelector
                                        + "\n"
                                        + StringUtils.trimToEmpty(titleSelector)
                                        + "\n"
                                        + StringUtils.trimToEmpty(descriptionSelector)
                                        + "\n"
                                        + StringUtils.trimToEmpty(urlSelector)
                                        + "\n"
                                        + StringUtils.trimToEmpty(imageSelector)
                                        + "\n"
                                        + StringUtils.trimToEmpty(dateSelector));
        Feed feed = feedService.findOrCreate(scraperFeedUrl);

        ScrapedFeedConfig config = scrapedFeedConfigDAO.findByFeedId(feed.getId());
        if (config == null) {
            config = new ScrapedFeedConfig();
            config.setFeed(feed);
        }
        config.setPageUrl(pageUrl);
        config.setItemSelector(itemSelector);
        config.setTitleSelector(StringUtils.trimToNull(titleSelector));
        config.setDescriptionSelector(StringUtils.trimToNull(descriptionSelector));
        config.setUrlSelector(StringUtils.trimToNull(urlSelector));
        config.setImageSelector(StringUtils.trimToNull(imageSelector));
        config.setDateSelector(StringUtils.trimToNull(dateSelector));
        scrapedFeedConfigDAO.merge(config);

        FeedSubscription sub = feedSubscriptionDAO.findByFeed(user, feed);
        if (sub == null) {
            sub = new FeedSubscription();
            sub.setFeed(feed);
            sub.setUser(user);
        }
        sub.setCategory(category);
        sub.setPosition(position);
        sub.setTitle(FeedUtils.truncate(title, 128));
        long subscriptionId = feedSubscriptionDAO.merge(sub).getId();
        refreshAfterCommit(feed);
        return subscriptionId;
    }

    private void refreshAfterCommit(Feed feed) {
        transactionSynchronizationRegistry.registerInterposedSynchronization(
                new Synchronization() {
                    @Override
                    public void beforeCompletion() {
                        // nothing to do
                    }

                    @Override
                    public void afterCompletion(int status) {
                        if (status == jakarta.transaction.Status.STATUS_COMMITTED) {
                            feedRefreshEngine.refreshImmediately(feed);
                        }
                    }
                });
    }

    public boolean unsubscribe(User user, Long subId) {
        FeedSubscription sub = feedSubscriptionDAO.findById(user, subId);
        if (sub != null) {
            feedSubscriptionDAO.delete(sub);
            return true;
        } else {
            return false;
        }
    }

    public void refreshAll(User user) throws ForceFeedRefreshTooSoonException {
        Instant lastForceRefresh = user.getLastForceRefresh();
        if (lastForceRefresh != null
                && lastForceRefresh
                        .plus(config.feedRefresh().forceRefreshCooldownDuration())
                        .isAfter(Instant.now())) {
            throw new ForceFeedRefreshTooSoonException();
        }

        List<FeedSubscription> subs = feedSubscriptionDAO.findAll(user);
        for (FeedSubscription sub : subs) {
            Feed feed = sub.getFeed();
            feedRefreshEngine.refreshImmediately(feed);
        }

        user.setLastForceRefresh(Instant.now());
    }

    public Map<Long, UnreadCount> getUnreadCount(User user) {
        return feedSubscriptionDAO.findAll(user).stream()
                .collect(
                        Collectors.toMap(
                                FeedSubscription::getId, feedEntryStatusDAO::getUnreadCount));
    }

    @SuppressWarnings("serial")
    public static class FeedSubscriptionException extends RuntimeException {
        private FeedSubscriptionException(String msg) {
            super(msg);
        }
    }

    @SuppressWarnings("serial")
    public static class ForceFeedRefreshTooSoonException extends Exception {
        private ForceFeedRefreshTooSoonException() {
            super();
        }
    }
}
