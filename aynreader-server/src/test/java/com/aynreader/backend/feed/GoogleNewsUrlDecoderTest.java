package com.aynreader.backend.feed;

import com.aynreader.AynReaderConfiguration;
import com.aynreader.backend.HttpClientFactory;
import com.aynreader.backend.HttpGetter;
import com.aynreader.backend.feed.parser.FeedParserResult.Content;
import com.aynreader.backend.feed.parser.FeedParserResult.Entry;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.Optional;
import org.apache.hc.client5.http.impl.classic.CloseableHttpClient;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Answers;
import org.mockito.Mock;
import org.mockito.Mockito;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class GoogleNewsUrlDecoderTest {

    @Mock private HttpGetter getter;
    @Mock private HttpClientFactory httpClientFactory;
    @Mock private CloseableHttpClient httpClient;

    @Mock(answer = Answers.RETURNS_DEEP_STUBS)
    private AynReaderConfiguration config;

    private GoogleNewsUrlDecoder decoder;

    @BeforeEach
    void init() {
        Mockito.when(config.feedRefresh().httpThreads()).thenReturn(1);
        Mockito.when(httpClientFactory.newClient(1)).thenReturn(httpClient);
        decoder = new GoogleNewsUrlDecoder(getter, new ObjectMapper(), httpClientFactory, config);
    }

    @Test
    void extractsBase64FromGoogleNewsUrl() {
        Assertions.assertEquals(
                Optional.of("CBMiabc"),
                decoder.getBase64("https://news.google.com/rss/articles/CBMiabc?oc=5"));
        Assertions.assertEquals(
                Optional.of("CBMiabc"),
                decoder.getBase64("https://news.google.com/read/CBMiabc?hl=fr"));
        Assertions.assertEquals(Optional.empty(), decoder.getBase64("https://example.com/article"));
    }

    @Test
    void parsesDecodedUrlFromBatchResponse() throws Exception {
        String decodedUrl = "https://example.com/original-article";
        String body =
                ")]}'\n\n[[\"wrb.fr\",\"Fbv4je\",\"[null,\\\"%s\\\"]\",null,null,null,\"generic\"]]"
                        .formatted(decodedUrl);

        Assertions.assertEquals(decodedUrl, decoder.parseDecodedUrl(body));
    }

    @Test
    void replacesGoogleNewsUrl() {
        String googleNewsUrl = "https://news.google.com/rss/articles/CBMiabc?oc=5";
        String decodedUrl = "https://example.com/original-article";
        Content content = new Content("title", "content", null, null, null, null);
        Entry entry = new Entry("guid", googleNewsUrl, Instant.EPOCH, content);

        GoogleNewsUrlDecoder spy = Mockito.spy(decoder);
        Mockito.doReturn(Optional.of(decodedUrl)).when(spy).decodeWithRetry(googleNewsUrl);

        Assertions.assertEquals(decodedUrl, spy.decode(entry).url());
    }
}
