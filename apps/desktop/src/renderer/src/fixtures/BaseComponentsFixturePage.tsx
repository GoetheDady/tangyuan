import {
  Bell,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Info,
  Search,
  Settings,
  TriangleAlert
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
            <div className={styles.formGrid}>
              <Alert>
                <Info />
                <AlertTitle>信息提示</AlertTitle>
                <AlertDescription>组件夹具使用固定、脱敏的验收数据。</AlertDescription>
              </Alert>
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertTitle>危险提示</AlertTitle>
                <AlertDescription>此状态仅用于验证破坏性语义层级。</AlertDescription>
              </Alert>
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

function FixtureSection(props: {
  id: 'actions' | 'forms' | 'selects' | 'feedback' | 'cards'
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
