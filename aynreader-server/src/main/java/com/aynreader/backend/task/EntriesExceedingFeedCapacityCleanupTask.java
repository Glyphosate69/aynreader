package com.aynreader.backend.task;

import com.aynreader.AynReaderConfiguration;
import com.aynreader.backend.service.db.DatabaseCleaningService;
import jakarta.inject.Singleton;
import java.util.concurrent.TimeUnit;
import lombok.RequiredArgsConstructor;

@RequiredArgsConstructor
@Singleton
public class EntriesExceedingFeedCapacityCleanupTask extends ScheduledTask {

    private final AynReaderConfiguration config;
    private final DatabaseCleaningService cleaner;

    @Override
    public void run() {
        int maxFeedCapacity = config.database().cleanup().maxFeedCapacity();
        if (maxFeedCapacity > 0) {
            cleaner.cleanEntriesForFeedsExceedingCapacity(maxFeedCapacity);
        }
    }

    @Override
    public long getInitialDelay() {
        return 10;
    }

    @Override
    public long getPeriod() {
        return 60;
    }

    @Override
    public TimeUnit getTimeUnit() {
        return TimeUnit.MINUTES;
    }
}
