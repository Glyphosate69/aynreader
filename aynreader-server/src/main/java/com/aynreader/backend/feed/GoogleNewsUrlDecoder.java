package com.aynreader.backend.feed;

import com.aynreader.AynReaderConfiguration;
import com.aynreader.backend.HttpClientFactory;
import com.aynreader.backend.HttpGetter;
import com.aynreader.backend.HttpGetter.HttpRequest;
import com.aynreader.backend.HttpGetter.HttpResult;
import com.aynreader.backend.HttpGetter.NotModifiedException;
import com.aynreader.backend.HttpGetter.SchemeNotAllowedException;
import com.aynreader.backend.HttpGetter.TooManyRequestsException;
import com.aynreader.backend.Urls;
import com.aynreader.backend.feed.parser.FeedParserResult.Entry;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.common.net.HttpHeaders;
import jakarta.inject.Singleton;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Optional;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.apache.hc.client5.http.classic.methods.HttpPost;
import org.apache.hc.client5.http.config.RequestConfig;
import org.apache.hc.client5.http.entity.UrlEncodedFormEntity;
import org.apache.hc.client5.http.impl.classic.CloseableHttpClient;
import org.apache.hc.core5.http.NameValuePair;
import org.apache.hc.core5.http.io.entity.EntityUtils;
import org.apache.hc.core5.http.message.BasicNameValuePair;
import org.apache.hc.core5.util.Timeout;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Element;

/** Decodes individual Google News article redirects without parallel requests. */
@Singleton
@Slf4j
public class GoogleNewsUrlDecoder {

    private static final String GOOGLE_NEWS_HOST = "news.google.com";
    private static final String BATCH_EXECUTE_URL =
            "https://news.google.com/_/DotsSplashUi/data/batchexecute";
    private static final int MAX_RETRIES = 3;
    private static final Duration RETRY_INTERVAL = Duration.ofSeconds(1);
    private static final Duration MIN_DECODE_INTERVAL = Duration.ofSeconds(1);

    private final HttpGetter getter;
    private final ObjectMapper objectMapper;
    private final CloseableHttpClient httpClient;
    private final AynReaderConfiguration config;
    private final Object decodeLock = new Object();
    private long lastDecodeMillis;

    public GoogleNewsUrlDecoder(
            HttpGetter getter,
            ObjectMapper objectMapper,
            HttpClientFactory httpClientFactory,
            AynReaderConfiguration config) {
        this.getter = getter;
        this.objectMapper = objectMapper;
        this.httpClient = httpClientFactory.newClient(config.feedRefresh().httpThreads());
        this.config = config;
    }

    /** Decodes one article. Calls from the feed updater are intentionally sequential. */
    public Entry decode(Entry entry) {
        return new Entry(
                entry.guid(),
                decodeWithRetry(entry.url()).orElse(entry.url()),
                entry.published(),
                entry.content());
    }

    Optional<String> decodeWithRetry(String url) {
        if (getBase64(url).isEmpty()) {
            return Optional.empty();
        }

        synchronized (decodeLock) {
            waitForNextDecodeSlot();
            for (int attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                try {
                    Optional<String> decodedUrl = decodeGoogleNewsUrl(url);
                    lastDecodeMillis = System.currentTimeMillis();
                    log.debug("Decoded Google News URL {} to {}", url, decodedUrl.orElse(url));
                    return decodedUrl;
                } catch (Exception e) {
                    lastDecodeMillis = System.currentTimeMillis();
                    log.debug(
                            "Could not decode Google News URL {} on attempt {}/{}",
                            url,
                            attempt,
                            MAX_RETRIES,
                            e);
                    sleepBeforeRetry(attempt);
                }
            }
        }

        return Optional.empty();
    }

    Optional<String> getBase64(String sourceUrl) {
        if (sourceUrl == null) {
            return Optional.empty();
        }

        try {
            URI uri = URI.create(sourceUrl);
            String[] path = StringUtils.split(uri.getPath(), '/');
            if (!GOOGLE_NEWS_HOST.equalsIgnoreCase(uri.getHost())
                    || path == null
                    || path.length < 2) {
                return Optional.empty();
            }

            String type = path[path.length - 2];
            if ("articles".equals(type) || "read".equals(type)) {
                return Optional.of(path[path.length - 1]);
            }
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }

        return Optional.empty();
    }

    private Optional<String> decodeGoogleNewsUrl(String url)
            throws IOException,
                    NotModifiedException,
                    TooManyRequestsException,
                    SchemeNotAllowedException {
        Optional<String> base64 = getBase64(url);
        if (base64.isEmpty()) {
            return Optional.empty();
        }

        DecodingParams params = getDecodingParams(base64.get());
        String decodedUrl = decodeUrl(params);
        return Urls.isAbsolute(decodedUrl) ? Optional.of(decodedUrl) : Optional.empty();
    }

    private DecodingParams getDecodingParams(String base64)
            throws IOException,
                    NotModifiedException,
                    TooManyRequestsException,
                    SchemeNotAllowedException {
        try {
            return getDecodingParams("https://news.google.com/articles/" + base64, base64);
        } catch (Exception e) {
            return getDecodingParams("https://news.google.com/rss/articles/" + base64, base64);
        }
    }

    private DecodingParams getDecodingParams(String url, String base64)
            throws IOException,
                    NotModifiedException,
                    TooManyRequestsException,
                    SchemeNotAllowedException {
        HttpResult result = getter.get(HttpRequest.builder(url).build());
        String html = new String(result.content(), StandardCharsets.UTF_8);
        Element element = Jsoup.parse(html).selectFirst("c-wiz > div[jscontroller]");
        if (element == null) {
            throw new IOException("Google News decoding parameters not found");
        }

        String signature = StringUtils.trimToNull(element.attr("data-n-a-sg"));
        String timestamp = StringUtils.trimToNull(element.attr("data-n-a-ts"));
        if (signature == null || timestamp == null) {
            throw new IOException("Google News decoding parameters are incomplete");
        }

        return new DecodingParams(base64, signature, timestamp);
    }

    private String decodeUrl(DecodingParams params) throws IOException {
        String gartUrlReq =
                "[\"garturlreq\",[[\"X\",\"X\",[\"X\",\"X\"],null,null,1,1,\"FR:fr\",null,1,null,null,null,null,null,0,1],\"X\",\"X\",1,[1,1,1],1,1,null,0,0,null,0],\"%s\",%s,\"%s\"]"
                        .formatted(params.base64(), params.timestamp(), params.signature());
        String payload =
                objectMapper.writeValueAsString(List.of(List.of(List.of("Fbv4je", gartUrlReq))));

        HttpPost request = new HttpPost(BATCH_EXECUTE_URL);
        request.setConfig(
                RequestConfig.custom()
                        .setResponseTimeout(Timeout.of(config.httpClient().responseTimeout()))
                        .build());
        request.addHeader(
                HttpHeaders.CONTENT_TYPE, "application/x-www-form-urlencoded;charset=UTF-8");
        List<NameValuePair> form = List.of(new BasicNameValuePair("f.req", payload));
        request.setEntity(new UrlEncodedFormEntity(form, StandardCharsets.UTF_8));

        return httpClient.execute(
                request,
                response -> {
                    if (response.getCode() >= 400) {
                        throw new IOException(
                                "Google News decoder failed with status " + response.getCode());
                    }
                    String body =
                            EntityUtils.toString(response.getEntity(), StandardCharsets.UTF_8);
                    return parseDecodedUrl(body);
                });
    }

    String parseDecodedUrl(String body) throws IOException {
        String[] parts = body.split("\\n\\n", 2);
        if (parts.length < 2) {
            throw new IOException("Google News decoder response is invalid");
        }

        JsonNode data = objectMapper.readTree(parts[1]);
        JsonNode encodedResult = data.path(0).path(2);
        if (!encodedResult.isTextual()) {
            throw new IOException("Google News decoder payload is invalid");
        }

        JsonNode decodedResult = objectMapper.readTree(encodedResult.asText());
        String decodedUrl = decodedResult.path(1).asText(null);
        if (StringUtils.isBlank(decodedUrl)) {
            throw new IOException("Google News decoder URL is missing");
        }
        return decodedUrl;
    }

    private void sleepBeforeRetry(int attempt) {
        if (attempt < MAX_RETRIES) {
            sleep(RETRY_INTERVAL);
        }
    }

    private void waitForNextDecodeSlot() {
        long elapsedMillis = System.currentTimeMillis() - lastDecodeMillis;
        long waitMillis = MIN_DECODE_INTERVAL.toMillis() - elapsedMillis;
        if (waitMillis > 0) {
            sleep(Duration.ofMillis(waitMillis));
        }
    }

    private void sleep(Duration duration) {
        try {
            Thread.sleep(duration.toMillis());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private record DecodingParams(String base64, String signature, String timestamp) {}
}
