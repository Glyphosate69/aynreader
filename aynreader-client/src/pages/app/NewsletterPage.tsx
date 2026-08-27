import {
    Badge,
    Box,
    Button,
    Checkbox,
    Divider,
    Grid,
    Group,
    MultiSelect,
    NumberInput,
    Paper,
    SegmentedControl,
    Slider,
    Stack,
    Switch,
    Text,
    Title,
    UnstyledButton,
} from "@mantine/core"
import { showNotification } from "@mantine/notifications"
import { useEffect, useMemo, useRef, useState } from "react"
import { TbAdjustments, TbCalendar, TbCheck, TbDownload, TbLayoutCards, TbListDetails, TbMail, TbSparkles } from "react-icons/tb"
import { client } from "@/app/client"
import { Constants } from "@/app/constants"
import { useAppDispatch, useAppSelector } from "@/app/store"
import type { Entry, NewsletterSettings } from "@/app/types"
import { setNewsletterSettings } from "@/app/user/slice"
import { flattenCategoryTree } from "@/app/utils"
import { buildNewsletter, newsletterEntryId, selectNewsletterEntries } from "./newsletter"

type NewsletterTemplate = "brief" | "digest" | "editorial" | "radar"

const templateOptions: Array<{
    id: NewsletterTemplate
    name: string
    description: string
    icon: typeof TbLayoutCards
    palette: {
        accent: string
        canvas: string
        surface: string
        text: string
    }
}> = [
    {
        id: "brief",
        name: "Ayn Signal",
        description: "Un sujet de tête et les signaux essentiels.",
        icon: TbSparkles,
        palette: { accent: "#B8F03C", canvas: "#F2F4F0", surface: "#101413", text: "#F2F4F0" },
    },
    {
        id: "digest",
        name: "Bleu analytique",
        description: "Un digest clair, pensé pour la décision.",
        icon: TbListDetails,
        palette: { accent: "#0F62FE", canvas: "#F3F7FF", surface: "#12325F", text: "#FFFFFF" },
    },
    {
        id: "editorial",
        name: "Éditorial corail",
        description: "Une sélection commentée, article par article.",
        icon: TbMail,
        palette: { accent: "#D94841", canvas: "#FFF5F2", surface: "#4A2420", text: "#FFF9F7" },
    },
    {
        id: "radar",
        name: "Radar forêt",
        description: "Des signaux classés par thématique de veille.",
        icon: TbLayoutCards,
        palette: { accent: "#2E8B70", canvas: "#F0FAF5", surface: "#173D33", text: "#F4FFFA" },
    },
]

const templateLabels: Record<NewsletterTemplate, string> = {
    brief: "Ayn Signal",
    digest: "Bleu analytique",
    editorial: "Éditorial corail",
    radar: "Radar forêt",
}

export function NewsletterPage() {
    const rootCategory = useAppSelector(state => state.tree.rootCategory)
    const savedSettings = useAppSelector(state => state.user.localSettings.newsletter)
    const categories = useMemo(
        () => (rootCategory ? flattenCategoryTree(rootCategory).filter(category => category.id !== Constants.categories.all.id) : []),
        [rootCategory]
    )
    const feeds = useMemo(() => categories.flatMap(category => category.feeds), [categories])
    const initializedSources = useRef(false)
    const dispatch = useAppDispatch()

    const [frequency, setFrequency] = useState(savedSettings?.frequency ?? "weekly")
    const [template, setTemplate] = useState<NewsletterTemplate>(savedSettings?.template ?? "digest")
    const [selectedCategories, setSelectedCategories] = useState<string[]>(savedSettings?.categoryIds ?? [])
    const [selectedFeeds, setSelectedFeeds] = useState<string[]>(savedSettings?.feedIds ?? [])
    const [maxArticles, setMaxArticles] = useState<number | string>(savedSettings?.maximumArticles ?? 12)
    const [similarityEnabled, setSimilarityEnabled] = useState(savedSettings?.similarityEnabled ?? true)
    const [similarity, setSimilarity] = useState(savedSettings?.similarity ?? 72)
    const [groupSimilar, setGroupSimilar] = useState(savedSettings?.groupSimilar ?? true)
    const [includeImages, setIncludeImages] = useState(savedSettings?.includeImages ?? true)
    const [excludedEntryIds, setExcludedEntryIds] = useState(savedSettings?.excludedEntryIds ?? [])
    const [availableEntries, setAvailableEntries] = useState<Entry[]>([])
    const [entriesLoading, setEntriesLoading] = useState(true)

    useEffect(() => {
        if (initializedSources.current || !categories.length) return
        initializedSources.current = true
        if (!savedSettings) {
            setSelectedCategories(categories.map(category => category.id))
            setSelectedFeeds(feeds.map(feed => String(feed.id)))
        }
    }, [categories, feeds, savedSettings])

    useEffect(() => {
        const categoryIds = new Set(categories.map(category => category.id))
        setSelectedCategories(current => current.filter(id => categoryIds.has(id)))
    }, [categories])

    useEffect(() => {
        let active = true
        client.category
            .getEntries({
                id: Constants.categories.all.id,
                readType: "all",
                order: "desc",
                offset: 0,
                limit: 100,
            })
            .then(result => {
                if (active) setAvailableEntries(result.data.entries)
            })
            .catch(() => {
                if (active) {
                    showNotification({
                        title: "Articles indisponibles",
                        message: "La sélection sera disponible après le prochain chargement de la veille.",
                        color: "red",
                    })
                }
            })
            .finally(() => {
                if (active) setEntriesLoading(false)
            })
        return () => {
            active = false
        }
    }, [])

    const selectedFeedNames = feeds.filter(feed => selectedFeeds.includes(String(feed.id))).map(feed => feed.name)
    const selectedCategoryNames = categories.filter(category => selectedCategories.includes(category.id)).map(category => category.name)
    const articleCount = typeof maxArticles === "number" ? maxArticles : 12
    const frequencyLabel = frequency === "daily" ? "Chaque matin" : "Chaque lundi"
    const activeTemplate = templateOptions.find(option => option.id === template) || templateOptions[0]
    const candidateEntries = selectNewsletterEntries(availableEntries, {
        feedIds: selectedFeeds,
        excludedEntryIds: [],
        maximumArticles: articleCount,
    })
    const selectedEntries = candidateEntries.filter(entry => !excludedEntryIds.includes(newsletterEntryId(entry)))

    const getSettings = (): NewsletterSettings => {
        return {
            frequency: frequency as NewsletterSettings["frequency"],
            template,
            categoryIds: selectedCategories,
            feedIds: selectedFeeds,
            maximumArticles: articleCount,
            similarityEnabled,
            similarity,
            groupSimilar,
            includeImages,
            excludedEntryIds,
        }
    }

    const applySettings = () => {
        const settings = getSettings()
        dispatch(setNewsletterSettings(settings))
        showNotification({
            title: "Configuration appliquée",
            message: `${templateLabels[template]} · ${frequency === "daily" ? "quotidienne" : "hebdomadaire"} · ${similarityEnabled ? "similarité active" : "sans similarité"}.`,
            color: "green",
            icon: <TbCheck size={16} />,
        })
    }

    const toggleEntry = (entry: Entry) => {
        const entryId = newsletterEntryId(entry)
        setExcludedEntryIds(current => (current.includes(entryId) ? current.filter(id => id !== entryId) : [...current, entryId]))
    }

    const downloadNewsletter = () => {
        if (!selectedEntries.length) {
            showNotification({
                title: "Aucun article à télécharger",
                message: "Sélectionne au moins une source ou réintègre un article.",
                color: "orange",
            })
            return
        }

        const settings: NewsletterSettings = {
            ...getSettings(),
        }
        dispatch(setNewsletterSettings(settings))

        const html = buildNewsletter({
            entries: selectedEntries,
            template,
            includeImages,
            generatedAt: new Date(),
        })
        const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }))
        const link = document.createElement("a")
        link.href = url
        link.download = `aynreader-newsletter-${new Date().toISOString().slice(0, 10)}.html`
        document.body.append(link)
        link.click()
        link.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 0)
        showNotification({
            title: "Newsletter téléchargée",
            message: `${selectedEntries.length} article(s) ont été ajoutés au fichier HTML.`,
            color: "green",
            icon: <TbCheck size={16} />,
        })
    }

    return (
        <Box maw={1180} mx="auto" w="100%" pb="xl">
            <Group justify="space-between" align="flex-start" mb="xl" gap="md">
                <Box>
                    <Group gap="xs" mb={4}>
                        <TbMail size={21} />
                        <Text fw={700} size="sm" c="dimmed">
                            Veille éditoriale
                        </Text>
                    </Group>
                    <Title order={2}>Newsletter</Title>
                    <Text c="dimmed" mt={4}>
                        Compose la sélection, le rythme et la présentation de ta veille.
                    </Text>
                </Box>
            </Group>

            <Grid gap={{ base: "xl", md: 48 }}>
                <Grid.Col span={{ base: 12, md: 7 }}>
                    <Stack gap="xl">
                        <Box>
                            <Group gap="xs" mb="sm">
                                <TbCalendar size={18} />
                                <Title order={4}>Cadence</Title>
                            </Group>
                            <SegmentedControl
                                fullWidth
                                value={frequency}
                                onChange={setFrequency}
                                data={[
                                    { value: "daily", label: "Quotidienne" },
                                    { value: "weekly", label: "Hebdomadaire" },
                                ]}
                            />
                        </Box>

                        <Box>
                            <Group justify="space-between" align="center" mb="sm">
                                <Box>
                                    <Title order={4}>Articles retenus</Title>
                                    <Text size="xs" c="dimmed">
                                        Décoche un article pour le retirer du téléchargement.
                                    </Text>
                                </Box>
                                <Badge variant="light" color="gray">
                                    {selectedEntries.length} / {articleCount}
                                </Badge>
                            </Group>
                            <Stack gap={0}>
                                {entriesLoading && (
                                    <Text size="sm" c="dimmed">
                                        Chargement des articles…
                                    </Text>
                                )}
                                {!entriesLoading && !candidateEntries.length && (
                                    <Text size="sm" c="dimmed">
                                        Aucun article ne correspond aux sources sélectionnées.
                                    </Text>
                                )}
                                {candidateEntries.map(entry => {
                                    const selected = !excludedEntryIds.includes(newsletterEntryId(entry))
                                    return (
                                        <Box
                                            key={newsletterEntryId(entry)}
                                            py="sm"
                                            style={{ borderBottom: "1px solid var(--mantine-color-gray-3)" }}
                                        >
                                            <Checkbox
                                                checked={selected}
                                                onChange={() => toggleEntry(entry)}
                                                label={
                                                    <Box>
                                                        <Text size="sm" fw={600} lineClamp={2}>
                                                            {entry.title}
                                                        </Text>
                                                        <Text size="xs" c="dimmed">
                                                            {entry.feedName}
                                                        </Text>
                                                    </Box>
                                                }
                                            />
                                        </Box>
                                    )
                                })}
                            </Stack>
                        </Box>

                        <Box>
                            <Group gap="xs" mb="sm">
                                <TbLayoutCards size={18} />
                                <Title order={4}>Modèle</Title>
                            </Group>
                            <Grid gap="sm">
                                {templateOptions.map(option => {
                                    const Icon = option.icon
                                    const selected = template === option.id
                                    return (
                                        <Grid.Col span={{ base: 12, sm: 6 }} key={option.id}>
                                            <UnstyledButton
                                                aria-pressed={selected}
                                                onClick={() => setTemplate(option.id)}
                                                style={{ display: "block", width: "100%" }}
                                            >
                                                <Paper
                                                    withBorder
                                                    p="md"
                                                    h="100%"
                                                    bg={selected ? option.palette.canvas : undefined}
                                                    style={{
                                                        borderColor: selected ? option.palette.accent : undefined,
                                                        borderWidth: selected ? 2 : 1,
                                                    }}
                                                >
                                                    <Group justify="space-between" align="flex-start" mb="md">
                                                        <Group gap={5}>
                                                            {[option.palette.accent, option.palette.surface, option.palette.canvas].map(
                                                                color => (
                                                                    <Box
                                                                        key={color}
                                                                        w={14}
                                                                        h={14}
                                                                        style={{ backgroundColor: color, borderRadius: "50%" }}
                                                                    />
                                                                )
                                                            )}
                                                        </Group>
                                                        {selected && <TbCheck size={18} />}
                                                    </Group>
                                                    <Box
                                                        h={26}
                                                        mb="md"
                                                        style={{
                                                            backgroundColor: option.palette.surface,
                                                            borderLeft: `4px solid ${option.palette.accent}`,
                                                        }}
                                                    />
                                                    <Icon size={18} color={option.palette.accent} />
                                                    <Text fw={700} size="sm">
                                                        {option.name}
                                                    </Text>
                                                    <Text size="xs" c="dimmed" mt={5}>
                                                        {option.description}
                                                    </Text>
                                                </Paper>
                                            </UnstyledButton>
                                        </Grid.Col>
                                    )
                                })}
                            </Grid>
                        </Box>

                        <Box>
                            <Group gap="xs" mb="sm">
                                <TbListDetails size={18} />
                                <Title order={4}>Contenus à inclure</Title>
                            </Group>
                            <Stack gap="sm">
                                <MultiSelect
                                    label="Catégories"
                                    placeholder="Choisir les catégories"
                                    data={categories.map(category => ({ value: category.id, label: category.name }))}
                                    value={selectedCategories}
                                    onChange={setSelectedCategories}
                                    searchable
                                    clearable
                                />
                                <Checkbox.Group label="Sources" value={selectedFeeds} onChange={setSelectedFeeds}>
                                    <Grid mt={4} gap="xs">
                                        {feeds.map(feed => (
                                            <Grid.Col span={{ base: 12, sm: 6 }} key={feed.id}>
                                                <Checkbox value={String(feed.id)} label={feed.name} />
                                            </Grid.Col>
                                        ))}
                                    </Grid>
                                </Checkbox.Group>
                                {!feeds.length && (
                                    <Text size="sm" c="dimmed">
                                        Ajoute des sources pour pouvoir les sélectionner dans la newsletter.
                                    </Text>
                                )}
                            </Stack>
                        </Box>

                        <Box>
                            <Group gap="xs" mb="sm">
                                <TbAdjustments size={18} />
                                <Title order={4}>Similarité et édition</Title>
                            </Group>
                            <Stack gap="md">
                                <Box>
                                    <Group justify="space-between" mb={4}>
                                        <Box>
                                            <Text size="sm" fw={500}>
                                                Détecter les contenus similaires
                                            </Text>
                                            <Text size="xs" c="dimmed">
                                                Utilise all-MiniLM-L6-v2 pour éviter les doublons dans l'envoi.
                                            </Text>
                                        </Box>
                                        <Switch
                                            checked={similarityEnabled}
                                            onChange={event => setSimilarityEnabled(event.currentTarget.checked)}
                                            aria-label="Activer la similarité"
                                        />
                                    </Group>
                                    <Group justify="space-between" mb={4}>
                                        <Text size="sm" c={similarityEnabled ? undefined : "dimmed"}>
                                            Seuil de similarité
                                        </Text>
                                        <Text size="sm" c="dimmed">
                                            {similarityEnabled ? (similarity / 100).toFixed(2) : "Désactivée"}
                                        </Text>
                                    </Group>
                                    <Slider
                                        value={similarity}
                                        onChange={setSimilarity}
                                        disabled={!similarityEnabled}
                                        min={50}
                                        max={95}
                                        step={1}
                                        marks={[
                                            { value: 60, label: "0.60" },
                                            { value: 75, label: "0.75" },
                                            { value: 90, label: "0.90" },
                                        ]}
                                    />
                                </Box>
                                <NumberInput
                                    label="Nombre maximum d'articles"
                                    value={maxArticles}
                                    onChange={setMaxArticles}
                                    min={3}
                                    max={30}
                                    clampBehavior="strict"
                                />
                                <Switch
                                    checked={groupSimilar}
                                    onChange={event => setGroupSimilar(event.currentTarget.checked)}
                                    disabled={!similarityEnabled}
                                    label="Regrouper les articles très similaires"
                                />
                                <Switch
                                    checked={includeImages}
                                    onChange={event => setIncludeImages(event.currentTarget.checked)}
                                    label="Inclure l'image principale des articles"
                                />
                            </Stack>
                        </Box>

                        <Group justify="flex-end">
                            <Button leftSection={<TbCheck size={17} />} onClick={applySettings}>
                                Appliquer la configuration
                            </Button>
                            <Button
                                leftSection={<TbDownload size={17} />}
                                onClick={downloadNewsletter}
                                disabled={entriesLoading || !selectedEntries.length}
                            >
                                Télécharger la newsletter
                            </Button>
                        </Group>
                    </Stack>
                </Grid.Col>

                <Grid.Col span={{ base: 12, md: 5 }}>
                    <Stack gap="sm" pos="sticky" top={16}>
                        <Group justify="space-between">
                            <Title order={4}>Aperçu</Title>
                            <Text size="sm" c="dimmed">
                                {frequencyLabel}
                            </Text>
                        </Group>
                        <Paper withBorder p={0} radius="sm" style={{ overflow: "hidden" }}>
                            <Box
                                p={{ base: "md", sm: "xl" }}
                                style={{ backgroundColor: activeTemplate.palette.surface, color: activeTemplate.palette.text }}
                            >
                                <Text size="xs" tt="uppercase" fw={700} style={{ color: activeTemplate.palette.accent }}>
                                    Ayn Reader OS
                                </Text>
                                <Title order={3} mt={6} style={{ color: activeTemplate.palette.text }}>
                                    {template === "brief" && "Les signaux IA essentiels"}
                                    {template === "digest" && "La veille IA de la semaine"}
                                    {template === "editorial" && "Ce qu'il faut retenir de l'IA"}
                                    {template === "radar" && "Le radar IA par thématique"}
                                </Title>
                                <Text size="sm" mt="xs" style={{ color: activeTemplate.palette.text, opacity: 0.78 }}>
                                    {frequencyLabel} · {selectedFeeds.length} sources sélectionnées
                                </Text>
                            </Box>
                            <Stack gap="md" p={{ base: "md", sm: "xl" }} style={{ backgroundColor: activeTemplate.palette.canvas }}>
                                <Text size="sm" fw={700} style={{ color: activeTemplate.palette.surface }}>
                                    À retenir cette période
                                </Text>
                                <Text size="sm" style={{ color: activeTemplate.palette.surface }}>
                                    Jusqu'à {articleCount} articles sélectionnés depuis {selectedFeeds.length} source(s)
                                    {similarityEnabled
                                        ? `, regroupés au seuil de ${(similarity / 100).toFixed(2)}.`
                                        : ", sans déduplication par similarité."}
                                </Text>
                                {includeImages && <Box h={74} style={{ backgroundColor: activeTemplate.palette.accent }} />}
                                <Divider />
                                <Text size="sm" fw={700} style={{ color: activeTemplate.palette.surface }}>
                                    {template === "editorial" ? "À lire en priorité" : "Sources retenues"}
                                </Text>
                                <Group gap={6}>
                                    {selectedFeedNames.slice(0, 5).map(name => (
                                        <Badge
                                            key={name}
                                            variant="outline"
                                            style={{ borderColor: activeTemplate.palette.accent, color: activeTemplate.palette.surface }}
                                        >
                                            {name}
                                        </Badge>
                                    ))}
                                    {selectedFeedNames.length > 5 && (
                                        <Badge
                                            variant="outline"
                                            style={{ borderColor: activeTemplate.palette.accent, color: activeTemplate.palette.surface }}
                                        >
                                            +{selectedFeedNames.length - 5}
                                        </Badge>
                                    )}
                                </Group>
                                <Text size="xs" c="dimmed">
                                    {selectedCategoryNames.length ? selectedCategoryNames.join(" · ") : "Aucune catégorie sélectionnée"}
                                </Text>
                            </Stack>
                        </Paper>
                        <Text size="xs" c="dimmed">
                            Le fichier téléchargé contient les articles actuellement retenus.
                        </Text>
                    </Stack>
                </Grid.Col>
            </Grid>
        </Box>
    )
}
