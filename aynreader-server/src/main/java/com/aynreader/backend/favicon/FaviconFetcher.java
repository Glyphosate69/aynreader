package com.aynreader.backend.favicon;

import com.aynreader.backend.model.Feed;

public interface FaviconFetcher {

    Favicon fetch(Feed feed);
}
