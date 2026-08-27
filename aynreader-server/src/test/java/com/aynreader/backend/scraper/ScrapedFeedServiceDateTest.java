package com.aynreader.backend.scraper;

import java.time.Instant;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

class ScrapedFeedServiceDateTest {

    private static final Instant REFERENCE_TIME = Instant.parse("2026-07-31T12:30:00Z");

    @Test
    void parsesStandardFrenchAndEnglishDates() {
        Assertions.assertEquals(
                Instant.parse("2026-07-31T00:00:00Z"),
                ScrapedFeedService.parseDate("31 juillet 2026", REFERENCE_TIME));
        Assertions.assertEquals(
                Instant.parse("2026-07-22T00:00:00Z"),
                ScrapedFeedService.parseDate("22.07.2026", REFERENCE_TIME));
        Assertions.assertEquals(
                Instant.parse("2026-07-31T00:00:00Z"),
                ScrapedFeedService.parseDate("31 July 2026", REFERENCE_TIME));
    }

    @Test
    void parsesRelativeFrenchAndEnglishDatesAgainstTheReferenceTime() {
        Assertions.assertEquals(
                Instant.parse("2026-07-31T00:00:00Z"),
                ScrapedFeedService.parseDate("aujourd'hui", REFERENCE_TIME));
        Assertions.assertEquals(
                Instant.parse("2026-07-30T00:00:00Z"),
                ScrapedFeedService.parseDate("hier", REFERENCE_TIME));
        Assertions.assertEquals(
                Instant.parse("2026-07-31T10:30:00Z"),
                ScrapedFeedService.parseDate("il y a 2 heures", REFERENCE_TIME));
        Assertions.assertEquals(
                Instant.parse("2026-07-29T12:30:00Z"),
                ScrapedFeedService.parseDate("2 days ago", REFERENCE_TIME));
    }

    @Test
    void rejectsInvalidOrMissingDates() {
        Assertions.assertNull(ScrapedFeedService.parseDate("31/02/2026", REFERENCE_TIME));
        Assertions.assertNull(ScrapedFeedService.parseDate("", REFERENCE_TIME));
        Assertions.assertNull(
                ScrapedFeedService.parseDate("not a publication date", REFERENCE_TIME));
    }
}
