<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
// 0.2.0 起 embedHashraceIframe 自动注入四项 allow 权限：
//   web-share / clipboard-write / screen-wake-lock / fullscreen
// （对齐 PG Soft / Pragmatic Play B2B 基线，详见 CHANGELOG）。
// 不想要这层默认值时传 iframeAllow: '' 或自定义字符串。
import { embedHashraceIframe, type PartnerClient } from '@hashrace/partner-browser';

// Vue 3 <script setup> 版 Hashrace iframe 容器。
// launchUrl 由 Partner 后端调用 Hashrace /api/v1/partner/launch-session 获取后下发到前端。
const props = defineProps<{ launchUrl: string }>();
const container = ref<HTMLDivElement | null>(null);
let client: PartnerClient | null = null;
let iframe: HTMLIFrameElement | null = null;

onMounted(() => {
    if (!container.value) return;
    const r = embedHashraceIframe({
        launchUrl: props.launchUrl,
        container: container.value,
        onSecurityViolation: (reason, detail) => {
            console.warn('[SDK]', reason, detail);
        },
    });
    client = r.client;
    iframe = r.iframe;
    client.on('iframe.round_end', (p) => {
        console.log(`round ${p.round_id} net=${p.net_change_minor} ${p.currency}`);
    });
    client.on('iframe.exit_request', (_, ack) => {
        ack({ accepted: true });
    });
});

onBeforeUnmount(() => {
    // 连 iframe 一起移除，只 dispose() 不够：iframe 是 SDK 用 DOM API 挂进容器的，
    // 不归 Vue 的 vdom 管；HMR / KeepAlive 等场景下容器可能复用，残留的旧 iframe 会与
    // 新挂载的 iframe 拿同一个一次性 launch token 去兑换，后到的那个必然失败。
    client?.dispose();
    iframe?.remove();
    client = null;
    iframe = null;
});
</script>

<template>
    <div ref="container" style="width: 100%; height: 600px" />
</template>
