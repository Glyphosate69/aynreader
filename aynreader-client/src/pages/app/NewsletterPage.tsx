import {
    ActionIcon,
    Box,
    Button,
    Checkbox,
    Divider,
    Group,
    MultiSelect,
    SegmentedControl,
    Stack,
    Stepper,
    Switch,
    Text,
    TextInput,
    Title,
    Tooltip,
    UnstyledButton,
} from "@mantine/core"
import { DateInput } from "@mantine/dates"
import { openConfirmModal } from "@mantine/modals"
import { showNotification } from "@mantine/notifications"
import { useEffect, useMemo, useRef, useState } from "react"
import { TbArrowLeft, TbArrowRight, TbCheck, TbChecks, TbDownload, TbMail, TbSearch } from "react-icons/tb"
import { client } from "@/app/client"
import { Constants } from "@/app/constants"
import { useAppDispatch, useAppSelector } from "@/app/store"
import type { Entries, Entry, NewsletterSettings } from "@/app/types"
import { setNewsletterSettings } from "@/app/user/slice"
import { flattenCategoryTree } from "@/app/utils"
import {
    buildNewsletter,
    getCategoryFeedIds,
    getNewsletterPageCount,
    getNewsletterStartDate,
    hasNewsletterScopeChanged,
    type NewsletterPeriod,
    type NewsletterScope,
    type NewsletterTemplate,
    newsletterEntryExcerpt,
    newsletterEntryId,
    type SelectedNewsletterEntries,
    selectNewsletterEntries,
    toggleNewsletterEntry,
} from "./newsletter"

const PAGE_SIZE = 25
const BULK_SELECTION_PAGE_SIZE = 1000

const templateOptions: Array<{
    id: NewsletterTemplate
    name: string
    accent: string
}> = [
    { id: "brief", name: "Ayn Signal", accent: "#B8F03C" },
    { id: "digest", name: "Bleu analytique", accent: "#0F62FE" },
    { id: "editorial", name: "Éditorial corail", accent: "#D94841" },
    { id: "radar", name: "Radar forêt", accent: "#2E8B70" },
]

export function NewsletterPage() {
    const rootCategory = useAppSelector(state => state.tree.rootCategory)
    const savedSettings = useAppSelector(state => state.user.localSettings.newsletter)
    const dispatch = useAppDispatch()
    const initializedSources = useRef(false)

    const categories = useMemo(
        () => (rootCategory ? flattenCategoryTree(rootCategory).filter(category => category.id !== Constants.categories.all.id) : []),
        [rootCategory]
    )
    const legacyFeedIds = (savedSettings as (NewsletterSettings & { feedIds?: string[] }) | undefined)?.feedIds

    const [activeStep, setActiveStep] = useState(0)
    const [selectedCategories, setSelectedCategories] = useState<string[]>(() => savedSettings?.categoryIds ?? [])
    const [period, setPeriod] = useState<NewsletterPeriod>(() => newsletterPeriod(savedSettings?.period))
    const [customStartDate, setCustomStartDate] = useState<string | undefined>(() => savedSettings?.customStartDate)
    const [template, setTemplate] = useState<NewsletterTemplate>(() => savedSettings?.template ?? "digest")
    const [includeImages, setIncludeImages] = useState(() => savedSettings?.includeImages ?? true)
    const [appliedScope, setAppliedScope] = useState<NewsletterScope>()
    const [entries, setEntries] = useState<Entries>()
    const [entriesLoading, setEntriesLoading] = useState(false)
    const [selectingAllEntries, setSelectingAllEntries] = useState(false)
    const [page, setPage] = useState(0)
    const [searchInput, setSearchInput] = useState("")
    const [searchQuery, setSearchQuery] = useState("")
    const [selectedEntries, setSelectedEntries] = useState<SelectedNewsletterEntries>({})
    const [title, setTitle] = useState(() => defaultNewsletterTitle())

    const categoryOptions = useMemo(
        () =>
            categories.map(category => ({
                value: category.id,
                label: category.name,
            })),
        [categories]
    )

    useEffect(() => {
        if (initializedSources.current || !categories.length) return
        initializedSources.current = true

        const categoryIds = new Set(categories.map(category => category.id))
        setSelectedCategories(current => {
            if (savedSettings?.categoryIds) return current.filter(id => categoryIds.has(id))
            if (legacyFeedIds) {
                return categories
                    .filter(category => category.feeds.some(feed => legacyFeedIds.includes(String(feed.id))))
                    .map(category => category.id)
            }
            return categories.map(category => category.id)
        })
    }, [categories, legacyFeedIds, savedSettings?.categoryIds])

    const selectedFeedIds = useMemo(() => getCategoryFeedIds(categories, selectedCategories), [categories, selectedCategories])
    const currentScope = useMemo<NewsletterScope>(
        () => ({
            categoryIds: selectedCategories,
            feedIds: selectedFeedIds,
            period,
            customStartDate,
        }),
        [customStartDate, period, selectedCategories, selectedFeedIds]
    )

    const selectedEntriesList = useMemo(() => Object.values(selectedEntries), [selectedEntries])
    const previewTitle = title.trim() || defaultNewsletterTitle()
    const newsletterHtml = useMemo(
        () =>
            buildNewsletter({
                entries: selectedEntriesList,
                template,
                includeImages,
                generatedAt: new Date(),
                title: previewTitle,
            }),
        [includeImages, previewTitle, selectedEntriesList, template]
    )

    useEffect(() => {
        if (activeStep !== 1 || !appliedScope) return

        let active = true
        setEntriesLoading(true)
        client.category
            .getEntries({
                id: Constants.categories.all.id,
                readType: "all",
                publishedAfter: getNewsletterStartDate(appliedScope.period, appliedScope.customStartDate),
                order: "desc",
                offset: page * PAGE_SIZE,
                limit: PAGE_SIZE,
                keywords: searchQuery || undefined,
                subscriptionIds: appliedScope.feedIds.join(","),
                includeTotal: true,
            })
            .then(response => {
                if (active) setEntries(response.data)
            })
            .catch(() => {
                if (!active) return
                setEntries(undefined)
                showNotification({
                    title: "Articles indisponibles",
                    message: "Impossible de charger les articles correspondant à ce périmètre.",
                    color: "red",
                })
            })
            .finally(() => {
                if (active) setEntriesLoading(false)
            })

        return () => {
            active = false
        }
    }, [activeStep, appliedScope, page, searchQuery])

    const savePreferences = (scope = currentScope, nextTemplate = template, nextIncludeImages = includeImages) => {
        const settings: NewsletterSettings = {
            categoryIds: scope.categoryIds,
            period: scope.period,
            customStartDate: scope.customStartDate,
            template: nextTemplate,
            includeImages: nextIncludeImages,
        }
        dispatch(setNewsletterSettings(settings))
    }

    const continueToArticleSelection = () => {
        if (!currentScope.categoryIds.length) {
            showNotification({
                title: "Sélectionne au moins une catégorie",
                message: "La newsletter est construite à partir des catégories choisies.",
                color: "orange",
            })
            return
        }
        if (currentScope.period === "custom" && !currentScope.customStartDate) {
            showNotification({
                title: "Choisis une date de début",
                message: "La période personnalisée a besoin d'une date de début.",
                color: "orange",
            })
            return
        }

        const openArticleSelection = () => {
            const scopeChanged = appliedScope && hasNewsletterScopeChanged(appliedScope, currentScope)
            if (scopeChanged) setSelectedEntries({})
            setAppliedScope(currentScope)
            setEntries(undefined)
            setPage(0)
            setSearchInput("")
            setSearchQuery("")
            savePreferences()
            setActiveStep(1)
        }

        if (appliedScope && selectedEntriesList.length && hasNewsletterScopeChanged(appliedScope, currentScope)) {
            openConfirmModal({
                title: "Modifier le périmètre ?",
                children: <Text size="sm">Les articles déjà sélectionnés seront retirés du brouillon.</Text>,
                labels: { confirm: "Modifier le périmètre", cancel: "Annuler" },
                confirmProps: { color: "red" },
                onConfirm: openArticleSelection,
            })
            return
        }

        openArticleSelection()
    }

    const submitSearch = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        setPage(0)
        setSearchQuery(searchInput.trim())
    }

    const continueToPreview = () => {
        if (!selectedEntriesList.length) {
            showNotification({
                title: "Aucun article sélectionné",
                message: "Coche au moins un article pour composer la newsletter.",
                color: "orange",
            })
            return
        }
        setActiveStep(2)
    }

    const downloadNewsletter = () => {
        if (!title.trim()) {
            showNotification({
                title: "Titre requis",
                message: "Donne un titre à la newsletter avant le téléchargement.",
                color: "orange",
            })
            return
        }

        savePreferences()
        const url = URL.createObjectURL(new Blob([newsletterHtml], { type: "text/html;charset=utf-8" }))
        const link = document.createElement("a")
        link.href = url
        link.download = `aynreader-newsletter-${new Date().toISOString().slice(0, 10)}.html`
        document.body.append(link)
        link.click()
        link.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 0)
        showNotification({
            title: "Newsletter téléchargée",
            message: `${selectedEntriesList.length} article(s) ont été ajoutés au fichier HTML.`,
            color: "green",
            icon: <TbCheck size={16} />,
        })
    }

    const selectTemplate = (nextTemplate: NewsletterTemplate) => {
        setTemplate(nextTemplate)
        savePreferences(currentScope, nextTemplate)
    }

    const selectImages = (nextIncludeImages: boolean) => {
        setIncludeImages(nextIncludeImages)
        savePreferences(currentScope, template, nextIncludeImages)
    }

    const totalEntries = entries?.total ?? 0
    const totalPages = getNewsletterPageCount(totalEntries, PAGE_SIZE)
    const allEntriesSelected = totalEntries > 0 && selectedEntriesList.length === totalEntries

    const toggleAllEntries = async () => {
        if (!appliedScope) return

        if (allEntriesSelected) {
            setSelectedEntries({})
            return
        }

        setSelectingAllEntries(true)
        try {
            const allEntries: Entry[] = []
            for (let offset = 0; offset < totalEntries; offset += BULK_SELECTION_PAGE_SIZE) {
                const response = await client.category.getEntries({
                    id: Constants.categories.all.id,
                    readType: "all",
                    publishedAfter: getNewsletterStartDate(appliedScope.period, appliedScope.customStartDate),
                    order: "desc",
                    offset,
                    limit: Math.min(BULK_SELECTION_PAGE_SIZE, totalEntries - offset),
                    keywords: searchQuery || undefined,
                    subscriptionIds: appliedScope.feedIds.join(","),
                })
                allEntries.push(...response.data.entries)
            }
            setSelectedEntries(selectNewsletterEntries(allEntries))
        } catch {
            showNotification({
                title: "Sélection impossible",
                message: "Impossible de récupérer tous les articles correspondant à ce périmètre.",
                color: "red",
            })
        } finally {
            setSelectingAllEntries(false)
        }
    }

    return (
        <Box maw={1280} mx="auto" w="100%" pb="xl">
            <Group justify="space-between" align="flex-start" mb="xl" gap="md">
                <Box>
                    <Group gap="xs" mb={4}>
                        <TbMail size={21} />
                        <Text fw={700} size="sm" c="dimmed">
                            Veille éditoriale
                        </Text>
                    </Group>
                    <Title order={2}>Newsletter</Title>
                </Box>
            </Group>

            <Stepper active={activeStep} onStepClick={step => step < activeStep && setActiveStep(step)} mb="xl">
                <Stepper.Step label="Périmètre" description="Catégories et période" allowStepSelect={activeStep > 0}>
                    <Stack gap="xl">
                        <MultiSelect
                            label="Catégories"
                            placeholder="Rechercher une catégorie"
                            data={categoryOptions}
                            value={selectedCategories}
                            onChange={setSelectedCategories}
                            searchable
                            clearable
                            maxDropdownHeight={280}
                            nothingFoundMessage="Aucune catégorie"
                        />

                        <Box>
                            <Text size="sm" fw={500} mb={6}>
                                Période
                            </Text>
                            <SegmentedControl
                                fullWidth
                                value={period}
                                onChange={value => setPeriod(value as NewsletterPeriod)}
                                data={[
                                    { value: "today", label: "Dernières 24 h" },
                                    { value: "week", label: "7 jours" },
                                    { value: "month", label: "30 jours" },
                                    { value: "custom", label: "Depuis le…" },
                                ]}
                            />
                        </Box>

                        {period === "custom" && (
                            <DateInput
                                label="Date de début"
                                placeholder="Choisir une date"
                                value={customStartDate ?? null}
                                onChange={value => setCustomStartDate(value ?? undefined)}
                                valueFormat="DD MMMM YYYY"
                                clearable
                            />
                        )}

                        <Group justify="flex-end">
                            <Button rightSection={<TbArrowRight size={16} />} onClick={continueToArticleSelection}>
                                Choisir les articles
                            </Button>
                        </Group>
                    </Stack>
                </Stepper.Step>

                <Stepper.Step label="Articles" description="Sélection manuelle" allowStepSelect={activeStep > 1}>
                    <Stack gap="md">
                        <Group justify="space-between" align="end" gap="md">
                            <form onSubmit={submitSearch} style={{ flex: 1 }}>
                                <TextInput
                                    label="Rechercher dans les articles"
                                    placeholder="Mot-clé"
                                    value={searchInput}
                                    onChange={event => setSearchInput(event.currentTarget.value)}
                                    rightSection={
                                        <Tooltip label="Rechercher">
                                            <ActionIcon type="submit" variant="subtle" aria-label="Rechercher">
                                                <TbSearch size={18} />
                                            </ActionIcon>
                                        </Tooltip>
                                    }
                                />
                            </form>
                            <Group gap="xs" align="center" pb={2}>
                                <Text fw={600}>
                                    {selectedEntriesList.length} sélectionné{selectedEntriesList.length > 1 ? "s" : ""}
                                </Text>
                                <Button
                                    size="xs"
                                    variant="default"
                                    leftSection={<TbChecks size={15} />}
                                    disabled={!totalEntries || entriesLoading || selectingAllEntries}
                                    loading={selectingAllEntries}
                                    onClick={toggleAllEntries}
                                >
                                    {allEntriesSelected ? "Tout désélectionner" : "Tout sélectionner"}
                                </Button>
                            </Group>
                        </Group>

                        <Box style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
                            {entriesLoading && (
                                <Text c="dimmed" py="md">
                                    Chargement des articles…
                                </Text>
                            )}
                            {!entriesLoading && entries?.entries.length === 0 && (
                                <Text c="dimmed" py="md">
                                    Aucun article ne correspond à ce périmètre.
                                </Text>
                            )}
                            {!entriesLoading &&
                                entries?.entries.map(entry => (
                                    <ArticleRow
                                        key={newsletterEntryId(entry)}
                                        entry={entry}
                                        checked={Boolean(selectedEntries[newsletterEntryId(entry)])}
                                        onChange={() => setSelectedEntries(current => toggleNewsletterEntry(current, entry))}
                                    />
                                ))}
                        </Box>

                        <Box
                            pos="sticky"
                            bottom={0}
                            py="md"
                            style={{ background: "var(--mantine-color-body)", borderTop: "1px solid var(--mantine-color-default-border)" }}
                        >
                            <Group justify="space-between" wrap="nowrap">
                                <Group gap="xs" wrap="nowrap">
                                    <Tooltip label="Page précédente">
                                        <ActionIcon
                                            variant="default"
                                            aria-label="Page précédente"
                                            disabled={page === 0 || entriesLoading}
                                            onClick={() => setPage(current => Math.max(0, current - 1))}
                                        >
                                            <TbArrowLeft size={18} />
                                        </ActionIcon>
                                    </Tooltip>
                                    <Text size="sm" miw={96} ta="center">
                                        Page {page + 1} sur {totalPages}
                                    </Text>
                                    <Tooltip label="Page suivante">
                                        <ActionIcon
                                            variant="default"
                                            aria-label="Page suivante"
                                            disabled={!entries?.hasMore || entriesLoading}
                                            onClick={() => setPage(current => current + 1)}
                                        >
                                            <TbArrowRight size={18} />
                                        </ActionIcon>
                                    </Tooltip>
                                </Group>
                                <Button
                                    rightSection={<TbArrowRight size={16} />}
                                    disabled={!selectedEntriesList.length}
                                    onClick={continueToPreview}
                                >
                                    Continuer
                                </Button>
                            </Group>
                        </Box>
                    </Stack>
                </Stepper.Step>

                <Stepper.Step label="Rendu" description="Aperçu et téléchargement" allowStepSelect={false}>
                    <Stack gap="lg">
                        <TextInput label="Titre" value={title} onChange={event => setTitle(event.currentTarget.value)} required />

                        <Group justify="space-between" align="center" gap="md">
                            <Box>
                                <Text size="sm" fw={500}>
                                    Design
                                </Text>
                                <Text size="sm" c="dimmed">
                                    {templateOptions.find(option => option.id === template)?.name}
                                </Text>
                            </Box>
                            <Group gap="xs">
                                {templateOptions.map(option => (
                                    <Tooltip key={option.id} label={option.name}>
                                        <UnstyledButton
                                            aria-label={option.name}
                                            onClick={() => selectTemplate(option.id)}
                                            style={{
                                                width: 32,
                                                height: 32,
                                                background: option.accent,
                                                border:
                                                    template === option.id
                                                        ? "3px solid var(--mantine-color-text)"
                                                        : "1px solid transparent",
                                            }}
                                        />
                                    </Tooltip>
                                ))}
                            </Group>
                        </Group>

                        <Switch
                            label="Afficher l'image principale des articles"
                            checked={includeImages}
                            onChange={event => selectImages(event.currentTarget.checked)}
                        />

                        <Divider />

                        <Box
                            style={{
                                border: "1px solid var(--mantine-color-default-border)",
                                borderRadius: 4,
                                overflow: "hidden",
                            }}
                        >
                            <iframe
                                title="Aperçu de la newsletter"
                                srcDoc={newsletterHtml}
                                sandbox=""
                                style={{ width: "100%", height: 680, border: 0, display: "block" }}
                            />
                        </Box>

                        <Box
                            pos="sticky"
                            bottom={0}
                            py="md"
                            style={{ background: "var(--mantine-color-body)", borderTop: "1px solid var(--mantine-color-default-border)" }}
                        >
                            <Group justify="space-between">
                                <Button variant="default" leftSection={<TbArrowLeft size={16} />} onClick={() => setActiveStep(1)}>
                                    Articles
                                </Button>
                                <Button
                                    leftSection={<TbDownload size={16} />}
                                    disabled={!selectedEntriesList.length || !title.trim()}
                                    onClick={downloadNewsletter}
                                >
                                    Télécharger la newsletter (.html)
                                </Button>
                            </Group>
                        </Box>
                    </Stack>
                </Stepper.Step>
            </Stepper>
        </Box>
    )
}

function ArticleRow({ entry, checked, onChange }: { entry: Entry; checked: boolean; onChange: () => void }) {
    return (
        <Group align="flex-start" wrap="nowrap" gap="sm" py="md" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
            <Checkbox checked={checked} onChange={onChange} aria-label={`Inclure ${entry.title}`} mt={3} />
            <Box style={{ flex: 1, minWidth: 0 }}>
                <Text fw={600} lineClamp={2}>
                    {entry.title}
                </Text>
                <Text size="sm" c="dimmed" mt={2}>
                    {entry.feedName} · {formatEntryDate(entry.date)}
                </Text>
                <Text size="sm" c="dimmed" lineClamp={2} mt={4}>
                    {newsletterEntryExcerpt(entry)}
                </Text>
            </Box>
        </Group>
    )
}

function newsletterPeriod(value?: string): NewsletterPeriod {
    return value === "today" || value === "week" || value === "month" || value === "custom" ? value : "week"
}

function defaultNewsletterTitle() {
    return `Veille du ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date())}`
}

function formatEntryDate(timestamp: number) {
    return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(timestamp))
}
