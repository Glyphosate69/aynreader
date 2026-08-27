import { useEffect } from "react"
import WebsocketHeartbeatJs from "websocket-heartbeat-js"
import { reloadEntries } from "@/app/entries/thunks"
import { setWebSocketConnected } from "@/app/server/slice"
import { type AppDispatch, type RootState, useAppDispatch, useAppSelector } from "@/app/store"
import { newFeedEntriesDiscovered } from "@/app/tree/thunks"

const handleMessage = (dispatch: AppDispatch, source: RootState["entries"]["source"], message: string) => {
    const parts = message.split(":")
    const type = parts[0]
    if (type === "new-feed-entries") {
        const feedId = +parts[1]
        dispatch(
            newFeedEntriesDiscovered({
                feedId,
                amount: +parts[2],
            })
        )
        if (source.type === "category" || (source.type === "feed" && +source.id === feedId)) {
            dispatch(reloadEntries())
        }
    }
}

export const useWebSocket = () => {
    const websocketEnabled = useAppSelector(state => state.server.serverInfos?.websocketEnabled)
    const websocketPingInterval = useAppSelector(state => state.server.serverInfos?.websocketPingInterval)
    const source = useAppSelector(state => state.entries.source)
    const dispatch = useAppDispatch()

    useEffect(() => {
        let ws: WebsocketHeartbeatJs | undefined

        if (websocketEnabled && websocketPingInterval) {
            const currentUrl = new URL(window.location.href)
            const wsProtocol = currentUrl.protocol === "http:" ? "ws" : "wss"
            const wsUrl = `${wsProtocol}://${currentUrl.hostname}:${currentUrl.port}${currentUrl.pathname}ws`

            ws = new WebsocketHeartbeatJs({
                url: wsUrl,
                pingMsg: "ping",
                pingTimeout: websocketPingInterval,
            })
            ws.onopen = () => dispatch(setWebSocketConnected(true))
            ws.onclose = () => dispatch(setWebSocketConnected(false))
            ws.onmessage = event => {
                if (typeof event.data === "string") {
                    handleMessage(dispatch, source, event.data)
                }
            }
        }

        return () => ws?.close()
    }, [dispatch, source, websocketEnabled, websocketPingInterval])
}
