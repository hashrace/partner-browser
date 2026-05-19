<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
// 0.2.0 起 embedHashraceIframe 自动注入四项 allow 权限：
//   web-share / clipboard-write / screen-wake-lock / fullscreen
// （对齐 PG Soft / Pragmatic Play B2B 基线，详见 CHANGELOG）。
// 不想要这层默认值时传 iframeAllow: '' 或自定义字符串。
import { embedHashraceIframe, type PartnerClient } from '@hashrace/partner-browser';

// Vue 3 <script setup> 版 HashMach iframe 容器。
// launchUrl 由 Partner 后端调用 HashMach /api/v1/partner/launch-session 获取后下发到前端。
const props = defineProps<{ launchUrl: string }>();
const container = ref<HTMLDivElement | null>(null);
let client: PartnerClient | null = null;

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
    client.on('iframe.round_end', (p) => {
        console.log(`round ${p.round_id} net=${p.net_change_minor} ${p.currency}`);
    });
    client.on('iframe.exit_request', (_, ack) => {
        ack({ accepted: true });
    });
});

onBeforeUnmount(() => {
    client?.dispose();
    client = null;
});
</script>

<template>
    <div ref="container" style="width: 100%; height: 600px" />
</template>
