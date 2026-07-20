import { useState } from 'react'
import {
  Archive,
  Bell,
  CheckCircle2,
  CircleX,
  ChevronLeft,
  ChevronRight,
  Info,
  Search,
  Settings
} from 'lucide-react'
import { toast } from 'sonner'

import styles from './BaseComponentsFixturePage.module.css'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

/** 夹具构建产物探针；生产构建不得包含此值。 */
export const BASE_COMPONENTS_FIXTURE_MARKER = 'base-components-fixture-v1'

type CardStateFixture = {
  id: 'default' | 'hover' | 'focus' | 'active' | 'selected' | 'disabled'
  label: string
  pressed?: boolean
  disabled?: boolean
  selectedIcon?: boolean
}

const CARD_STATE_FIXTURES: readonly CardStateFixture[] = [
  { id: 'default', label: '默认' },
  { id: 'hover', label: '悬停' },
  { id: 'focus', label: '键盘聚焦' },
  { id: 'active', label: '按下' },
  { id: 'selected', label: '已选中', pressed: true, selectedIcon: true },
  { id: 'disabled', label: '禁用', disabled: true }
]

/**
 * 渲染基础组件的高层验收矩阵。
 *
 * 该页面只依赖 Renderer 组件和固定脱敏数据，不读取 Preload API 或 Runtime。
 */
export default function BaseComponentsFixturePage(): React.JSX.Element {
  return (
    <TooltipProvider delayDuration={0}>
      <main data-fixture-marker={BASE_COMPONENTS_FIXTURE_MARKER} className={styles.page}>
        <div className={styles.container}>
          <header className={styles.header}>
            <Badge variant="outline" className={styles.fixtureBadge}>
              仅开发与测试构建
            </Badge>
            <h1 className={styles.heading}>基础组件验收夹具</h1>
            <p className={styles.introduction}>
              以稳定分区展示黑芝麻汤圆主题下的 variant、size、状态与 Portal 场景。
            </p>
          </header>

          <FixtureSection
            id="actions"
            title="操作组件"
            description="按钮 variant、size、图标位置、禁用态、invalid 态与 Tooltip。"
          >
            <div className={styles.row}>
              <Button>主要操作</Button>
              <Button variant="secondary">次要操作</Button>
              <Button variant="outline">描边操作</Button>
              <Button variant="ghost">幽灵操作</Button>
              <Button variant="destructive">危险操作</Button>
              <Button variant="link">链接操作</Button>
              <Button disabled>禁用操作</Button>
            </div>
            <Separator />
            <div className={styles.row}>
              <Button size="xs">超小</Button>
              <Button size="sm">小号</Button>
              <Button>默认</Button>
              <Button size="lg">大号</Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="icon" aria-label="通知说明">
                    <Bell data-icon="inline-start" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>通知说明</TooltipContent>
              </Tooltip>
            </div>
            <Separator />
            <div className={styles.row}>
              <Button>
                <Search aria-hidden="true" />
                前置图标
              </Button>
              <Button>
                后置图标
                <ChevronRight aria-hidden="true" />
              </Button>
              <Button variant="secondary">
                <ChevronLeft aria-hidden="true" />
                返回
              </Button>
              <Button variant="outline" size="icon" aria-label="搜索">
                <Search />
              </Button>
              <Button variant="ghost" size="icon" aria-label="设置">
                <Settings />
              </Button>
              <Button variant="secondary" size="icon" aria-label="通知">
                <Bell />
              </Button>
              <Button variant="outline" size="icon-xs" aria-label="超小图标按钮">
                <Search />
              </Button>
              <Button variant="outline" size="icon-sm" aria-label="小号图标按钮">
                <Settings />
              </Button>
              <Button variant="outline" size="icon-lg" aria-label="大号图标按钮">
                <Bell />
              </Button>
            </div>
            <Separator />
            <div className={styles.row}>
              <Button variant="secondary" disabled>
                次要禁用
              </Button>
              <Button variant="outline" disabled>
                描边禁用
              </Button>
              <Button variant="ghost" disabled>
                幽灵禁用
              </Button>
              <Button variant="destructive" disabled>
                危险禁用
              </Button>
              <Button variant="link" disabled>
                链接禁用
              </Button>
              <Button aria-invalid="true">无效态</Button>
            </div>
            <Separator />
            <div className={styles.row}>
              <Button className="max-w-[200px] truncate">
                这段文案会很长很长很长很长很长用来验证按钮的长文本截断表现
              </Button>
              <Button variant="secondary" size="lg">
                <Search aria-hidden="true" />
                大号带图标
              </Button>
            </div>
          </FixtureSection>

          <FixtureSection
            id="tooltips"
            title="Tooltip 辅助说明"
            description="四个方位、长短文本、图标触发器、偏移覆盖与视口边缘自动避让；悬停触发器查看浮层。"
          >
            <div className={styles.tooltipGrid}>
              <div className={styles.tooltipSample}>
                <span className={styles.tooltipSampleLabel}>上方 · top</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline">悬停查看上方说明</Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">上方 Tooltip</TooltipContent>
                </Tooltip>
              </div>

              <div className={styles.tooltipSample}>
                <span className={styles.tooltipSampleLabel}>右侧 · right</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline">悬停查看右侧说明</Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">右侧 Tooltip</TooltipContent>
                </Tooltip>
              </div>

              <div className={styles.tooltipSample}>
                <span className={styles.tooltipSampleLabel}>下方 · bottom</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline">悬停查看下方说明</Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">下方 Tooltip</TooltipContent>
                </Tooltip>
              </div>

              <div className={styles.tooltipSample}>
                <span className={styles.tooltipSampleLabel}>左侧 · left</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline">悬停查看左侧说明</Button>
                  </TooltipTrigger>
                  <TooltipContent side="left">左侧 Tooltip</TooltipContent>
                </Tooltip>
              </div>

              <div className={styles.tooltipSample}>
                <span className={styles.tooltipSampleLabel}>长文本与 10px 偏移</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="secondary">查看较长辅助说明</Button>
                  </TooltipTrigger>
                  <TooltipContent sideOffset={10} className={styles.tooltipLongContent}>
                    当前 Agent 将继承默认模型设置；你可以稍后在设置页面为它选择不同模型。
                  </TooltipContent>
                </Tooltip>
              </div>

              <div className={styles.tooltipSample}>
                <span className={styles.tooltipSampleLabel}>图标触发器</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="icon" aria-label="查看模型继承说明">
                      <Info aria-hidden="true" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>继承默认模型</TooltipContent>
                </Tooltip>
              </div>

              <div className={`${styles.tooltipSample} ${styles.tooltipEdgeSample}`}>
                <span className={styles.tooltipSampleLabel}>右侧边缘自动避让</span>
                <div className={styles.tooltipEdgeTrack}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="outline">靠近右侧边缘</Button>
                    </TooltipTrigger>
                    <TooltipContent side="right" className={styles.tooltipLongContent}>
                      当右侧空间不足时，Radix 会自动选择可用方位，避免 Tooltip 溢出视口。
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </div>
          </FixtureSection>

          <FixtureSection
            id="separators"
            title="Separator 内容分隔"
            description="1px 语义边框、全宽与内缩水平线、固定高度垂直线，以及文字分隔组合。"
          >
            <div className={styles.separatorGrid}>
              <div className={styles.separatorSample}>
                <span className={styles.separatorSampleLabel}>水平全宽</span>
                <div className={styles.separatorCopy}>
                  <strong>模型设置</strong>
                  <span>跟随父容器宽度，不通过阴影制造层级。</span>
                </div>
                <Separator data-testid="separator-full-width" />
                <span className={styles.separatorHint}>默认 decorative · Level 0</span>
              </div>

              <div className={`${styles.separatorSample} ${styles.separatorMutedSample}`}>
                <span className={styles.separatorSampleLabel}>水平内缩</span>
                <div className={styles.separatorCopy}>
                  <strong>会话分组</strong>
                  <span>内缩由父布局提供，基础组件 API 保持不变。</span>
                </div>
                <div className={styles.separatorInsetWrapper} data-testid="separator-inset-wrapper">
                  <Separator data-testid="separator-inset" />
                </div>
                <span className={styles.separatorHint}>父布局左右各提供 24px</span>
              </div>

              <div className={`${styles.separatorSample} ${styles.separatorMutedSample}`}>
                <span className={styles.separatorSampleLabel}>垂直方向</span>
                <div className={styles.separatorToolbar} aria-label="Separator 垂直工具栏">
                  <span>刷新</span>
                  <span
                    className={styles.separatorVerticalTrack}
                    data-testid="separator-vertical-track"
                  >
                    <Separator data-testid="separator-vertical" orientation="vertical" />
                  </span>
                  <span>导出</span>
                  <span className={styles.separatorVerticalTrack}>
                    <Separator orientation="vertical" />
                  </span>
                  <span>设置</span>
                </div>
                <span className={styles.separatorHint}>在 24px 确定父高度中完整填充</span>
              </div>

              <div className={styles.separatorSample}>
                <span className={styles.separatorSampleLabel}>文字分隔组合</span>
                <div className={styles.separatorLabelRow}>
                  <strong>高级设置</strong>
                  <Separator className="min-w-0 flex-1" />
                </div>
                <div className={styles.separatorLabelRow}>
                  <Separator className="min-w-0 flex-1" />
                  <span>或者</span>
                  <Separator className="min-w-0 flex-1" />
                </div>
                <Separator decorative={false} aria-label="语义内容分区" />
              </div>
            </div>
          </FixtureSection>

          <FixtureSection
            id="forms"
            title="表单组件"
            description="Label 与 Input、Textarea 的关联、排版、长文本和禁用反馈，以及控件的常用状态。"
          >
            <div className={styles.formGrid}>
              <div className={styles.field}>
                <div className="text-muted-foreground">
                  <Label htmlFor="fixture-name" data-fixture-label-state="default">
                    显示名称
                  </Label>
                </div>
                <Input id="fixture-name" defaultValue="汤圆" />
              </div>
              <div className={styles.field}>
                <Label htmlFor="fixture-long-label" data-fixture-label-state="long">
                  这是一个用于验证标签在有限宽度内保持清晰排版的长文本控件名称
                </Label>
                <Input id="fixture-long-label" defaultValue="长标签关联控件" />
              </div>
              <div className={styles.field}>
                <Label htmlFor="fixture-password">API Key</Label>
                <Input id="fixture-password" type="password" defaultValue="secret-token-1234" />
              </div>
              <div className={styles.field}>
                <Label htmlFor="fixture-long-value">长值输入</Label>
                <Input
                  id="fixture-long-value"
                  defaultValue="这段文案会很长很长很长很长用来验证输入框的长文本表现"
                />
              </div>
              <div className={styles.field}>
                <Label htmlFor="fixture-placeholder">占位输入</Label>
                <Input id="fixture-placeholder" placeholder="请输入内容..." />
              </div>
              <div className={styles.field}>
                <Label htmlFor="fixture-disabled" data-fixture-label-state="disabled-input">
                  禁用输入
                </Label>
                <Input id="fixture-disabled" value="不可编辑" disabled readOnly />
              </div>
              <div className={styles.field}>
                <Label htmlFor="fixture-readonly">只读输入</Label>
                <Input id="fixture-readonly" value="只读内容" readOnly />
              </div>
              <div className={styles.field}>
                <Label htmlFor="fixture-invalid">无效输入</Label>
                <Input
                  id="fixture-invalid"
                  defaultValue="格式待修正"
                  aria-invalid="true"
                  aria-describedby="fixture-invalid-help"
                />
                <p id="fixture-invalid-help" className={styles.errorText}>
                  请检查输入格式。
                </p>
              </div>
              <div className={styles.field}>
                <Label htmlFor="fixture-required">必填输入</Label>
                <Input id="fixture-required" required placeholder="此项必填" />
              </div>
              <div className={styles.field}>
                <Label htmlFor="fixture-file">文件上传</Label>
                <Input id="fixture-file" type="file" />
              </div>
              <div className={styles.field}>
                <Label htmlFor="fixture-provider">模型服务</Label>
                <Select defaultValue="anthropic">
                  <SelectTrigger id="fixture-provider">
                    <SelectValue placeholder="选择模型服务" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>可用服务</SelectLabel>
                      <SelectItem value="anthropic">Anthropic（测试数据）</SelectItem>
                      <SelectItem value="openai">OpenAI（测试数据）</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className={styles.field}>
              <Label htmlFor="fixture-notes" data-fixture-label-state="textarea">
                验收说明
              </Label>
              <Textarea id="fixture-notes" defaultValue="固定测试数据，不包含真实 API Key。" />
            </div>
            <div className={styles.field}>
              <Label htmlFor="fixture-textarea-empty">空文本域</Label>
              <Textarea id="fixture-textarea-empty" placeholder="请输入多行内容..." />
            </div>
            <div className={styles.field}>
              <Label htmlFor="fixture-textarea-multiline">多行内容</Label>
              <Textarea
                id="fixture-textarea-multiline"
                defaultValue={'第一行内容\n第二行内容\n第三行内容'}
                rows={4}
              />
            </div>
            <div className={styles.field}>
              <Label htmlFor="fixture-textarea-long-line">超长行内容</Label>
              <Textarea
                id="fixture-textarea-long-line"
                defaultValue="这段文案会很长很长很长很长用来验证文本域的长文本不会溢出或破坏父布局，并且可以在文本域中正常换行显示"
              />
            </div>
            <div className={styles.field}>
              <Label htmlFor="fixture-textarea-tall">指定高度</Label>
              <Textarea id="fixture-textarea-tall" defaultValue="高文本域" rows={8} />
            </div>
            <div className={styles.field}>
              <Label htmlFor="fixture-textarea-resize">可拖拽调整大小</Label>
              <Textarea
                id="fixture-textarea-resize"
                defaultValue="拖拽右下角调整大小"
                className="resize"
              />
            </div>
            <div className={styles.field}>
              <Label
                htmlFor="fixture-textarea-disabled"
                data-fixture-label-state="disabled-textarea"
              >
                禁用文本域
              </Label>
              <Textarea
                id="fixture-textarea-disabled"
                value="不可编辑的多行内容"
                disabled
                readOnly
              />
            </div>
            <div className={styles.field}>
              <Label htmlFor="fixture-textarea-invalid">无效文本域</Label>
              <Textarea
                id="fixture-textarea-invalid"
                defaultValue="格式待修正的多行内容"
                aria-invalid="true"
                aria-describedby="fixture-textarea-invalid-help"
              />
              <p id="fixture-textarea-invalid-help" className={styles.errorText}>
                请检查输入格式。
              </p>
            </div>
            <div className={styles.field}>
              <Label htmlFor="fixture-textarea-required">必填文本域</Label>
              <Textarea id="fixture-textarea-required" required placeholder="此项必填" />
            </div>
          </FixtureSection>

          <FixtureSection
            id="selects"
            title="选择器"
            description="Select Trigger 状态、Item 状态、分组、分隔与长列表滚动。"
          >
            <div className={styles.formGrid}>
              <div className={styles.field}>
                <Label htmlFor="fixture-select-placeholder">占位选择器</Label>
                <Select>
                  <SelectTrigger id="fixture-select-placeholder">
                    <SelectValue placeholder="请选择一项内容..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="a">选项 A</SelectItem>
                    <SelectItem value="b">选项 B</SelectItem>
                    <SelectItem value="c">选项 C</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className={styles.field}>
                <Label htmlFor="fixture-select-disabled">禁用选择器</Label>
                <Select defaultValue="disabled-example">
                  <SelectTrigger id="fixture-select-disabled" disabled>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="disabled-example">不可用</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className={styles.field}>
                <Label htmlFor="fixture-select-invalid">无效选择器</Label>
                <Select>
                  <SelectTrigger id="fixture-select-invalid" aria-invalid="true">
                    <SelectValue placeholder="格式待修正" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="a">选项 A</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className={styles.field}>
                <Label htmlFor="fixture-select-long-text">长文本选择器</Label>
                <Select defaultValue="long-text-value">
                  <SelectTrigger id="fixture-select-long-text">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="long-text-value">
                      这段文案会很长很长很长很长用来验证选择器的长文本截断表现
                    </SelectItem>
                    <SelectItem value="short">短选项</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className={styles.field}>
                <Label htmlFor="fixture-select-grouped">分组与分隔</Label>
                <Select defaultValue="banana">
                  <SelectTrigger id="fixture-select-grouped">
                    <SelectValue placeholder="选择食物" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>水果</SelectLabel>
                      <SelectItem value="apple">苹果</SelectItem>
                      <SelectItem value="banana">香蕉</SelectItem>
                      <SelectItem value="orange">橙子</SelectItem>
                    </SelectGroup>
                    <SelectSeparator />
                    <SelectGroup>
                      <SelectLabel>蔬菜</SelectLabel>
                      <SelectItem value="carrot">胡萝卜</SelectItem>
                      <SelectItem value="broccoli">西兰花</SelectItem>
                    </SelectGroup>
                    <SelectSeparator />
                    <SelectItem value="water" disabled>
                      水（不可选）
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className={styles.field}>
                <Label htmlFor="fixture-select-scroll">长列表滚动</Label>
                <Select defaultValue="item-1">
                  <SelectTrigger id="fixture-select-scroll">
                    <SelectValue placeholder="从 20 项中选择" />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 20 }, (_, i) => (
                      <SelectItem key={i + 1} value={`item-${i + 1}`}>
                        选项 {String(i + 1).padStart(2, '0')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </FixtureSection>

          <FixtureSection
            id="dropdown-menus"
            title="DropdownMenu 复合菜单"
            description="普通操作、分组、危险与禁用项、Checkbox、Radio，以及受控和非受控子菜单。"
          >
            <DropdownMenuFixtureMatrix />
          </FixtureSection>

          <FixtureSection
            id="feedback"
            title="反馈与层级"
            description="Badge、Alert、Card、AlertDialog Portal 与 Toaster。"
          >
            <div className={styles.row}>
              <Badge>默认 Badge</Badge>
              <Badge variant="secondary">次要 Badge</Badge>
              <Badge variant="success">成功 Badge</Badge>
              <Badge variant="destructive">危险 Badge</Badge>
              <Badge variant="outline">描边 Badge</Badge>
            </div>
            <Separator />
            <div className={styles.row}>
              <Badge variant="secondary" className="max-w-48" data-testid="badge-long-text">
                这是一段很长很长很长很长用来验证高度与溢出的 Badge 文案
              </Badge>
              <Badge variant="success" data-testid="badge-icon">
                <CheckCircle2 aria-hidden="true" />
                图标组合
              </Badge>
            </div>
            <div className={styles.alertGrid} data-fixture-alerts>
              <Alert variant="info" data-testid="alert-info">
                <Info aria-hidden="true" />
                <AlertTitle>有可用更新</AlertTitle>
                <AlertDescription>新版本将在下次启动时自动应用。</AlertDescription>
              </Alert>
              <Alert variant="success" data-testid="alert-success">
                <CheckCircle2 aria-hidden="true" />
                <AlertTitle>设置已保存</AlertTitle>
                <AlertDescription>新的模型配置已经生效。</AlertDescription>
              </Alert>
              <Alert variant="warning" data-testid="alert-warning">
                <AlertTitle>
                  上下文即将达到上限，这是一段用于验证标题在有限宽度内自然换行且不会被截断的长标题，并继续补充固定文案以确认第二行仍然完整可读
                </AlertTitle>
                <AlertDescription>
                  继续运行可能压缩较早的消息；这段较长说明用于确认没有图标时，文字仍与容器左侧保持正确对齐并自然换行，同时在第二行继续展示完整的状态说明。
                </AlertDescription>
              </Alert>
              <Alert variant="destructive" data-testid="alert-destructive">
                <CircleX aria-hidden="true" />
                <AlertTitle>连接失败</AlertTitle>
                <AlertDescription>
                  <p>无法验证 Provider 凭据，请检查密钥后重试。</p>
                  <Button type="button" size="sm" variant="outline">
                    重新验证
                  </Button>
                </AlertDescription>
              </Alert>
            </div>
          </FixtureSection>

          <FixtureSection
            id="alert-dialogs"
            title="AlertDialog 关键确认"
            description="default、sm、危险操作、长内容与安全默认焦点；所有内容通过 Portal 渲染。"
          >
            <div className={styles.alertDialogGrid} data-fixture-alert-dialogs>
              <AlertDialogFixtureSample
                label="default · 512px"
                summary="标准高影响确认，包含明确标题、后果说明和两项操作。"
                triggerLabel="打开 default 对话框"
                title="确认验收动作"
                dialogDescription="对话框通过 Portal 渲染；此操作不会读写任何真实配置。"
                cancelLabel="取消"
                actionLabel="确认"
              />
              <AlertDialogFixtureSample
                label="sm · 320px"
                summary="紧凑确认在窄内容中保持按钮顺序和安全边距。"
                triggerLabel="打开 sm 对话框"
                size="sm"
                title="切换默认模型？"
                dialogDescription="新会话将使用所选模型。"
                cancelLabel="取消切换"
                actionLabel="确认切换"
              />
              <AlertDialogFixtureSample
                label="危险确认 · Cancel 默认焦点"
                summary="归档属于高影响操作，确认按钮使用 destructive 层级。"
                triggerLabel="打开危险确认"
                triggerVariant="destructive"
                media={<Archive aria-hidden="true" />}
                title="确认归档这个 Agent？"
                dialogDescription={
                  <>归档后将无法创建新会话，但历史记录仍会保留。你之后可以从 Agent 列表中恢复。</>
                }
                cancelLabel="取消"
                actionLabel="归档 Agent"
                actionVariant="destructive"
              />
              <AlertDialogFixtureSample
                label="长内容 · 自然换行"
                summary="固定长文案验证标题、说明和操作区不会溢出视口。"
                triggerLabel="打开长内容对话框"
                title="确认将“研究资料整理与长期知识维护 Agent”归档？"
                dialogDescription="归档后，这个 Agent 将从日常使用列表中移除，并且不能继续创建新会话；已有身份设定、Skills、工作空间和历史会话都会保留。你可以稍后在设置页面的已归档列表中恢复它，恢复后即可继续使用。"
                cancelLabel="暂不归档"
                actionLabel="确认归档"
                actionVariant="destructive"
              />
            </div>
          </FixtureSection>

          <FixtureSection
            id="cards"
            title="Card 内容容器"
            description="完整组合、default/compact 密度、长内容、操作 Footer 与整卡交互状态。"
          >
            <div className={styles.cardGrid}>
              <Card data-testid="card-default">
                <CardHeader>
                  <CardTitle>Agent 配置</CardTitle>
                  <CardDescription>管理当前 Agent 的模型与运行参数。</CardDescription>
                </CardHeader>
                <CardContent>
                  <dl className={styles.cardDetails}>
                    <div className={styles.cardDetailRow}>
                      <dt>模型</dt>
                      <dd>Claude Sonnet 4</dd>
                    </div>
                    <div className={styles.cardDetailRow}>
                      <dt>工作空间</dt>
                      <dd>~/gdsw/tangyuan</dd>
                    </div>
                  </dl>
                </CardContent>
                <CardFooter className={styles.cardFooter}>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline">打开确认对话框</Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>确认验收动作</AlertDialogTitle>
                        <AlertDialogDescription>
                          对话框通过 Portal 渲染；此操作不会读写任何真实配置。
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction>确认</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  <Button variant="secondary" onClick={() => toast.success('组件验收通知已显示')}>
                    显示验收通知
                  </Button>
                </CardFooter>
              </Card>

              <Card size="compact" data-testid="card-compact">
                <CardHeader>
                  <CardTitle>紧凑运行摘要</CardTitle>
                  <CardDescription>16px 内边距用于并列信息与紧凑列表。</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className={styles.longCardCopy}>
                    这是一段用于验证长内容换行的固定说明。Card 在 1024、1280 与 1440+
                    宽度下都应保持边框、内边距和内容层级稳定，不依赖装饰阴影制造分组。
                  </p>
                </CardContent>
              </Card>
            </div>

            <div className={styles.cardStateGrid} aria-label="整卡操作状态">
              {CARD_STATE_FIXTURES.map((state) => (
                <div key={state.id} className={styles.cardState}>
                  <span className={styles.cardStateLabel}>{state.label}</span>
                  <Card asChild interactive size="compact">
                    <button
                      type="button"
                      aria-pressed={state.pressed}
                      disabled={state.disabled}
                      data-testid={`card-interactive-${state.id}`}
                    >
                      <span className={styles.interactiveCardContent}>
                        <span className={styles.interactiveCardTitle}>
                          Agent 卡片
                          {state.selectedIcon ? <CheckCircle2 aria-hidden="true" /> : null}
                        </span>
                        <span className={styles.interactiveCardDescription}>状态说明</span>
                      </span>
                    </button>
                  </Card>
                </div>
              ))}
            </div>
          </FixtureSection>
        </div>
      </main>
    </TooltipProvider>
  )
}

function DropdownMenuFixtureMatrix(): React.JSX.Element {
  const [lastAction, setLastAction] = useState('尚未执行')
  const [historyKept, setHistoryKept] = useState(true)
  const [timestampsVisible, setTimestampsVisible] = useState(false)
  const [uncontrolledDensity, setUncontrolledDensity] = useState('compact')
  const [controlledDensity, setControlledDensity] = useState('detailed')
  const [uncontrolledSubmenuState, setUncontrolledSubmenuState] = useState('closed')
  const [controlledSubmenuOpen, setControlledSubmenuOpen] = useState(false)

  return (
    <div className={styles.dropdownMenuGrid} data-fixture-dropdown-menus>
      <div className={styles.dropdownMenuSample} data-testid="dropdown-menu-actions-sample">
        <span className={styles.dropdownMenuSampleLabel}>普通操作、分组与状态</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">菜单：普通操作</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" data-testid="dropdown-menu-actions-content">
            <DropdownMenuLabel>Agent 操作</DropdownMenuLabel>
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={() => setLastAction('重命名')}>
                重命名
                <DropdownMenuShortcut>⌘R</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setLastAction('复制')}>
                复制
                <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem disabled onSelect={() => setLastAction('禁用项被激活')}>
                锁定项（不可用）
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuSub
              onOpenChange={(open) => setUncontrolledSubmenuState(open ? 'open' : 'closed')}
            >
              <DropdownMenuSubTrigger>移动到</DropdownMenuSubTrigger>
              <DropdownMenuSubContent data-testid="dropdown-menu-uncontrolled-sub-content">
                <DropdownMenuItem onSelect={() => setLastAction('移动到工作空间')}>
                  工作空间
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setLastAction('移动到归档区')}>
                  归档区
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setLastAction('归档 Agent')}>
              归档 Agent
              <DropdownMenuShortcut>⌥⌘A</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <output className={styles.dropdownMenuStatus} data-testid="dropdown-menu-last-action">
          最近操作：{lastAction}
        </output>
        <output
          className={styles.dropdownMenuStatus}
          data-testid="dropdown-menu-uncontrolled-sub-state"
        >
          非受控子菜单：{uncontrolledSubmenuState}
        </output>
      </div>

      <div className={styles.dropdownMenuSample} data-testid="dropdown-menu-checkbox-sample">
        <span className={styles.dropdownMenuSampleLabel}>Checkbox · 非受控与受控</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">菜单：Checkbox</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" data-testid="dropdown-menu-checkbox-content">
            <DropdownMenuLabel>显示选项</DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              defaultChecked
              onCheckedChange={(checked) => setHistoryKept(checked === true)}
            >
              保留历史记录
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={timestampsVisible}
              onCheckedChange={(checked) => setTimestampsVisible(checked === true)}
            >
              显示时间戳
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <output className={styles.dropdownMenuStatus} data-testid="dropdown-menu-history-state">
          非受控：{historyKept ? 'checked' : 'unchecked'}
        </output>
        <output className={styles.dropdownMenuStatus} data-testid="dropdown-menu-timestamps-state">
          受控：{timestampsVisible ? 'checked' : 'unchecked'}
        </output>
      </div>

      <div className={styles.dropdownMenuSample} data-testid="dropdown-menu-radio-sample">
        <span className={styles.dropdownMenuSampleLabel}>Radio · 非受控与受控</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">菜单：Radio</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" data-testid="dropdown-menu-radio-content">
            <DropdownMenuLabel>非受控密度</DropdownMenuLabel>
            <DropdownMenuRadioGroup defaultValue="compact" onValueChange={setUncontrolledDensity}>
              <DropdownMenuRadioItem value="compact">紧凑</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="comfortable">舒适</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>受控布局</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={controlledDensity} onValueChange={setControlledDensity}>
              <DropdownMenuRadioItem value="compact">列表布局</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="detailed">详细布局</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <output
          className={styles.dropdownMenuStatus}
          data-testid="dropdown-menu-uncontrolled-radio-state"
        >
          非受控：{uncontrolledDensity}
        </output>
        <output
          className={styles.dropdownMenuStatus}
          data-testid="dropdown-menu-controlled-radio-state"
        >
          受控：{controlledDensity}
        </output>
      </div>

      <div className={styles.dropdownMenuSample} data-testid="dropdown-menu-submenu-sample">
        <span className={styles.dropdownMenuSampleLabel}>Submenu · 受控</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">菜单：受控子菜单</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" data-testid="dropdown-menu-controlled-root-content">
            <DropdownMenuItem onSelect={() => setLastAction('查看详情')}>查看详情</DropdownMenuItem>
            <DropdownMenuSub open={controlledSubmenuOpen} onOpenChange={setControlledSubmenuOpen}>
              <DropdownMenuSubTrigger>共享到</DropdownMenuSubTrigger>
              <DropdownMenuSubContent data-testid="dropdown-menu-controlled-sub-content">
                <DropdownMenuItem onSelect={() => setLastAction('共享到工作空间')}>
                  工作空间
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setLastAction('共享到文件')}>
                  文件
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
        <output
          className={styles.dropdownMenuStatus}
          data-testid="dropdown-menu-controlled-sub-state"
        >
          受控子菜单：{controlledSubmenuOpen ? 'open' : 'closed'}
        </output>
      </div>
    </div>
  )
}

type AlertDialogFixtureSampleProps = {
  label: string
  summary: string
  triggerLabel: string
  triggerVariant?: 'outline' | 'destructive'
  size?: 'default' | 'sm'
  media?: React.ReactNode
  title: React.ReactNode
  dialogDescription: React.ReactNode
  cancelLabel: string
  actionLabel: string
  actionVariant?: 'default' | 'destructive'
}

function AlertDialogFixtureSample({
  label,
  summary,
  triggerLabel,
  triggerVariant = 'outline',
  size = 'default',
  media,
  title,
  dialogDescription,
  cancelLabel,
  actionLabel,
  actionVariant = 'default'
}: AlertDialogFixtureSampleProps): React.JSX.Element {
  return (
    <div className={styles.alertDialogSample}>
      <span className={styles.alertDialogSampleLabel}>{label}</span>
      <p className={styles.alertDialogSampleDescription}>{summary}</p>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant={triggerVariant}>{triggerLabel}</Button>
        </AlertDialogTrigger>
        <AlertDialogContent size={size}>
          <AlertDialogHeader>
            {media ? <AlertDialogMedia>{media}</AlertDialogMedia> : null}
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{dialogDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
            <AlertDialogAction variant={actionVariant}>{actionLabel}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function FixtureSection(props: {
  id:
    | 'actions'
    | 'tooltips'
    | 'separators'
    | 'forms'
    | 'selects'
    | 'dropdown-menus'
    | 'feedback'
    | 'alert-dialogs'
    | 'cards'
  title: string
  description: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section
      data-fixture-section={props.id}
      aria-labelledby={`fixture-section-${props.id}`}
      className={styles.section}
    >
      <div className={styles.sectionHeader}>
        <h2 id={`fixture-section-${props.id}`} className={styles.sectionTitle}>
          {props.title}
        </h2>
        <p className={styles.sectionDescription}>{props.description}</p>
      </div>
      <div className={styles.sectionContent}>{props.children}</div>
    </section>
  )
}
