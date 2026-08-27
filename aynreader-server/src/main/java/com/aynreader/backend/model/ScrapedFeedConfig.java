package com.aynreader.backend.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.Lob;
import jakarta.persistence.OneToOne;
import jakarta.persistence.Table;
import java.sql.Types;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;

@Entity
@Table(name = "SCRAPEDFEEDCONFIGS")
@SuppressWarnings("serial")
@Getter
@Setter
public class ScrapedFeedConfig extends AbstractModel {

    @OneToOne(fetch = FetchType.LAZY)
    @JoinColumn(nullable = false, unique = true)
    private Feed feed;

    @Lob
    @Column(name = "page_url", length = Integer.MAX_VALUE, nullable = false)
    @JdbcTypeCode(Types.LONGVARCHAR)
    private String pageUrl;

    @Column(name = "item_selector", length = 2048, nullable = false)
    private String itemSelector;

    @Column(name = "title_selector", length = 2048)
    private String titleSelector;

    @Column(name = "description_selector", length = 2048)
    private String descriptionSelector;

    @Column(name = "url_selector", length = 2048)
    private String urlSelector;

    @Column(name = "image_selector", length = 2048)
    private String imageSelector;

    @Column(name = "date_selector", length = 2048)
    private String dateSelector;
}
