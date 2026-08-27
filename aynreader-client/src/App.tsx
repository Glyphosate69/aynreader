import { i18n } from "@lingui/core"
import { I18nProvider } from "@lingui/react"
import { MantineProvider, v8CssVariablesResolver } from "@mantine/core"
import { ModalsProvider } from "@mantine/modals"
import { Notifications } from "@mantine/notifications"
import type React from "react"
import { useEffect } from "react"
import { HashRouter, Navigate, Route, Routes, useNavigate } from "react-router-dom"
import { Constants } from "@/app/constants"
import { redirectTo } from "@/app/redirect/slice"
import { redirectToInitialSetup } from "@/app/redirect/thunks"
import { reloadServerInfos } from "@/app/server/thunks"
import { useAppDispatch, useAppSelector } from "@/app/store"
import { ErrorBoundary } from "@/components/ErrorBoundary"
import { Header } from "@/components/header/Header"
import { Tree } from "@/components/sidebar/Tree"
import { useI18n } from "@/i18n"
import { AdminUsersPage } from "@/pages/admin/AdminUsersPage"
import { MetricsPage } from "@/pages/admin/MetricsPage"
import { AboutPage } from "@/pages/app/AboutPage"
import { AddPage } from "@/pages/app/AddPage"
import { CategoryDetailsPage } from "@/pages/app/CategoryDetailsPage"
import { FeedDetailsPage } from "@/pages/app/FeedDetailsPage"
import { FeedEntriesPage } from "@/pages/app/FeedEntriesPage"
import Layout from "@/pages/app/Layout"
import { NewsletterPage } from "@/pages/app/NewsletterPage"
import { SettingsPage } from "@/pages/app/SettingsPage"
import { TagDetailsPage } from "@/pages/app/TagDetailsPage"
import { InitialSetupPage } from "@/pages/auth/InitialSetupPage"
import { LoginPage } from "@/pages/auth/LoginPage"
import { PasswordRecoveryPage } from "@/pages/auth/PasswordRecoveryPage"
import { PasswordResetPage } from "@/pages/auth/PasswordResetPage"
import { RegistrationPage } from "@/pages/auth/RegistrationPage"
import { WelcomePage } from "@/pages/WelcomePage"

function Providers(
    props: Readonly<{
        children: React.ReactNode
    }>
) {
    const primaryColor = useAppSelector(state => state.user.settings?.primaryColor) || Constants.theme.defaultPrimaryColor
    return (
        <I18nProvider i18n={i18n}>
            <MantineProvider
                defaultColorScheme="auto"
                // keep using css variables from mantine v8
                cssVariablesResolver={v8CssVariablesResolver}
                theme={{
                    primaryColor: primaryColor,
                    fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
                    headings: {
                        fontFamily: '"Space Grotesk", "IBM Plex Sans", system-ui, sans-serif',
                        fontWeight: "600",
                    },
                    defaultRadius: 8,
                    colors: {
                        acid: [
                            "#fbfff1",
                            "#e9ffc2",
                            "#d9fb91",
                            "#cbf765",
                            "#b8f03c",
                            "#9ed625",
                            "#7fae19",
                            "#5f8312",
                            "#40590c",
                            "#263706",
                        ],
                        data: [
                            "#eff5ff",
                            "#dbe8ff",
                            "#b8d1ff",
                            "#8db6ff",
                            "#4c8dff",
                            "#2f75ff",
                            "#0f62fe",
                            "#004fd4",
                            "#003ea6",
                            "#002a73",
                        ],
                        ink: ["#f2f4f0", "#dfe4de", "#c3cbc1", "#9daaa1", "#77857d", "#5a625f", "#3f4743", "#2c3330", "#1c2421", "#101413"],
                        // keep using dark colors from mantine v6
                        // https://v6.mantine.dev/theming/colors/#default-colors
                        dark: [
                            "#F2F4F0",
                            "#DCE1DA",
                            "#BFC7BE",
                            "#8B948F",
                            "#5A625F",
                            "#2C3330",
                            "#1F2624",
                            "#161B19",
                            "#0B0F0E",
                            "#070A09",
                        ],
                    },
                }}
            >
                <ModalsProvider>
                    <Notifications position="bottom-right" zIndex={9999} />
                    <ErrorBoundary>{props.children}</ErrorBoundary>
                </ModalsProvider>
            </MantineProvider>
        </I18nProvider>
    )
}

function AppRoutes() {
    const sidebarVisible = useAppSelector(state => state.tree.sidebarVisible)

    return (
        <Routes>
            <Route path="/" element={<Navigate to={`/app/category/${Constants.categories.all.id}`} replace />} />
            <Route path="welcome" element={<WelcomePage />} />
            <Route path="setup" element={<InitialSetupPage />} />
            <Route path="login" element={<LoginPage />} />
            <Route path="register" element={<RegistrationPage />} />
            <Route path="passwordRecovery" element={<PasswordRecoveryPage />} />
            <Route path="passwordReset" element={<PasswordResetPage />} />
            <Route path="app" element={<Layout header={<Header />} sidebar={<Tree />} sidebarVisible={sidebarVisible} />}>
                <Route path="category">
                    <Route path=":id" element={<FeedEntriesPage sourceType="category" />} />
                    <Route path=":id/details" element={<CategoryDetailsPage />} />
                </Route>
                <Route path="feed">
                    <Route path=":id" element={<FeedEntriesPage sourceType="feed" />} />
                    <Route path=":id/details" element={<FeedDetailsPage />} />
                </Route>
                <Route path="tag">
                    <Route path=":id" element={<FeedEntriesPage sourceType="tag" />} />
                    <Route path=":id/details" element={<TagDetailsPage />} />
                </Route>
                <Route path="add" element={<AddPage />} />
                <Route path="newsletter" element={<NewsletterPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="admin">
                    <Route path="users" element={<AdminUsersPage />} />
                    <Route path="metrics" element={<MetricsPage />} />
                </Route>
                <Route path="about" element={<AboutPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    )
}

function InitialSetupHandler() {
    const serverInfos = useAppSelector(state => state.server.serverInfos)
    const dispatch = useAppDispatch()
    useEffect(() => {
        if (serverInfos?.initialSetupRequired) {
            dispatch(redirectToInitialSetup())
        }
    }, [serverInfos, dispatch])

    return null
}

function RedirectHandler() {
    const target = useAppSelector(state => state.redirect.to)
    const dispatch = useAppDispatch()
    const navigate = useNavigate()
    useEffect(() => {
        if (target) {
            // pages can subscribe to state.timestamp in order to refresh when navigating to an url matching the current page
            navigate(target, { state: { timestamp: new Date() } })
            dispatch(redirectTo(undefined))
        }
    }, [target, dispatch, navigate])

    return null
}

export function App() {
    useI18n()
    const dispatch = useAppDispatch()

    useEffect(() => {
        dispatch(reloadServerInfos())
    }, [dispatch])

    return (
        <Providers>
            <HashRouter>
                <InitialSetupHandler />
                <RedirectHandler />
                <AppRoutes />
            </HashRouter>
        </Providers>
    )
}
