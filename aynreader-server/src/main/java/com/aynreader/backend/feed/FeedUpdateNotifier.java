package com.aynreader.backend.feed;

import com.aynreader.AynReaderConfiguration;
import com.aynreader.backend.dao.UnitOfWork;
import com.aynreader.backend.dao.UserSettingsDAO;
import com.aynreader.backend.model.FeedEntry;
import com.aynreader.backend.model.FeedSubscription;
import com.aynreader.backend.model.UserSettings;
import com.aynreader.backend.service.PushNotificationService;
import com.aynreader.frontend.ws.WebSocketMessageBuilder;
import com.aynreader.frontend.ws.WebSocketSessions;
import jakarta.inject.Singleton;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Singleton
@RequiredArgsConstructor
public class FeedUpdateNotifier {

    private final AynReaderConfiguration config;
    private final UnitOfWork unitOfWork;
    private final UserSettingsDAO userSettingsDAO;
    private final WebSocketSessions webSocketSessions;
    private final PushNotificationService pushNotificationService;

    public void notifyOverWebsocket(FeedSubscription sub, List<FeedEntry> entries) {
        if (!entries.isEmpty()) {
            webSocketSessions.sendMessage(
                    sub.getUser(), WebSocketMessageBuilder.newFeedEntries(sub, entries.size()));
        }
    }

    public void sendPushNotifications(FeedSubscription sub, List<FeedEntry> entries) {
        if (!config.pushNotifications().enabled()
                || !sub.isPushNotificationsEnabled()
                || entries.isEmpty()) {
            return;
        }

        UserSettings settings = unitOfWork.call(() -> userSettingsDAO.findByUser(sub.getUser()));
        if (settings != null
                && settings.getPushNotifications() != null
                && settings.getPushNotifications().getType() != null) {
            for (FeedEntry entry : entries) {
                pushNotificationService.notify(settings.getPushNotifications(), sub, entry);
            }
        }
    }
}
