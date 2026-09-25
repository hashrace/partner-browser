# Hashrace 游戏接入指南

本文面向接入 Hashrace 游戏内容的 Partner（运营方）技术团队，覆盖从拿到凭证到玩家在你的站点里玩上第一局所需的全部对外契约：

1. [接入流程](#1-接入流程)
2. [签名与认证](#2-签名与认证)
3. [启动会话：launch-session API](#3-启动会话launch-session-api)
4. [启动链接（launch URL）](#4-启动链接launch-url)
5. [页面通信：`hashrace.v1` postMessage 通道](#5-页面通信hashracev1-postmessage-通道)
6. [Seamless Wallet Webhook](#6-seamless-wallet-webhook)
7. [幂等与重试](#7-幂等与重试)
8. [错误码](#8-错误码)

> 本文中带 `<!-- parity:… -->` 标记的表格由 Hashrace 的自动化守栏逐字段与平台实现对账——表里写的字段名、事件名、错误码就是线上实际使用的名字。

---

## 1. 接入流程

Hashrace 是 B2B 游戏内容供应商：**玩家与玩家资金始终归你**。Hashrace 不持有玩家钱包，玩家的每一笔下注、派彩、冲正都由 Hashrace 服务端实时调用你的钱包接口（Seamless Wallet）完成。

整个集成由三条通道组成：

| 通道 | 方向 | 用途 |
|---|---|---|
| launch-session API | 你的后端 → Hashrace | 为某位已登录玩家签发一次性启动凭证 |
| Seamless Wallet Webhook | Hashrace → 你的后端 | 查询余额、扣款、派彩、冲正、交易查询 |
| `hashrace.v1` postMessage | 游戏 iframe → 你的页面 | 退出、重试、客服、游戏结束等页面级事件 |

接入步骤：

1. **签约并开通账号**：Hashrace 为你创建 Partner，并通过带外安全渠道交付一对 **API Key / API Secret**。Secret 只交付一次，请存放在你的密钥管理系统中，不要放进前端代码、工单或聊天记录。
2. **登记接入配置**（在 Operator Portal 中完成）：
   - Webhook base URL：Hashrace 在它后面拼 `/wallet/{endpoint}` 调用，例如配置 `https://api.example.com/hooks` 时，扣款请求发往 `https://api.example.com/hooks/wallet/debit`
   - 可用币种（`allowed_currencies`）：Hashrace 只接受你登记为可用的币种，不做任何币种换算
   - 调用 launch-session API 的出口 IP 白名单
3. **实现钱包接口**：按 [§6](#6-seamless-wallet-webhook) 实现 5 个端点，按 [§7](#7-幂等与重试) 实现幂等。
4. **跑接入验证**：在 Operator Portal「接入验证」中录入测试玩家，运行全部必跑用例。Hashrace 会向你的待验证 URL 发送真实签名的测试请求（带请求头 `X-Hashrace-Test-Scenario`，取值 `normal` / `force_5xx` / `force_timeout`，这个头不参与签名），覆盖正常扣款、余额不足、玩家不存在、派彩、派彩幂等、错误签名、5xx 后重投、未知单号冲正。全部通过后确认就绪。
5. **上线**：Hashrace 把你的 Webhook 切到生效状态。之后你的后端调 launch-session、在页面里嵌入游戏即可。

---

## 2. 签名与认证

两个方向（你调 Hashrace 的 launch-session、Hashrace 调你的钱包 Webhook）使用**同一对** API Key / Secret、**同一种**签名方法。收到请求的一方负责验签。

<!-- parity:signature-headers -->
| Header | 必带 | 含义 |
|---|---|---|
| `X-API-Key` | 是 | 你的 API Key |
| `X-Timestamp` | 是 | Unix 秒（**不是毫秒**），ASCII 数字 |
| `X-Nonce` | 是 | UUID v4 或等熵随机串（≥ 128 bit），每个请求不同 |
| `X-Signature` | 是 | `hex(HMAC-SHA256(api_secret, sign_str))`，64 个小写十六进制字符 |

`sign_str` 由 5 段以 `\n`（LF，不是 CRLF）拼接：

```text
sign_str = METHOD + "\n" + PATH + "\n" + X-Timestamp + "\n" + X-Nonce + "\n" + hex(SHA256(body))
X-Signature = hex(HMAC-SHA256(api_secret, sign_str))
```

| 段 | 内容 |
|---|---|
| `METHOD` | 大写 HTTP 方法，如 `POST` |
| `PATH` | 接收方**实际收到的**请求路径，含 query string（原样，不重排、不解码），不含 scheme 与 host。你的 Webhook base URL 带路径前缀时（如 `/hooks`），签进去的是完整路径 `/hooks/wallet/debit` |
| `X-Timestamp` / `X-Nonce` | 与同名请求头逐字相同 |
| `hex(SHA256(body))` | 请求体原始字节的 SHA-256，小写十六进制；空 body 取 `SHA256("")`，不跳过 |

`hex(SHA256(body))` 在**最后一段**。顺序写错时签名 100% 不通过，而错误响应里只能看到「签名无效」，看不出是顺序问题。

金标向量（请用它自测）：

```text
METHOD      = POST
PATH        = /wallet/debit
X-Timestamp = 1714658400
X-Nonce     = 3f0c9a1e-7d4b-4a2f-9c81-6e5b0d2a1f47
body        = {"ref_id":"r-1001","amount":1000000}
api_secret  = sk_test_0123456789abcdef
sign_str    = POST\n/wallet/debit\n1714658400\n3f0c9a1e-7d4b-4a2f-9c81-6e5b0d2a1f47\nbbe1905633170dc813a3c1a175dddf55611dbef31350f0dfa8c679beca7b00ea
X-Signature = f62885b72722357021cc3022218c294f3296a250e607422df1338bfdf36833b5
```

**验签规则**（你验 Hashrace 发来的 Webhook 时按此实施；Hashrace 验你的 launch-session 请求同样按此执行）：

| 检查项 | 规则 | Webhook 上失败时你应返回 |
|---|---|---|
| 4 个 header 齐全 | 任一缺失即失败 | HTTP 401 + `PARTNER_WEBHOOK_SIGNATURE_INVALID` |
| 时间戳 | 可解析为整数秒，且与你的服务器时间偏差 ≤ 300 秒 | HTTP 401 + `PARTNER_WEBHOOK_SIGNATURE_INVALID` |
| Nonce | 10 分钟内未出现过（去重存储 TTL ≥ 10 分钟） | HTTP 401 + `PARTNER_WEBHOOK_SIGNATURE_INVALID` |
| API Key | 是你签发给 Hashrace 的那把 | HTTP 401 + `UNAUTHORIZED` |
| 签名 | 重算后与 `X-Signature` 常量时间比较相等 | HTTP 401 + `PARTNER_WEBHOOK_SIGNATURE_INVALID` |

---

## 3. 启动会话：launch-session API

玩家在你的站点点击某个游戏时，由**你的后端**（不是浏览器）为这位玩家签发一个一次性的 `launch_token`，再拼成启动链接交给页面。

```
POST {Hashrace Partner API 域名}/api/v1/partner/launch-session
Content-Type: application/json
X-API-Key / X-Timestamp / X-Nonce / X-Signature   （见 §2）
Idempotency-Key: <每次启动一个新的 UUID>
```

**`Idempotency-Key` 必带**，缺失直接 400。它是这个接口唯一的重放保护：同一个 key 的重试会拿回同一次的结果，不会给同一位玩家铸出两个都能用的 token。**同一次启动的超时重试用同一个 key；每一次新的启动（哪怕是同一位玩家再开一局）用一个新 key**——复用 key 会拿回上一次已经被兑换掉的 token。

请求体把业务字段包在 `data` 里：

```json
{
  "data": {
    "partner_id": 1001,
    "external_player_id": "alice_001",
    "nickname": "Alice",
    "currency": "USDT",
    "target_mode": "game",
    "created_at": 1731042000
  }
}
```

<!-- parity:launch-request -->
| 字段 | 类型 | 必选 | 说明 |
|---|---|---|---|
| `data.partner_id` | integer | 是 | 你的 Partner ID；必须与 API Key 所属 Partner 一致，否则拒绝 |
| `data.external_player_id` | string | 是 | 你这边玩家的唯一 ID，Hashrace 不解读格式、原样用于回调你的钱包（即 Webhook 里的 `player_id`）。非空、≤ 128 字节、合法 UTF-8、不含控制字符 |
| `data.nickname` | string | 否 | 玩家展示昵称 |
| `data.avatar` | string | 否 | 玩家头像 URL |
| `data.currency` | string | 是 | 本次会话的初始币种，`^[A-Z]{3,5}$`，必须是你登记为可用的币种。玩家进入游戏后可在你的可用币种之间切换 |
| `data.client_ip` | string | 否 | 玩家浏览器的 IP；配合 `strict_context_check` 使用 |
| `data.client_ua` | string | 否 | 玩家浏览器的 User-Agent；配合 `strict_context_check` 使用 |
| `data.target_mode` | string | 否 | `"game"`（直接进入游戏）或 `"lobby"` |
| `data.extra_params` | object（string → string） | 否 | 原样透传给游戏客户端的附加参数，Hashrace 不解读 |
| `data.strict_context_check` | boolean | 否 | 为 `true` 时，兑换 token 的浏览器 IP / UA 必须与上面两个字段严格一致，否则拒绝进入 |
| `data.created_at` | integer | 否 | 你这边签发时刻，Unix 秒 |

玩家可见的品牌名由 Hashrace 按你的签约主体填入，请求体里带了也会被忽略。

**成功响应**（HTTP 200）：

```json
{
  "launch_token": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "expires_at": "1731042300"
}
```

<!-- parity:launch-response -->
| 字段 | 类型 | 说明 |
|---|---|---|
| `launch_token` | string | 64 位十六进制一次性 token，**5 分钟**内有效、**只能兑换一次** |
| `expires_at` | string（整数） | 过期时刻，Unix 秒；按 64 位整数的 JSON 惯例以字符串下发 |

**错误响应**：launch-session 的错误体是 RFC 7807 Problem Details（`Content-Type: application/problem+json`），用 `reason` 字段判断原因：

```json
{
  "type": "about:blank",
  "title": "Unauthorized",
  "status": 401,
  "instance": "/api/v1/partner/launch-session",
  "code": "ERROR_CODE_UNAUTHENTICATED",
  "reason": "PARTNER_SIGNATURE_INVALID",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736"
}
```

<!-- parity:launch-reasons -->
| `reason` | HTTP | 含义 | 你应做 |
|---|---|---|---|
| `PARTNER_SIGNATURE_REQUIRED` | 401 | 签名头缺失或格式不对 | 检查 4 个签名头 |
| `PARTNER_TIMESTAMP_INVALID` | 401 | 时间戳不可解析或偏差超过 300 秒 | 校准服务器时钟 |
| `PARTNER_SIGNATURE_INVALID` | 401 | 签名不匹配或 API Key 无效 | 对照 §2 金标向量排查 |
| `PARTNER_NONCE_REPLAY` | 401 | 10 分钟内重复使用了同一个 Nonce | 每个请求生成新 Nonce |
| `PARTNER_SUSPENDED` | 401 | 你的 Partner 当前处于暂停状态 | 联系 Hashrace 商务 |
| `PARTNER_IP_NOT_ALLOWED` | 403 | 出口 IP 不在白名单内 | 在 Operator Portal 登记出口 IP |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | 没带 `Idempotency-Key` | 补上请求头 |
| `IDEMPOTENCY_KEY_MISMATCH` | 409 | 同一个 `Idempotency-Key` 配了不同的请求体 | 新的启动换新 key |
| `IDEMPOTENCY_REQUEST_IN_FLIGHT` | 409 | 同一个 key 的上一次请求还在处理 | 稍后用同一个 key 重试 |
| `INVALID_PARAMS` | 400 | 字段非法：`external_player_id` 为空 / 过长、币种格式不对 | 按 `trace_id` 与 message 修正参数 |
| `OPERATOR_CURRENCY_NOT_ACTIVE` | 400 | `currency` 不在你的可用币种里 | 换币种，或在 Portal 申请开通 |
| `RATE_LIMITED` | 429 | 调用频率超出配额 | 退避后重试（重试沿用同一个 `Idempotency-Key`） |

---

## 4. 启动链接（launch URL）

拿到 `launch_token` 后，按下面的格式拼出启动链接，交给页面加载：

```text
https://{Hashrace 游戏域名}/game/{game_id}?launch={launch_token}&lang={lang}
```

| 部分 | 说明 |
|---|---|
| `{Hashrace 游戏域名}` | 开通时由 Hashrace 告知（不同环境不同） |
| `/game/{game_id}` | 游戏 ID，形如 `mines`，来自 Hashrace 提供的游戏清单；这是唯一合法的启动路径，其他路径会显示错误页 |
| `launch` | 上一步拿到的 `launch_token` |
| `lang` | 可选，界面语言，如 `en` / `zh-CN` |
| 其他 query 参数 | 可选，原样透传给游戏客户端 |

要点：

- **一次性**：token 只能兑换一次，5 分钟过期。**每次启动都向你的后端要一条新链接**；不要缓存、不要复用、不要把链接放进可被分享的地址里。玩家在游戏里点「重试」时，你会收到 `iframe.retry_request`（§5），此时重新签发即可。
- **不要从页面地址里读 launch URL**（如 `?url=` / `#url`）：那会让任何构造出来的链接决定你的 iframe 加载什么。
- 用本 SDK 嵌入：

```ts
import { embedHashraceIframe } from '@hashrace/partner-browser';

const { client } = embedHashraceIframe({
    launchUrl,                                  // 由你的后端返回
    container: document.getElementById('game')!,
});
```

弹窗模式用 `launchInPopup({ launchUrl, ... })`，必须在点击事件的同步路径里调用。

---

## 5. 页面通信：`hashrace.v1` postMessage 通道

游戏 iframe 通过 `window.postMessage` 向你的页面发送事件。所有消息都装在同一个信封里：

```json
{
  "channel": "hashrace.v1",
  "event":   "iframe.exit_request",
  "payload": { "reason": "user_back" },
  "nonce":   "5a0f3c1e-2d4b-4f6a-8c21-7e9b0d1a2f33"
}
```

| 字段 | 说明 |
|---|---|
| `channel` | 固定 `"hashrace.v1"`；破坏性变更会升为 `"hashrace.v2"` 并与 v1 并存至少 90 天 |
| `event` | 事件名：`iframe.*` 为游戏发往你的页面，`parent.*` 为你的页面发往游戏 |
| `payload` | 该事件的专属字段 |
| `nonce` | UUID v4；回执（如 `iframe.exit_request.ack`）里原样带回 |

### 5.1 通道开通条件与安全校验

- 通道不依赖任何 Partner 域白名单（Hashrace 不需要你登记父页域名），也不依赖本次是否刚兑换过 launch（玩家刷新页面照样开通）。游戏发出的每条消息都定向到嵌入它的那个页面的 origin——先取 `location.ancestorOrigins[0]`，浏览器不提供时取 `document.referrer` 的 origin；两者都取不到时不发送任何事件，不会退化成向任意 origin 广播。因此请不要给 iframe 设 `referrerpolicy="no-referrer"`：在不提供 `location.ancestorOrigins` 的浏览器（如 Firefox）上，游戏会因此拿不到你的 origin 而不发事件。本 SDK 的 `embedHashraceIframe` 用的是 `strict-origin-when-cross-origin`，满足要求。
- 游戏只接收来自嵌入它的那个页面 origin 的消息（例如 `iframe.exit_request.ack`），其他来源一律丢弃。
- 游戏侧的定向只保护「消息不发错地方」，不替你校验来源——请按下一条在你这一侧校验。
- 接收消息时必须**依次**校验：`event.source === iframe.contentWindow` → `event.origin` 是 Hashrace 游戏的 origin（开通时告知；不接受 `"*"`，也不接受字面 `"null"`）→ `data.channel === "hashrace.v1"`。任一不符即丢弃。本 SDK 默认执行这三步。

### 5.2 游戏 → 你的页面

<!-- parity:pm-up -->
| 事件 | payload | 需应答 | 说明 |
|---|---|---|---|
| `iframe.ready` | `{ client_version, protocol_version }` | 否 | 游戏加载完成，可隐藏你的 loading。`protocol_version` 恒为 `"hashrace.v1"`，用于特性检测 |
| `iframe.exit_request` | `{ reason }` | 否（回执可选） | 玩家请求退出。`reason` 取值 `user_back`（玩家点了返回）/ `session_expired`（会话已过期）。请关闭 iframe 或回到大厅。游戏发出后不等回执：回不回、回什么都不改变游戏的行为 |
| `iframe.retry_request` | `{}` | 否 | 游戏内的会话已无法恢复（如维护后重试）。请**重新调 launch-session**，用新链接重新加载 iframe——旧链接的 token 已被兑换 |
| `iframe.support_request` | `{}` | 否 | 玩家点了「联系客服」。请打开你的客服入口 |
| `iframe.game_ended` | `{ game_id }` | 否 | 玩家离开了游戏。请关闭 iframe 或回到你的游戏列表 |
| `iframe.size_change` | `{ width, height }` | 否 | 游戏期望的容器尺寸（CSS px）。**游戏客户端尚未发送此事件** |
| `iframe.round_start` | `{ round_id, game_code, started_at }` | 否 | 一局开始，`started_at` 为 Unix 毫秒。**游戏客户端尚未发送此事件** |
| `iframe.round_end` | `{ round_id, game_code, net_change_micro, currency, ended_at }` | 否 | 一局结束。**游戏客户端尚未发送此事件**，字段见下 |
| `iframe.error` | `{ code, trace_id?, message }` | 否 | 游戏内部错误通知，未知 `code` 请原样记录。**游戏客户端尚未发送此事件** |

标注「尚未发送」的事件协议已定，你可以先实现接收侧，但现阶段不会收到，不要依赖它们（例如不要靠 `iframe.round_end` 刷新余额）。

`iframe.round_end` 字段：

<!-- parity:pm-fields:iframe.round_end -->
| 字段 | 类型 | 说明 |
|---|---|---|
| `round_id` | string | 与 `iframe.round_start` 对应 |
| `game_code` | string | 游戏代码 |
| `net_change_micro` | string | 本局玩家净变动，**微元**（1 个币种单位 = 1,000,000 微元），十进制整数字符串（`^-?[0-9]+$`），负数表示玩家净亏。用字符串是因为高面值币种的微元金额会超过 JavaScript `number` 的安全整数范围；请用 `BigInt(net_change_micro)` 解析 |
| `currency` | string | 本局币种，与钱包 Webhook 里的 `currency` 同一取值 |
| `ended_at` | number | Unix 毫秒 |

**这笔净变动已经通过 Seamless Wallet Webhook 写进了你的钱包**。收到它只需刷新余额展示，**不要再记一次账**，否则玩家余额会被重复变动。

`iframe.exit_request` 的回执（**可选**）：

```json
{
  "channel": "hashrace.v1",
  "event":   "iframe.exit_request.ack",
  "payload": { "accepted": true },
  "nonce":   "<原请求的 nonce>"
}
```

这条事件是发出即忘（fire-and-forget）：游戏不等待回执，也不按 `accepted` 的取值改变行为——不回、晚回、回 `false` 都不会让游戏显示错误页或停留在原处。要不要关 iframe 完全由你这一侧决定。用本 SDK 时可以在回调里调用 `ack({ accepted: true | false })` 发回执，不调也可以。

### 5.3 你的页面 → 游戏

<!-- parity:pm-down -->
| 事件 | payload | 说明 |
|---|---|---|
| `parent.resize` | `{ width, height }` | 你的容器尺寸变化（CSS px） |
| `parent.close_request` | `{ reason }` | 你请求游戏关闭 |
| `parent.visibility_change` | `{ visible }` | 页面可见性变化 |
| `parent.pause` | `{}` | 暂停（如插播广告） |
| `parent.resume` | `{}` | 恢复 |

这些事件名已由协议保留，**游戏当前不消费任何下行事件**，发出去不会有效果。

资金、会话、游戏控制类指令**永远不能**从页面发给游戏——余额变动只走 Seamless Wallet Webhook，登出 / 踢人由 Hashrace 服务端决定。本 SDK 的 `send()` 对下列事件名直接抛错：

<!-- parity:pm-forbidden -->
| 类别 | 事件 |
|---|---|
| 资金类 | `balance_refreshed` |
| 资金类 | `deposit_done` |
| 资金类 | `force_bet` |
| 资金类 | `force_cashout` |
| 资金类 | `set_balance` |
| 资金类 | `withdraw_done` |
| 资金类 | `bonus_granted` |
| 会话类 | `logout` |
| 会话类 | `refresh_token` |
| 会话类 | `switch_user` |
| 会话类 | `force_reconnect` |
| 会话类 | `revoke_session` |
| 游戏控制类 | `force_fold` |
| 游戏控制类 | `force_leave_table` |
| 游戏控制类 | `force_sit_out` |

---

## 6. Seamless Wallet Webhook

Hashrace 服务端调用你的 5 个钱包端点。全部是 `POST`、`Content-Type: application/json`，全部带 §2 的 4 个签名头。

<!-- parity:webhook-endpoints -->
| 路径 | 用途 | 幂等键 |
|---|---|---|
| `/wallet/balance` | 查询玩家余额 | 无（只读） |
| `/wallet/debit` | 扣款（下注） | `ref_id` |
| `/wallet/credit` | 加款（派彩 / 退还） | `ref_id` |
| `/wallet/cancel` | 冲正一笔已成功的 debit / credit | `original_ref_id` |
| `/wallet/query-txn` | 按 `ref_id` 查交易状态 | 无（只读） |

**统一约定**：

- 成功一律 HTTP 200 + 业务字段；**不允许**用 HTTP 200 + `error_code` 表达错误。
- 错误一律用 [§8](#8-错误码) 的错误体（`application/json`），**不要**返回 `application/problem+json`。
- 请在 **3 秒**内完成响应（含建连与读完请求）。超过 3 秒 Hashrace 按超时处理，见 [§7.3](#73-超时与重投)。目标 P99 ≤ 1.5 秒。

### 6.1 金额

- `amount` 类字段是 **int64 整数，单位微元**（1 个币种单位 = 1,000,000 微元）。
- 每个金额都配一个 `real_amount` 类字符串，是同一金额的十进制文本，**双方都要互相校验**：`.` 作小数点、无千分位、负数前缀 `-`、末位补零、向零截断；小数位按币种取：

| 币种 | 小数位 | 例：10 个单位 |
|---|---|---|
| `USD` / `EUR` / `CNY` / `IDR` | 2 | `"10.00"` |
| `USDT` / `USDC` / `BTC` | 6 | `"10.000000"` |
| `VND` | 0 | `"10"` |

  字符串严格相等比较（`"1.5"` ≠ `"1.50"`）。你返回的 `real_amount` 与 `amount` 对不上时，Hashrace 拒收该响应并告警；Hashrace 发来的对不上时，请返回 `INVALID_AMOUNT_PRECISION`。
- `wallet_type` 目前只有 `"C"`（现金）。收到其他值请返回 `WALLET_TYPE_NOT_SUPPORTED`，不要静默接受。
- Hashrace 从不做币种换算：`currency` 就是这笔钱的币种，你按 `(玩家, 币种)` 记账。

### 6.2 `ref_id`

`ref_id` 是一笔资金操作的幂等键，由 Hashrace 生成，形如 `1001:mines:roll:6f1c…`。请把它**整串**当作不可变字符串持久化，不要截取或解析。同一个 `ref_id` 的所有请求只能对应一笔账（见 [§7](#7-幂等与重试)）。

### 6.3 `POST /wallet/balance`

<!-- parity:webhook:BalanceReq -->
| 请求字段 | 类型 | 必选 | 说明 |
|---|---|---|---|
| `player_id` | string | 是 | launch-session 时的 `external_player_id` |
| `currency` | string | 是 | 币种 |

<!-- parity:webhook:BalanceResp -->
| 响应字段 | 类型 | 必选 | 说明 |
|---|---|---|---|
| `balance.amount` | int64 | 是 | 当前余额（微元） |
| `balance.real_amount` | string | 是 | 同一金额的十进制文本 |
| `balance.currency` | string | 是 | 币种回显 |
| `balance.wallet_type` | string | 是 | `"C"` |

### 6.4 `POST /wallet/debit`

扣款成功（你返回 200）后这笔钱才算下注成立。

<!-- parity:webhook:DebitReq -->
| 请求字段 | 类型 | 必选 | 说明 |
|---|---|---|---|
| `player_id` | string | 是 | 玩家 ID |
| `amount` | int64 | 是 | 扣款金额（微元，> 0） |
| `real_amount` | string | 是 | 十进制文本，须与 `amount` 一致 |
| `currency` | string | 是 | 币种 |
| `wallet_type` | string | 是 | `"C"` |
| `ref_id` | string | 是 | 幂等键 |
| `game_code` | string | 否 | 游戏编码，便于你的报表 |
| `round_id` | string | 否 | 局标识 |
| `type` | string | 是 | 业务类型，如 `bet` / `rebuy` / `tournament_entry` |
| `reason` | string | 否 | 人类可读说明，供报表 / 客服 |

<!-- parity:webhook:DebitResp -->
| 响应字段 | 类型 | 必选 | 说明 |
|---|---|---|---|
| `new_balance.amount` | int64 | 是 | 扣款后余额（微元） |
| `new_balance.real_amount` | string | 是 | 十进制文本 |
| `new_balance.currency` | string | 是 | 币种回显 |
| `new_balance.wallet_type` | string | 是 | `"C"` |
| `partner_txn_id` | string | 是 | 你这边的交易 ID |
| `completed_at` | int64 | 是 | 你这边落账时刻，Unix 秒 |

示例：

```json
// 请求
{"player_id":"alice_001","amount":10000000,"real_amount":"10.00","currency":"USD","wallet_type":"C","ref_id":"1001:mines:roll:abc123","game_code":"mines","type":"bet"}
// 200 响应
{"new_balance":{"amount":40000000,"real_amount":"40.00","currency":"USD","wallet_type":"C"},"partner_txn_id":"ptn_tx_8e9d2a","completed_at":1731042000}
```

### 6.5 `POST /wallet/credit`

请求字段在 debit 的基础上多两个；响应与 debit 相同。

<!-- parity:webhook:CreditReq -->
| 请求字段 | 类型 | 必选 | 说明 |
|---|---|---|---|
| `player_id` | string | 是 | 玩家 ID |
| `amount` | int64 | 是 | 加款金额（微元） |
| `real_amount` | string | 是 | 十进制文本 |
| `currency` | string | 是 | 币种 |
| `wallet_type` | string | 是 | `"C"` |
| `ref_id` | string | 是 | 幂等键 |
| `game_code` | string | 否 | 游戏编码 |
| `round_id` | string | 否 | 局标识 |
| `type` | string | 是 | 如 `win` / `bonus` / `refund` / `tournament_prize` |
| `reason` | string | 否 | 见下表 |
| `valid_bet_delta` | int64 | 否 | 本笔对应的有效投注增量（微元） |
| `net_profit` | int64 | 否 | 本笔对应的玩家净盈亏（微元，可负） |

`reason` 区分这笔钱是玩家主动拿的，还是平台替他结的——金额口径相同，只是归因不同，建议你的财务与客服分开统计：

| `reason` | 含义 |
|---|---|
| `{game}_cashout`（如 `hilo_cashout`） | 玩家主动结算 |
| `force_settle_cashout` | 平台强制结算（房间排空、维护、局超时等），按派彩处理 |
| `force_settle_refund` | 平台强制结算，该局无结果，按退还处理 |

**派彩不应被业务拒绝**：credit 返回 4xx 业务错误（幂等冲突、限流 / 维护除外）会让这笔派彩停在人工处理队列，玩家在你那边看不到这笔钱。credit 永远不应返回 `INSUFFICIENT_BALANCE`。

### 6.6 `POST /wallet/cancel`

冲正一笔已成功的 debit 或 credit。**请求不带金额**，由你按 `original_ref_id` 反查原交易。

<!-- parity:webhook:CancelReq -->
| 请求字段 | 类型 | 必选 | 说明 |
|---|---|---|---|
| `player_id` | string | 是 | 玩家 ID |
| `wallet_type` | string | 是 | `"C"` |
| `original_ref_id` | string | 是 | 被冲正交易的 `ref_id` |
| `reason` | string | 否 | 冲正原因，如 `emergency_refund` / `manual_cancel` |

<!-- parity:webhook:CancelResp -->
| 响应字段 | 类型 | 必选 | 说明 |
|---|---|---|---|
| `reverted_amount` | int64 | 是 | 被冲正的金额（微元） |
| `reverted_real_amount` | string | 是 | 十进制文本 |
| `new_balance.amount` | int64 | 是 | 冲正后余额（微元） |
| `new_balance.real_amount` | string | 是 | 十进制文本 |
| `new_balance.currency` | string | 是 | 币种 |
| `new_balance.wallet_type` | string | 是 | `"C"` |
| `partner_txn_id` | string | 是 | 你这边本次冲正的交易 ID |
| `completed_at` | int64 | 否 | 冲正落账时刻，Unix 秒（可选） |

**必须遵守**：

- **没见过的 `original_ref_id` 必须返回 200 空冲正**：`reverted_amount = 0`、`reverted_real_amount = "0"`、`new_balance` 为当前余额、照常回填 `partner_txn_id`。**不要返回 4xx**。原因：Hashrace 可能在扣款请求到达你之前就已决定冲正（那笔扣款在你这边根本没发生过），此时冲正什么都不应改变。重复收到同一个未知单号的冲正同样返回 200 空冲正。接入验证的必跑用例专门检查这一条。
- `NOT_CANCELLABLE` 只用于「这笔交易**存在**但不可冲正」：已最终结算、已冲正过，或它本身就是一笔冲正。

### 6.7 `POST /wallet/query-txn`

Hashrace 在扣款结果未知（超时）时用它确认你那边到底有没有落账。

<!-- parity:webhook:QueryTxnReq -->
| 请求字段 | 类型 | 必选 | 说明 |
|---|---|---|---|
| `ref_id` | string | 是 | 要查询的交易 |

<!-- parity:webhook:QueryTxnResp -->
| 响应字段 | 类型 | 必选 | 说明 |
|---|---|---|---|
| `status` | string | 是 | `completed` / `cancelled` / `not_found` |
| `amount` | int64 | 否 | 交易金额（微元）；`not_found` 时省略 |
| `real_amount` | string | 否 | 十进制文本；`not_found` 时省略 |
| `currency` | string | 否 | 币种；`not_found` 时省略 |
| `wallet_type` | string | 否 | `"C"`；`not_found` 时省略 |
| `type` | string | 否 | 原交易的 `type`；`not_found` 时省略 |
| `completed_at` | int64 | 否 | 落账时刻，Unix 秒；`not_found` 时省略 |
| `partner_txn_id` | string | 否 | 你这边的交易 ID；`not_found` 时省略 |

`not_found` 时只返回 `{"status":"not_found"}`。迟到完成的交易（超过 3 秒才落账的那一笔）必须能被查到。

---

## 7. 幂等与重试

### 7.1 你必须实现的幂等

| 约束 | 要求 |
|---|---|
| 同一 `ref_id` 重发 | 返回**首次结果**：HTTP 200 + 与首次相同的 `partner_txn_id` / `new_balance` / `completed_at`（cancel 同时包括 `reverted_amount`）。请持久化首次响应的这些字段 |
| 同一 `ref_id`、参数不同 | 返回 HTTP 409 `IDEMPOTENT_CONFLICT`（金额、币种、玩家任一不同） |
| **同一 `ref_id` 的并发请求** | 同一个 `ref_id` 的多个请求**同时在处理**时，也必须**只入账一次**：一个按首次处理，其余按重发返回首次结果（或 `IDEMPOTENT_CONFLICT`）。「先查有没有记录、没有再写」两步之间不加锁是典型错法——并发的两个请求会同时判定为首次、各记一次账。判重与记账必须在同一个原子单元里完成（唯一索引 + 同一事务写流水、行锁，或按 `ref_id` 串行处理） |
| 唯一性范围 | 按 `(你的 API Key, ref_id)` 唯一即可（`ref_id` 里已编码 Partner） |

为什么并发会发生：Hashrace 自己不会对同一个 `ref_id` 同时发两次请求，但一次请求超时之后的重投，可能在你那边仍在处理上一次时到达。

### 7.2 Hashrace 怎么解读你的响应

| 你的响应 | Hashrace 的处理 |
|---|---|
| 200 | 成功。重投拿到的 200 若与首次结果不一致（`partner_txn_id` / `completed_at` / `new_balance.amount`），Hashrace 告警排查 |
| 409 `IDEMPOTENT_CONFLICT` | 不重试，人工排查 |
| 429 `RATE_LIMITED`、503 `SERVER_MAINTENANCE` / `SERVICE_UNAVAILABLE` | 视为「你没处理这笔、钱没动」，稍后用**同一个 `ref_id`** 重投 |
| 5xx / 超时 / 连接失败 | credit / cancel 用同一个 `ref_id` 重投；debit 见下节 |
| 其他 4xx 业务错误 | debit：本次下注失败，玩家看到对应提示；credit / cancel：停止自动重投，转人工处理 |

### 7.3 超时与重投

| 端点 | 超时（> 3 秒）或 5xx 之后 | 你需要保证 |
|---|---|---|
| `debit` | 本次下注对玩家返回失败；约 30 秒后 Hashrace 调 `/wallet/query-txn` 确认：你回 `completed`（其实扣了）→ Hashrace 发 `cancel` 冲正；回 `not_found` → 不动钱 | 迟到完成的扣款能被 `query-txn` 查到，且能被 `cancel` 冲正 |
| `credit` / `cancel` | 用**同一个 `ref_id`** 按退避重投，直到拿到明确结果：首次失败后 30 秒，每次间隔翻倍，封顶 1 小时，最多 50 次 | 迟到完成的那一次与重投的那一次只记一笔（§7.1） |
| `balance` / `query-txn` | 不重投，由调用方稍后再查 | — |

对同一个 Partner 连续失败（连续 3 次，或最近 20 次过半）时，Hashrace 会暂停调用约 30 秒再试探恢复；暂停期间的扣款直接对玩家返回失败，不会发到你那边。

---

## 8. 错误码

### 8.1 Webhook 错误体

你的钱包接口返回错误时使用如下结构（`Content-Type: application/json`）：

```json
{
  "error_code":     "INSUFFICIENT_BALANCE",
  "message":        "balance below requested amount",
  "trace_id":       "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  "retry_after_ms": 0
}
```

<!-- parity:webhook:ErrorBody -->
| 字段 | 类型 | 必选 | 说明 |
|---|---|---|---|
| `error_code` | string | 是 | 下表之一 |
| `message` | string | 否 | 人类可读说明，便于双方排查 |
| `trace_id` | string | 否 | 你这边的链路 ID（W3C traceparent 或自定义） |
| `retry_after_ms` | int64 | 否 | 仅 5xx 时可选，建议 Hashrace 的退避毫秒数 |

### 8.2 `error_code`

<!-- parity:error-codes -->
| `error_code` | HTTP | 什么时候返回 |
|---|---|---|
| `INVALID_PARAM` | 400 | 字段缺失或非法（含 `wallet_type` 缺失） |
| `UNAUTHORIZED` | 401 | API Key 未知或已吊销 |
| `PARTNER_WEBHOOK_SIGNATURE_INVALID` | 401 | 验签失败（签名不对、时间戳偏差、Nonce 重放） |
| `FORBIDDEN` | 403 | 该调用方无权访问此端点 |
| `CURRENCY_NOT_ALLOWED` | 403 | 币种不在该玩家 / 你的可用币种内 |
| `PLAYER_NOT_FOUND` | 404 | 该币种下不存在这个玩家 |
| `IDEMPOTENT_CONFLICT` | 409 | 同一 `ref_id` 参数不同 |
| `NOT_CANCELLABLE` | 409 | 原交易存在但不可冲正（已结算 / 已冲正 / 本身是冲正） |
| `CURRENCY_DEPRECATED_NEW_BET_BLOCKED` | 409 | 币种已停用，不再接受新下注（存量派彩与冲正照常） |
| `INSUFFICIENT_BALANCE` | 422 | 余额不足（仅 debit） |
| `PLAYER_SUSPENDED` | 422 | 玩家账户被冻结 |
| `PLAYER_SELF_EXCLUDED` | 422 | 玩家自我限制生效 |
| `LIMIT_EXCEEDED` | 422 | 你的风控限额触发 |
| `INVALID_AMOUNT_PRECISION` | 422 | `amount` 与 `real_amount` 对不上 |
| `WALLET_TYPE_NOT_SUPPORTED` | 422 | `wallet_type` 不是你支持的值 |
| `PRECONDITION_FAILED` | 422 | 其他业务前置条件不满足（没有更具体的码时使用） |
| `RATE_LIMITED` | 429 | 你在限流 |
| `INTERNAL_ERROR` | 500 | 你的内部错误 |
| `SERVER_MAINTENANCE` | 503 | 你在维护窗口 |
| `SERVICE_UNAVAILABLE` | 503 | 你临时不可用 |

**必返 / 禁返**：

- 余额不足必须返回 `INSUFFICIENT_BALANCE`；玩家被冻结 / 自我限制返回 `PLAYER_SUSPENDED` / `PLAYER_SELF_EXCLUDED`——游戏据此给玩家对应提示。
- 你的数据库故障等内部错误返回 5xx，**不要**附带业务错误码。
- credit 不允许返回 `INSUFFICIENT_BALANCE`；balance 不允许返回 `IDEMPOTENT_CONFLICT`。
- 任何端点都不允许 HTTP 200 + `error_code`，不允许 `application/problem+json`。
