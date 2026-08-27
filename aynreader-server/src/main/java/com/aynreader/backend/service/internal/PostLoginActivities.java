package com.aynreader.backend.service.internal;

import com.aynreader.backend.dao.UnitOfWork;
import com.aynreader.backend.dao.UserDAO;
import com.aynreader.backend.model.User;
import jakarta.inject.Singleton;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import lombok.RequiredArgsConstructor;

@RequiredArgsConstructor
@Singleton
public class PostLoginActivities {

    private final UserDAO userDAO;
    private final UnitOfWork unitOfWork;

    public void executeFor(User user) {
        // only update lastLogin every once in a while in order to avoid invalidating the cache
        // every
        // time someone logs in
        Instant now = Instant.now();
        Instant lastLogin = user.getLastLogin();
        if (lastLogin == null || ChronoUnit.MINUTES.between(lastLogin, now) >= 30) {
            user.setLastLogin(now);
            unitOfWork.run(() -> userDAO.merge(user));
        }
    }
}
