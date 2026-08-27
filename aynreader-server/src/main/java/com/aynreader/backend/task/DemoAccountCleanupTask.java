package com.aynreader.backend.task;

import com.aynreader.AynReaderConfiguration;
import com.aynreader.AynReaderConstants;
import com.aynreader.backend.dao.UnitOfWork;
import com.aynreader.backend.dao.UserDAO;
import com.aynreader.backend.model.User;
import com.aynreader.backend.service.UserService;
import jakarta.inject.Singleton;
import java.util.concurrent.TimeUnit;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

@RequiredArgsConstructor
@Singleton
@Slf4j
public class DemoAccountCleanupTask extends ScheduledTask {

    private final AynReaderConfiguration config;
    private final UnitOfWork unitOfWork;
    private final UserDAO userDAO;
    private final UserService userService;

    @Override
    protected void run() {
        if (!config.users().createDemoAccount()) {
            return;
        }

        log.info("recreating demo user account");
        unitOfWork.run(
                () -> {
                    User demoUser = userDAO.findByName(AynReaderConstants.USERNAME_DEMO);
                    if (demoUser == null) {
                        return;
                    }

                    userService.unregister(demoUser);
                    userService.createDemoUser();
                });
    }

    @Override
    protected long getInitialDelay() {
        return 1;
    }

    @Override
    protected long getPeriod() {
        return getTimeUnit().convert(24, TimeUnit.HOURS);
    }

    @Override
    protected TimeUnit getTimeUnit() {
        return TimeUnit.MINUTES;
    }
}
