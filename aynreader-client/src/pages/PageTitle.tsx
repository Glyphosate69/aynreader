import { Center } from "@mantine/core"
import { Logo } from "@/components/Logo"

export function PageTitle() {
    return (
        <Center my="xl" className="ayn-page-title">
            <Logo size={190} variant="wordmark" />
        </Center>
    )
}
