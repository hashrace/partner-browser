<script setup lang="ts">
import { ref } from 'vue';
import { launchInPopup, type PopupHandle } from '@hashrace/partner-browser';

/**
 * Vue 3 版 Hashrace popup 启动器。
 *
 * 关键约束：launchInPopup 必须在 user gesture 同步路径（@click 内）调用，
 * 否则浏览器会拦截 popup。onMounted 内调用会被 popup blocker 抓住。
 */
defineProps<{ launchUrl: string }>();
const status = ref<string>('未启动');
const active = ref<boolean>(false);
let handle: PopupHandle | null = null;

function onClick(launchUrl: string): void {
    const h = launchInPopup({
        launchUrl,
        window: { width: 1280, height: 720 },
        onPopupBlocked: () => { status.value = '弹窗被浏览器拦截，请允许后重试'; },
        onSecurityViolation: (reason, detail) => console.warn('[SDK]', reason, detail),
    });
    if (!h) return;
    handle = h;
    active.value = true;
    status.value = '游戏窗口已启动';

    h.on('iframe.round_end', (p) => {
        console.log(`round ${p.round_id} net=${p.net_change_minor} ${p.currency}`);
    });
    h.on('iframe.exit_request', (_, ack) => ack({ accepted: true }));
    h.onClosed(() => {
        active.value = false;
        status.value = '游戏窗口已关闭';
        handle = null;
    });
}
</script>

<template>
    <div style="font: 14px system-ui; padding: 24px; max-width: 600px">
        <h1>Hashrace 游戏（popup 模式）</h1>
        <button
            :disabled="active"
            style="padding: 10px 20px; font-size: 16px"
            @click="onClick($props.launchUrl)"
        >
            {{ active ? '游戏运行中…' : '运行游戏' }}
        </button>
        <div style="margin-top: 16px; padding: 12px; background: #f5f5f5; border-radius: 4px">
            {{ status }}
        </div>
    </div>
</template>
