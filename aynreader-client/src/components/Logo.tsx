import { Image, useMantineColorScheme } from "@mantine/core"
import logoSymbolAcide from "@/assets/ayn/logo-symbol-acide.svg"
import logoSymbolData from "@/assets/ayn/logo-symbol-data.svg"
import logoSymbolEncre from "@/assets/ayn/logo-symbol-encre.svg"
import logoSymbolWhite from "@/assets/ayn/logo-symbol-white.svg"
import logoTextAcide from "@/assets/ayn/logo-text-acide.svg"
import logoTextData from "@/assets/ayn/logo-text-data.svg"
import logoTextEncre from "@/assets/ayn/logo-text-encre.svg"
import logoTextWhite from "@/assets/ayn/logo-text-white.svg"

export interface LogoProps {
    size: number
    variant?: "symbol" | "wordmark"
    tone?: "auto" | "encre" | "white" | "acide" | "data"
}

const logos = {
    symbol: {
        acide: logoSymbolAcide,
        data: logoSymbolData,
        encre: logoSymbolEncre,
        white: logoSymbolWhite,
    },
    wordmark: {
        acide: logoTextAcide,
        data: logoTextData,
        encre: logoTextEncre,
        white: logoTextWhite,
    },
}

export function Logo(props: Readonly<LogoProps>) {
    const { colorScheme } = useMantineColorScheme()
    const variant = props.variant ?? "symbol"
    const tone = props.tone === "auto" || !props.tone ? (colorScheme === "dark" ? "white" : "encre") : props.tone

    return <Image src={logos[variant][tone]} w={props.size} fit="contain" alt="Ayn Reader OS" />
}
