package com.aynreader.backend.favicon;

import com.aynreader.backend.HttpGetter;
import com.aynreader.backend.HttpGetter.HttpResult;
import com.aynreader.backend.model.Feed;
import jakarta.annotation.Priority;
import jakarta.inject.Singleton;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/** Fetch favicon from the url declared in the feed. */
@Slf4j
@RequiredArgsConstructor
@Singleton
@Priority(2)
public class FeedFaviconFetcher implements FaviconFetcher {

    private final HttpGetter getter;

    @Override
    public Favicon fetch(Feed feed) {
        String url = feed.getIconUrl();
        if (url == null) {
            return null;
        }

        try {
            HttpResult result = getter.get(url);
            return new Favicon(result.content(), result.contentType());
        } catch (Exception e) {
            log.debug("Failed to retrieve icon declared in the feed {}", url, e);
            return null;
        }
    }
}
