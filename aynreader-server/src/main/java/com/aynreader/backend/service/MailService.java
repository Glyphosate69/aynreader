package com.aynreader.backend.service;

import com.aynreader.backend.model.User;
import io.quarkus.mailer.Mail;
import io.quarkus.mailer.Mailer;
import jakarta.inject.Singleton;
import lombok.RequiredArgsConstructor;

@RequiredArgsConstructor
@Singleton
public class MailService {

    private final Mailer mailer;

    public void sendMail(User user, String subject, String content) {
        Mail mail = Mail.withHtml(user.getEmail(), "Ayn Reader OS - " + subject, content);
        mailer.send(mail);
    }
}
