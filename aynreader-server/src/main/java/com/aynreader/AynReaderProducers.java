package com.aynreader;

import com.codahale.metrics.MetricRegistry;
import jakarta.enterprise.inject.Produces;
import jakarta.inject.Singleton;
import java.time.InstantSource;

@Singleton
public class AynReaderProducers {

    @Produces
    @Singleton
    public InstantSource instantSource() {
        return InstantSource.system();
    }

    @Produces
    @Singleton
    public MetricRegistry metricRegistry() {
        return new MetricRegistry();
    }
}
