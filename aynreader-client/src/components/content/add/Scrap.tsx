import { Trans } from "@lingui/react/macro"
import { Box, Button, Code, Group, SegmentedControl, Stack, Stepper, Table, Text, TextInput, Tooltip } from "@mantine/core"
import { useForm } from "@mantine/form"
import { useEffect, useMemo, useState } from "react"
import { useAsyncCallback } from "react-async-hook"
import { TbEyeSearch, TbInfoCircle, TbPointer, TbRss } from "react-icons/tb"
import { client, errorToStrings } from "@/app/client"
import { Constants } from "@/app/constants"
import { reloadEntries } from "@/app/entries/thunks"
import { redirectToFeed } from "@/app/redirect/thunks"
import { useAppDispatch } from "@/app/store"
import { reloadTree } from "@/app/tree/thunks"
import type { ScrapeSubscribeRequest } from "@/app/types"
import { Alert } from "@/components/Alert"
import { CategorySelect } from "./CategorySelect"

const scraperApiBase = import.meta.env.VITE_SCRAPER_API_BASE || "http://localhost:3000"
const outputColumns = ["title", "description", "url", "date", "image"] as const
const maxFeedTitleLength = 128
const defaultCategoryId = Constants.categories.all.id

const selectorHelp = {
    itemSelector:
        "Colle le selector d'une carte exemple, ex: #resultats > ul > li:nth-child(1). AynReader cherche ensuite les cartes répétées autour. Un selector commun ou un conteneur marche aussi.",
    titleSelector: "À l'intérieur du bloc, l'élément qui contient le titre: h2, .title, a...",
    descriptionSelector: "Optionnel. À l'intérieur du bloc, le résumé ou extrait: p, .summary, .description. Laisse vide pour auto.",
    urlSelector: "À l'intérieur du bloc, le lien de l'article. Cible un a[href].",
    imageSelector: "Optionnel. À l'intérieur du bloc, l'image de l'article. Cible un img[src]. Laisse vide pour auto.",
    dateSelector: "À l'intérieur du bloc, la date. Cible idéalement time[datetime].",
} as const

interface LoadResponse {
    html: string
    finalUrl: string
}

interface ExtractedField {
    title?: string
    description?: string
    url?: string
    date?: string
    image?: string
}

interface ExtractResponse {
    count: number
    similarSelector: string
    usedFallback: boolean
    fieldSelectors?: {
        titleSelector?: string
        descriptionSelector?: string
        urlSelector?: string
        imageSelector?: string
        dateSelector?: string
    }
    fields: ExtractedField[]
}

interface SelectionMessage {
    type: "visual-scraper:selected"
    selector: string
    level: number
    maxLevel: number
    tag: string
}

async function postJson<T>(path: string, body: unknown) {
    let response: Response
    try {
        response = await fetch(`${scraperApiBase}${path}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
        })
    } catch {
        throw new Error("Le service scraper local ne répond pas. Lance le service scraper local du projet.")
    }
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.error || `Erreur HTTP ${response.status}.`)
    return payload as T
}

function normalizeUrl(url: string) {
    const trimmed = url.trim()
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed.replace(/^\/+/, "")}`
}

function normalizeFeedTitle(title: string, fallbackUrl: string) {
    const fallbackTitle = new URL(fallbackUrl).hostname.replace(/^www\./i, "")
    const normalized = (title || fallbackTitle).replace(/\s+/g, " ").trim()
    const navigationTerms = normalized.match(
        /\b(?:press products|today in dow|live events|releases|advisories|transcripts|speeches|publications|contracts|news stories|feature stories)\b/gi
    )
    if (normalized.length > 80 || (navigationTerms?.length || 0) >= 3) return fallbackTitle
    return normalized.slice(0, maxFeedTitleLength)
}

function normalizeScrapeRequest(values: ScrapeSubscribeRequest): ScrapeSubscribeRequest {
    return {
        ...values,
        url: normalizeUrl(values.url),
        itemSelector: values.itemSelector.trim(),
        titleSelector: values.titleSelector?.trim(),
        descriptionSelector: values.descriptionSelector?.trim(),
        urlSelector: values.urlSelector?.trim(),
        imageSelector: values.imageSelector?.trim(),
        dateSelector: values.dateSelector?.trim(),
        title: normalizeFeedTitle(values.title, values.url),
    }
}

function normalizeFieldValue(value: string | undefined) {
    return (value || "").replace(/\s+/g, " ").trim().toLocaleLowerCase()
}

function findRepeatedTitle(fields: ExtractedField[]) {
    const seen = new Set<string>()
    for (const field of fields) {
        const title = normalizeFieldValue(field.title)
        if (!title) continue
        if (seen.has(title)) return field.title
        seen.add(title)
    }
    return undefined
}

function isSelectionMessage(data: unknown): data is SelectionMessage {
    return typeof data === "object" && data !== null && "type" in data && data.type === "visual-scraper:selected"
}

export function Scrap() {
    const dispatch = useAppDispatch()
    const [activeStep, setActiveStep] = useState(0)
    const [scrapeMode, setScrapeMode] = useState<"auto" | "manual">("auto")
    const [error, setError] = useState<string>()
    const [status, setStatus] = useState(<Trans>Paste a page URL to start.</Trans>)
    const [html, setHtml] = useState("")
    const [finalUrl, setFinalUrl] = useState("")
    const [selector, setSelector] = useState("")
    const [scraperReady, setScraperReady] = useState<boolean>()
    const [levelHelp, setLevelHelp] = useState(
        <Trans>Click one news card or one repeated item. Use up/down only to adjust that card.</Trans>
    )
    const [extraction, setExtraction] = useState<ExtractResponse>()

    const loadForm = useForm({
        initialValues: {
            url: "",
        },
    })

    const manualForm = useForm({
        initialValues: {
            url: "",
            itemSelector: "",
            titleSelector: "",
            descriptionSelector: "",
            urlSelector: "",
            imageSelector: "",
            dateSelector: "",
            title: "",
        },
        validate: {
            url: value => (value.trim().length === 0 ? <Trans>Page URL is required.</Trans> : null),
            itemSelector: value => (value.trim().length === 0 ? <Trans>CSS selector is required.</Trans> : null),
            title: value =>
                value.trim().length > maxFeedTitleLength ? (
                    <Trans>Feed name must be 128 characters or less.</Trans>
                ) : value.trim().length === 0 ? (
                    <Trans>Feed name is required.</Trans>
                ) : null,
        },
    })

    const subscribeForm = useForm<ScrapeSubscribeRequest>({
        initialValues: {
            url: "",
            itemSelector: "",
            titleSelector: "",
            descriptionSelector: "",
            urlSelector: "",
            imageSelector: "",
            dateSelector: "",
            title: "",
            categoryId: defaultCategoryId,
        },
        validate: {
            title: value =>
                value.trim().length > maxFeedTitleLength ? (
                    <Trans>Feed name must be 128 characters or less.</Trans>
                ) : value.trim().length === 0 ? (
                    <Trans>Feed name is required.</Trans>
                ) : null,
            itemSelector: value => (value.trim().length === 0 ? <Trans>CSS selector is required.</Trans> : null),
        },
    })

    useEffect(() => {
        const listener = (event: MessageEvent) => {
            if (!isSelectionMessage(event.data)) return
            setSelector(event.data.selector)
            const level = Number(event.data.level || 0)
            const maxLevel = Number(event.data.maxLevel || 0)
            setLevelHelp(
                <>
                    Niveau {level + 1}/{maxLevel + 1} ({event.data.tag || "element"}).{" "}
                    {level < maxLevel ? "Haut: parent." : "Haut: limite atteinte."} {level > 0 ? "Bas: enfant." : "Bas: limite atteinte."}
                </>
            )
            setStatus(<Trans>Item selected. Adjust with up/down if needed, then run detection.</Trans>)
        }

        window.addEventListener("message", listener)
        return () => window.removeEventListener("message", listener)
    }, [])

    useEffect(() => {
        fetch(`${scraperApiBase}/api/health`)
            .then(response => setScraperReady(response.ok))
            .catch(() => setScraperReady(false))
    }, [])

    const rows = useMemo(() => extraction?.fields || [], [extraction])

    const selectorHelpIcon = (message: string) => (
        <Tooltip label={message} multiline w={260} withArrow>
            <Box component="span" c="dimmed" style={{ display: "flex" }}>
                <TbInfoCircle size={16} />
            </Box>
        </Tooltip>
    )

    const selectorInputProps = (message: string) => ({
        rightSection: selectorHelpIcon(message),
        rightSectionPointerEvents: "all" as const,
    })

    const loadPage = useAsyncCallback(async ({ url }: { url: string }) => {
        setError(undefined)
        setHtml("")
        setFinalUrl("")
        setSelector("")
        setExtraction(undefined)
        setLevelHelp(<Trans>Click one news card or one repeated item. Use up/down only to adjust that card.</Trans>)

        const normalizedUrl = normalizeUrl(url)
        loadForm.setFieldValue("url", normalizedUrl)
        setStatus(<Trans>Loading page...</Trans>)
        const payload = await postJson<LoadResponse>("/api/load", { url: normalizedUrl })
        setHtml(payload.html)
        setFinalUrl(payload.finalUrl)
        setStatus(<Trans>Page loaded. Click one article card, product row, result, or another repeated item.</Trans>)
    })

    const detectElements = useAsyncCallback(async () => {
        if (!selector) return
        setError(undefined)
        setStatus(<Trans>Detecting similar elements...</Trans>)
        const payload = await postJson<ExtractResponse>("/api/extract", {
            url: finalUrl || loadForm.values.url,
            selector,
        })
        const repeatedTitle = findRepeatedTitle(payload.fields)
        if (repeatedTitle) {
            setExtraction(undefined)
            throw new Error(
                `Titre répété détecté: "${repeatedTitle}". La zone sélectionnée n'est pas une carte d'article valide. Sélectionne un élément plus précis qui contient un titre unique par ligne.`
            )
        }
        setExtraction(payload)
        const detectedItemSelector = payload.similarSelector
        subscribeForm.setValues({
            url: finalUrl || loadForm.values.url,
            itemSelector: detectedItemSelector,
            titleSelector: payload.fieldSelectors?.titleSelector || "",
            descriptionSelector: payload.fieldSelectors?.descriptionSelector || "",
            urlSelector: payload.fieldSelectors?.urlSelector || "",
            imageSelector: payload.fieldSelectors?.imageSelector || "",
            dateSelector: payload.fieldSelectors?.dateSelector || "",
            title: normalizeFeedTitle(payload.fields[0]?.title || "", finalUrl || loadForm.values.url),
            categoryId: defaultCategoryId,
        })
        setActiveStep(1)
        setStatus(
            <>
                {payload.count} élément(s) détecté(s). Groupe: {payload.similarSelector}.
                {payload.usedFallback ? " Sélection approximative: meilleur groupe répétitif proposé automatiquement." : ""}
            </>
        )
    })

    const previewManualSelectors = useAsyncCallback(async (values: ScrapeSubscribeRequest) => {
        const normalizedUrl = normalizeUrl(values.url)
        const selector = values.itemSelector.trim()

        setError(undefined)
        setHtml("")
        setFinalUrl(normalizedUrl)
        setSelector("")
        setStatus(<>Analyse des selectors manuels...</>)
        const payload = await postJson<ExtractResponse>("/api/manual-extract", {
            url: normalizedUrl,
            itemSelector: selector,
            titleSelector: values.titleSelector?.trim(),
            descriptionSelector: values.descriptionSelector?.trim(),
            urlSelector: values.urlSelector?.trim(),
            imageSelector: values.imageSelector?.trim(),
            dateSelector: values.dateSelector?.trim(),
        })
        if (payload.count < 2) {
            setExtraction(undefined)
            throw new Error(
                `Le selector "${selector}" ne permet pas de trouver un groupe de cartes répétées. Colle le selector d'une carte de news complète, ou celui du conteneur de la liste.`
            )
        }

        const itemSelector = payload.similarSelector || selector
        setExtraction(payload)
        loadForm.setFieldValue("url", normalizedUrl)
        subscribeForm.setValues({
            url: normalizedUrl,
            itemSelector,
            titleSelector: values.titleSelector?.trim() ?? "",
            descriptionSelector: values.descriptionSelector?.trim() ?? "",
            urlSelector: values.urlSelector?.trim() ?? "",
            imageSelector: values.imageSelector?.trim() ?? "",
            dateSelector: values.dateSelector?.trim() ?? "",
            title: normalizeFeedTitle(values.title || payload.fields[0]?.title || "", normalizedUrl),
            categoryId: defaultCategoryId,
        })
        setActiveStep(1)
        setStatus(
            <>
                {payload.count} carte(s) trouvée(s) avec le selector manuel: {itemSelector}.
                {payload.usedFallback ? " Groupe répété détecté automatiquement depuis ton selector." : ""}
            </>
        )
    })

    const verifySelectors = async (values: ScrapeSubscribeRequest) => {
        const request = normalizeScrapeRequest(values)
        const preview = await postJson<ExtractResponse>("/api/manual-extract", {
            url: request.url,
            itemSelector: request.itemSelector,
            titleSelector: request.titleSelector,
            descriptionSelector: request.descriptionSelector,
            urlSelector: request.urlSelector,
            imageSelector: request.imageSelector,
            dateSelector: request.dateSelector,
        })
        if (preview.count < 2) {
            throw new Error(`Le selector "${request.itemSelector}" ne trouve pas plusieurs cartes d'actualité.`)
        }
        const repeatedTitle = findRepeatedTitle(preview.fields)
        if (repeatedTitle) {
            throw new Error(`Titre répété détecté: "${repeatedTitle}". Corrige les selectors avant de créer la source.`)
        }
        return {
            preview,
            request: {
                ...request,
                itemSelector: preview.similarSelector || request.itemSelector,
            },
        }
    }

    const previewUpdatedSelectors = useAsyncCallback(async () => {
        setError(undefined)
        setStatus(<Trans>Testing the current selectors...</Trans>)
        const { preview, request } = await verifySelectors(subscribeForm.values)
        setExtraction(preview)
        subscribeForm.setValues(request)
        setStatus(<>{preview.count} carte(s) vérifiée(s) avec les selectors actuels.</>)
    })

    const subscribe = useAsyncCallback(
        async (values: ScrapeSubscribeRequest) => {
            setError(undefined)
            setStatus(<Trans>Applying selectors...</Trans>)
            const { preview, request } = await verifySelectors(values)
            setExtraction(preview)
            subscribeForm.setValues(request)
            setStatus(<>{preview.count} carte(s) vérifiée(s) avec les selectors actuels.</>)
            return await client.feed.subscribeScraped(request)
        },
        {
            onSuccess: sub => {
                dispatch(reloadTree())
                    .then(() => dispatch(redirectToFeed(sub.data)))
                    .then(() => {
                        window.setTimeout(() => dispatch(reloadEntries()), 2000)
                        window.setTimeout(() => dispatch(reloadEntries()), 6000)
                    })
            },
        }
    )

    const loadError = loadPage.error || detectElements.error || previewManualSelectors.error || previewUpdatedSelectors.error
    const subscribeError = subscribe.error

    return (
        <Stack>
            {scraperReady === false && (
                <Alert level="warning" messages={["Le service scraper local ne répond pas. Lance le service scraper local du projet."]} />
            )}
            {error && <Alert messages={[error]} />}
            {loadError && <Alert messages={[loadError instanceof Error ? loadError.message : "Erreur pendant l'analyse de la page."]} />}
            {subscribeError && <Alert messages={errorToStrings(subscribeError)} />}

            <Stepper active={activeStep} onStepClick={setActiveStep}>
                <Stepper.Step label={<Trans>Analyze page</Trans>} description={<Trans>Select the repeated area</Trans>}>
                    <Stack>
                        <SegmentedControl
                            value={scrapeMode}
                            onChange={value => setScrapeMode(value as "auto" | "manual")}
                            data={[
                                { label: "Detection automatique", value: "auto" },
                                { label: "Selectors manuels", value: "manual" },
                            ]}
                        />

                        {scrapeMode === "auto" ? (
                            <form onSubmit={loadForm.onSubmit(loadPage.execute)}>
                                <Stack>
                                    <Group align="end">
                                        <TextInput
                                            label={<Trans>Page URL</Trans>}
                                            placeholder="https://www.mysite.com/articles"
                                            required
                                            style={{ flex: 1 }}
                                            {...loadForm.getInputProps("url")}
                                        />
                                        <Button type="submit" leftSection={<TbEyeSearch size={16} />} loading={loadPage.loading}>
                                            <Trans>Load</Trans>
                                        </Button>
                                    </Group>

                                    <Box
                                        h={420}
                                        style={{
                                            border: "1px solid var(--mantine-color-default-border)",
                                            borderRadius: 4,
                                            overflow: "hidden",
                                        }}
                                    >
                                        <iframe
                                            title="Page à scraper"
                                            srcDoc={html}
                                            sandbox="allow-same-origin allow-scripts allow-popups"
                                            style={{ width: "100%", height: "100%", border: 0 }}
                                        />
                                    </Box>

                                    <Box>
                                        <Text size="sm" fw={700}>
                                            <Trans>Selected item</Trans>
                                        </Text>
                                        <Code block>{selector || "Aucune"}</Code>
                                        <Text size="sm" c="dimmed" mt="xs">
                                            {levelHelp}
                                        </Text>
                                    </Box>

                                    <Group justify="center">
                                        <Button
                                            leftSection={<TbPointer size={16} />}
                                            disabled={!selector}
                                            loading={detectElements.loading}
                                            onClick={detectElements.execute}
                                        >
                                            <Trans>Detect elements</Trans>
                                        </Button>
                                    </Group>
                                </Stack>
                            </form>
                        ) : (
                            <form onSubmit={manualForm.onSubmit(previewManualSelectors.execute)}>
                                <Stack>
                                    <TextInput
                                        label={<Trans>Page URL</Trans>}
                                        placeholder="https://www.mysite.com/articles"
                                        required
                                        {...manualForm.getInputProps("url")}
                                    />
                                    <TextInput
                                        label="Example card selector"
                                        placeholder="#resultats > ul > li:nth-child(1)"
                                        required
                                        {...selectorInputProps(selectorHelp.itemSelector)}
                                        {...manualForm.getInputProps("itemSelector")}
                                    />
                                    <TextInput
                                        label="Title selector"
                                        placeholder="h2, .title, a"
                                        {...selectorInputProps(selectorHelp.titleSelector)}
                                        {...manualForm.getInputProps("titleSelector")}
                                    />
                                    <TextInput
                                        label="Description selector (optional)"
                                        placeholder="p, .summary, .excerpt"
                                        {...selectorInputProps(selectorHelp.descriptionSelector)}
                                        {...manualForm.getInputProps("descriptionSelector")}
                                    />
                                    <TextInput
                                        label="URL selector"
                                        placeholder="a[href]"
                                        {...selectorInputProps(selectorHelp.urlSelector)}
                                        {...manualForm.getInputProps("urlSelector")}
                                    />
                                    <TextInput
                                        label="Image selector (optional)"
                                        placeholder="img[src]"
                                        {...selectorInputProps(selectorHelp.imageSelector)}
                                        {...manualForm.getInputProps("imageSelector")}
                                    />
                                    <TextInput
                                        label="Date selector"
                                        placeholder="time[datetime], .date"
                                        {...selectorInputProps(selectorHelp.dateSelector)}
                                        {...manualForm.getInputProps("dateSelector")}
                                    />
                                    <TextInput
                                        label={<Trans>Feed name</Trans>}
                                        required
                                        maxLength={maxFeedTitleLength}
                                        {...manualForm.getInputProps("title")}
                                    />
                                    <Group justify="center">
                                        <Button
                                            type="submit"
                                            leftSection={<TbEyeSearch size={16} />}
                                            loading={previewManualSelectors.loading}
                                        >
                                            Tester les selectors
                                        </Button>
                                    </Group>
                                </Stack>
                            </form>
                        )}
                    </Stack>
                </Stepper.Step>

                <Stepper.Step label={<Trans>Create feed</Trans>} description={<Trans>Save this scraping rule</Trans>}>
                    <form onSubmit={subscribeForm.onSubmit(subscribe.execute)}>
                        <Stack>
                            <Text size="sm" c="dimmed">
                                {status}
                            </Text>
                            <TextInput
                                label={<Trans>Feed name</Trans>}
                                required
                                maxLength={maxFeedTitleLength}
                                {...subscribeForm.getInputProps("title")}
                            />
                            <TextInput label={<Trans>Page URL</Trans>} disabled {...subscribeForm.getInputProps("url")} />
                            <TextInput
                                label="Cards selector"
                                required
                                {...selectorInputProps(selectorHelp.itemSelector)}
                                {...subscribeForm.getInputProps("itemSelector")}
                            />
                            <TextInput
                                label="Title selector"
                                {...selectorInputProps(selectorHelp.titleSelector)}
                                {...subscribeForm.getInputProps("titleSelector")}
                            />
                            <TextInput
                                label="Description selector (optional)"
                                {...selectorInputProps(selectorHelp.descriptionSelector)}
                                {...subscribeForm.getInputProps("descriptionSelector")}
                            />
                            <TextInput
                                label="URL selector"
                                {...selectorInputProps(selectorHelp.urlSelector)}
                                {...subscribeForm.getInputProps("urlSelector")}
                            />
                            <TextInput
                                label="Image selector (optional)"
                                {...selectorInputProps(selectorHelp.imageSelector)}
                                {...subscribeForm.getInputProps("imageSelector")}
                            />
                            <TextInput
                                label="Date selector"
                                {...selectorInputProps(selectorHelp.dateSelector)}
                                {...subscribeForm.getInputProps("dateSelector")}
                            />
                            <CategorySelect label={<Trans>Category</Trans>} {...subscribeForm.getInputProps("categoryId")} clearable />

                            {rows.length > 0 && (
                                <Table striped withTableBorder>
                                    <Table.Thead>
                                        <Table.Tr>
                                            {outputColumns.map(column => (
                                                <Table.Th key={column}>{column}</Table.Th>
                                            ))}
                                        </Table.Tr>
                                    </Table.Thead>
                                    <Table.Tbody>
                                        {rows.slice(0, 5).map(row => (
                                            <Table.Tr key={`${row.url}-${row.title}-${row.date}-${row.image}`}>
                                                {outputColumns.map(column => (
                                                    <Table.Td key={column}>{row[column]}</Table.Td>
                                                ))}
                                            </Table.Tr>
                                        ))}
                                    </Table.Tbody>
                                </Table>
                            )}

                            <Group justify="center">
                                <Button variant="default" onClick={() => setActiveStep(0)}>
                                    <Trans>Back</Trans>
                                </Button>
                                <Button
                                    type="button"
                                    variant="default"
                                    leftSection={<TbEyeSearch size={16} />}
                                    loading={previewUpdatedSelectors.loading}
                                    onClick={previewUpdatedSelectors.execute}
                                >
                                    Tester les selectors modifiés
                                </Button>
                                <Button type="submit" leftSection={<TbRss size={16} />} loading={subscribe.loading}>
                                    <Trans>Create feed</Trans>
                                </Button>
                            </Group>
                        </Stack>
                    </form>
                </Stepper.Step>
            </Stepper>
        </Stack>
    )
}
