package com.aynreader.backend.dao;

import com.aynreader.backend.model.ScrapedFeedConfig;
import jakarta.inject.Singleton;
import jakarta.persistence.EntityManager;

@Singleton
public class ScrapedFeedConfigDAO extends GenericDAO<ScrapedFeedConfig> {

    private final EntityManager entityManager;

    public ScrapedFeedConfigDAO(EntityManager entityManager) {
        super(entityManager, ScrapedFeedConfig.class);
        this.entityManager = entityManager;
    }

    public ScrapedFeedConfig findByFeedId(Long feedId) {
        return entityManager
                .createQuery(
                        "select c from ScrapedFeedConfig c where c.feed.id = :feedId",
                        ScrapedFeedConfig.class)
                .setParameter("feedId", feedId)
                .getResultStream()
                .findFirst()
                .orElse(null);
    }
}
