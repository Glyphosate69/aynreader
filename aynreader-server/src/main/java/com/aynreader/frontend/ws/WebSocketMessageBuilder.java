package com.aynreader.frontend.ws;

import com.aynreader.backend.model.FeedSubscription;
import lombok.experimental.UtilityClass;

@UtilityClass
public class WebSocketMessageBuilder {

    public static String newFeedEntries(FeedSubscription subscription, long count) {
        return String.format("%s:%s:%s", "new-feed-entries", subscription.getId(), count);
    }
}
