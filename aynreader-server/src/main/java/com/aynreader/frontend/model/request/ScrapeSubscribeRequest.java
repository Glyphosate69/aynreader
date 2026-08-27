package com.aynreader.frontend.model.request;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import java.io.Serializable;
import lombok.Data;
import org.eclipse.microprofile.openapi.annotations.media.Schema;

@SuppressWarnings("serial")
@Schema(description = "Scraped feed subscription request")
@Data
public class ScrapeSubscribeRequest implements Serializable {

    @Schema(description = "url of the page to scrape", required = true)
    @NotEmpty
    @Size(max = 4096)
    private String url;

    @Schema(description = "CSS selector matching repeated items", required = true)
    @NotEmpty
    @Size(max = 2048)
    private String itemSelector;

    @Schema(description = "CSS selector for the entry title, relative to each repeated item")
    @Size(max = 2048)
    private String titleSelector;

    @Schema(description = "CSS selector for the entry description, relative to each repeated item")
    @Size(max = 2048)
    private String descriptionSelector;

    @Schema(description = "CSS selector for the entry URL, relative to each repeated item")
    @Size(max = 2048)
    private String urlSelector;

    @Schema(description = "CSS selector for the entry image, relative to each repeated item")
    @Size(max = 2048)
    private String imageSelector;

    @Schema(description = "CSS selector for the entry date, relative to each repeated item")
    @Size(max = 2048)
    private String dateSelector;

    @Schema(description = "name of the feed for the user", required = true)
    @NotEmpty
    @Size(max = 128)
    private String title;

    @Schema(description = "id of the user category to place the feed in")
    @Size(max = 128)
    private String categoryId;
}
