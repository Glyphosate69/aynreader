import { msg } from "@lingui/core/macro"
import { Anchor, Box, Center, Container, Divider, Group, Space, Text, Title, useMantineColorScheme } from "@mantine/core"
import { useAsyncCallback } from "react-async-hook"
import { TbClock, TbKey, TbMoon, TbSettings, TbSun, TbUserPlus } from "react-icons/tb"
import { client } from "@/app/client"
import { redirectToApiDocumentation, redirectToLogin, redirectToRegistration, redirectToRootCategory } from "@/app/redirect/thunks"
import { useAppDispatch, useAppSelector } from "@/app/store"
import { ActionButton } from "@/components/ActionButton"
import { useBrowserExtension } from "@/hooks/useBrowserExtension"
import { useMobile } from "@/hooks/useMobile"
import { PageTitle } from "./PageTitle"

const iconSize = 18

export function WelcomePage() {
    const serverInfos = useAppSelector(state => state.server.serverInfos)
    const dispatch = useAppDispatch()

    const login = useAsyncCallback(client.user.login, {
        onSuccess: () => {
            dispatch(redirectToRootCategory())
        },
    })

    return (
        <Container size="lg" className="ayn-welcome">
            <Header />

            <Box className="ayn-welcome-hero">
                <Box>
                    <Text className="ayn-kicker">Reader OS · veille, data, decision</Text>
                    <Title order={1} mt="md">
                        Voir avant les autres.
                    </Title>
                    <Text className="ayn-lead" mt="lg">
                        Ayn Reader OS est un poste de veille sobre: sources, signaux et lectures organisees pour decider sans bruit.
                    </Text>
                    <Group mt="xl">
                        <Buttons />
                    </Group>
                </Box>

                <Box className="ayn-dashboard" aria-label="Ayn Reader OS dashboard preview">
                    <Group justify="space-between">
                        <Text className="ayn-label">SIGNAUX DETECTES</Text>
                        <Text className="ayn-label">SOURCES</Text>
                    </Group>
                    <Box className="ayn-dashboard-grid">
                        <Box className="ayn-signal-card">
                            <Text className="ayn-label">INDICE DE TENSION</Text>
                            <strong>72,4</strong>
                            <small>+4,1 pts sur 30 jours</small>
                        </Box>
                        <Box className="ayn-signal-card">
                            <Text className="ayn-label">DONNEES CROISEES</Text>
                            <div className="ayn-bars" aria-hidden>
                                <span style={{ height: 76 }} />
                                <span style={{ height: 58 }} />
                                <span style={{ height: 68 }} />
                                <span style={{ height: 44 }} />
                                <span style={{ height: 28 }} />
                            </div>
                            <small>Pic sur l'energie · semaine 28</small>
                        </Box>
                    </Box>
                    <Box className="ayn-source-row">
                        <span>Analyse datee</span>
                        <span>Decision assistee</span>
                    </Box>
                </Box>
            </Box>

            {serverInfos?.demoAccountEnabled && (
                <Center mb="xl">
                    <ActionButton
                        label={msg`Try the demo!`}
                        icon={<TbClock size={iconSize} />}
                        variant="outline"
                        onClick={async () => await login.execute({ name: "demo", password: "demo" })}
                        showLabelOnMobile
                    />
                </Center>
            )}

            <Divider my="lg" />

            <Footer />

            <Space h="lg" />
        </Container>
    )
}

function Header() {
    const mobile = useMobile()

    if (mobile) {
        return <PageTitle />
    }

    return (
        <Group justify="space-between">
            <Box>
                <PageTitle />
            </Box>
            <Box />
        </Group>
    )
}

function Buttons() {
    const serverInfos = useAppSelector(state => state.server.serverInfos)
    const { colorScheme, toggleColorScheme } = useMantineColorScheme()
    const { isBrowserExtensionPopup, openSettingsPage } = useBrowserExtension()
    const dispatch = useAppDispatch()
    const dark = colorScheme === "dark"

    return (
        <Group gap={14}>
            <ActionButton
                label={msg`Log in`}
                icon={<TbKey size={iconSize} />}
                variant="outline"
                onClick={async () => await dispatch(redirectToLogin())}
                showLabelOnMobile
            />
            {serverInfos?.allowRegistrations && (
                <ActionButton
                    label={msg`Sign up`}
                    icon={<TbUserPlus size={iconSize} />}
                    variant="filled"
                    onClick={async () => await dispatch(redirectToRegistration())}
                    showLabelOnMobile
                />
            )}

            <ActionButton
                label={dark ? msg`Switch to light theme` : msg`Switch to dark theme`}
                icon={colorScheme === "dark" ? <TbSun size={18} /> : <TbMoon size={iconSize} />}
                onClick={() => toggleColorScheme()}
                hideLabelOnDesktop
            />

            {isBrowserExtensionPopup && (
                <ActionButton
                    label={msg`Extension options`}
                    icon={<TbSettings size={iconSize} />}
                    onClick={() => openSettingsPage()}
                    hideLabelOnDesktop
                />
            )}
        </Group>
    )
}

function Footer() {
    const dispatch = useAppDispatch()
    return (
        <Group justify="space-between">
            <Group>
                <span>© Ayn Reader OS</span>
            </Group>
            <Box>
                <Anchor variant="text" onClick={async () => await dispatch(redirectToApiDocumentation())}>
                    API documentation
                </Anchor>
            </Box>
        </Group>
    )
}
