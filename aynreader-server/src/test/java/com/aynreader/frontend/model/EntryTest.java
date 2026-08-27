package com.aynreader.frontend.model;

import com.aynreader.backend.model.Feed;
import com.aynreader.backend.model.FeedEntry;
import com.aynreader.backend.model.FeedEntryContent;
import com.aynreader.backend.model.FeedEntryStatus;
import com.aynreader.backend.model.FeedSubscription;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

class EntryTest {

    @Test
    void usesDecodedMediaDomainAsGoogleNewsSourceName() {
        Feed feed = new Feed();
        feed.setUrl("https://news.google.com/rss/search?q=incendie");
        feed.setLink("https://news.google.com/");

        FeedSubscription subscription = new FeedSubscription();
        subscription.setFeed(feed);
        subscription.setTitle("incendie - Google Actualités");

        FeedEntry feedEntry = new FeedEntry();
        feedEntry.setUrl("https://www.lemonde.fr/article");
        FeedEntryContent content = new FeedEntryContent();
        content.setTitle("Article");
        feedEntry.setContent(content);

        FeedEntryStatus status = new FeedEntryStatus();
        status.setSubscription(subscription);
        status.setEntry(feedEntry);

        Entry result = Entry.build(status, false);

        Assertions.assertEquals("lemonde.fr", result.getFeedName());
        Assertions.assertEquals("https://www.lemonde.fr/article", result.getFeedLink());
    }

    @Test
    void preservesCustomSourceNameForRegularFeeds() {
        Feed feed = new Feed();
        feed.setUrl("https://example.com/feed.xml");
        feed.setLink("https://example.com");

        FeedSubscription subscription = new FeedSubscription();
        subscription.setFeed(feed);
        subscription.setTitle("Ma source");

        FeedEntry feedEntry = new FeedEntry();
        feedEntry.setUrl("https://example.com/article");
        feedEntry.setContent(new FeedEntryContent());

        FeedEntryStatus status = new FeedEntryStatus();
        status.setSubscription(subscription);
        status.setEntry(feedEntry);

        Entry result = Entry.build(status, false);

        Assertions.assertEquals("Ma source", result.getFeedName());
        Assertions.assertEquals("https://example.com", result.getFeedLink());
    }
}
