# 业务代码字号统一到语义字阶

`main.css` 的 `@theme` 已定义一套语义字阶（`text-page-title`/`text-section-heading`/`text-body`/`text-label`/`text-caption`/`text-mono`），但 renderer 业务代码长期直接写 Tailwind 原子类和方括号硬编码（`text-sm`/`text-xs`/`text-[13px]`/`text-[26px]` 等），导致同一消息流里用户消息 14px、Agent 回复 12px 等不一致。我们决定：业务代码（`pages/` 与非 `ui/` 的 `components/`）的正文与标题级字号一律使用语义 token，消灭方括号硬编码。

## Considered Options

- **只用 Tailwind 原厂档（放弃语义字阶）**：被否。原厂档没有 caption 11px、page-title 28px，且行高偏紧（正文 20px 而非本项目的 22px），会牺牲 ADR-0007「靠字号建立层级」的落地。
- **保留语义字阶，业务代码统一到它**（本决策）。

## 边界

- **不动 `components/ui/`**：shadcn 上游组件保留 `text-sm`/`text-xs`/`text-base`，数值上已等于 body/label；改动会与未来 shadcn 升级 diff 冲突。
- **保留 8/9/10px 装饰性小字**：会话分组标签、执行历史回合标签、时间戳/meta 等密集元信息区刻意低于 caption(11px)，属 ADR-0007 的层级设计，不并入字阶，因此字阶不覆盖这一档。

## 映射

`text-sm`→`text-body`(14)、`text-xs`→`text-label`(12)、`text-lg`→`text-section-heading`(18)、`text-[11px]`→`text-caption`(11)、`text-[13px]`→`text-body`(14)、`text-[26px]`→`text-page-title`(28)。字号带 token 后删除手动 `leading-[...]`，行高跟随 token。
