package com.aynreader.security.identity;

import com.aynreader.backend.dao.UnitOfWork;
import com.aynreader.backend.dao.UserDAO;
import com.aynreader.backend.model.User;
import com.aynreader.backend.model.UserRole.Role;
import com.aynreader.backend.service.UserService;
import com.aynreader.backend.service.internal.PostLoginActivities;
import io.quarkus.security.AuthenticationFailedException;
import io.quarkus.security.identity.AuthenticationRequestContext;
import io.quarkus.security.identity.IdentityProvider;
import io.quarkus.security.identity.SecurityIdentity;
import io.quarkus.security.identity.request.TrustedAuthenticationRequest;
import io.quarkus.security.runtime.QuarkusPrincipal;
import io.quarkus.security.runtime.QuarkusSecurityIdentity;
import io.smallrye.mutiny.Uni;
import jakarta.inject.Singleton;
import java.util.Set;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;

@RequiredArgsConstructor
@Singleton
public class TrustedIdentityProvider implements IdentityProvider<TrustedAuthenticationRequest> {

    private final UnitOfWork unitOfWork;
    private final UserService userService;
    private final UserDAO userDAO;
    private final PostLoginActivities postLoginActivities;

    @Override
    public Class<TrustedAuthenticationRequest> getRequestType() {
        return TrustedAuthenticationRequest.class;
    }

    @Override
    public Uni<SecurityIdentity> authenticate(
            TrustedAuthenticationRequest request, AuthenticationRequestContext context) {
        return context.runBlocking(
                () -> {
                    Long userId = Long.valueOf(request.getPrincipal());
                    User user = unitOfWork.call(() -> userDAO.findById(userId));
                    if (user == null) {
                        throw new AuthenticationFailedException("user not found");
                    }

                    // execute post login activities manually because we didn't call login() since
                    // we received
                    // a trusted authentication request
                    unitOfWork.run(() -> postLoginActivities.executeFor(user));

                    Set<Role> roles = unitOfWork.call(() -> userService.getRoles(user));
                    return QuarkusSecurityIdentity.builder()
                            .setPrincipal(new QuarkusPrincipal(String.valueOf(userId)))
                            .addRoles(roles.stream().map(Enum::name).collect(Collectors.toSet()))
                            .build();
                });
    }
}
