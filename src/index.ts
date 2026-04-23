// @hashrace/partner-sdk 公共 API。
// 稳定导出面：PartnerClient 工厂、embedHashraceIframe 辅助、事件类型、origin 校验工具。
// 内部实现细节不在此导出，Partner 仅依赖以下命名空间。

export { createPartnerClient } from './client';
export type {
    PartnerClient,
    PartnerClientOptions,
    UpHandler,
    AckSender,
} from './client';

export { embedHashraceIframe } from './embed';
export type { EmbedOptions, EmbedResult } from './embed';

export { CHANNEL, FORBIDDEN_DOWN_EVENTS } from './events';
export type {
    UpEventMap,
    UpEventName,
    DownEventMap,
    DownEventName,
    Envelope,
    IframeReadyPayload,
    IframeSizeChangePayload,
    IframeExitRequestPayload,
    IframeRoundStartPayload,
    IframeRoundEndPayload,
    IframeErrorPayload,
    ParentResizePayload,
    ParentCloseRequestPayload,
    ParentVisibilityChangePayload,
    ParentPausePayload,
    ParentResumePayload,
} from './events';

export { DEFAULT_CHILD_ORIGIN, isExpectedOrigin } from './origin';
