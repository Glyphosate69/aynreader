package com.aynreader.backend.task;

import com.aynreader.backend.service.db.DatabaseCleaningService;
import jakarta.inject.Singleton;
import java.util.concurrent.TimeUnit;
import lombok.RequiredArgsConstructor;

@RequiredArgsConstructor
@Singleton
public class AutoMarkAsReadTask extends ScheduledTask {

    private final DatabaseCleaningService cleaner;

    @Override
    public void run() {
        cleaner.autoMarkAsRead();
    }

    @Override
    public long getInitialDelay() {
        return 30;
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
