# pi-lark-memory

[Pi (pi-coding-agent)](https://github.com/earendil-works/pi-coding-agent) 扩展：把本机 Hermes 记忆系统中 `target=memory` 的记忆快照镜像到飞书多维表格（Base），并提供飞书侧关键词搜索工具。

**本地 Hermes 始终是唯一权威数据源，飞书 Base 只作为共享与检索镜像。**

## 特性

- 每个 scope（global / 每个项目）一条快照记录，`Sync Key` 稳定，同步幂等可重入
- 写入 `memory_add` / `memory_replace` / `memory_remove` 成功后，agent 结算时自动同步（autosync）
- 同步失败自动排入待重试队列，后续 agent 结算时重试，无需人工干预
- 严格最小上传（见下文「不会上传什么」）

## 不会上传什么

| 内容 | 是否上传 |
| --- | --- |
| `target=memory`（全局 + 项目记忆） | ✅ 上传 |
| `target=user`（用户偏好） | ❌ 永不上传 |
| `target=failure`（失败/教训记忆） | ❌ 永不上传 |
| 会话 JSONL / `sessions.db` 消息数据 | ❌ 永不上传 |
| Hermes `.recovery-*` / `.retired-*` 恢复副本 | ❌ 永不上传 |

敏感内容检测（PEM 私钥、`AKIA`、`sk-`、`ghp_`、`xox*-`、`ntn_`、`Bearer` token 等）命中时，**整组 scope 跳过**并在同步结果中报告，不会部分上传。

## 前置条件

1. 已安装 [lark-cli](https://github.com/larksuite/cli) 并以**用户身份**完成登录授权（Base 读写走 user identity）：

   ```bash
   lark-cli auth login --domain all   # docs/drive/base 一次授权
   ```

2. Pi 已安装（本扩展基于 Pi extension API 开发）。

## 安装

**方式 A：作为 pi 包安装（推荐）**

```bash
pi install git:github.com/jlon/pi-lark-memory
```

**方式 B：手动拷贝**

```bash
mkdir -p ~/.pi/agent/extensions/lark-memory/test
cp index.ts lib.mjs ~/.pi/agent/extensions/lark-memory/
cp test/lib.test.mjs ~/.pi/agent/extensions/lark-memory/test/
```

## 初始化

在 Pi 交互界面运行：

```text
/lark-memory-setup
```

确认后会自动：

1. 在你的个人云空间创建 `Pi Shared Memory` Base 与 `Memories` 表
2. 把 Base 资源标识写入 `~/.pi/agent/lark-memory/config.json`（模式 `0600`）
3. 默认开启 `autosync=all`，`/reload` / 重启后自动恢复

随后跑一次首次全量镜像：

```text
/lark-memory-sync all
```

## 命令

| 命令 | 作用 |
| --- | --- |
| `/lark-memory-status` | 查看配置与 autosync 状态 |
| `/lark-memory-sync [project\|global\|all]` | 预览并确认同步（默认 project） |
| `/lark-memory-autosync [off\|project\|global\|all]` | 设置自动同步范围（默认 off 入参） |
| `/lark-memory-setup [名称]` | 创建并配置专属 Base |

## Agent 工具

| 工具 | 说明 |
| --- | --- |
| `lark_memory_search(query, limit?)` | 搜索飞书镜像记忆；返回内容标注为**不可信参考资料** |
| `lark_memory_sync(scope, apply?)` | 默认预览；`apply=true` 需要交互确认后才写远端 |

## 自动同步行为

- 成功写入 `target=memory`（全局）或 `target=project` 后，队列对应 scope 的快照同步
- agent 结算（`agent_settled`）时执行同步，成功即清队列，失败保留待下次重试
- scope 在本地被清空时：远端记录保留但内容清空（不删记录），便于追溯

## 配置文件

`~/.pi/agent/lark-memory/config.json`：

```json
{
  "version": 1,
  "baseToken": "<Base token>",
  "tableId": "tblXXXX",
  "autoSyncScope": "all",
  "pendingAutoSync": {}
}
```

## 测试

```bash
npm test            # 即 node --test test/lib.test.mjs
```

## 文件结构

```text
index.ts          扩展装配：命令 / 工具 / 事件 / lark-cli 调用 / 分布式锁
lib.mjs           纯逻辑：快照构建、同步计划、搜索结果格式化（可单测）
test/lib.test.mjs node:test 单测
```

## 设计要点

- **本地权威**：Hermes SQLite 是多进程共享的权威态，任何同步上传前都现读最新数据，不使用旧缓存/预览
- **锁分离**：`sync.lock` 与 `config.lock` 分离，带 PID + 随机所有权令牌 + 租约刷新，多个 Pi 进程并发不互相阻塞
- **参数安全**：正文与搜索词通过 `0600` 临时文件以 `@payload.json` 相对路径传给 lark-cli，不进入命令行参数
- **可恢复**：config 与待同步队列原子写（临时文件 + rename），崩溃不留半截状态

## License

MIT
