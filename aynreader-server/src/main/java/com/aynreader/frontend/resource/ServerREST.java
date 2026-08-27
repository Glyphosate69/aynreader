package com.aynreader.frontend.resource;

import com.aynreader.AynReaderConfiguration;
import com.aynreader.AynReaderVersion;
import com.aynreader.backend.HttpGetter;
import com.aynreader.backend.HttpGetter.HttpResult;
import com.aynreader.backend.feed.ImageProxyUrl;
import com.aynreader.backend.service.db.DatabaseStartupService;
import com.aynreader.frontend.model.ServerInfo;
import com.aynreader.security.Roles;
import jakarta.annotation.security.PermitAll;
import jakarta.annotation.security.RolesAllowed;
import jakarta.inject.Singleton;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.Response.Status;
import lombok.RequiredArgsConstructor;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.parameters.Parameter;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

@Path("/rest/server")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@RequiredArgsConstructor
@Singleton
@Tag(name = "Server")
public class ServerREST {

    private final HttpGetter httpGetter;
    private final AynReaderConfiguration config;
    private final AynReaderVersion version;
    private final DatabaseStartupService databaseStartupService;

    @Path("/get")
    @GET
    @PermitAll
    @Transactional
    @Operation(summary = "Get server infos", description = "Get server infos")
    public ServerInfo getServerInfos() {
        ServerInfo infos = new ServerInfo();
        infos.setAnnouncement(config.announcement().orElse(null));
        infos.setVersion(version.getVersion());
        infos.setGitCommit(version.getGitCommit());
        infos.setAllowRegistrations(config.users().allowRegistrations());
        infos.setEmailAddressRequired(config.users().emailAddressRequired());
        infos.setSmtpEnabled(config.passwordRecoveryEnabled());
        infos.setDemoAccountEnabled(config.users().createDemoAccount());
        infos.setWebsocketEnabled(config.websocket().enabled());
        infos.setWebsocketPingInterval(config.websocket().pingInterval().toMillis());
        infos.setTreeReloadInterval(config.websocket().treeReloadInterval().toMillis());
        infos.setForceRefreshCooldownDuration(
                config.feedRefresh().forceRefreshCooldownDuration().toMillis());
        infos.setInitialSetupRequired(databaseStartupService.isInitialSetupRequired());
        infos.setMinimumPasswordLength(config.users().minimumPasswordLength());
        infos.setPushNotificationsEnabled(config.pushNotifications().enabled());
        return infos;
    }

    @Path("/proxy")
    @GET
    @RolesAllowed(Roles.USER)
    @Transactional
    @Operation(summary = "proxy image")
    @Produces("image/png")
    public Response getProxiedImage(
            @Parameter(description = "image url", required = true) @QueryParam("u") String url) {
        if (!config.imageProxyEnabled()) {
            return Response.status(Status.FORBIDDEN).build();
        }

        url = ImageProxyUrl.decode(url);
        try {
            HttpResult result = httpGetter.get(url);
            return Response.ok(result.content()).build();
        } catch (Exception e) {
            return Response.status(Status.SERVICE_UNAVAILABLE).entity(e.getMessage()).build();
        }
    }
}
